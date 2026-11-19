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

  // ---- Experiment B: efficacy (oracles written before running) ----
  // #5077 (fix ca45b1d, parent 619917b): Backspace via deleteSurroundingText mid-word.
  // Fixed: "HellWorld". Bug signature on parent: "Hellorld" (Lexical deletes, Chrome deletes again).
  'b5077': {
    steps: [['commit', 'HelloWorld'], ['select', 5, 5], ['delete', 1, 0]],
    expect: 'HellWorld',
    bug: 'Hellorld',
  },
  // Negative control for #5077: KEYCODE_DEL takes the keydown path; expected "HellWorld" on both commits.
  'b5077-key': {
    steps: [['commit', 'HelloWorld'], ['select', 5, 5], ['key', 67]],
    expect: 'HellWorld',
  },
  // #5282 (fix 4d2e310, parent 68c6148): last char on a line not deleted.
  // Fixed: "". Bug signature on parent: "a".
  'b5282': {
    steps: [['commit', 'a'], ['delete', 1, 0]],
    expect: '',
    bug: 'a',
  },
  // #6268 (fix b73bfc3, parent 93b756b): Backspace at end of a keyword node (canInsertTextAfter false).
  // Precondition: KeywordsPlugin made a .keyword span. Fixed: "congrat". Bug signature on parent: "congrats".
  'b6268': {
    steps: [['commit', 'congrats'], ['delete', 1, 0]],
    expect: 'congrat',
    bug: 'congrats',
    oracle: res => (res.target === 'lexical' && !res.states[0]?.keyword ? ['precondition: no .keyword span after commit'] : []),
  },
};
