// Audit group: structural weaknesses from lexical-knowledge/tools/real-ime-spike/audit/SUMMARY.md
// (origin/main 3c631cbab). Each scenario names its target: S1-S4 (the four "Structural" items) or a
// "Local bug candidate".
//   S1: the composition is a node key (editor._compositionKey), and node operations clear or move it mid-IME.
//   S2: the U+200B placeholder lives in the model and leaks when the key moved.
//   S3: module-level timestamps and timers (history merge window, 20-100 ms heuristics).
//   S4: feature regexes assume ASCII space and punctuation (autolink, typeahead, hashtag, markdown).
//
// Fields as in matrix.mjs. Extra:
//   keyDelay: ms between keys (runner default 150).
// Every word is the control's text (no Lexical code). Calibration notes are next to each word.
// An intent exists only where a meta/lexical test asserts the same thing the check checks.
// "근거 없음" marks a target that no test states: those scenarios judge layers 1 and 2 only, and the
// Record keeps the rest (blocks, imeNode, menuItems) for reading by hand.
import {expectedAfter} from '../core/text.mjs';
import {DEF_KEYS, WORD_KEYS, toks} from './vocab.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ALL = ['ko', 'ja', 'zh'];
const DEF_WORD = {ko: '한국어 ', ja: '日本語', zh: '你好'};

const type = (c, s) => c.page.keyboard.type(s, {delay: 30});
const press = async (c, k, n = 1) => {
  for (let i = 0; i < n; i++) await c.page.keyboard.press(k);
};
const bold = (c) => c.page.keyboard.press(process.platform === 'darwin' ? 'Meta+b' : 'Control+b');

// Evidence format (parsed by scenarios.test.mjs): packages/<path>: '<exact test title>' (meta/lexical@<sha>). <what>
const COMMIT = '3c631cbab';
const ev = (path, name, what) => `${path}: '${name}' (meta/lexical@${COMMIT}). ${what}`;

const S = [
  // S1: formatText during a composition (Selection:2219 clears the key). Bold toggles while the last syllable
  // or the conversion is still open. Layers 1 and 2: the IME text is entered once and the editor stays sound.
  {id: 'fmt-mid-composition', langs: ALL,
    setup: (c) => type(c, 'ab'),
    keys: (l) => toks({ko: `${WORD_KEYS.ko} MOD+b`, ja: 'n i h o n g o SP MOD+b', zh: 'n i h a o MOD+b'}[l]),
    word: (l) => ({ko: '한국어', ja: '日本語', zh: '你好'})[l]},

  // S1: a real OS click on another paragraph while composing. The click moves the selection (PointType.set)
  // before the composition ends. Layers 1 and 2: the IME text stays where it was typed, once.
  {id: 'click-mid-composition', langs: ALL,
    setup: async (c) => { await type(c, 'abc'); await press(c, 'Enter'); await type(c, 'def'); },
    keys: (l) => toks({ko: `${WORD_KEYS.ko} CLICK:abc`, ja: 'n i h o n g o SP CLICK:abc', zh: 'n i h a o CLICK:abc'}[l]),
    word: (l) => ({ko: '한국어', ja: '日本語', zh: '你好'})[l]},

  // S1 (P2d: key null, then the IME's Enter makes a paragraph). The caret sits on a format boundary
  // (end of bold "cd", start of plain "ef"), and the conversion is committed with Return.
  // Layer 2: the Return that commits the conversion is not a paragraph break, so one paragraph stays.
  {id: 'enter-after-key-reset', langs: ['ja'],
    setup: async (c) => {
      await type(c, 'ab'); await bold(c); await type(c, 'cd'); await bold(c); await type(c, 'ef'); await press(c, 'ArrowLeft', 2);
    },
    keys: () => toks(WORD_KEYS.ja), word: () => '日本語', paragraphs: () => 1},

  // S2: composition starts in an empty paragraph with bold on (element anchor and a format change: both send
  // the U+200B placeholder path in $handleCompositionStart). Layer 1 checks that no U+200B is left.
  // 근거 없음 for the IME text being bold here: 'Can type Hiragana via IME into a new bold format' types after
  // "Hello" (text anchor), and 'composition in empty paragraph (element anchor ZWSP path)' has no bold.
  {id: 'compose-empty-format', langs: ALL,
    setup: async (c) => { await type(c, 'ab'); await press(c, 'Enter'); await bold(c); },
    keys: (l) => toks(DEF_KEYS[l]), word: (l) => DEF_WORD[l]},

  // S3 + D1: syllables 400 ms apart (more than the 300 ms history merge window), then one undo.
  // 근거 없음 — no intent. #8142's PR text says compositions are merged into the previous state only "if input
  // time less than delay", which is not the case here; no test covers consecutive compositions and undo.
  // Lexical text: layer 2 compares with the control's native undo (the default), which is not a Lexical rule.
  // Read a layer 2 failure here as a difference from the browser's own undo, not as a broken documented behaviour.
  {id: 'slow-syllables-undo', langs: ['ko'],
    setup: (c) => type(c, 'ab '),
    keys: () => toks('g k s WAIT:400 r n r WAIT:400 d j SP WAIT:400 MOD+z'),
    word: () => '한국어'},

  // S3: keys 40 ms apart instead of 150 ms (the 20-100 ms timers). Layers 1 and 2.
  {id: 'fast-typing', langs: ALL, keyDelay: 40,
    setup: (c) => type(c, 'ab'),
    keys: (l) => toks(DEF_KEYS[l]), word: (l) => DEF_WORD[l]},

  // S4: autolink separators are /[.,;\s]/. The URL is followed by CJK punctuation from the IME:
  // ja "。" then an ideographic space (U+3000), zh "，".
  // 근거 없음 — 3층 진단만: no test at 3c631cbab ends an autolink with CJK punctuation. The Record's blocks show
  // whether the punctuation went into the link.
  {id: 'autolink-cjk-punct', langs: ['ja', 'zh'],
    setup: (c) => type(c, 'see https://example.com'),
    keys: (l) => toks({ja: 'PERIOD RET SP', zh: 'COMMA'}[l]),
    word: (l) => ({ja: '。　', zh: '，'})[l]},

  // S4: the typeahead trigger needs (^|\s|\() before "@". Korean text, then "@" at once (the IME passes it).
  // 근거 없음 — 3층 진단만: no test opens the mention menu right after a CJK character, and the playground menu
  // needs a 1+ character query that a Korean IME cannot type in Latin. menuItems stays in the Record.
  {id: 'mention-no-space', langs: ['ko'],
    keys: () => toks(`${WORD_KEYS.ko} SHIFT+2`), word: () => '한국어@'},

  // S4: markdown shortcuts look for an ASCII " " after "#". Japanese IME space without a composition is an
  // ideographic space (U+3000).
  // 근거 없음 — 3층 진단만: no test types "#" + U+3000. Layer 2 expects the text as typed.
  {id: 'md-heading-fullwidth', langs: ['ja'],
    setup: (c) => type(c, '#'),
    keys: () => toks(`SP ${WORD_KEYS.ja}`), word: () => '　日本語'},

  // Candidate P6b (token destroyed on a cancelled composition): compose inside a hashtag, then Escape cancels.
  // 근거 없음 for the hashtag node surviving the cancel: the #9291 tests ('composing %s keeps its type, key and
  // node state') commit the composition, and 'cancelled composition reverts text' has no TextNode subclass.
  // Layer 2 checks the text reverts; the Record's blocks show the node type.
  // The playground blurs the editor on a plain Escape, so no caret is expected (as matrix escape-cancel).
  // Control values (guess, from matrix escape-cancel): "" (Escape cancels); ibus + webkit commits the preedit.
  {id: 'token-cancel', langs: ['ja', 'zh'], blursEditor: true,
    setup: async (c) => {
      await type(c, '#abcd');
      await press(c, 'ArrowLeft', 2);
      if (c.target === 'lexical') await c.page.waitForSelector(`${c.sel} [class*="hashtag"]`, {timeout: 3000});
      await sleep(100);
    },
    keys: (l) => toks({ja: 'k a ESC', zh: 'n i ESC'}[l]),
    word: (l, cell) => (cell?.ime === 'ibus' && cell?.browser === 'webkit' ? {ja: 'か', zh: '你'}[l] : '')},

  // Candidate (229 gate): Tab while the last syllable is still composing. The Korean IME commits, and the Tab
  // keydown arrives with keyCode 229. The control (plain contenteditable) moves focus out on Tab, so its text
  // has no tab. Lexical: the playground's TabIndentationExtension inserts a tab node after text.
  // Layer 2 expects the tab, from 'can tab + IME' (Tab after IME text gives a tab node). That test presses
  // Tab after the composition ended; here it ends with the Tab itself.
  {id: 'ko-tab-commit', langs: ['ko'],
    setup: (c) => type(c, 'ab'),
    keys: () => toks(`${WORD_KEYS.ko} TAB`), word: () => '한국어',
    lexAfter: (before, word) => expectedAfter(before, `${word}\t`)},

  // #9949 (markdown shortcut guard on multi-character input): the closing backtick of inline code arrives with
  // the IME commit. Korean: the backtick commits the last syllable and is passed on, in one composition end or
  // right after it. The shortcut consumes both backticks.
  {id: 'md-shortcut-multichar', langs: ['ko'],
    setup: (c) => type(c, '`hello'),
    keys: () => toks('g k BACKTICK'), word: () => '하`',
    lexAfter: (before, word) => expectedAfter(before, word).replace(/`/g, ''),
    intent: {
      check: (lex) => {
        const i = lex.after.imeNode;
        return i && i.format & 16 ? null : `IME text not inline code (format=${i && i.format})`;
      },
      evidence: ev('packages/lexical-markdown/src/__tests__/unit/LexicalMarkdown.test.ts',
        'applies inline code when compositionend commits the trigger as a multi-character chunk',
        '"`hello" + a composition end that commits "a`" gives inline code "helloa".'),
    }},
];

export const SCENARIOS = S.map((s) => ({group: 'audit', ...s}));
