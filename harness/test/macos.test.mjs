import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {toOskeys, imageId, imeVersionOf, macosAdapter, SRC, WARM, appOf} from '../drivers/macos.mjs';
import {allScenarios} from '../scenarios/index.mjs';

const SWIFT = readFileSync(new URL('../native/oskeys.swift', import.meta.url), 'utf8');

test('모든 시나리오의 키를 oskeys로 보낼 수 있다', () => {
  for (const sc of allScenarios()) {
    for (const lang of sc.langs) {
      if (sc.keys) assert.doesNotThrow(() => toOskeys(sc.keys(lang)), `${sc.id}/${lang}`);
    }
  }
  assert.throws(() => toOskeys(['F13']));
  assert.deepEqual(toOskeys(['MOD+b', 'HASH', 'WAIT:300']), ['MOD+b', 'HASH', 'WAIT:300']);
});

test('oskeys.swift가 vocab 토큰을 안다', () => {
  assert.match(SWIFT, /"MOD": \.maskCommand/);
  for (const t of ['ASTERISK', 'HASH', 'MINUS', 'SP', 'RET', 'BS', 'ESC', 'TAB', 'LEFT', 'RIGHT', 'UP', 'DOWN']) {
    assert.match(SWIFT, new RegExp(`"${t}": \\d+`), t);
  }
});

test('언어마다 입력 소스와 예열 키가 있다', () => {
  for (const l of ['ko', 'ja', 'zh']) {
    assert.ok(SRC[l]);
    assert.doesNotThrow(() => toOskeys(WARM[l]));
  }
  assert.equal(appOf('webkit'), 'ms-playwright/webkit');
});

test('Firefox만 focusmanager.testmode를 끈다', () => {
  const a = macosAdapter();
  assert.equal(a.name, 'macos');
  assert.deepEqual(a.launchOpts('firefox').firefoxUserPrefs, {'focusmanager.testmode': false});
  assert.equal(a.launchOpts('webkit').firefoxUserPrefs, undefined);
  assert.equal(a.launchOpts('chromium').headless, false);
});

test('env.image에 러너 이미지와 macOS 버전이 들어간다', () => {
  assert.equal(imageId({ImageOS: 'macos15', ImageVersion: '20261110.1'}, {version: '15.7', build: '24G222'}),
    'runner=macos15 20261110.1; macOS 15.7 (24G222)');
});

test('일본어 imeVersion에 읽어 온 라이브 변환 값이 들어간다', () => {
  const sw = {version: '15.8.2', build: '24H232'};
  assert.equal(imeVersionOf('ja', sw, () => '0'), 'macOS 15.8.2 (24H232); liveConversion=0');
  assert.equal(imeVersionOf('ja', sw, () => 'unset'), 'macOS 15.8.2 (24H232); liveConversion=unset');
  assert.equal(imeVersionOf('ko', sw, () => { throw new Error('not read'); }), 'macOS 15.8.2 (24H232)');
});
