// Android scenarios, ported from the spike (branch android, android/scenarios.mjs, feasibility set).
//
// Android input is InputConnection calls from the test IME (harness/native/android/ime), not keys.
// steps(lang): Step list instead of keys(lang). Each step:
//   ['compose', s] setComposingText(s, 1) | ['commit', s] commitText(s, 1) | ['finish'] finishComposingText()
//   ['delete', before, after] deleteSurroundingText | ['key', code] sendKeyEvent down+up (67 = KEYCODE_DEL)
//   ['select', a, b] setSelection | ['region', a, b] setComposingRegion
//   ['seq', [steps...]] all steps in one broadcast, no settle between them | ['wait', ms]
// word(lang, cell): text the control must contain after the steps. Every scenario starts in an empty
//   editor, so H1 (control after = before with the selection replaced by word) holds for deletions too:
//   word is the text left after the deletion. Values are the spike's `expect` (run 44641665810, control 3/3).
// The test IME is language-agnostic. The del-* scenarios type Latin text and run under lang 'ko' only.

const compose = (...xs) => xs.map((x) => ['compose', x]);

const OPS_TEXT = new Set(['compose', 'commit']);
const OPS_TWO_INTS = new Set(['delete', 'select', 'region']);
const isInt = (x) => Number.isInteger(x) && x >= 0;

/** @param {any} st @param {boolean} [inSeq] @returns {boolean} */
export function isStep(st, inSeq = false) {
  if (!Array.isArray(st) || st.length === 0) return false;
  const [op, a, b] = st;
  if (OPS_TEXT.has(op)) return st.length === 2 && typeof a === 'string';
  if (op === 'finish') return st.length === 1;
  if (OPS_TWO_INTS.has(op)) return st.length === 3 && isInt(a) && isInt(b);
  if (op === 'key') return st.length === 2 && isInt(a);
  if (op === 'wait') return !inSeq && st.length === 2 && isInt(a);
  if (op === 'seq') return !inSeq && st.length === 2 && Array.isArray(a) && a.length > 0 && a.every((x) => isStep(x, true));
  return false;
}

const sc = (id, steps, word) => ({
  id, group: 'android', langs: ['ko'],
  steps: () => steps,
  word: () => word,
});

export const SCENARIOS = [
  sc('ko-finish',
    [...compose('ㅎ', '하', '한'), ['finish'], ...compose('ㄱ', '구', '국'), ['finish'], ...compose('ㅇ', '어'), ['finish']],
    '한국어'),
  sc('ko-commit',
    [...compose('ㅎ', '하', '한'), ['commit', '한'], ...compose('ㄱ', '구', '국'), ['commit', '국'], ...compose('ㅇ', '어'), ['commit', '어']],
    '한국어'),
  sc('del-surrounding', [['commit', 'hello'], ['delete', 1, 0], ['delete', 1, 0]], 'hel'),
  sc('del-key', [['commit', 'hello'], ['key', 67], ['key', 67]], 'hel'),
  sc('ko-del-surrounding',
    [...compose('ㅎ', '하', '한'), ['finish'], ...compose('ㄱ', '구', '국'), ['finish'], ['delete', 1, 0]],
    '한'),
  // Gboard-style Backspace while composing: shorter composing text, then empty.
  sc('ko-del-in-composition',
    [...compose('ㅎ', '하', '한'), ['finish'], ...compose('ㄱ', '구', '국', '구', 'ㄱ', ''), ['finish']],
    '한'),
];
