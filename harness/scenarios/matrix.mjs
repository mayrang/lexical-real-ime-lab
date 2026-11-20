// Linux matrix scenarios, ported from lexical-knowledge/tools/real-ime-spike/matrix/scenarios.js.
//
// setup(c): c.page is a Playwright page, c.target is 'control' or 'lexical', c.sel is the editor selector.
//   Setup uses Playwright synthetic keys. They bypass the OS IME (checked in the spike with
//   hangul, mozc and pinyin active).
// keys(lang): token list that goes through the real OS IME. See vocab.mjs.
// word(lang, cell): text the control must contain after the keys. cell = {scen, lang, os, ime, browser}.
//   Every value below comes from the old control results (results.json, ctlFlat minus the setup text).
//   Lexical values were never used to set a word.
// lexAfter(before, word): expected Lexical text. Default is expectedAfter.
// paragraphs(before): expected Lexical paragraph count. Default is the count before the keys.
// intent.check(lexicalSide): message string if the documented behaviour is broken, else null.
//   An intent exists only where a meta/lexical PR, test or doc states the behaviour.
import {readFileSync} from 'node:fs';
import {expectedAfter} from '../core/text.mjs';
import {DEF_KEYS, WORD_KEYS, toks} from './vocab.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ALL = ['ko', 'ja', 'zh'];

// Default control text: Korean ends with a space key. Japanese and Chinese commit without one.
const DEF_WORD = {ko: '한국어 ', ja: '日本語', zh: '你好'};
const defWord = (lang) => DEF_WORD[lang];
const defKeys = (lang) => toks(DEF_KEYS[lang]);
const wordKeys = (lang) => toks(WORD_KEYS[lang]);

const type = (c, s) => c.page.keyboard.type(s, {delay: 30});
const press = async (c, k, n = 1) => {
  for (let i = 0; i < n; i++) await c.page.keyboard.press(k);
};
const bold = (c) => c.page.keyboard.press(process.platform === 'darwin' ? 'Meta+b' : 'Control+b');

// Lexical setup state comes from editor.parseEditorState (JSON captured from a Chromium paste of the same
// HTML), because a synthetic ClipboardEvent paste has no clipboardData in Firefox.
// The control uses execCommand('insertHTML').
let STATES = null;
async function paste(c, html, stateKey) {
  if (c.target === 'control') {
    await c.page.evaluate((h) => document.execCommand('insertHTML', false, h), html);
  } else if (stateKey) {
    STATES ??= JSON.parse(readFileSync(new URL('./states.json', import.meta.url), 'utf8'));
    await c.page.evaluate(([sel, json]) => {
      const ed = document.querySelector(sel).__lexicalEditor;
      ed.setEditorState(ed.parseEditorState(json));
    }, [c.sel, STATES[stateKey]]);
  } else {
    await c.page.evaluate((h) => {
      const dt = new DataTransfer();
      dt.setData('text/html', h);
      dt.setData('text/plain', h.replace(/<[^>]+>/g, ''));
      document.activeElement.dispatchEvent(new ClipboardEvent('paste', {bubbles: true, cancelable: true, clipboardData: dt}));
    }, html);
  }
  await sleep(200);
}

async function placeCaret(c, needle, offset) {
  await c.page.evaluate(([needle, offset, sel]) => {
    const root = document.querySelector(sel);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (n.data.includes(needle)) {
        document.getSelection().setBaseAndExtent(n, offset, n, offset);
        return;
      }
    }
    throw new Error('no text node ' + needle);
  }, [needle, offset, c.sel]);
  await sleep(150);
}

const strip = (re) => (s) => s.replace(re, '');
// A markdown shortcut may already have consumed the typed prefix before the keys start.
// Strip it from the expected text either way.
const stripped = (re) => (before, word) => strip(re)(expectedAfter(before, word));

// Intent helpers. They read the node that holds the IME text: lexicalSide.after.imeNode.
const ime = (lex) => lex.after.imeNode;
const isBold = (lex) => {
  const i = ime(lex);
  return i && i.format & 1 ? null : `IME text not bold (format=${i && i.format})`;
};
const notBold = (lex) => {
  const i = ime(lex);
  return i && !(i.format & 1) ? null : 'IME text is bold';
};
const notAnc = (t) => (lex) => {
  const i = ime(lex);
  return i && !i.anc.includes(t) ? null : `IME text inside ${t}`;
};
const isType = (t) => (lex) => {
  const i = ime(lex);
  return i && i.type === t ? null : `IME text node type ${i && i.type} != ${t}`;
};
const notType = (t) => (lex) => {
  const i = ime(lex);
  return i && i.type !== t ? null : `IME text node type is ${t}`;
};
const hasAnc = (t) => (lex) => {
  const i = ime(lex);
  return i && i.anc.includes(t) ? null : `IME text not inside ${t} (anc=${i && i.anc.join('>')})`;
};

// Evidence format (parsed by scenarios.test.mjs): packages/<path>: '<exact test title>' (meta/lexical@<sha>). <what>
// Every cited title was checked with git grep -F at that commit.
const COMMIT = '3c631cbab';
const ev = (path, name, what) => `${path}: '${name}' (meta/lexical@${COMMIT}). ${what}`;
const E2E = 'packages/lexical-playground/__tests__/e2e/';
const COMPOSITION = `${E2E}Composition.spec.mjs`;
const EV_BOLD_NEW = ev(COMPOSITION, 'Can type Hiragana via IME into a new bold format', 'Ctrl+B with no text, then IME text, gives bold text.');
const EV_HASHTAG = ev(COMPOSITION, 'Can type Hiragana via IME with hashtags', '"#" then IME text gives one hashtag node.');
const EV_SUBCLASS = ev('packages/lexical/src/__tests__/browser/LexicalComposition.test.ts', 'Composition into a TextNode subclass (#9289)', 'Composing into a normal-mode TextNode subclass keeps its type (meta/lexical#9291). HashtagNode is such a subclass.');
const EV_MENTION = ev(COMPOSITION, 'Typing after mention with IME should not break it', 'IME text after a mention is a separate plain text node.');
const EV_BOLD_OFF = ev(`${E2E}TextFormatting.spec.mjs`, 'Can create bold text using the shortcut', 'Bold off, then typing gives plain text.');
const EV_LINK_IN = ev(`${E2E}Links.spec.mjs`, 'It can insert text inside a link after a formatted text node', 'Typing inside a link stays in the link.');
const EV_LINK_AFTER = ev(`${E2E}Links.spec.mjs`, 'Can type text before and after', 'Typing at the end of a paragraph after a link goes outside the link.');
const EV_MD_BLOCK = ev('packages/lexical-markdown/src/__tests__/browser/MarkdownShortcuts.test.ts', 'types, undoes and redoes $text', 'The shortcut text "# ", "> " or "- " makes a heading, quote or list.');
const EV_LIST_ENTER = ev(`${E2E}Markdown.spec.mjs`, 'keep list marker on its own items', 'Enter in a list item makes a new list item (checked through the markdown export).');
const EV_CODE = ev(`${E2E}CodeBlock.spec.mjs`, 'Can create code block with markdown', 'Text typed after the shortcut is inside the code block.');
const EV_TABLE = ev(`${E2E}Tables.spec.mjs`, 'Can type inside of table cell', 'Typed text lands in the table cell.');

const S = [
  {id: 'plain-end', langs: ALL, setup: (c) => type(c, 'abc ')},
  {id: 'plain-mid', langs: ALL, setup: async (c) => { await type(c, 'abcdef'); await press(c, 'ArrowLeft', 3); }},
  // Control "x" + "하난 ": the first jamo group splits across syllables. Same on all six engine/browser pairs.
  {id: 'ko-jamo-migrate', langs: ['ko'], setup: (c) => type(c, 'x'), keys: () => toks('g k s k s SP'), word: () => '하난 '},

  {id: 'bold-after-off', langs: ALL, setup: async (c) => { await type(c, 'ab'); await bold(c); await type(c, 'cd'); await bold(c); },
    intent: {check: notBold, evidence: EV_BOLD_OFF}},
  {id: 'bold-on-empty', langs: ['ko'], setup: async (c) => { await type(c, 'ab'); await bold(c); },
    intent: {check: isBold, evidence: EV_BOLD_NEW}},
  // 근거 없음 — 3층 진단만: IME text inside a bold run is bold (isBold)
  {id: 'bold-inside', langs: ['ko'], setup: async (c) => {
    await type(c, 'ab'); await bold(c); await type(c, 'cdef'); await bold(c); await type(c, 'gh'); await press(c, 'ArrowLeft', 4);
  }},
  {id: 'link-inside', langs: ['ko'], setup: async (c) => {
    await paste(c, '<p>ab<a href="https://x.com">link</a>cd</p>', 'link'); await placeCaret(c, 'link', 2);
  }, intent: {check: hasAnc('link'), evidence: EV_LINK_IN}},
  {id: 'link-after-eol', langs: ['ko'], setup: async (c) => {
    await paste(c, '<p>ab<a href="https://x.com">link</a></p>', 'linkeol'); await placeCaret(c, 'link', 4);
  }, intent: {check: notAnc('link'), evidence: EV_LINK_AFTER}},
  {id: 'hashtag-after', langs: ['ko', 'ja'], setup: (c) => type(c, 'x #'),
    intent: {check: isType('hashtag'), evidence: EV_HASHTAG}},
  {id: 'hashtag-inside', langs: ['ko'], setup: async (c) => { await type(c, '#abcd'); await press(c, 'ArrowLeft', 2); },
    intent: {check: isType('hashtag'), evidence: EV_SUBCLASS}},
  {id: 'autolink-end', langs: ['ko'], setup: (c) => type(c, 'see https://example.com/')},

  // md-*: the control keeps the typed prefix, Lexical turns it into a block.
  {id: 'md-heading', langs: ALL, setup: (c) => type(c, '# '), lexAfter: stripped(/^# /),
    intent: {check: hasAnc('heading'), evidence: EV_MD_BLOCK}},
  {id: 'md-list', langs: ALL, setup: (c) => type(c, '- '), lexAfter: stripped(/^- /),
    intent: {check: hasAnc('listitem'), evidence: EV_MD_BLOCK}},
  {id: 'md-quote', langs: ['ko'], setup: (c) => type(c, '> '), lexAfter: stripped(/^> /),
    intent: {check: hasAnc('quote'), evidence: EV_MD_BLOCK}},
  // Control "a **" + "한국어**": the closing ** is typed after the word.
  // 근거 없음 — 3층 진단만: IME text is bold after the shortcut (isBold). No test at 3c631cbab types a ** shortcut.
  {id: 'md-bold', langs: ['ko'], setup: (c) => type(c, 'a **'), keys: () => [...wordKeys('ko'), 'ASTERISK', 'ASTERISK'],
    word: () => '한국어**', lexAfter: (before, word) => expectedAfter(before, word).replace(/\*\*(.*?)\*\*/, '$1')},
  // The last Return is a real Enter, so the control gets a paragraph break after the word.
  // Old analyzer dropped newlines from the flat text, so "\n" here is from the old expected blocks, not from ctlFlat.
  // Old caretLast (caret in the last block) has no field in the Record.
  {id: 'list-enter', langs: ALL, setup: (c) => type(c, '- ab'), keys: (l) => [...wordKeys(l), 'RET'],
    word: (l) => `${DEF_WORD[l].trimEnd()}\n`, lexAfter: stripped(/^- /), paragraphs: () => 2,
    intent: {check: hasAnc('listitem'), evidence: EV_LIST_ENTER}},
  {id: 'code-end', langs: ALL, setup: async (c) => { await type(c, '``` '); await type(c, 'let y = '); },
    lexAfter: stripped(/^``` /), intent: {check: hasAnc('code'), evidence: EV_CODE}},
  {id: 'code-mid', langs: ['ko', 'ja'], setup: async (c) => {
    await type(c, '``` '); await type(c, 'const x = "ab";'); await press(c, 'ArrowLeft', 3);
  }, lexAfter: stripped(/^``` /), intent: {check: hasAnc('code'), evidence: EV_CODE}},
  {id: 'table-cell', langs: ['ko', 'ja'], setup: async (c) => {
    await paste(c, '<table><tr><td><p>a</p></td><td><p>b</p></td></tr></table>', 'table'); await placeCaret(c, 'a', 1);
  }, intent: {check: hasAnc('tablecell'), evidence: EV_TABLE}},
  // The IME text replaces a range across two paragraphs, so one paragraph is left.
  {id: 'range-2para', langs: ['ko', 'ja'], setup: async (c) => {
    await type(c, 'abc'); await press(c, 'Enter'); await type(c, 'def'); await press(c, 'ArrowLeft');
    await c.page.keyboard.down('Shift'); await press(c, 'ArrowLeft', 4); await c.page.keyboard.up('Shift');
  }, paragraphs: () => 1},

  // Control values: ko "한 " (SP commits what is left after 3 BS), ja "にほ". Same on all six pairs.
  {id: 'bs-in-composition', langs: ['ko', 'ja'], setup: (c) => type(c, 'ab'),
    keys: (l) => toks({ko: `${WORD_KEYS.ko} BS BS BS SP`, ja: 'n i h o n g o BS BS RET'}[l]),
    word: (l) => ({ko: '한 ', ja: 'にほ'})[l]},
  // Control values: ko "한국" (SP commits 한국어, then 2 BS), ja "日本".
  {id: 'bs-after-commit', langs: ['ko', 'ja'], setup: (c) => type(c, 'ab'),
    keys: (l) => toks({ko: `${WORD_KEYS.ko} SP BS BS`, ja: `${WORD_KEYS.ja} BS`}[l]),
    word: (l) => ({ko: '한국', ja: '日本'})[l]},
  // Control stays "ab": the IME text is fully deleted.
  {id: 'bs-to-empty-bold', langs: ['ko'], setup: async (c) => { await type(c, 'ab'); await bold(c); },
    keys: () => toks('g k BS BS'), word: () => ''},
  // The playground blurs the editor on a plain Escape (checked without IME), so no caret is expected.
  // Control values, same on all engines and browsers except ibus + webkit:
  //   ko: "한국어" (Escape commits)
  //   ja, zh: "" (Escape cancels)
  //   ibus + webkit: ja "にほんご", zh "你好" (Escape commits the preedit)
  {id: 'escape-cancel', langs: ALL, setup: async (c) => { await type(c, 'abcd'); await press(c, 'ArrowLeft', 2); },
    keys: (l) => toks({ko: `${WORD_KEYS.ko} ESC`, ja: 'n i h o n g o ESC', zh: 'n i h a o ESC'}[l]),
    word: (l, cell) => {
      if (l === 'ko') return '한국어';
      if (cell?.ime === 'ibus' && cell?.browser === 'webkit') return {ja: 'にほんご', zh: '你好'}[l];
      return '';
    },
    blursEditor: true},
  // The last Return is a real Enter. The control gets a paragraph break after the word.
  // The "\n" comes from the old expected blocks [word, ""], not from ctlFlat (the old flat text dropped newlines).
  {id: 'ime-enter', langs: ALL, setup: (c) => type(c, 'ab'), keys: (l) => [...wordKeys(l), 'RET'],
    word: (l) => `${DEF_WORD[l].trimEnd()}\n`, paragraphs: () => 2},

  // 근거 없음 — 3층 진단만: the typeahead menu shows items (old post: 'menu'). The playground mention menu
  // needs a 1+ character query, so a bare "@" opens nothing. The IME text then becomes the query and
  // matches no mention, so an empty menu is correct. No test asserts a menu for this state.
  {id: 'mention-query', langs: ALL, setup: (c) => type(c, '@')},
  // The control types "@Luke " and the playground picks a mention, so Lexical text is "Luke Skywalker한국어 ".
  // The default lexAfter gives that, because the Lexical "before" text already holds the mention.
  {id: 'mention-after', langs: ['ko'], setup: async (c) => {
    await type(c, '@Luke');
    if (c.target === 'lexical') {
      await c.page.waitForSelector('#typeahead-menu ul li', {timeout: 4000});
      await press(c, 'Enter');
    } else {
      await type(c, ' ');
    }
    await sleep(150);
  }, intent: {check: notType('mention'), evidence: EV_MENTION}},
  // 근거 없음 — 3층 진단만: the component picker menu shows items (old post: 'menu'). ComponentPicker.spec.mjs
  // 'Can insert a heading using the component picker slash command' shows the menu opens after "/". The IME
  // text then filters the options to none, so an empty menu after the keys is correct.
  {id: 'picker-query', langs: ALL, setup: (c) => type(c, '/')},
];

export const SCENARIOS = S.map((s) => ({
  group: 'matrix',
  keys: defKeys,
  word: defWord,
  ...s,
}));
