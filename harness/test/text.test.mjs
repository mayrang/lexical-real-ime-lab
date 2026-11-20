import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, flatten, expectedAfter, firstDiff } from '../core/text.mjs';

test('NFC만 맞추고 NBSP는 그대로', () => {
  assert.equal(normalize('한'), '한');
  assert.equal(normalize('한'), '한'.normalize('NFC'));
  assert.notEqual(normalize('a b'), 'a b');
  assert.equal(normalize('a​b'), 'a​b');
});
test('문단은 \\n 하나로 잇는다', () => assert.equal(flatten(['ab', '', 'c']), 'ab\n\nc'));
test('커서 위치에 삽입', () => assert.equal(expectedAfter({text: 'abcdef', selStart: 3, selEnd: 3}, '한국어 '), 'abc한국어 def'));
test('범위 선택은 대체', () => assert.equal(expectedAfter({text: 'abc\ndef', selStart: 2, selEnd: 6}, '한국어'), 'ab한국어f'));
test('firstDiff', () => assert.deepEqual(firstDiff('한국어', '한국ㅓ'), {at: 2, a: '어', b: 'ㅓ'}));
