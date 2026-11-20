import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateRecord} from '../core/record.mjs';
import {scenariosFor} from '../scenarios/index.mjs';

process.env.ADB = '/nonexistent/adb';
const {runAndroidCell, encodeStep} = await import('../drivers/android.mjs');

test('encodeStep: 글자는 base64, 수는 그대로', () => {
  assert.equal(encodeStep(['compose', '한']), `compose,${Buffer.from('한').toString('base64')},,`);
  assert.equal(encodeStep(['commit', '']), 'commit,,,');
  assert.equal(encodeStep(['delete', 1, 0]), 'delete,,1,0');
  assert.equal(encodeStep(['finish']), 'finish,,,');
});

test('adb가 없어도 기록을 돌려준다 (fatal)', async () => {
  const sc = scenariosFor('android')[0];
  const rec = await runAndroidCell(sc, {lang: 'ko', rep: 1, lexicalUrl: 'http://127.0.0.1:3013/', controlUrl: 'http://127.0.0.1:3014/control.html'});
  assert.deepEqual(validateRecord(rec), []);
  assert.ok(rec.harness.fatal);
  assert.deepEqual(rec.cell, {scen: sc.id, lang: 'ko', os: 'android', ime: 'testime', browser: 'chrome'});
  assert.equal(rec.harness.keysSent.length, sc.steps('ko').length);
});
