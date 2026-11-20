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

test('report: replay 기록은 변형마다 칸이 따로, 시나리오는 변형 없이 찾는다', async () => {
  const {scenariosFor} = await import('../scenarios/index.mjs');
  const fx = JSON.parse(readFileSync(new URL('./fixtures/pass.json', import.meta.url), 'utf8'));
  const recs = [];
  for (const variant of ['parent', 'fix']) {
    for (let rep = 1; rep <= 3; rep++) {
      const r = structuredClone(fx);
      r.rep = rep;
      r.cell = {...r.cell, scen: `b8121@${variant}`, lang: 'ko', os: 'macos', browser: 'chromium'};
      r.control.before = r.lexical.before = {text: 'hello world', selStart: 0, selEnd: 11};
      r.control.after.text = '가 ';
      r.lexical.after.text = r.lexical.after.domText = variant === 'parent' ? 'ㅏ ' : '가 ';
      r.control.after.paragraphs = r.lexical.after.paragraphs = 1;
      recs.push(r);
    }
  }
  const rep = buildReport(recs, scenariosFor('replay'));
  assert.deepEqual(rep.cells.map((c) => [c.cell.scen, c.verdict, c.failed]),
    [['b8121@fix', 'pass', []], ['b8121@parent', 'fail', [2]]]);
  const md = renderMarkdown(rep);
  assert.match(md, /## replay: 커밋별 판정/);
  // The cell key's pipes are escaped, so the row has exactly four columns.
  const row = md.split('\n').find((l) => l.startsWith('| b8121'));
  assert.equal(row, `| b8121\\|ko\\|macos\\|${recs[0].cell.ime}\\|chromium | fail [2] | pass | - |`);
  assert.equal(row.split(/(?<!\\)\|/).length - 2, 4);
});

test('buildReport: reps must be distinct and exactly reps (H3)', () => {
  const dup = buildReport([rec('pass', 1), rec('pass', 1), rec('pass', 2)], scenarios);
  assert.equal(dup.cells[0].verdict, 'harness');
  assert.deepEqual(dup.cells[0].reasons, ['H3 runs: 3 Records, 2 distinct reps, expected 3']);
  const extra = buildReport([1, 2, 3, 4].map((n) => rec('pass', n)), scenarios);
  assert.equal(extra.cells[0].verdict, 'harness');
  assert.deepEqual(extra.cells[0].reasons, ['H3 runs: 4 Records, 4 distinct reps, expected 3']);
  assert.equal(buildReport([1, 2, 3].map((n) => rec('pass', n)), scenarios).cells[0].verdict, 'pass');
});

test('buildReport: a planned cell with no Record is a harness cell; skipped cells are listed, not counted', () => {
  const rs = [1, 2, 3].map((n) => rec('pass', n));
  const c0 = rs[0].cell;
  const plans = [{
    planned: [
      {scen: c0.scen, lang: c0.lang, os: c0.os, browser: c0.browser, ime: null},
      {scen: c0.scen, lang: 'ja', os: c0.os, browser: c0.browser, ime: null},
    ],
    skipped: [{scen: c0.scen, lang: 'zh', os: c0.os, browser: c0.browser, ime: null}],
  }];
  const rep = buildReport(rs, scenarios, {plans});
  assert.equal(rep.cells.length, 2);
  const miss = rep.cells.find((c) => c.cell.lang === 'ja');
  assert.equal(miss.verdict, 'harness');
  assert.deepEqual(miss.reasons, ['H3 missing cell: planned, no Record']);
  assert.equal(rep.cells.find((c) => c.cell.lang === c0.lang).verdict, 'pass');
  assert.equal(rep.summary.skipped, 1);
  assert.equal(rep.summary.byVerdict.harness, 1);
  const md = renderMarkdown(rep);
  assert.match(md, /skip\(cell\)으로 돌리지 않은 칸: 1개/);
  assert.match(md, new RegExp(`- ${c0.scen}\\|zh\\|`));
});

test('buildReport: a plan with an IME is matched on the full key (ibus Records do not hide fcitx5 cells)', () => {
  const rs = [1, 2, 3].map((n) => rec('pass', n));
  const c0 = rs[0].cell;
  const plan = (ime) => ({scen: c0.scen, lang: c0.lang, os: c0.os, browser: c0.browser, ime});
  const rep = buildReport(rs, scenarios, {plans: [{planned: [plan(c0.ime), plan('other-ime')], skipped: []}]});
  assert.equal(rep.cells.length, 2);
  const miss = rep.cells.find((c) => c.cell.ime === 'other-ime');
  assert.equal(miss.verdict, 'harness');
  assert.deepEqual(miss.reasons, ['H3 missing cell: planned, no Record']);
  // ime null (macOS, Windows): matched without the IME.
  assert.equal(buildReport(rs, scenarios, {plans: [{planned: [plan(null)], skipped: []}]}).cells.length, 1);
});

test('buildReport: missing plans and reps mismatches are loud warnings', () => {
  const rs = [1, 2, 3].map((n) => rec('pass', n));
  const plans = [{planned: [], skipped: [], reps: 1, _file: 'macos-chromium-planned-audit.json'}];
  const rep = buildReport(rs, scenarios, {plans, expect: ['macos-chromium-planned-audit.json', 'macos-firefox-planned-audit.json']});
  assert.equal(rep.summary.missingPlans, 1);
  assert.equal(rep.warnings.length, 2);
  assert.match(rep.warnings[0], /H3 missing plan: macos-firefox-planned-audit.json/);
  assert.match(rep.warnings[1], /ran with reps 1, report expects 3/);
  const md = renderMarkdown(rep);
  assert.match(md, /## 경고: 숫자가 불완전하다/);
  assert.match(md, /H3 missing plan: macos-firefox-planned-audit.json/);
});

test('I1: an IME name with "|" (Windows) is grouped on the structured field; table cells are escaped', () => {
  const ime = '00000411+imeon(open,conv|=0x19,smode0>0x8)';
  const mk = (browser, name, n) => ({...rec(name, n), cell: {...load(name).cell, os: 'windows', ime, browser}});
  const rs = [1, 2, 3].flatMap((n) => [mk('chromium', 'pass', n), mk('firefox', 'd1', n)]);
  const md = renderMarkdown(buildReport(rs, scenarios));
  const esc = ime.replace(/\|/g, '\\|');
  assert.ok(md.includes(`| ${esc} | chromium | 1 | 0 | 0 | 0 | 0 |`), md);
  assert.ok(md.includes(`| ${esc} | firefox | 0 | 1 | 0 | 0 | 0 |`), md);
  assert.ok(md.includes(`| ${esc} | firefox | 0 | 1 | 0 |`), 'layer table'); // L1 0, L2 1, L5 0
});

test('cell reasons come from a run with the cell verdict, after a count line', () => {
  const same = (r) => ({...r, cell: load('pass').cell});
  const rs = [rec('pass', 1), rec('d1', 2), rec('pass', 3)].map(same);
  const c = buildReport(rs, scenarios).cells[0];
  assert.equal(c.verdict, 'flaky');
  assert.equal(c.reasons[0], '1 of 3 runs fail [2]; 2 of 3 runs pass');
  assert.ok(c.reasons.slice(1).every((x) => x.startsWith('L2')));
  const h = structuredClone(load('pass'));
  h.control.after.text = 'zzz';
  const c2 = buildReport([rec('d1', 1), {...h, rep: 2}, rec('d1', 3)].map(same), scenarios).cells[0];
  assert.equal(c2.verdict, 'harness');
  assert.equal(c2.reasons[0], '2 of 3 runs fail [2]; 1 of 3 runs harness');
  assert.ok(c2.reasons[1].startsWith('H1 control'), c2.reasons.join('; '));
});

test('a malformed record file is an inconclusive run and a warning, not a crash', async () => {
  const {readRecordFile} = await import('../core/report.mjs');
  const {mkdtempSync, writeFileSync, rmSync} = await import('node:fs');
  const {join} = await import('node:path');
  const dir = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'imelab-bad-'));
  try {
    writeFileSync(join(dir, 'bad.json'), '{"cell": ');
    writeFileSync(join(dir, 'null.json'), 'null');
    const bad = readRecordFile(dir, 'bad.json');
    assert.equal(bad._file, 'bad.json');
    assert.equal(typeof bad._malformed, 'string');
    assert.match(readRecordFile(dir, 'null.json')._malformed, /not a JSON object/);
    const rep = buildReport([...[1, 2, 3].map((n) => rec('pass', n)), bad], scenarios);
    assert.equal(rep.cells.length, 2);
    const m = rep.cells.find((c) => c.cell.scen === '?bad.json');
    assert.equal(m.verdict, 'inconclusive');
    assert.match(m.reasons.join('; '), /malformed record file/);
    assert.match(rep.warnings[0], /malformed record file: bad.json/);
    assert.match(renderMarkdown(rep), /malformed record file: bad.json/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('report.mjs CLI: a malformed file does not stop the report', async () => {
  const {spawnSync} = await import('node:child_process');
  const {mkdtempSync, writeFileSync, rmSync, readFileSync: rf} = await import('node:fs');
  const {join} = await import('node:path');
  const dir = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'imelab-cli-'));
  try {
    writeFileSync(join(dir, 'bad.json'), 'not json');
    const r = spawnSync(process.execPath, [new URL('../core/report.mjs', import.meta.url).pathname, dir, join(dir, 'out')], {encoding: 'utf8'});
    assert.equal(r.status, 0, r.stderr);
    assert.match(rf(join(dir, 'out', 'report.md'), 'utf8'), /inconclusive 1/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
