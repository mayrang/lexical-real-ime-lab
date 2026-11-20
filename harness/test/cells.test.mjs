import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cellVerdict, l4Diffs} from '../core/cells.mjs';
import {buildReport, renderMarkdown} from '../core/report.mjs';

const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8'));
const J = (verdict, failed = []) => ({verdict, failed, reasons: [], diffs: {l3: null}});
const word = () => '한국어 ';
const scenarios = [{id: 'plain-end', word}];

test('cellVerdict: 여섯 경우', () => {
  assert.equal(cellVerdict([J('pass'), J('pass'), J('pass')]), 'pass');
  assert.equal(cellVerdict([J('fail', [2]), J('fail', [2]), J('fail', [2])]), 'fail');
  assert.equal(cellVerdict([J('fail', [2]), J('fail', [1, 2]), J('fail', [2])]), 'inconclusive');
  assert.equal(cellVerdict([J('pass'), J('fail', [2]), J('pass')]), 'flaky');
  assert.equal(cellVerdict([J('pass'), J('inconclusive'), J('pass')]), 'inconclusive');
  assert.equal(cellVerdict([J('harness'), J('inconclusive'), J('pass')]), 'harness');
});

test('cellVerdict: harness가 pass 둘보다 앞선다', () => {
  assert.equal(cellVerdict([J('harness'), J('pass'), J('pass')]), 'harness');
});

test('l4Diffs: Firefox만 다르면 표시', () => {
  const c = (browser, text) => ({key: `s|ko|linux|ibus|${browser}`, cell: {scen: 's', lang: 'ko', browser}, text});
  const out = l4Diffs([c('chromium', '한국어 '), c('firefox', '한국ㅓ '), c('webkit', '한국어 ')]);
  assert.equal(out.length, 1);
  assert.deepEqual([out[0].scen, out[0].lang], ['s', 'ko']);
  assert.equal(out[0].variants.length, 3);
  assert.deepEqual(l4Diffs([c('chromium', 'a'), c('firefox', 'a')]), []);
});

const rec = (name, rep) => ({...structuredClone(load(name)), rep});

test('buildReport: 칸 판정과 파일 이름', () => {
  const rs = [1, 2, 3].map((n) => ({...rec('d1', n), _file: `d1-${n}.json`}));
  const rep = buildReport(rs, scenarios);
  assert.equal(rep.cells.length, 1);
  const c = rep.cells[0];
  assert.equal(c.verdict, 'fail');
  assert.deepEqual(c.failed, [2]);
  assert.deepEqual(c.runs.map((r) => r.file), ['d1-1.json', 'd1-2.json', 'd1-3.json']);
  assert.ok(c.l2Diff);
  assert.equal(rep.summary.byVerdict.fail, 1);
});

test('buildReport: 모르는 시나리오는 inconclusive', () => {
  const rep = buildReport([rec('pass', 1)], [], {reps: 1});
  assert.equal(rep.cells[0].verdict, 'inconclusive');
  assert.match(rep.cells[0].runs[0].reasons[0], /unknown scenario/);
});

test('renderMarkdown: 표와 실패 줄', () => {
  const rs = [rec('pass', 1), rec('pass', 2), rec('pass', 3), ...[1, 2, 3].map((n) => ({...rec('d1', n), cell: {...load('d1').cell, os: 'mac'}}))];
  const md = renderMarkdown(buildReport(rs, scenarios));
  assert.match(md, /linux/);
  assert.match(md, /mac/);
  assert.match(md, /fail/);
  assert.doesNotMatch(md, /<[a-z]+>/);
});

test('buildReport: 실행이 reps보다 적으면 harness (H3)', () => {
  const rep = buildReport([rec('pass', 1)], scenarios);
  assert.equal(rep.cells[0].verdict, 'harness');
  assert.deepEqual(rep.cells[0].reasons, ['H3 missing runs: 1/3']);
  assert.equal(buildReport([rec('pass', 1)], scenarios, {reps: 1}).cells[0].verdict, 'pass');
});
