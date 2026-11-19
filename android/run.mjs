// Drives Chrome on an Android emulator through the test IME and records events + editor state.
// usage: node android/run.mjs <outdir> <label> <target:control|lexical> <repeats> <scenario...>
// Ideas (Chrome debug flags, DevTools socket, InputConnection ops) adapted from Slate's
// playwright/devices/android/run.cjs (MIT, Copyright (c) Ian Storm Taylor).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { scenarios } from './scenarios.mjs';

const [outdir, label, target, repeatsArg, ...names] = process.argv.slice(2);
const repeats = Number(repeatsArg || 1);
const ADB = process.env.ADB || 'adb';
const DEVTOOLS_PORT = 9333;
const IME = 'org.lexicallab.testime/.TestIme';
const URLS = { control: 'http://localhost:3013/control.html', lexical: 'http://localhost:3000/' };
const ROOT = { control: '#ce', lexical: '[data-lexical-editor="true"]' };
const SETTLE = Number(process.env.SETTLE || 250);
fs.mkdirSync(outdir, { recursive: true });

const adb = (...a) => execFileSync(ADB, a, { encoding: 'utf8' }).trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b64 = s => Buffer.from(s ?? '', 'utf8').toString('base64');

function ime(op, text, a, b) {
  const args = ['shell', 'am', 'broadcast', '-a', 'org.lexicallab.testime.COMMAND', '--es', 'op', op];
  if (text) args.push('--es', 'b64', b64(text)); // empty extra is dropped by adb shell; IME treats missing as ""
  if (a != null) args.push('--ei', 'a', String(a));
  if (b != null) args.push('--ei', 'b', String(b));
  const out = adb(...args);
  const r = /data="([^"]*)"/.exec(out)?.[1];
  if (!r || r.includes('error')) throw new Error(`ime ${op} failed: ${r || out}`);
  return r;
}
const encodeStep = ([op, x, y]) =>
  op === 'compose' || op === 'commit' ? `${op},${b64(x)},,` : `${op},,${x ?? ''},${y ?? ''}`;
async function step(s) {
  const [op, x, y] = s;
  if (op === 'wait') return sleep(x);
  if (op === 'seq') ime('seq', x.map(encodeStep).join(';'));
  else if (op === 'compose' || op === 'commit') ime(op, x);
  else ime(op, null, x, y);
  await sleep(SETTLE);
}

function uiNodes() {
  adb('shell', 'uiautomator', 'dump', '/sdcard/ui.xml');
  const xml = adb('exec-out', 'cat', '/sdcard/ui.xml');
  return Array.from(xml.matchAll(/<node\s([^>]+)>/g), m => {
    const n = Object.fromEntries(Array.from(m[1].matchAll(/([\w-]+)="([^"]*)"/g), ([, k, v]) => [k, v]));
    const r = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(n.bounds || '');
    if (r) n.rect = r.slice(1).map(Number);
    return n;
  });
}
function tapNode(n) {
  const [l, t, r, b] = n.rect;
  adb('shell', 'input', 'tap', String((l + r) >> 1), String((t + b) >> 1));
}
// Click through Chrome first-run / promo dialogs if they appear.
async function dismissDialogs() {
  const words = /^(accept & continue|accept and continue|use without an account|no thanks|no, thanks|continue|got it|skip|not now|done|allow|ok)$/i;
  for (let i = 0; i < 8; i++) {
    let nodes;
    try { nodes = uiNodes(); } catch { await sleep(1000); continue; }
    const btn = nodes.find(n => n.clickable === 'true' && n.rect && words.test((n.text || n['content-desc'] || '').trim()));
    if (!btn) return;
    console.log('dismiss dialog:', btn.text || btn['content-desc']);
    tapNode(btn);
    await sleep(1500);
  }
}

async function setUp() {
  adb('shell', 'ime', 'enable', IME);
  adb('shell', 'ime', 'set', IME);
  adb('reverse', 'tcp:3000', 'tcp:3000');
  adb('reverse', 'tcp:3013', 'tcp:3013');
  adb('shell', 'am', 'set-debug-app', '--persistent', 'com.android.chrome');
  adb('shell', 'echo "_ --disable-fre --no-default-browser-check --no-first-run" > /data/local/tmp/chrome-command-line');
  adb('shell', 'am', 'force-stop', 'com.android.chrome');
  adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', URLS[target], 'com.android.chrome');
  for (let i = 0; i < 60; i++) {
    if (adb('shell', 'cat', '/proc/net/unix').includes('chrome_devtools_remote')) break;
    await sleep(1000);
  }
  await sleep(3000);
  await dismissDialogs();
  adb('forward', `tcp:${DEVTOOLS_PORT}`, 'localabstract:chrome_devtools_remote');
}

const LOGGER = () => {
  window.__log = [];
  const t0 = performance.now();
  const push = o => window.__log.push({ ms: Math.round(performance.now() - t0), ...o });
  for (const type of ['keydown', 'keyup', 'compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input']) {
    document.addEventListener(type, e => {
      const o = { type, trusted: e.isTrusted };
      if (type.startsWith('key')) Object.assign(o, { key: e.key, code: e.keyCode, isComposing: e.isComposing });
      else if (type.startsWith('composition')) o.data = e.data;
      else {
        Object.assign(o, { inputType: e.inputType, data: e.data, isComposing: e.isComposing });
        if (type === 'beforeinput' && e.getTargetRanges) {
          o.ranges = e.getTargetRanges().map(r => [r.startOffset, r.endOffset, r.startContainer.textContent]);
        }
        if (type === 'beforeinput') setTimeout(() => { o.prevented = e.defaultPrevented; }, 0);
      }
      push(o);
    }, true);
  }
  window.addEventListener('error', e => push({ type: 'error', msg: String(e.message) }));
};

const READ = rootSel => {
  const root = document.querySelector(rootSel);
  const out = { focused: document.activeElement === root || root.contains(document.activeElement) };
  const sel = document.getSelection();
  out.domSel = sel.rangeCount ? [sel.anchorOffset, sel.focusOffset, sel.anchorNode && sel.anchorNode.textContent] : null;
  const ed = root.__lexicalEditor;
  if (ed) {
    const json = ed.getEditorState().toJSON();
    const t = n => n.type === 'linebreak' ? '\n' : typeof n.text === 'string' ? n.text : (n.children || []).map(t).join('');
    out.model = json.root.children.map(t).join('\n');
    out.dom = Array.from(root.children).map(c => c.textContent).join('\n');
    out.keyword = !!root.querySelector('.keyword');
    out.blocks = json.root.children.length;
    out.domBlocks = root.children.length;
    ed.getEditorState().read(() => {
      const s = ed.getEditorState()._selection;
      if (s && s.anchor) out.modelSel = [s.anchor.key, s.anchor.offset, s.focus.offset];
    });
  } else {
    out.dom = root.textContent;
    out.model = out.dom;
  }
  return out;
};

async function focusEditor(page) {
  const sel = ROOT[target];
  await page.locator(sel).waitFor({ timeout: 60000 });
  await page.evaluate(s => {
    const r = document.querySelector(s);
    r.style.minHeight = '150vh';
    r.scrollIntoView({ block: 'start' });
  }, sel);
  await sleep(300);
  const size = /(\d+)x(\d+)/.exec(adb('shell', 'wm', 'size'));
  for (let attempt = 0; attempt < 3; attempt++) {
    adb('shell', 'input', 'tap', String(size[1] >> 1), String(Math.round(size[2] * (0.45 + attempt * 0.1))));
    await sleep(800);
    try {
      const st = ime('state');
      const r = await page.evaluate(READ, sel);
      if (r.focused) return st;
    } catch (e) {
      console.log('focus attempt', attempt, e.message);
    }
  }
  throw new Error('could not focus editor with a native tap');
}

async function runOne(browser, name, rep) {
  const sc = scenarios[name];
  const ctx = browser.contexts()[0];
  let page = ctx.pages()[0];
  const errors = [];
  const onErr = e => errors.push('pageerror: ' + e.message);
  const onCon = m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); };
  page.on('pageerror', onErr);
  page.on('console', onCon);
  const res = { label, target, name, rep, expect: sc.expect, problems: [], states: [] };
  try {
    await page.goto(URLS[target], { waitUntil: 'load', timeout: 120000 });
    await page.evaluate(LOGGER);
    res.imeStateAfterFocus = await focusEditor(page);
    for (const st of sc.setup || []) await step(st);
    for (const st of sc.steps) {
      await step(st);
      res.states.push({ step: JSON.stringify(st), ...(await page.evaluate(READ, ROOT[target])) });
    }
    await sleep(600);
    res.final = await page.evaluate(READ, ROOT[target]);
    res.imeStateFinal = ime('state');
    res.log = await page.evaluate(() => window.__log);
  } catch (e) {
    res.problems.push('harness: ' + e.message.split('\n')[0]);
  }
  res.errors = errors;
  page.off('pageerror', onErr);
  page.off('console', onCon);
  const f = res.final;
  if (f) {
    if (f.model !== sc.expect) res.problems.push(`model text ${JSON.stringify(f.model)} != expected ${JSON.stringify(sc.expect)}`);
    if (f.dom !== f.model) res.problems.push(`DOM ${JSON.stringify(f.dom)} != model ${JSON.stringify(f.model)}`);
    if (sc.oracle) res.problems.push(...sc.oracle(res));
  }
  if (errors.some(e => e.startsWith('pageerror'))) res.problems.push('page error');
  res.pass = res.problems.length === 0 && !!f;
  res.bugSignature = !!f && sc.bug !== undefined && f.model === sc.bug;
  res.harnessOk = !res.problems.some(p => p.startsWith('harness'));
  fs.writeFileSync(path.join(outdir, `${label}-${target}-${name}-${rep}.json`), JSON.stringify(res, null, 1));
  console.log(`${res.pass ? 'PASS' : 'FAIL'}${res.bugSignature ? '(BUG-SIG)' : ''} ${label} ${target} ${name} #${rep} model=${JSON.stringify(f?.model)} dom=${JSON.stringify(f?.dom)} ${res.problems.join(' | ')}`);
  if (process.env.VERBOSE || !res.pass) console.log('  events:', (res.log || []).map(e => e.type === 'beforeinput' ? `bi:${e.inputType}:${JSON.stringify(e.data)}${e.prevented ? '(P)' : ''}` : e.type === 'keydown' ? `kd:${e.key}/${e.code}` : e.type === 'input' ? `in:${e.inputType}` : e.type.replace('composition', 'c')).join(' '));
  return res;
}

await setUp();
const browser = await chromium.connectOverCDP(`http://localhost:${DEVTOOLS_PORT}`);
console.log('connected; browser version', browser.version());
for (const name of names) for (let r = 1; r <= repeats; r++) await runOne(browser, name, r);
await browser.close().catch(() => {});
