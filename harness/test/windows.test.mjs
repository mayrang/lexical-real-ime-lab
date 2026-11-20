import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {toWinkeys, imageId, imeOf, windowsAdapter, LAYOUT, MODE, WARM, LATIN} from '../drivers/windows.mjs';
import {allScenarios} from '../scenarios/index.mjs';

const CS = readFileSync(new URL('../native/winkeys.cs', import.meta.url), 'utf8');

test('한국어·일본어 시나리오의 키를 winkeys로 보낼 수 있다', () => {
  for (const sc of allScenarios()) {
    for (const lang of sc.langs.filter((l) => l !== 'zh')) {
      if (sc.keys) assert.doesNotThrow(() => toWinkeys(sc.keys(lang)), `${sc.id}/${lang}`);
    }
  }
  assert.throws(() => toWinkeys(['F13']));
  assert.deepEqual(toWinkeys(['MOD+b', 'HASH', 'WAIT:300']), ['MOD+b', 'HASH', 'WAIT:300']);
});

test('winkeys.cs가 vocab 토큰을 안다', () => {
  assert.match(CS, /StartsWith\("MOD\+"\)\) \{ Key\(0x11/);
  assert.match(CS, /StartsWith\("SHIFT\+"\)\) \{ Key\(0x10/);
  for (const t of ['ASTERISK', 'HASH', 'MINUS', 'SP', 'RET', 'BS', 'ESC', 'TAB', 'LEFT', 'RIGHT', 'UP', 'DOWN']) {
    assert.match(CS, new RegExp(`t == "${t}"`), t);
  }
});

test('언어마다 레이아웃, 모드, 예열 키가 있다', () => {
  assert.equal(LATIN, '00000409');
  assert.deepEqual(LAYOUT, {ko: '00000412', ja: '00000411'});
  assert.deepEqual(MODE, {ko: '--hangul', ja: '--imeon'});
  for (const l of ['ko', 'ja']) assert.doesNotThrow(() => toWinkeys(WARM[l]));
  assert.equal(imeOf('ko'), '00000412+hangul');
  assert.equal(imeOf('ja'), '00000411+imeon');
  assert.equal(imeOf('zh'), 'unknown');
});

test('중국어는 고를 수 없다', async () => {
  await assert.rejects(windowsAdapter().selectIme('zh'), /no keyboard layout for zh/);
});

test('Firefox만 focusmanager.testmode를 끈다', () => {
  const a = windowsAdapter();
  assert.equal(a.name, 'windows');
  assert.deepEqual(a.launchOpts('firefox').firefoxUserPrefs, {'focusmanager.testmode': false});
  assert.equal(a.launchOpts('webkit').firefoxUserPrefs, undefined);
  assert.equal(a.launchOpts('chromium').headless, false);
});

test('env.image에 러너 이미지와 Windows 빌드가 들어간다', () => {
  assert.equal(imageId({ImageOS: 'win25', ImageVersion: '20261110.1'}, '10.0.26100.4349'),
    'runner=win25 20261110.1; Windows 10.0.26100.4349');
});
