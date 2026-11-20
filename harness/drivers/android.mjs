// Android runner: Chrome on an emulator, input from the test IME (harness/native/android/ime).
// Steps are InputConnection calls sent to the IME with adb broadcasts. Playwright reads the page
// through Chrome's DevTools socket (connectOverCDP). One Chrome connection serves all cells; it is
// opened on first use and reopened when Chrome or its renderer goes away.
// Ideas (Chrome debug flags, DevTools socket, InputConnection ops) adapted from Slate's
// playwright/devices/android/run.cjs (MIT, Copyright (c) Ian Storm Taylor), through the spike on
// branch android (android/run.mjs).
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {installLogger, snapshot} from '../page/collect.js';

const ADB = process.env.ADB || 'adb';
const DEVTOOLS_PORT = 9333;
const IME = 'org.lexicallab.testime/.TestIme';
const SETTLE_MS = Number(process.env.SETTLE || 250);
const FINAL_MS = 600;
const LEX_SEL = '.editor-shell [data-lexical-editor="true"]';
const CTL_SEL = '#ce';
const ATTEMPTS = 3;
const LOG_DIR = process.env.ANDROID_LOG_DIR || null;

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const IME_SRC = join(REPO_ROOT, 'harness/native/android/ime/src/org/lexicallab/testime/TestIme.java');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const firstLine = (e) => String((e && e.message) || e).split('\n')[0].slice(0, 300);
const adb = (...a) => execFileSync(ADB, a, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
const b64 = (s) => Buffer.from(s ?? '', 'utf8').toString('base64');

/** Send one IME command. Returns the IME's result string; throws on an IME error. */
export function ime(op, text, a, b) {
  const args = ['shell', 'am', 'broadcast', '-a', 'org.lexicallab.testime.COMMAND', '--es', 'op', op];
  if (text) args.push('--es', 'b64', b64(text)); // adb shell drops an empty extra; the IME reads missing as ""
  if (a != null) args.push('--ei', 'a', String(a));
  if (b != null) args.push('--ei', 'b', String(b));
  const out = adb(...args);
  const r = /data="([^"]*)"/.exec(out)?.[1];
  if (!r || r.includes('error')) throw new Error(`ime ${op} failed: ${r || out}`);
  return r;
}

/** Encode a step for the IME's 'seq' op. */
export const encodeStep = ([op, x, y]) =>
  op === 'compose' || op === 'commit' ? `${op},${b64(x)},,` : `${op},,${x ?? ''},${y ?? ''}`;

/** Run one step, then let the page settle. */
export async function step(s) {
  const [op, x, y] = s;
  if (op === 'wait') return sleep(x);
  if (op === 'seq') ime('seq', x.map(encodeStep).join(';'));
  else if (op === 'compose' || op === 'commit') ime(op, x);
  else ime(op, null, x, y);
  await sleep(SETTLE_MS);
}

function uiNodes() {
  adb('shell', 'uiautomator', 'dump', '/sdcard/ui.xml');
  const xml = adb('exec-out', 'cat', '/sdcard/ui.xml');
  return Array.from(xml.matchAll(/<node\s([^>]+)>/g), (m) => {
    const n = Object.fromEntries(Array.from(m[1].matchAll(/([\w-]+)="([^"]*)"/g), ([, k, v]) => [k, v]));
    const r = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(n.bounds || '');
    if (r) n.rect = r.slice(1).map(Number);
    return n;
  });
}

/** Click through Chrome first-run and promo dialogs if they appear. */
async function dismissDialogs() {
  const words = /^(accept & continue|accept and continue|use without an account|no thanks|no, thanks|continue|got it|skip|not now|done|allow|ok)$/i;
  for (let i = 0; i < 8; i++) {
    let nodes;
    try { nodes = uiNodes(); } catch { await sleep(1000); continue; }
    const btn = nodes.find((n) => n.clickable === 'true' && n.rect && words.test((n.text || n['content-desc'] || '').trim()));
    if (!btn) return;
    console.log('dismiss dialog:', btn.text || btn['content-desc']);
    const [l, t, r, b] = btn.rect;
    adb('shell', 'input', 'tap', String((l + r) >> 1), String((t + b) >> 1));
    await sleep(1500);
  }
}

const portOf = (url) => {
  const u = new URL(url);
  return u.port || (u.protocol === 'https:' ? '443' : '80');
};

let state = null; // {browser, urls}

async function startChrome(url) {
  // adb shell runs one remote shell command line: quote the URL, or '&' in the query splits it.
  adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `'${url}'`, 'com.android.chrome');
  for (let i = 0; i < 60; i++) {
    if (adb('shell', 'cat', '/proc/net/unix').includes('chrome_devtools_remote')) break;
    await sleep(1000);
  }
  await sleep(3000);
  await dismissDialogs();
  adb('forward', `tcp:${DEVTOOLS_PORT}`, 'localabstract:chrome_devtools_remote');
  for (let i = 0; ; i++) {
    try {
      const b = await chromium.connectOverCDP(`http://localhost:${DEVTOOLS_PORT}`);
      console.log('connected; Chrome', b.version());
      return b;
    } catch (e) {
      if (i >= 4) throw e;
      console.log('connect retry', i, firstLine(e));
      await sleep(3000);
    }
  }
}

/** First use: select the IME, map the page ports, set Chrome's debug flags, start Chrome. */
async function connect(urls) {
  adb('shell', 'ime', 'enable', IME);
  adb('shell', 'ime', 'set', IME);
  for (const p of new Set(urls.map(portOf))) adb('reverse', `tcp:${p}`, `tcp:${p}`);
  adb('shell', 'am', 'set-debug-app', '--persistent', 'com.android.chrome');
  adb('shell', 'echo "_ --disable-fre --no-default-browser-check --no-first-run" > /data/local/tmp/chrome-command-line');
  adb('shell', 'am', 'force-stop', 'com.android.chrome');
  return startChrome(urls[0]);
}

async function reconnect(url) {
  try { await state.browser.close(); } catch { /* already gone */ }
  try {
    state.browser = await startChrome(url);
  } catch (e) {
    // Without this the dead connection served every later cell (run 44721522976: "reading 'pages'").
    state = null;
    throw e;
  }
}

/** Close the shared Chrome connection. Call once after the last cell. */
export async function closeAndroid() {
  if (state) {
    try { await state.browser.close(); } catch { /* already gone */ }
    state = null;
  }
}

/** Tap the editor with a native touch (the IME needs a real focus), until the page reports focus. */
async function focusEditor(page, sel) {
  await page.locator(sel).waitFor({timeout: 60000});
  await page.evaluate((s) => {
    const r = document.querySelector(s);
    r.style.minHeight = '150vh';
    r.scrollIntoView({block: 'start'});
  }, sel);
  await sleep(300);
  const size = /(\d+)x(\d+)/.exec(adb('shell', 'wm', 'size'));
  let last = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    adb('shell', 'input', 'tap', String(size[1] >> 1), String(Math.round(size[2] * (0.45 + attempt * 0.1))));
    await sleep(800);
    try {
      ime('state');
      const focused = await page.evaluate((s) => {
        const r = document.querySelector(s);
        return r.contains(document.activeElement);
      }, sel);
      if (focused) return;
    } catch (e) {
      last = firstLine(e);
    }
  }
  throw new Error(`could not focus editor with a native tap${last ? ': ' + last : ''}`);
}

const glitch = (msg) => /closed|crash|disconnect|socket|no page|Target/i.test(msg);

function saveLogcat(name) {
  if (!LOG_DIR) return;
  try {
    mkdirSync(LOG_DIR, {recursive: true});
    writeFileSync(join(LOG_DIR, `logcat-${name}.txt`), adb('logcat', '-d', '-t', '400'));
  } catch { /* logcat is optional */ }
}

const emptyBefore = () => ({text: '', selStart: 0, selEnd: 0});
const emptyControl = () => ({before: emptyBefore(), after: {text: '', paragraphs: 0}, trace: '', nKeydown: 0, errors: []});
const emptyLexical = () => {
  const s = emptyControl();
  s.after = {text: '', paragraphs: 0, domText: '', compositionKey: null, hasZWSP: false, caretInEditor: false, blocks: [], imeNode: null};
  s.editorStateJSON = '';
  s.domHTML = '';
  return s;
};

function fillSide(side, before, after, errors, isLexical) {
  if (before) {
    side.before = {text: before.text, selStart: before.selStart, selEnd: before.selEnd};
    if (isLexical && before.blocks) side.before.blocks = before.blocks;
  }
  if (after) {
    side.trace = after.trace;
    side.nKeydown = after.nKeydown;
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

/** One attempt at one target on the shared Chrome page. */
async function runTarget(sc, target, url, cell, steps, env) {
  const isLexical = target === 'lexical';
  const sel = isLexical ? LEX_SEL : CTL_SEL;
  const side = isLexical ? emptyLexical() : emptyControl();
  const errors = [];
  let setupError = null;
  let fatal = null;
  let before = null;
  let after = null;
  let page = null;
  const onErr = (e) => errors.push('pageerror: ' + String((e && e.stack) || e).slice(0, 300));
  const onCon = (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); };
  try {
    env.browserVersion = state.browser.version();
    const ctx = state.browser.contexts()[0];
    page = ctx.pages()[0] || (await ctx.newPage());
    page.on('pageerror', onErr);
    page.on('console', onCon);
    await page.goto(url, {waitUntil: 'load', timeout: 120000});
    await page.waitForSelector(sel, {timeout: 60000});
    await sleep(isLexical ? 800 : 300);
    await page.evaluate(installLogger, sel);
    await focusEditor(page, sel);
    await sleep(250);
    // Count page errors from here on: setup and the measured steps.
    errors.length = 0;
    if (sc.setup) {
      try {
        await sc.setup({page, target, sel, step});
      } catch (e) {
        setupError = `${target}: ${firstLine(e)}`;
      }
      await sleep(400);
    }
    const word = sc.word(cell.lang, cell);
    const arg = [sel, isLexical, word ? word[0] : ''];
    before = await page.evaluate(snapshot, arg);
    if (!setupError) {
      await page.evaluate(() => { window.__log = []; });
      for (const s of steps) await step(s);
      await sleep(FINAL_MS);
    }
    after = await page.evaluate(snapshot, arg);
  } catch (err) {
    fatal = `${target}: ${firstLine(err)}`;
  } finally {
    if (page) {
      page.off('pageerror', onErr);
      page.off('console', onCon);
    }
  }
  fillSide(side, before, after, errors, isLexical);
  return {side, setupError, fatal};
}

function getprop(k) {
  try { return adb('shell', 'getprop', k).replace(/\r/g, ''); } catch { return 'unknown'; }
}

function imeVersion() {
  try { return 'testime@' + createHash('sha256').update(readFileSync(IME_SRC)).digest('hex').slice(0, 12); } catch { return 'unknown'; }
}

function gitHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
  } catch {
    return null;
  }
}

let envCache = null;
function deviceEnv() {
  if (!envCache) {
    const api = getprop('ro.build.version.sdk');
    if (api === 'unknown') return {imeVersion: imeVersion()};
    const img = process.env.ANDROID_SYSTEM_IMAGE || 'unknown system image';
    envCache = {
      image: `emulator API ${api} (Android ${getprop('ro.build.version.release')}), ${img}, ${getprop('ro.build.fingerprint')}`,
      imeVersion: imeVersion(),
    };
  }
  return envCache;
}

/**
 * Run one Android cell once. Control first, then Lexical. A Record is always returned.
 * A target that fails with a Chrome glitch (closed page, renderer crash, lost socket) is retried
 * on a fresh Chrome connection, up to ATTEMPTS times. Retries go into harness.notes.
 * @param {any} sc Android scenario (steps instead of keys)
 * @param {{lang: string, rep: number, lexicalUrl: string|null, controlUrl: string,
 *   lexicalCommit?: string, lexicalBuild?: string, harnessCommit?: string}} o
 */
export async function runAndroidCell(sc, o) {
  const harness = {keysSent: [], setupError: null, fatal: null, notes: ''};
  const env = {
    os: 'android', image: 'unknown', ime: 'testime', imeVersion: 'unknown',
    browser: 'chrome', browserVersion: 'unknown',
    lexicalCommit: o.lexicalCommit ?? process.env.LEXICAL_COMMIT ?? 'unknown',
    lexicalBuild: o.lexicalBuild ?? 'unknown',
    harnessCommit: o.harnessCommit ?? process.env.GITHUB_SHA ?? gitHead() ?? 'unknown',
  };
  const cell = {scen: sc.id, lang: o.lang, os: 'android', ime: 'testime', browser: 'chrome'};
  const rec = {cell, rep: o.rep, env, control: emptyControl(), lexical: emptyLexical(), harness};

  try {
    Object.assign(env, deviceEnv());
    const steps = sc.steps(o.lang);
    harness.keysSent = steps.map((s) => JSON.stringify(s));
    const targets = [['control', o.controlUrl], ['lexical', o.lexicalUrl]].filter(([, url]) => url);
    if (!state) state = {browser: await connect(targets.map(([, u]) => u))};
    for (const [target, url] of targets) {
      let r;
      for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        r = await runTarget(sc, target, url, cell, steps, env);
        if (!r.fatal || !glitch(r.fatal) || attempt === ATTEMPTS) break;
        harness.notes += `${target}: retry ${attempt} after ${r.fatal}; `;
        console.log(`Chrome glitch (attempt ${attempt}): ${r.fatal}; reconnecting`);
        saveLogcat(`${sc.id}-${o.lang}-r${o.rep}-${target}-${attempt}`);
        await reconnect(url);
      }
      rec[target] = r.side;
      if (r.setupError && !harness.setupError) harness.setupError = r.setupError;
      if (r.fatal && !harness.fatal) harness.fatal = r.fatal;
    }
  } catch (err) {
    harness.fatal = firstLine(err);
  }
  return rec;
}
