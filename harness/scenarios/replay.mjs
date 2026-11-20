// Replay group: past IME bugs, each run on its parent and fix commit (spec §5.1).
// Sources: macOS keys and oracles from the lab repo's scenarios.mjs + matrix.json (root), Linux from
// lexical-knowledge/tools/real-ime-spike/replay/{real.js,common.js}, Android from branch android
// (android/scenarios.mjs + android/matrix.json). Commit pairs: merge commit of the fix PR and its first parent
// (gh pr view <N> -R meta/lexical --json mergeCommit). node/pm: what installed and built in the spikes.
//
// Extra fields (see matrix.mjs for the others):
//   commits: {parent, fix, node, pm}  run.mjs runs the scenario on both builds and on the main build,
//                                     and labels the Record cell.scen `<id>@parent|fix|main`.
//   only: {os?, browser?, ime?}       the platform where the bug was found. Other platforms skip it.
// Every replay declares its own word (control text) and, when setup leaves text in the editor, its own lexAfter.
// Words are control results: the control has no Lexical code, so they hold on parent and fix alike.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {expectedAfter} from '../core/text.mjs';
import {toks} from './vocab.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isMac = process.platform === 'darwin';
const type = (c, s) => c.page.keyboard.type(s, {delay: 30});
const press = async (c, k, n = 1) => {
  for (let i = 0; i < n; i++) await c.page.keyboard.press(k);
};
const mod = (c, k) => c.page.keyboard.press(`${isMac ? 'Meta' : 'Control'}+${k}`);

// Lexical: a synthetic ClipboardEvent paste (Chromium only; the spike's real.js did the same, and old builds
// cannot read states.json from today's playground). Control: execCommand('insertHTML').
async function paste(c, html) {
  await c.page.evaluate(([h, isLex]) => {
    if (!isLex) {
      document.execCommand('insertHTML', false, h);
      return;
    }
    const dt = new DataTransfer();
    dt.setData('text/html', h);
    dt.setData('text/plain', h.replace(/<[^>]+>/g, ''));
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', {bubbles: true, cancelable: true, clipboardData: dt}));
  }, [html, c.target === 'lexical']);
  await sleep(600);
}

async function placeCaret(c, needle, offset) {
  await c.page.evaluate(([needle, offset, sel]) => {
    const w = document.createTreeWalker(document.querySelector(sel), NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (n.data === needle) {
        document.getSelection().setBaseAndExtent(n, offset, n, offset);
        return;
      }
    }
    throw new Error('no text node ' + needle);
  }, [needle, offset, c.sel]);
  await sleep(400);
}

// Setup shared by #8162 and #8121: text, the first five characters bold, then select all.
// Pauses between the steps: without them the old dev builds sometimes bolded nothing or "h"/"hell"
// (run 44721522976). On Lexical the bold run is checked, so a bad setup is a harness error, not a verdict.
const formattedSelectAll = (text) => async (c) => {
  await type(c, text);
  await sleep(300);
  await press(c, 'ArrowLeft', text.length);
  await sleep(300);
  await c.page.keyboard.down('Shift');
  await press(c, 'ArrowRight', 5);
  await c.page.keyboard.up('Shift');
  await sleep(300);
  await mod(c, 'b');
  await sleep(300);
  if (c.target === 'lexical') {
    const runs = await c.page.evaluate((sel) => [...document.querySelectorAll(`${sel} [data-lexical-text="true"]`)]
      .map((e) => `${e.textContent}:${e.tagName === 'STRONG' || /Bold/.test(e.className) ? 'b' : '-'}`).join(' '), c.sel);
    if (!runs.startsWith(`${text.slice(0, 5)}:b `)) throw new Error(`bold setup failed: ${runs}`);
  }
  await mod(c, 'a');
  await sleep(300);
};

// Evidence: the fix PR's own test (or a test of the same behaviour) at the fix commit.
// Format checked by scenarios.test.mjs: packages/<path>: '<exact test title>' (meta/lexical@<sha>). <what>
const ev = (path, name, sha, what) => `${path}: '${name}' (meta/lexical@${sha}). ${what}`;
const E2E = 'packages/lexical-playground/__tests__/e2e/';

const textNodes = (lex) => lex.after.blocks.flatMap((b) => b.nodes).filter((n) => n.text !== '' && n.type !== 'paragraph');

const S = [
  // #8162: typing over a Cmd/Ctrl+A selection whose first text node is bold keeps bold for all of the IME text.
  // Old oracle (replay common.js b1, lab scenarios.mjs 8162): text 가나다, every text node bold.
  // Old Linux result: parent fcitx5 "가":bold "나다":plain, parent ibus all plain; fix ibus lost all text.
  {id: 'b8162', langs: ['ko'], only: {os: ['linux', 'macos'], browser: ['chromium']},
    commits: {parent: '7e472705aeeb8817b7e045d0d0024097d3848a0a', fix: '1448d64c942e792858f97ffe59eb988013cb526e', node: '22', pm: 'pnpm@10.30.0'},
    setup: formattedSelectAll('helloworld'),
    keys: () => toks('r k s k e k RIGHT'), word: () => '가나다', lexAfter: expectedAfter,
    intent: {
      check: (lex) => {
        const ns = textNodes(lex);
        const plain = ns.filter((n) => !(n.format & 1));
        return ns.length && !plain.length ? null : `IME text not all bold: ${ns.map((n) => `${JSON.stringify(n.text)}:f${n.format}`).join(' ')}`;
      },
      evidence: ev(`${E2E}Composition.spec.mjs`, 'Can replace multiple formatted text nodes with IME composition (Korean)', '1448d64c9',
        'Select all over partly bold text, then Korean IME text gives one bold text node.'),
    }},

  // #8142: a cancelled composition must not add an undo step. Old oracle b2a: after undo the editor is empty.
  // Old setup typed "a" in Latin mode; here everything goes through the IME so that the control's own undo
  // (native) covers the same input: "a RET" commits あ, 1.1 s later "s ESC" is cancelled, then Ctrl+Z.
  {id: 'b8142', langs: ['ja'], only: {os: ['linux'], browser: ['chromium']},
    commits: {parent: '05fc02ada3392303c80b7bcb7ad3de34ba5ebfb7', fix: 'c32268ada4908272d01b2708939b5af50d8fec02', node: '22', pm: 'pnpm@10.30.0'},
    // Control (run 44723777809, 6/6 runs): "あ". Native contenteditable undo does not take the IME commit back,
    // so the control cannot give Lexical's expected text. lexAfter comes from the fix's test instead.
    keys: () => toks('a RET WAIT:1100 s ESC WAIT:300 MOD+z'), word: () => 'あ', lexAfter: () => '',
    intent: {
      check: (lex) => (lex.after.text === '' ? null : `text after undo ${JSON.stringify(lex.after.text)}, not empty: the cancelled composition was an undo step`),
      evidence: ev(`${E2E}History.spec.mjs`, 'Cancel composition not push undo stack', 'c32268ada',
        'Text, a pause, a cancelled composition, then undo gives an empty editor.'),
    }},

  // #9291: composing inside a hashtag keeps the same hashtag node (type and key). Old oracle b5.
  // Old Linux result: parent hashtag key 4 -> 6 (type kept), fix key kept.
  {id: 'b9291', langs: ['ja'], only: {os: ['linux'], browser: ['chromium']},
    commits: {parent: '7bfd3e4ef532f87bdace863afe3821a092693b51', fix: '979209266e353c280b80bca23d2b9d7a0ba3ce80', node: '24', pm: 'pnpm@11.24.0'},
    setup: async (c) => {
      await type(c, '#abcd');
      await press(c, 'ArrowLeft', 2);
      if (c.target === 'lexical') await c.page.waitForSelector(`${c.sel} [class*="hashtag"]`, {timeout: 3000});
    },
    keys: () => toks('k a SP RET'), word: () => 'か', lexAfter: expectedAfter,
    intent: {
      check: (lex) => {
        const pre = (lex.before.blocks ?? []).flatMap((b) => b.nodes).find((n) => n.type === 'hashtag');
        const i = lex.after.imeNode;
        if (!pre) return 'no hashtag node before the keys';
        if (!i) return 'IME text not found';
        if (i.type !== 'hashtag') return `IME text node type ${i.type} != hashtag`;
        return i.key === pre.key ? null : `hashtag node replaced: key ${pre.key} -> ${i.key}`;
      },
      evidence: ev('packages/lexical/src/__tests__/browser/LexicalComposition.test.ts', 'composing %s keeps its type, key and node state', '979209266',
        'Composing into a TextNode subclass keeps its type and key (meta/lexical#9291). HashtagNode is such a subclass.'),
    }},

  // #5762: IME text at a text node boundary inside a link (canInsertTextAfter false) is entered once and the
  // paragraph stays one. Old oracle b6/b6b: text abcあいdef. Old Linux result: passed on parent too (not reproduced).
  // a: caret at the end of "abc" (End, 3 x Left, as b6). b: caret at the start of "def" (as b6b).
  ...[['a', (c) => press(c, 'ArrowLeft', 3)], ['b', (c) => placeCaret(c, 'def', 0)]].map(([v, caret]) => ({
    id: `b5762${v}`, langs: ['ja'], only: {os: ['linux'], browser: ['chromium']},
    commits: {parent: '4c37c107fd3b946586c32bb7562113c9f9e31ae1', fix: '10996aea5ce614cfea39d32e8632fe35d0313cc6', node: '20', pm: 'npm'},
    setup: async (c) => {
      await paste(c, '<a href="https://lexical.dev">abc<b>def</b></a>');
      await press(c, 'End');
      await caret(c);
    },
    keys: () => toks('a i RET'), word: () => 'あい', lexAfter: expectedAfter, paragraphs: () => 1,
  })),

  // #7987: the mention menu stays open (has items) while a Japanese composition goes on after "@Luke".
  // Old Linux result, during composition: parent 0 items, fix 1 item. The snapshot is taken at PROBE, before RET commits.
  {id: 'b7987', langs: ['ja'], only: {os: ['linux'], browser: ['chromium']},
    commits: {parent: '6296fe9f1bf08b6c92b3b7acc9961d794172fe48', fix: '8ff3dec7b0913d767fc2ea4d93c4cb2263c95aa6', node: '20', pm: 'npm'},
    setup: async (c) => {
      await type(c, '@Luke');
      if (c.target === 'lexical') await c.page.waitForSelector('#typeahead-menu ul li', {timeout: 5000});
    },
    keys: () => toks('s u s h PROBE RET'), word: () => 'すｓｈ', lexAfter: expectedAfter,
    intent: {
      check: (lex) => {
        const m = lex.mid;
        if (!m) return 'no snapshot at PROBE';
        return m.menuItems > 0 ? null : `typeahead menu has ${m.menuItems} items during composition (text ${JSON.stringify(m.text)})`;
      },
      evidence: ev(`${E2E}Composition.spec.mjs`, 'Typeahead menu should not close during IME composition', '8ff3dec7b',
        'After "@Luke", the typeahead menu stays open while a Japanese composition goes on.'),
    }},

  // #8121: the first jamo after Cmd+A over formatted text is kept. Old oracle (lab 8121): text "가 ".
  // Old macOS result: parent "ㅏ ".
  {id: 'b8121', langs: ['ko'], only: {os: ['macos'], browser: ['chromium']},
    commits: {parent: 'd5716cb70eeba7a9f4e7090fd05b697f9c95be8e', fix: '1efd452852fe39f9e986ce16cad0216d9b4bb667', node: '22', pm: 'pnpm@10.30.0'},
    setup: formattedSelectAll('hello world'),
    keys: () => toks('r k SP'), word: () => '가 ', lexAfter: expectedAfter},

  // #8680: "- " and "# " typed with the Korean source on Firefox become a list and a heading.
  // Old oracle (lab 8680a/b): one block of type list/heading, no marker left. Old macOS result: parent paragraph "- ".
  ...[['a', 'MINUS', '- ', 'listitem'], ['b', 'HASH', '# ', 'heading']].map(([v, key, marker, block]) => ({
    id: `b8680${v}`, langs: ['ko'], only: {os: ['macos'], browser: ['firefox']},
    commits: {parent: 'e40f2836d2c960b68ee34ede12a16915c2a16cf0', fix: 'd0b80fdb277c67884af66926e2c064d2e80dd508', node: '22', pm: 'pnpm@10.34.1'},
    keys: () => [key, 'SP'], word: () => marker,
    // The shortcut consumes the marker.
    lexAfter: (before, word) => expectedAfter(before, word).replace(marker, ''),
    intent: {
      check: (lex) => {
        const t = lex.after.blocks.map((b) => b.type);
        return t.length === 1 && t[0] === block ? null : `blocks ${t.join(',')} != ${block}`;
      },
      evidence: ev(`${E2E}Markdown.spec.mjs`, 'Should test markdown with the (${markdownText}) trigger. Should include undo and redo.', 'd0b80fdb2',
        `Typing "${marker}" makes a ${block === 'listitem' ? 'list' : 'heading'}. The fix test (LexicalFirefoxCompositionEndTag.test.ts) makes Firefox's deferred compositionend reach this shortcut.`),
    }})),

  // #7061: Backspace that cancels a one-letter Pinyin composition does not delete committed text.
  // Old oracle (lab 7061): text abc, model = DOM. Old macOS result: parent "ab" in some runs, fix model != DOM.
  {id: 'b7061', langs: ['zh'], only: {os: ['macos'], browser: ['webkit']},
    commits: {parent: '92a1cd704b7e1642349f487be3e2026b88a63457', fix: '46c9c2f9d738f974cc9b7cacf7088c168edba78c', node: '20', pm: 'npm'},
    setup: (c) => type(c, 'abc'),
    keys: () => toks('n BS'), word: () => '', lexAfter: expectedAfter},

  // Android (test IME). Steps start in an empty editor, so word is the text left. Old oracles: expect / bug.
  // #5077: deleteSurroundingText mid-word deletes one character (bug: "Hellorld").
  {id: 'b5077', langs: ['ko'], only: {os: ['android']},
    commits: {parent: '619917b01a38820803eebfa8084e15637c8e078a', fix: 'ca45b1d00b7c365399ea444d98663567d25d3a4e', node: '20', pm: 'npm'},
    steps: () => [['commit', 'HelloWorld'], ['select', 5, 5], ['delete', 1, 0]], word: () => 'HellWorld'},
  // #5282: the last character on a line is deleted (bug: "a" stays).
  {id: 'b5282', langs: ['ko'], only: {os: ['android']},
    commits: {parent: '68c614831cbd94ab1a27874c471c9e0cfbfe5562', fix: '4d2e3102b90d09662cbd70b014464be0ff80c7a0', node: '20', pm: 'npm'},
    steps: () => [['commit', 'a'], ['delete', 1, 0]], word: () => ''},
  // #6268: Backspace at the end of a keyword node (canInsertTextAfter false) deletes (bug: "congrats" stays).
  {id: 'b6268', langs: ['ko'], only: {os: ['android']},
    commits: {parent: '93b756ba302c6552fe8d71b77a8062a68e2c95de', fix: 'b73bfc3c161a67caf168d29dc7a0ff67391bd629', node: '20', pm: 'npm'},
    steps: () => [['commit', 'congrats'], ['delete', 1, 0]], word: () => 'congrat'},
];

export const SCENARIOS = S.map((s) => ({group: 'replay', ...s}));

/**
 * Builds the replay needs: one entry per commit of the scenarios that run on one of the platforms.
 * @param {string[]} platforms @param {string} [scen] one scenario id, or all
 * @returns {{sha: string, node: string, pm: string}[]}
 */
export function replayBuilds(platforms, scen = '') {
  const out = new Map();
  for (const s of SCENARIOS) {
    if (scen && s.id !== scen) continue;
    if (s.only?.os && !s.only.os.some((o) => platforms.includes(o))) continue;
    for (const sha of [s.commits.parent, s.commits.fix]) out.set(sha, {sha, node: s.commits.node, pm: s.commits.pm});
  }
  return [...out.values()];
}

// CLI for the workflow: node harness/scenarios/replay.mjs <platforms,comma,list> [scen]
// Prints the build matrix {"include": [{sha, node, pm}, ...]}.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [platforms = '', scen = ''] = process.argv.slice(2);
  console.log(JSON.stringify({include: replayBuilds(platforms.split(','), scen)}));
}
