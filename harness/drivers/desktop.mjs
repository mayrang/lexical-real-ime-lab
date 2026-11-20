// Shared desktop runner. An OS adapter (Tasks 6-8) supplies the real IME steps.
//
// OsAdapter = {
//   name: 'macos'|'linux'|'windows',
//   env(): Promise<Partial<Env>>,
//   selectIme(lang): Promise<void>,
//   selectLatin(): Promise<void>,
//   click(page, sel): Promise<void>,
//   sendKeys(tokens: string[], delayMs: number): Promise<void>,
//   launchOpts(browser): object,
// }
import {execFileSync} from 'node:child_process';
import * as playwright from 'playwright';
import {installLogger, snapshot} from '../page/collect.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY_DELAY_MS = 150;
const LEX_SEL = '.editor-shell [data-lexical-editor="true"]';
const CTL_SEL = '#ed';
const MENU_SCENARIOS = new Set(['mention-query', 'picker-query']);

const firstLine = (e) => String((e && e.message) || e).split('\n')[0].slice(0, 300);

function gitHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
  } catch {
    return null;
  }
}

const emptyBefore = () => ({text: '', selStart: 0, selEnd: 0});
const emptyControl = () => ({
  before: emptyBefore(),
  after: {text: '', paragraphs: 0},
  trace: '', nKeydown: 0, errors: [],
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
function fillSide(side, before, after, errors, isLexical) {
  if (before) side.before = {text: before.text, selStart: before.selStart, selEnd: before.selEnd};
  if (after) {
    side.trace = after.trace;
    side.nKeydown = after.nKeydown;
    side.after.text = after.text;
    side.after.paragraphs = after.paragraphs;
    if (isLexical) {
      for (const k of ['domText', 'compositionKey', 'hasZWSP', 'caretInEditor', 'blocks', 'imeNode', 'menuItems']) {
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
  let after = null;
  let browser = null;
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
    errors.length = 0;
    await page.evaluate(installLogger, sel);
    await adapter.click(page, sel);
    await sleep(250);
    await adapter.selectLatin();
    await sleep(350);
    try {
      await sc.setup({page, target, sel});
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
      await adapter.sendKeys(keys, KEY_DELAY_MS);
      await sleep(o.settleMs ?? (MENU_SCENARIOS.has(sc.id) || sc.post === 'menu' ? 1200 : 900));
    }
    after = await page.evaluate(snapshot, arg);
  } finally {
    fillSide(side, before, after, errors, isLexical);
    try { if (browser) await browser.close(); } catch { /* the browser is already gone */ }
  }
  return {side, setupError};
}

/**
 * Run one cell once. Control first, then Lexical. A Record is always returned.
 * @param {any} adapter OsAdapter
 * @param {any} sc Scenario
 * @param {{lang: string, browser: string, rep: number, lexicalUrl: string|null, controlUrl: string,
 *   lexicalCommit?: string, harnessCommit?: string, settleMs?: number}} o
 */
export async function runCell(adapter, sc, o) {
  const harness = {keysSent: [], setupError: null, fatal: null, notes: ''};
  const e = {};
  try { Object.assign(e, await adapter.env()); } catch (err) { harness.notes += `env: ${firstLine(err)}; `; }
  const env = {
    os: adapter.name, image: 'unknown', ime: 'unknown', imeVersion: 'unknown',
    ...e,
    browser: o.browser,
    browserVersion: 'unknown',
    lexicalCommit: o.lexicalCommit ?? process.env.LEXICAL_COMMIT ?? 'unknown',
    harnessCommit: o.harnessCommit ?? process.env.GITHUB_SHA ?? gitHead() ?? 'unknown',
  };
  const cell = {scen: sc.id, lang: o.lang, os: adapter.name, ime: env.ime, browser: o.browser};
  const rec = {cell, rep: o.rep, env, control: emptyControl(), lexical: emptyLexical(), harness};

  try {
    harness.keysSent = sc.keys(o.lang);
    const targets = [['control', o.controlUrl], ['lexical', o.lexicalUrl]].filter(([, url]) => url);
    for (const [target] of targets) {
      const r = await runTarget(adapter, sc, target, o, cell, harness.keysSent, env);
      rec[target] = r.side;
      if (r.setupError && !harness.setupError) harness.setupError = r.setupError;
    }
  } catch (err) {
    harness.fatal = firstLine(err);
  }
  return rec;
}
