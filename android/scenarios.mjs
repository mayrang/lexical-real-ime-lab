// Each step is an InputConnection call made by the test IME.
// ['compose', s] setComposingText(s,1) | ['commit', s] commitText(s,1) | ['finish'] finishComposingText()
// ['delete', before, after] deleteSurroundingText | ['key', code] sendKeyEvent down+up (67 = KEYCODE_DEL)
// ['select', a, b] setSelection | ['region', a, b] setComposingRegion
// ['seq', [steps...]] = all steps in one broadcast (no settle between them) | ['wait', ms]
const compose = (...xs) => xs.map(x => ['compose', x]);

export const scenarios = {
  // ---- Experiment A: feasibility ----
  'ko-finish': {
    steps: [...compose('ㅎ', '하', '한'), ['finish'], ...compose('ㄱ', '구', '국'), ['finish'], ...compose('ㅇ', '어'), ['finish']],
    expect: '한국어',
  },
  'ko-commit': {
    steps: [...compose('ㅎ', '하', '한'), ['commit', '한'], ...compose('ㄱ', '구', '국'), ['commit', '국'], ...compose('ㅇ', '어'), ['commit', '어']],
    expect: '한국어',
  },
  'del-surrounding': {
    steps: [['commit', 'hello'], ['delete', 1, 0], ['delete', 1, 0]],
    expect: 'hel',
  },
  'del-key': {
    steps: [['commit', 'hello'], ['key', 67], ['key', 67]],
    expect: 'hel',
  },
  'ko-del-surrounding': {
    steps: [...compose('ㅎ', '하', '한'), ['finish'], ...compose('ㄱ', '구', '국'), ['finish'], ['delete', 1, 0]],
    expect: '한',
  },
  'ko-del-in-composition': {
    // Gboard-style Backspace while composing: shorter composing text, then empty.
    steps: [...compose('ㅎ', '하', '한'), ['finish'], ...compose('ㄱ', '구', '국', '구', 'ㄱ', ''), ['finish']],
    expect: '한',
  },
};
