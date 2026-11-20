// Shared desktop runner. An OS adapter (Tasks 6-8) supplies the real IME steps.
//
// OsAdapter = {
//   name: 'macos'|'linux'|'windows',
//   env(lang): Promise<Partial<Env>>,   (lang lets macOS report the selected input source)
//   selectIme(lang): Promise<void>,
//   selectLatin(): Promise<void>,
//   click(page, sel, opts?): Promise<void>,   (opts.keepFocus: a click during the keys, CLICK:<text>;
//                                           the adapter must not blur the editor first)
//   sendKeys(tokens: string[], delayMs: number): Promise<void>,
//   launchOpts(browser): object,
//   takeNotes?(): string,                (optional: IME state changes made during one target, for harness.notes)
// }
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as playwright from 'playwright';
import {installLogger, snapshot} from '../page/collect.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY_DELAY_MS = 150;
const LEX_SEL = '.editor-shell [data-lexical-editor="true"]';
const CTL_SEL = '#ed';
const MENU_SCENARIOS = new Set(['mention-query', 'picker-query']);

const PROBE_SETTLE_MS = 600;

/**
 * Split keys at the runner's own tokens (see scenarios/vocab.mjs): PROBE and CLICK:<text>.
 * Returns steps in order: {keys} (never empty), {probe: true}, {click: '<text>'}.
 * @param {string[]} keys @returns {({keys: string[]}|{probe: true}|{click: string})[]}
 */
export function keySteps(keys) {
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length) out.push({keys: run});
    run = [];
  };
  for (const t of keys) {
    const c = /^CLICK:(.+)$/.exec(t);
    if (t === 'PROBE') { flush(); out.push({probe: true}); } else if (c) { flush(); out.push({click: c[1]}); } else run.push(t);
  }
  flush();
  return out;
}

/**
 * Real OS click (CLICK:<text>) on the editor block that holds <text>: the root's child that contains the
 * first text node with <text>, or the root itself when that text node is a direct child (Chromium's plain
 * contenteditable keeps the first line as a bare text node). The page is not changed to mark the target.
 * The editor already has focus, so the adapter's focus check cannot see a miss. The click is checked here
 * instead: the first trusted mousedown must land on the same root child (block) as <text>. Both blocks are
 * resolved inside the mousedown handler, at event time, before the click or the IME changes the DOM: the
 * hit from caretPositionFromPoint / caretRangeFromPoint at the event point (e.target when there is none).
 * The listener removes itself after that event. Lexical's own selection handling plays no part in the check.
 * Returns an error message for harness.setupError, or null.
 */
async function clickText(adapter, page, sel, text) {
  const target = await page.evaluate(armClickCheck, [sel, text]);
  await adapter.click(page, target, {keepFocus: true});
  return page.evaluate((text) => {
    const d = window.__imelabClick;
    if (!d) return `CLICK:${text}: no trusted mousedown`;
    return d.miss;
  }, text);
}

/**
 * Page side of the CLICK check (self-contained, runs through page.evaluate). Arms a capture mousedown
 * listener that, on the first trusted mousedown, stores {x, y, miss} in window.__imelabClick (miss: an error
 * message, or null) and removes itself. Returns the selector the adapter clicks.
 * @param {[string, string]} arg [editor selector, text]
 */
export function armClickCheck([sel, text]) {
  const root = document.querySelector(sel);
  const blockOf = (node) => {
    let b = node;
    while (b && b.parentNode !== root) b = b.parentNode;
    return b;
  };
  const textNode = () => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode()) && !n.data.includes(text));
    return n;
  };
  const n = textNode();
  if (!n) throw new Error(`CLICK: no text ${text}`);
  const b = blockOf(n);
  window.__imelabClick = null;
  const onDown = (e) => {
    if (!e.isTrusted) return;
    document.removeEventListener('mousedown', onDown, {capture: true});
    const x = e.clientX;
    const y = e.clientY;
    const at = `mousedown at ${x},${y}`;
    const tn = textNode();
    const want = tn && blockOf(tn);
    let hit = null;
    if (document.caretPositionFromPoint) hit = document.caretPositionFromPoint(x, y)?.offsetNode ?? null;
    else if (document.caretRangeFromPoint) hit = document.caretRangeFromPoint(x, y)?.startContainer ?? null;
    if (!hit) hit = e.target instanceof Node ? e.target : null;
    let miss = null;
    if (!hit) miss = `CLICK:${text}: no caret position at ${at}`;
    else if (!root.contains(hit)) miss = `CLICK:${text}: ${at} outside the editor`;
    else if (!want) miss = `CLICK:${text}: no text ${text} at ${at}`;
    else if (blockOf(hit) !== want) {
      miss = `CLICK:${text}: ${at} hit block ${JSON.stringify((blockOf(hit)?.textContent ?? '').slice(0, 20))}, not the block with ${text}`;
    }
    window.__imelabClick = {x, y, miss};
  };
  document.addEventListener('mousedown', onDown, {capture: true});
  return b.nodeType === 1 ? `${sel} > :nth-child(${[...root.children].indexOf(b) + 1})` : sel;
}

const firstLine = (e) => String((e && e.message) || e).split('\n')[0].slice(0, 300);

// The harness repo root, not the process cwd.
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

function gitHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
  } catch {
    return null;
  }
}

const emptyBefore = () => ({text: '', selStart: 0, selEnd: 0});
const emptyControl = () => ({
  before: emptyBefore(),
  after: {text: '', paragraphs: 0},
  trace: '', nKeydown: 0, compositionEnds: [], errors: [],
});
const emptyLexical = () => {
  const s = emptyControl();
  s.after = {
    text: '', paragraphs: 0, domText: '', compositionKey: null, hasZWSP: false,
    caretInEditor: false, blocks: [], imeNode: null,
  };
  s.editorStateJSON = '';
  s.domHTML = '';
  return s;
};

/** Fill the side after a snapshot pair. Keeps the empty defaults for anything missing. */
function fillSide(side, before, after, errors, isLexical, mid = null) {
  if (before) {
    side.before = {text: before.text, selStart: before.selStart, selEnd: before.selEnd};
    // Lexical nodes (with keys) before the keys, for intents that compare nodes across the keys (#9291).
    if (isLexical && before.blocks) side.before.blocks = before.blocks;
  }
  // Snapshot at the PROBE token, in the middle of the keys (#7987: the menu during composition).
  if (mid) {
    side.mid = {text: mid.text, compositionKey: mid.compositionKey ?? null, menuPresent: mid.menuPresent ?? null,
      menuItems: mid.menuItems ?? null, trace: mid.trace};
  }
  if (after) {
    side.trace = after.trace;
    side.nKeydown = after.nKeydown;
    if (Array.isArray(after.compositionEnds)) side.compositionEnds = after.compositionEnds;
    side.after.text = after.text;
    side.after.paragraphs = after.paragraphs;
    if (isLexical) {
      for (const k of ['domText', 'compositionKey', 'hasZWSP', 'caretInEditor', 'focusInEditor', 'blocks', 'imeNode', 'menuPresent', 'menuItems']) {
        if (after[k] !== undefined) side.after[k] = after[k];
      }
      side.editorStateJSON = after.editorStateJSON;
      side.domHTML = after.domHTML;
    }
  }
  side.errors = [...errors];
}

/** Run one target (control or lexical) in a fresh browser. Returns the side and an optional setup error. */
async function runTarget(adapter, sc, target, o, cell, keys, env) {
  const isLexical = target === 'lexical';
  const sel = isLexical ? LEX_SEL : CTL_SEL;
  const side = isLexical ? emptyLexical() : emptyControl();
  const errors = [];
  let setupError = null;
  let before = null;
  let mid = null;
  let after = null;
  let browser = null;
  let fatal = null;
  try {
    await adapter.selectIme(o.lang);
    browser = await playwright[o.browser].launch(adapter.launchOpts(o.browser));
    env.browserVersion = browser.version();
    const page = await (await browser.newContext({viewport: null})).newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + String((e && e.stack) || e).slice(0, 300)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
    await page.goto(isLexical ? o.lexicalUrl : o.controlUrl, {waitUntil: 'load'});
    await page.waitForSelector(sel, {timeout: 20000});
    await sleep(isLexical ? 800 : 300);
    await page.evaluate(installLogger, sel);
    await adapter.click(page, sel);
    await sleep(250);
    // Count page errors from here on: setup and the measured keys. Errors from page load and from the
    // adapter's click (macOS warms the IME up in a temporary field there) are not Lexical's.
    errors.length = 0;
    await adapter.selectLatin();
    await sleep(350);
    try {
      if (sc.setup) await sc.setup({page, target, sel});
    } catch (e) {
      setupError = `${target}: ${firstLine(e)}`;
    }
    await sleep(400);
    const word = sc.word(cell.lang, cell);
    const arg = [sel, isLexical, word ? word[0] : ''];
    before = await page.evaluate(snapshot, arg);
    if (!setupError) {
      await adapter.selectIme(o.lang);
      await page.evaluate(() => { window.__log = []; });
      for (const step of keySteps(keys)) {
        if (step.keys) {
          await adapter.sendKeys(step.keys, sc.keyDelay ?? KEY_DELAY_MS);
        } else if (step.probe) {
          await sleep(PROBE_SETTLE_MS);
          mid = await page.evaluate(snapshot, arg);
        } else {
          // A missed click is a harness fault: the Record keeps going, and the judge says harness.
          const miss = await clickText(adapter, page, sel, step.click);
          if (miss && !setupError) setupError = `${target}: ${miss}`;
        }
      }
      await sleep(o.settleMs ?? (MENU_SCENARIOS.has(sc.id) || sc.post === 'menu' ? 1200 : 900));
    }
    after = await page.evaluate(snapshot, arg);
  } catch (err) {
    fatal = `${target}: ${firstLine(err)}`;
  } finally {
    try { if (browser) await browser.close(); } catch { /* the browser is already gone */ }
  }
  fillSide(side, before, after, errors, isLexical, mid);
  return {side, setupError, fatal};
}

/**
 * Run one cell once. Control first, then Lexical. A Record is always returned.
 * @param {any} adapter OsAdapter
 * @param {any} sc Scenario
 * @param {{lang: string, browser: string, rep: number, lexicalUrl: string|null, controlUrl: string,
 *   lexicalCommit?: string, lexicalBuild?: string, harnessCommit?: string, settleMs?: number}} o
 */
export async function runCell(adapter, sc, o) {
  const harness = {keysSent: [], setupError: null, fatal: null, notes: ''};
  const e = {};
  try { Object.assign(e, await adapter.env(o.lang)); } catch (err) { harness.notes += `env: ${firstLine(err)}; `; }
  const env = {
    os: adapter.name, image: 'unknown', ime: 'unknown', imeVersion: 'unknown',
    ...e,
    browser: o.browser,
    browserVersion: 'unknown',
    lexicalCommit: o.lexicalCommit ?? process.env.LEXICAL_COMMIT ?? 'unknown',
    lexicalBuild: o.lexicalBuild ?? 'unknown',
    harnessCommit: o.harnessCommit ?? process.env.GITHUB_SHA ?? gitHead() ?? 'unknown',
  };
  const cell = {scen: sc.id, lang: o.lang, os: adapter.name, ime: env.ime, browser: o.browser};
  const rec = {cell, rep: o.rep, env, control: emptyControl(), lexical: emptyLexical(), harness};

  try {
    harness.keysSent = sc.keys(o.lang);
    const targets = [['control', o.controlUrl], ['lexical', o.lexicalUrl]].filter(([, url]) => url);
    for (const [target] of targets) {
      adapter.takeNotes?.(); // drop anything left from before this target
      const r = await runTarget(adapter, sc, target, o, cell, harness.keysSent, env);
      const n = adapter.takeNotes?.();
      if (n) harness.notes += `${target}: ${n}; `;
      rec[target] = r.side;
      if (r.setupError && !harness.setupError) harness.setupError = r.setupError;
      if (r.fatal && !harness.fatal) harness.fatal = r.fatal;
    }
  } catch (err) {
    harness.fatal = firstLine(err);
  }
  return rec;
}
