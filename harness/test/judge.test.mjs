import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {judge} from '../core/judge.mjs';
import {validateRecord} from '../core/record.mjs';

const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8'));
const fx = Object.fromEntries(['pass', 'd1', 'd2', 'd3', 'nbsp', 'ctlwrong', 'setuperr', 'noeditor'].map((n) => [n, load(n)]));
const pick = (j) => ({verdict: j.verdict, failed: j.failed});

// Minimal inline scenarios (formal format comes in Task 4).
const word = () => '한국어 ';
const sc = {
  plainEnd: {id: 'plain-end', word},
  boldOnEmpty: {
    id: 'bold-on-empty', word,
    intent: {
      check: (lex) => (lex.after.imeNode && lex.after.imeNode.format & 1 ? null : 'IME text not bold'),
      evidence: 'https://github.com/meta/lexical/pull/8162',
    },
  },
  autolinkEnd: {id: 'autolink-end', word},
};

test('정상', () => assert.equal(judge(fx.pass, sc.plainEnd).verdict, 'pass'));
test('D1 → 2층', () => assert.deepEqual(pick(judge(fx.d1, sc.plainEnd)), {verdict: 'fail', failed: [2]}));
test('D2 → 5층', () => assert.deepEqual(pick(judge(fx.d2, sc.boldOnEmpty)), {verdict: 'fail', failed: [5]}));
test('D3 → 1층과 2층', () => assert.deepEqual(pick(judge(fx.d3, sc.autolinkEnd)), {verdict: 'fail', failed: [1, 2]}));
test('#7061형 NBSP → 1층', () => assert.deepEqual(judge(fx.nbsp, sc.plainEnd).failed, [1]));
test('대조군이 틀리면 harness', () => assert.equal(judge(fx.ctlwrong, sc.plainEnd).verdict, 'harness'));
test('setup 예외는 harness', () => assert.equal(judge(fx.setuperr, sc.plainEnd).verdict, 'harness'));
test('편집기 없음은 inconclusive', () => assert.equal(judge(fx.noeditor, sc.plainEnd).verdict, 'inconclusive'));
test('근거 없는 5층은 예외', () => assert.throws(() => judge(fx.pass, {...sc.boldOnEmpty, intent: {check: () => null, evidence: ''}})));

test('validateRecord: 정상 기록은 빠진 필드 없음', () => assert.deepEqual(validateRecord(fx.pass), []));
test('validateRecord: lexical.after 없음을 알림', () => assert.ok(validateRecord(fx.noeditor).some((m) => m.includes('lexical.after'))));
test('Vite 오버레이 오류는 1층에서 무시', () => assert.equal(judge(fx.d1, sc.plainEnd).reasons.some((r) => r.startsWith('L1')), false));
test('대조군과의 차이는 진단용(l3)이고 실패가 아님', () => {
  const j = judge(fx.d1, sc.plainEnd);
  assert.equal(typeof j.diffs.l3, 'string');
  assert.equal(judge(fx.pass, sc.plainEnd).diffs.l3, null);
});
test('blursEditor면 caretInEditor 생략', () => {
  const r = structuredClone(fx.pass);
  r.lexical.after.caretInEditor = false;
  assert.deepEqual(judge(r, sc.plainEnd).failed, [1]);
  assert.equal(judge(r, {...sc.plainEnd, blursEditor: true}).verdict, 'pass');
});
test('fatal은 inconclusive', () => {
  const r = structuredClone(fx.pass);
  r.harness.fatal = 'boom';
  assert.equal(judge(r, sc.plainEnd).verdict, 'inconclusive');
});
test('keydown 0은 harness', () => {
  const r = structuredClone(fx.pass);
  r.lexical.nKeydown = 0;
  assert.equal(judge(r, sc.plainEnd).verdict, 'harness');
});

test('word는 두 번째 인자로 기록의 cell을 받는다', () => {
  let seen;
  const scene = {id: 'plain-end', word: (lang, cell) => { seen = [lang, cell]; return '한국어 '; }};
  judge(fx.pass, scene);
  assert.deepEqual(seen, ['ko', fx.pass.cell]);
});

test('precondition: a string makes the run harness, null leaves the verdict alone', () => {
  const pre = (msg) => ({...sc.plainEnd, precondition: () => msg});
  const j = judge(fx.pass, pre('too slow'));
  assert.equal(j.verdict, 'harness');
  assert.deepEqual(j.reasons, ['precondition: too slow']);
  assert.equal(judge(fx.pass, pre(null)).verdict, 'pass');
  // A Lexical failure under an unmet precondition is not counted as a failure.
  assert.equal(judge(fx.d1, pre('too slow')).verdict, 'harness');
  assert.deepEqual(pick(judge(fx.d1, pre(null))), {verdict: 'fail', failed: [2]});
});

test('precondition: a failed precondition also carries the H1 reason', () => {
  const bad = structuredClone(fx.pass);
  bad.control.after.text = 'zzz';
  const j = judge(bad, {...sc.plainEnd, precondition: () => 'too slow'});
  assert.equal(j.verdict, 'harness');
  assert.equal(j.reasons[0], 'precondition: too slow');
  assert.ok(j.reasons.some((x) => x.startsWith('H1 control')));
});
