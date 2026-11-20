import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {scenariosFor, allScenarios, runsOn, runsCell, planCells, variantId} from '../scenarios/index.mjs';
import {mergeWindowMet, backtickInCommit} from '../scenarios/audit.mjs';
import {replayBuilds} from '../scenarios/replay.mjs';
import {isToken, WORD} from '../scenarios/vocab.mjs';
import {isStep} from '../scenarios/android.mjs';
import {judge} from '../core/judge.mjs';

const all = allScenarios();
const matrix = scenariosFor('matrix');
const android = scenariosFor('android');
const GROUPS = ['matrix', 'audit', 'replay', 'android'];
const LANGS = ['ko', 'ja', 'zh'];
const CELL = (sc, lang, extra = {}) => ({scen: sc.id, lang, os: 'linux', ime: 'ibus', browser: 'chromium', ...extra});

test('매트릭스 시나리오는 28개', () => assert.equal(matrix.length, 28));
test('Android 시나리오는 실현성 6개', () => assert.deepEqual(android.map((s) => s.id),
  ['ko-finish', 'ko-commit', 'del-surrounding', 'del-key', 'ko-del-surrounding', 'ko-del-in-composition']));
test('id 중복 없음', () => assert.equal(new Set(all.map((s) => s.id)).size, all.length));
test('group은 정해진 값', () => {
  for (const s of all) assert.ok(GROUPS.includes(s.group), `${s.id}: group ${s.group}`);
});
test('scenariosFor는 group으로 거른다', () => {
  assert.ok(matrix.every((s) => s.group === 'matrix'));
  assert.deepEqual(scenariosFor('nope'), []);
});

for (const s of all) {
  test(`${s.id}: 형식`, () => {
    assert.ok(s.langs.length > 0 && s.langs.every((l) => LANGS.includes(l)));
    assert.ok((s.keys === undefined) !== (s.steps === undefined), 'keys 또는 steps 중 정확히 하나');
    assert.equal(typeof (s.keys ?? s.steps), 'function');
    assert.equal(typeof s.word, 'function');
    if (s.setup !== undefined) assert.equal(typeof s.setup, 'function');
    if (s.keyDelay !== undefined) assert.ok(Number.isInteger(s.keyDelay) && s.keyDelay > 0, 'keyDelay: 양의 정수(ms)');
    // runCell splits the keys at the first PROBE only; a second one would reach the adapter as a key.
    if (s.keys) for (const lang of s.langs) assert.ok(s.keys(lang).filter((t) => t === 'PROBE').length <= 1, `${lang}: PROBE 하나까지`);
    if (s.intent) {
      assert.equal(typeof s.intent.check, 'function');
      assert.ok(typeof s.intent.evidence === 'string' && s.intent.evidence.trim(), 'evidence 필요');
    }
    for (const lang of s.langs) {
      if (s.steps) {
        const steps = s.steps(lang);
        assert.ok(Array.isArray(steps) && steps.length > 0, `${lang}: steps`);
        for (const st of steps) assert.ok(isStep(st), `${lang}: step ${JSON.stringify(st)} 없음`);
        assert.equal(typeof s.word(lang, CELL(s, lang, {os: 'android', ime: 'testime', browser: 'chrome'})), 'string');
        continue;
      }
      const keys = s.keys(lang);
      assert.ok(Array.isArray(keys) && keys.length > 0, `${lang}: keys`);
      for (const t of keys) assert.ok(isToken(t), `${lang}: 토큰 ${t} 없음`);
      for (const ime of ['ibus', 'fcitx']) for (const browser of ['chromium', 'firefox', 'webkit']) {
        assert.equal(typeof s.word(lang, CELL(s, lang, {ime, browser})), 'string');
      }
    }
  });
}

test('vocab: 토큰 검사', () => {
  for (const t of ['a', 'z', '0', 'SP', 'RET', 'BS', 'ESC', 'TAB', 'LEFT', 'RIGHT', 'UP', 'DOWN',
    'MOD+b', 'SHIFT+LEFT', 'WAIT:250', 'ASTERISK', 'HASH', 'MINUS', 'PERIOD', 'COMMA', 'BACKTICK', 'CLICK:abc']) assert.ok(isToken(t), t);
  for (const t of ['space', 'Return', 'A', 'WAIT:', 'MOD+', 'asterisk', '', 'CLICK:', 'CLICK:Abc', 'MOD+CLICK:abc']) assert.equal(isToken(t), false, t);
});
test('android: step 검사', () => {
  for (const st of [['compose', 'ㅎ'], ['compose', ''], ['commit', 'a'], ['finish'], ['delete', 1, 0], ['key', 67],
    ['select', 5, 5], ['region', 0, 1], ['wait', 100], ['seq', [['commit', 'a'], ['finish']]]]) assert.ok(isStep(st), JSON.stringify(st));
  for (const st of [[], ['type', 'a'], ['compose'], ['delete', 1], ['key', 'DEL'], ['seq', [['wait', 1]]], ['seq', []], 'commit']) {
    assert.equal(isStep(st), false, JSON.stringify(st));
  }
});

test('android: 지우는 시나리오도 H1 식으로 맞는다 (빈 편집기에서 시작)', () => {
  const s = android.find((x) => x.id === 'del-surrounding');
  const fx = JSON.parse(readFileSync(new URL('./fixtures/pass.json', import.meta.url), 'utf8'));
  const r = structuredClone(fx);
  r.cell = {scen: s.id, lang: 'ko', os: 'android', ime: 'testime', browser: 'chrome'};
  for (const side of ['control', 'lexical']) {
    r[side].before = {text: '', selStart: 0, selEnd: 0};
    r[side].after.text = 'hel';
    r[side].after.paragraphs = 1;
  }
  r.lexical.after.domText = 'hel';
  assert.equal(judge(r, s).verdict, 'pass');
  r.lexical.after.text = r.lexical.after.domText = 'hell';
  assert.deepEqual(judge(r, s).failed, [2]);
});

const replay = scenariosFor('replay');
const OSES = ['linux', 'macos', 'windows', 'android'];
test('replay: §5.1 행마다 시나리오', () => assert.deepEqual(replay.map((s) => s.id),
  ['b8162', 'b8142', 'b9291', 'b5762a', 'b5762b', 'b7987', 'b8121', 'b8680a', 'b8680b', 'b7061', 'b5077', 'b5282', 'b6268']));
for (const s of replay) {
  test(`${s.id}: replay 형식`, () => {
    const c = s.commits;
    assert.ok(/^[0-9a-f]{40}$/.test(c.parent) && /^[0-9a-f]{40}$/.test(c.fix) && c.parent !== c.fix, 'commits.parent/fix: 40자 SHA');
    assert.ok(/^\d+$/.test(c.node), 'commits.node');
    assert.ok(c.pm === 'npm' || /^pnpm@\d+\.\d+\.\d+$/.test(c.pm), 'commits.pm');
    assert.ok(s.only?.os?.length && s.only.os.every((o) => OSES.includes(o)), 'only.os');
    // Own word, never a default; setup leaves text, so the expected Lexical text is explicit too.
    assert.ok(Object.hasOwn(s, 'word'));
    if (s.setup) assert.equal(typeof s.lexAfter, 'function', 'setup이 있으면 lexAfter');
  });
}
test('runsOn: only의 값만 통과, 모르는 값은 통과', () => {
  const s = {only: {os: ['linux'], browser: ['chromium'], ime: ['ibus']}};
  assert.equal(runsOn(s, {os: 'linux', browser: 'chromium', ime: 'ibus'}), true);
  assert.equal(runsOn(s, {os: 'linux', browser: 'chromium'}), true);
  assert.equal(runsOn(s, {os: 'linux', browser: 'firefox'}), false);
  assert.equal(runsOn(s, {os: 'linux', browser: 'chromium', ime: 'fcitx5'}), false);
  assert.equal(runsOn(s, {os: 'macos', browser: 'chromium'}), false);
  assert.equal(runsOn({}, {os: 'macos'}), true);
});
test('replayBuilds: 플랫폼의 커밋만, 중복 없이', () => {
  const a = replayBuilds(['android']);
  assert.equal(a.length, 6);
  assert.ok(a.every((b) => b.pm === 'npm' && b.node === '20'));
  assert.equal(replayBuilds(['windows']).length, 0);
  assert.deepEqual(replayBuilds(['linux', 'macos'], 'b8162').map((b) => b.sha),
    ['7e472705aeeb8817b7e045d0d0024097d3848a0a', '1448d64c942e792858f97ffe59eb988013cb526e']);
  const all = replayBuilds(OSES);
  assert.equal(new Set(all.map((b) => b.sha)).size, all.length);
  assert.equal(all.length, 22); // 11 bugs, parent and fix each
});
test('variantId', () => {
  assert.equal(variantId('b8162', 'parent'), 'b8162@parent');
  assert.equal(variantId('plain-end', null), 'plain-end');
});

const audit = scenariosFor('audit');
test('audit: 브리프 표의 12개', () => assert.deepEqual(audit.map((s) => s.id), ['fmt-mid-composition', 'click-mid-composition',
  'enter-after-key-reset', 'compose-empty-format', 'slow-syllables-undo', 'fast-typing', 'autolink-cjk-punct',
  'mention-no-space', 'md-heading-fullwidth', 'token-cancel', 'ko-tab-commit', 'md-shortcut-multichar']));
test('audit: CLICK 대상 글자는 setup이 넣은 글자', () => {
  const s = audit.find((x) => x.id === 'click-mid-composition');
  for (const l of s.langs) assert.ok(s.keys(l).includes('CLICK:abc'), l);
});
test('audit: lexAfter', () => {
  const tab = audit.find((x) => x.id === 'ko-tab-commit');
  assert.equal(tab.lexAfter({text: 'ab', selStart: 2, selEnd: 2}, '한국어 '), 'ab한국어 \t');
  const undo = audit.find((x) => x.id === 'slow-syllables-undo');
  assert.equal(undo.lexAfter({text: 'ab', selStart: 2, selEnd: 2}, 'か'), 'ab');
  const md = audit.find((x) => x.id === 'md-shortcut-multichar');
  assert.equal(md.lexAfter({text: '`hello', selStart: 6, selEnd: 6}, '하`'), 'hello하');
});

test('WORD', () => assert.deepEqual(WORD, {ko: '한국어', ja: '日本語', zh: '你好'}));

test('escape-cancel: word는 cell의 ime·browser에 따라 바뀐다', () => {
  const s = matrix.find((x) => x.id === 'escape-cancel');
  assert.equal(s.word('ja', CELL(s, 'ja')), '');
  assert.equal(s.word('ja', CELL(s, 'ja', {browser: 'webkit'})), 'にほんご');
  assert.equal(s.word('zh', CELL(s, 'zh', {browser: 'webkit'})), '你好');
  assert.equal(s.word('ko', CELL(s, 'ko')), '한국어');
  assert.equal(s.blursEditor, true);
});

test('md-bold: lexAfter는 ** 표시를 걷어낸다', () => {
  const s = matrix.find((x) => x.id === 'md-bold');
  assert.equal(s.lexAfter({text: 'a **', selStart: 4, selEnd: 4}, s.word('ko', CELL(s, 'ko'))), 'a 한국어');
});

test('판정기가 쓰는 필드: 시나리오가 기록으로 통과한다', () => {
  const s = matrix.find((x) => x.id === 'plain-end');
  const fx = JSON.parse(readFileSync(new URL('./fixtures/pass.json', import.meta.url), 'utf8'));
  assert.equal(judge(fx, s).verdict, 'pass');
});

// Citations must exist. Format: packages/<path>: '<exact test title>' (meta/lexical@<sha>)
const LEXICAL_DIR = process.env.LEXICAL_DIR ?? '/Users/mayrang/dev/projects/lexical';
const hasClone = existsSync(join(LEXICAL_DIR, '.git'));
const CITE = /^(packages\/[^\s:]+): '([^']+)' \(meta\/lexical@([0-9a-f]{7,40})\)/;

for (const s of all.filter((x) => x.intent)) {
  test(`${s.id}: evidence cites a real test`, {skip: hasClone ? false : `no Lexical clone at ${LEXICAL_DIR} (set LEXICAL_DIR)`}, () => {
    const m = CITE.exec(s.intent.evidence);
    assert.ok(m, `evidence must start with packages/<path>: '<title>' (meta/lexical@<sha>): ${s.intent.evidence}`);
    const [, path, title, sha] = m;
    const r = spawnSync('git', ['-C', LEXICAL_DIR, 'show', `${sha}:${path}`], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
    assert.equal(r.status, 0, `${path} not found at ${sha}: ${r.stderr}`);
    assert.ok(r.stdout.includes(title), `title not found in ${path} at ${sha}: ${title}`);
  });
}

test('runsCell: skip(cell) drops single cells; no skip runs all', () => {
  const c = (os, browser, lang) => ({scen: 'x', os, browser, lang});
  assert.equal(runsCell({}, c('macos', 'firefox', 'ko')), true);
  const fmt = audit.find((x) => x.id === 'fmt-mid-composition');
  assert.equal(fmt.only, undefined, 'WebKit cells run again');
  assert.equal(runsCell(fmt, c('windows', 'webkit', 'ja')), false);
  for (const [os, b, l] of [['windows', 'webkit', 'ko'], ['macos', 'webkit', 'ja'], ['linux', 'webkit', 'ja'], ['windows', 'chromium', 'ja']]) {
    assert.equal(runsCell(fmt, c(os, b, l)), true, `${os} ${b} ${l}`);
  }
  const click = audit.find((x) => x.id === 'click-mid-composition');
  assert.equal(runsCell(click, c('macos', 'firefox', 'ko')), false);
  for (const [os, b, l] of [['macos', 'firefox', 'ja'], ['macos', 'chromium', 'ko'], ['linux', 'firefox', 'ko']]) {
    assert.equal(runsCell(click, c(os, b, l)), true, `${os} ${b} ${l}`);
  }
});

test('slow-syllables-undo: precondition checks the 300 ms merge window from compositionend times', () => {
  const undo = audit.find((x) => x.id === 'slow-syllables-undo');
  assert.equal(mergeWindowMet([1000, 1150]), null);
  assert.match(mergeWindowMet([1000, 1300]), /ended 300 ms after/);
  assert.match(mergeWindowMet([1000]), /1 compositionend events, need 2/);
  assert.match(mergeWindowMet(undefined), /no compositionend times/);
  assert.match(mergeWindowMet([0, 100, 450]), /composition 3 ended 350 ms/);
  assert.equal(undo.precondition({lexical: {compositionEnds: [10, 200]}}), null);
  assert.equal(typeof undo.precondition({lexical: {compositionEnds: [10, 400]}}), 'string');
});

test('planCells: planned and skipped cells, replay variants', () => {
  const fmt = audit.find((x) => x.id === 'fmt-mid-composition');
  const p = planCells([fmt], {os: 'windows', browser: 'webkit', langs: ['ko', 'ja', 'zh']});
  assert.deepEqual(p.planned.map((c) => c.lang), ['ko']);
  assert.deepEqual(p.skipped, [{scen: 'fmt-mid-composition', lang: 'ja', os: 'windows', browser: 'webkit', ime: null}]);
  const r = scenariosFor('replay').find((x) => x.id === 'b8121');
  const q = planCells([r], {os: 'macos', browser: 'chromium', langs: ['ko', 'ja', 'zh']});
  assert.deepEqual(q.planned.map((c) => c.scen), ['b8121@parent', 'b8121@fix', 'b8121@main']);
});

test('md-shortcut-multichar: precondition keeps only a compositionend that carries the backtick', () => {
  const md = audit.find((x) => x.id === 'md-shortcut-multichar');
  assert.equal(backtickInCommit('k:Process/229 u:하 e:하 k:Unidentified/229 bi:insertFromComposition(`) e:`'), null);
  assert.equal(backtickInCommit('u:하` e:하`'), null);
  assert.match(backtickInCommit('u:하 e:하 k:` bi:insertText(`)'), /plain-key path/);
  assert.equal(typeof md.precondition({lexical: {trace: 'e:하 k:` bi:insertText(`)'}}), 'string');
  assert.equal(md.precondition({lexical: {trace: 'e:하 e:`'}}), null);
});

test('slow-syllables-undo: macOS is left out (merge window never met there)', () => {
  const undo = audit.find((x) => x.id === 'slow-syllables-undo');
  assert.equal(runsOn(undo, {os: 'macos', browser: 'chromium'}), false);
  assert.equal(runsOn(undo, {os: 'linux', browser: 'chromium'}), true);
  assert.equal(runsOn(undo, {os: 'windows', browser: 'chromium'}), true);
});
