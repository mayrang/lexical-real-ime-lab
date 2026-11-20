import {test} from 'node:test';
import assert from 'node:assert/strict';
import {toKeysym, keyPlan, linuxAdapter} from '../drivers/linux.mjs';
import {allScenarios} from '../scenarios/index.mjs';

test('토큰을 xdotool 키 이름으로 바꾼다', () => {
  assert.equal(toKeysym('g'), 'g');
  assert.equal(toKeysym('SP'), 'space');
  assert.equal(toKeysym('RET'), 'Return');
  assert.equal(toKeysym('BS'), 'BackSpace');
  assert.equal(toKeysym('ASTERISK'), 'asterisk');
  assert.equal(toKeysym('MOD+b'), 'ctrl+b');
  assert.equal(toKeysym('SHIFT+LEFT'), 'shift+Left');
  assert.throws(() => toKeysym('F13'));
});

test('WAIT는 키 묶음을 나눈다', () => {
  assert.deepEqual(keyPlan(['g', 'k', 'WAIT:500', 'SP']), [{keys: ['g', 'k']}, {wait: 500}, {keys: ['space']}]);
});

test('모든 시나리오의 키를 바꿀 수 있다', () => {
  for (const sc of allScenarios()) {
    for (const lang of sc.langs) {
      if (sc.keys) assert.doesNotThrow(() => keyPlan(sc.keys(lang)), `${sc.id}/${lang}`);
    }
  }
});

test('Firefox만 focusmanager.testmode를 끈다', () => {
  const a = linuxAdapter('fcitx5');
  assert.equal(a.name, 'linux');
  assert.deepEqual(a.launchOpts('firefox').firefoxUserPrefs, {'focusmanager.testmode': false});
  assert.equal(a.launchOpts('webkit').firefoxUserPrefs, undefined);
  assert.throws(() => linuxAdapter('kime'));
});
