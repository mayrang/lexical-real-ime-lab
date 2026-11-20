import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync, rmSync} from 'node:fs';
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

test('escape-cancel: ko commits, ja and zh cancel; cells where Escape leaves the composition open are skipped', () => {
  const s = matrix.find((x) => x.id === 'escape-cancel');
  assert.equal(s.word('ja', CELL(s, 'ja')), '');
  assert.equal(s.word('zh', CELL(s, 'zh', {browser: 'webkit'})), '');
  assert.equal(s.word('ko', CELL(s, 'ko')), '한국어');
  assert.equal(s.blursEditor, true);
});

test('escape-cancel and token-cancel skip the cells whose control composition stays open (C1, run 44747262639)', () => {
  const t = audit.find((x) => x.id === 'token-cancel');
  const e = matrix.find((x) => x.id === 'escape-cancel');
  const c = (lang, os, browser, ime) => ({scen: 'x', lang, os, browser, ime});
  for (const sc of [e, t]) {
    for (const cell of [c('ja', 'linux', 'webkit', 'ibus'), c('zh', 'linux', 'webkit', 'ibus'),
      c('ja', 'windows', 'chromium'), c('ja', 'windows', 'firefox')]) {
      assert.equal(runsCell(sc, cell), false, `${sc.id} ${JSON.stringify(cell)}`);
    }
    for (const cell of [c('ja', 'linux', 'webkit', 'fcitx5'), c('ja', 'linux', 'chromium', 'ibus'), c('ja', 'windows', 'webkit'),
      c('ja', 'macos', 'webkit'), c('zh', 'macos', 'chromium')]) {
      assert.equal(runsCell(sc, cell), true, `${sc.id} ${JSON.stringify(cell)}`);
    }
  }
  assert.equal(runsCell(e, c('ko', 'linux', 'webkit', 'ibus')), true);
  assert.equal(runsCell(e, c('ko', 'windows', 'chromium')), true);
  assert.equal(t.word('ja', c('ja', 'linux', 'webkit', 'ibus')), '');
});

test('fmt-mid-composition ja: a RET after MOD+b commits the conversion', () => {
  const fmt = audit.find((x) => x.id === 'fmt-mid-composition');
  assert.deepEqual(fmt.keys('ja').slice(-2), ['MOD+b', 'RET']);
  assert.deepEqual(fmt.keys('ko').slice(-1), ['MOD+b']);
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
  // Control side only: a slow Lexical side under a fast control is judged, not routed to harness.
  assert.equal(undo.precondition({control: {compositionEnds: [10, 200]}, lexical: {compositionEnds: [10, 900]}}), null);
  assert.equal(typeof undo.precondition({control: {compositionEnds: [10, 400]}, lexical: {compositionEnds: [10, 20]}}), 'string');
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
  // Control side only.
  assert.equal(typeof md.precondition({control: {trace: 'e:하 k:` bi:insertText(`)'}, lexical: {trace: 'e:하 e:`'}}), 'string');
  assert.equal(md.precondition({control: {trace: 'e:하 e:`'}, lexical: {trace: 'e:하 k:`'}}), null);
  // Only Linux WebKit, where the control commits the backtick in a compositionend.
  assert.equal(runsOn(md, {os: 'linux', browser: 'webkit'}), true);
  for (const [os, browser] of [['linux', 'chromium'], ['linux', 'firefox'], ['windows', 'webkit'], ['windows', 'chromium']]) {
    assert.equal(runsOn(md, {os, browser}), false, `${os} ${browser}`);
  }
});

test('slow-syllables-undo: macOS is left out (merge window never met there)', () => {
  const undo = audit.find((x) => x.id === 'slow-syllables-undo');
  assert.equal(runsOn(undo, {os: 'macos', browser: 'chromium'}), false);
  assert.equal(runsOn(undo, {os: 'linux', browser: 'chromium'}), true);
  assert.equal(runsOn(undo, {os: 'windows', browser: 'chromium'}), true);
});

test('run.mjs: each group writes its own plan into a shared --out', (t) => {
  const dir = join(process.env.TMPDIR ?? '/tmp', `imelab-plan-${process.pid}`);
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  for (const g of ['matrix', 'audit']) {
    const r = spawnSync(process.execPath, [new URL('../run.mjs', import.meta.url).pathname, '--os', 'macos', '--browser', 'firefox',
      '--group', g, '--reps', '0', '--lexical-url', 'http://127.0.0.1:1/', '--out', dir], {encoding: 'utf8'});
    assert.equal(r.status, 0, r.stderr);
  }
  const m = JSON.parse(readFileSync(join(dir, 'planned-matrix.json'), 'utf8'));
  const a = JSON.parse(readFileSync(join(dir, 'planned-audit.json'), 'utf8'));
  assert.equal(m.group, 'matrix');
  assert.equal(a.group, 'audit');
  assert.ok(m.planned.length > 0 && a.planned.length > 0);
  assert.ok(a.skipped.some((c) => c.scen === 'click-mid-composition' && c.lang === 'ko'));
});

test('run.mjs: an unknown --group exits non-zero and writes no plan', (t) => {
  const dir = join(process.env.TMPDIR ?? '/tmp', `imelab-badgroup-${process.pid}`);
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const r = spawnSync(process.execPath, [new URL('../run.mjs', import.meta.url).pathname, '--os', 'macos', '--browser', 'firefox',
    '--group', 'audti', '--reps', '0', '--lexical-url', 'http://127.0.0.1:1/', '--out', dir], {encoding: 'utf8'});
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unknown --group "audti"/);
  assert.equal(existsSync(join(dir, 'planned-audti.json')), false);
});

test('calibcheck: an open control composition is a violation unless the cell is skipped or the keys changed', async () => {
  const {openControlRuns} = await import('../core/calibcheck.mjs');
  const fx = JSON.parse(readFileSync(new URL('./fixtures/pass.json', import.meta.url), 'utf8'));
  const sc = {id: 'x', langs: ['ko'], keys: () => ['g', 'k'], word: () => '하', skip: (c) => c.browser === 'webkit'};
  const mk = (extra = {}, trace = 's: u:하') => {
    const r = structuredClone(fx);
    r.cell = {...r.cell, scen: 'x', lang: 'ko', browser: 'chromium', ...extra};
    r.harness.keysSent = ['g', 'k'];
    r.control.trace = trace;
    r.control.before = {text: '', selStart: 0, selEnd: 0};
    r.control.after.text = '하';
    return r;
  };
  const stale = mk();
  stale.harness.keysSent = ['g', 'k', 'SP'];
  const out = openControlRuns([mk(), mk({browser: 'webkit'}), stale, mk({}, 's: u:하 e:하'), mk({scen: 'y'}), mk({lang: 'ja'})], [sc]);
  assert.deepEqual(out.map((x) => x.status), ['violation', 'skipped', 'stale-keys', 'unknown', 'dropped']);
  assert.equal(out[0].wordFromOpen, true);
  // Every current scenario: no stored-run check here (the Records live outside the repo), but the rule holds by
  // construction for the cells the final review found (escape-cancel, token-cancel, fmt-mid-composition ja).
});
