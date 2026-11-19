// Pre-registered scenarios and oracles. Written before any CI run.
// Do not change an oracle between the parent and the fix commit of a bug.
export const SRC = {
  latin: 'com.apple.keylayout.US',
  ko: 'com.apple.inputmethod.Korean.2SetKorean',
  ja: 'com.apple.inputmethod.Kotoeri.RomajiTyping.Japanese',
  zh: 'com.apple.inputmethod.SCIM.ITABC',
};
const S = id => `SRC:${SRC[id]}`;

// Warm-up keys per input method (typed once per browser, then the page reloads).
export const WARM = {
  ko: [S('ko'), 'g', 'k', 'SP', 'BS', 'BS', 'BS'],
  ja: [S('ja'), 'a', 'RET', 'BS', 'BS'],
  zh: [S('zh'), 'n', 'i', 'SP', 'BS', 'BS'],
};

const nb = s => s.replace(/ /g, ' ');
// st = {model: {blocks: [{type, text, nodes:[{type,text,format}]}]}, dom: {blocks:[{tag, text}]}, errors:[...]}
const modelText = st => st.model.blocks.map(b => b.text).join('\n');
const domText = st => nb(st.dom.blocks.map(b => b.text).join('\n'));
const agree = st => st.model.blocks.length === st.dom.blocks.length && modelText(st) === domText(st);
const textNodes = st => st.model.blocks.flatMap(b => b.nodes).filter(n => typeof n.text === 'string' && n.text !== '');

export const SCENARIOS = {
  // #8121: first stroke after Cmd+A over formatted text must not be lost.
  '8121': {
    browser: 'chromium', ime: 'ko',
    keys: ['h', 'e', 'l', 'l', 'o', 'SP', 'w', 'o', 'r', 'l', 'd', 'CMD+LEFT', 'OPT+SHIFT+RIGHT', 'CMD+b', 'CMD+a',
      S('ko'), 'r', 'k', 'SP'],
    oracle: st => modelText(st) === '가 ' && st.model.blocks.length === 1 && agree(st),
  },
  // #9362: Enter after a cancelled Pinyin composition must create a new paragraph.
  '9362a': {
    browser: 'webkit', ime: 'zh',
    keys: ['a', 'b', 'c', S('zh'), 'n', 'i', 'ESC', 'WAIT:300', 'RET'],
    oracle: st => st.model.blocks.length === 2 && st.model.blocks[0].text.startsWith('abc') && agree(st),
  },
  '9362b': {
    browser: 'webkit', ime: 'zh',
    keys: ['a', 'b', 'c', S('zh'), 'n', 'i', 'BS', 'BS', 'WAIT:300', 'RET'],
    oracle: st => st.model.blocks.length === 2 && st.model.blocks[0].text.startsWith('abc') && agree(st),
  },
  // #8154: Cmd+A + Backspace after a committed Japanese composition must empty the editor.
  '8154': {
    browser: 'webkit', ime: 'ja',
    keys: [S('ja'), 'a', 'i', 'u', 'e', 'o', 'RET', 'WAIT:300', 'CMD+a', 'BS'],
    oracle: st => st.model.blocks.length === 1 && modelText(st) === '' && agree(st),
  },
  // #8598: Tab + Korean must not throw "TabNode does not support setTextContent"; the editor stays responsive.
  '8598': {
    browser: 'webkit', ime: 'ko',
    keys: ['f', 'o', 'o', 'TAB', S('ko'), 'a', 'WAIT:500', S('latin'), 'x'],
    oracle: st => !st.errors.some(e => /TabNode|setTextContent/.test(e)) &&
      modelText(st).startsWith('foo\t') && modelText(st).endsWith('x') && agree(st),
    // Secondary (also pre-registered): the composed jamo survives.
    strict: st => modelText(st).includes('ㅁ'),
  },
  // #7061: Backspace that cancels a one-letter Pinyin composition must not delete committed text.
  '7061': {
    browser: 'webkit', ime: 'zh',
    keys: ['a', 'b', 'c', S('zh'), 'n', 'BS'],
    oracle: st => st.model.blocks.length === 1 && modelText(st) === 'abc' && agree(st),
  },
  // #8680: markdown shortcut with the Korean source active on Firefox.
  '8680a': {
    browser: 'firefox', ime: 'ko',
    keys: [S('ko'), '-', 'SP'],
    oracle: st => st.model.blocks.length === 1 && st.model.blocks[0].type === 'list' &&
      st.dom.blocks[0].tag === 'UL' && !modelText(st).includes('-'),
  },
  '8680b': {
    browser: 'firefox', ime: 'ko',
    keys: [S('ko'), 'SHIFT+3', 'SP'],
    oracle: st => st.model.blocks.length === 1 && st.model.blocks[0].type === 'heading' &&
      st.dom.blocks[0].tag === 'H1' && !modelText(st).includes('#'),
  },
  // #8162: all of 가나다 typed over a partly bold Cmd+A selection must be bold.
  '8162': {
    browser: 'chromium', ime: 'ko',
    keys: ['h', 'e', 'l', 'l', 'o', 'w', 'o', 'r', 'l', 'd', 'CMD+LEFT', 'SHIFT+RIGHT', 'SHIFT+RIGHT', 'SHIFT+RIGHT',
      'SHIFT+RIGHT', 'SHIFT+RIGHT', 'CMD+b', 'CMD+a', S('ko'), 'r', 'k', 's', 'k', 'e', 'k', 'RIGHT'],
    oracle: st => modelText(st) === '가나다' && textNodes(st).every(n => (n.format & 1) === 1) && agree(st),
  },
};
