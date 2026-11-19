// Throwaway CI spike: real macOS IME -> headed Playwright browser.
// usage: node spike-ci.mjs <chromium|webkit|firefox> <url|plain> <label>
import {spawnSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {chromium, firefox, webkit} from 'playwright';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const OSKEYS = new URL('./oskeys', import.meta.url).pathname;
const [browserName, target, label] = process.argv.slice(2);
const SOURCE = 'com.apple.inputmethod.Korean.2SetKorean';
const KEYS = ['g', 'k', 's', 'r', 'n', 'r', 'd', 'j', 'SP'];
const ACTIVATE = {chromium: 'ms-playwright/chromium', webkit: 'ms-playwright/webkit', firefox: 'ms-playwright/firefox'}[browserName];
const oskeys = args => spawnSync(OSKEYS, args, {encoding: 'utf8'});
const PLAIN = 'data:text/html;charset=utf-8,' + encodeURIComponent('<div class="editor-shell"><div data-lexical-editor="true" contenteditable="true" style="margin:40px;width:600px;height:200px;border:1px solid #888"></div></div>');
mkdirSync('out', {recursive: true});

const browser = await {chromium, firefox, webkit}[browserName].launch({headless: false});
const context = await browser.newContext({viewport: null, locale: 'en-US'});
const page = await context.newPage();
await page.goto(target === 'plain' ? PLAIN : target);
await page.waitForSelector('.editor-shell [data-lexical-editor="true"]');
await sleep(800);
await page.evaluate(() => {
  window.lexicalEditor = document.querySelector('.editor-shell [data-lexical-editor="true"]').__lexicalEditor || null;
  window.__log = [];
  const push = e => window.__log.push(e);
  document.addEventListener('keydown', e => push({ev: 'keydown', key: e.key, kc: e.keyCode, comp: e.isComposing, tr: e.isTrusted}), true);
  for (const t of ['compositionstart', 'compositionupdate', 'compositionend']) document.addEventListener(t, e => push({ev: t, data: e.data, tr: e.isTrusted}), true);
  document.addEventListener('beforeinput', e => push({ev: 'beforeinput', it: e.inputType, data: e.data, comp: e.isComposing, tr: e.isTrusted}), true);
  document.addEventListener('input', e => push({ev: 'input', it: e.inputType, data: e.data, comp: e.isComposing}), true);
});
const pt = await page.evaluate(() => {
  const r = document.querySelector('.editor-shell [data-lexical-editor="true"]').getBoundingClientRect();
  const chromeTop = window.outerHeight - window.innerHeight;
  const side = (window.outerWidth - window.innerWidth) / 2;
  return {x: Math.round(window.screenX + side + r.x + 40), y: Math.round(window.screenY + chromeTop + r.y + 15)};
});
const text = () => page.evaluate(() => {
  if (!window.lexicalEditor) return document.querySelector('.editor-shell [data-lexical-editor="true"]').textContent;
  const walk = n => (n.text ?? '') + (n.children ? n.children.map(walk).join('') : '');
  return walk(window.lexicalEditor.getEditorState().toJSON().root);
});
const stderr = [];
const run = args => { const r = oskeys(args); stderr.push(`$ oskeys ${args.join(' ')} -> ${r.status}\n${r.stderr}`); return r; };

run(['--activate', ACTIVATE, `CLICK:${pt.x},${pt.y}`]);
// Warm-up: type and erase one syllable so the IME context exists.
run(['--activate', ACTIVATE, '--source', SOURCE, '--delay', '150', 'g', 'k', 'SP', 'BS', 'BS', 'BS']);
await sleep(500);
const warm = await text();
await page.evaluate(() => { window.__log.length = 0; });
run(['--activate', ACTIVATE, '--source', SOURCE, '--delay', '150', ...KEYS]);
await sleep(800);
const typed = await text();
const log = await page.evaluate(() => window.__log);
await page.screenshot({path: `out/${label}.png`});
const result = {
  label, browserName, target: target === 'plain' ? 'plain' : 'lexical', pt, warm, typed,
  ok: typed.replace(/ /g, ' ').includes('한국어'),
  trusted: [...new Set(log.filter(e => 'tr' in e).map(e => `${e.ev}:${e.tr}`))],
  compositionEvents: log.filter(e => e.ev.startsWith('composition')).length,
  stderr: stderr.join('\n'), log,
};
writeFileSync(`out/${label}.json`, JSON.stringify(result, null, 1));
console.log(JSON.stringify({label, typed, ok: result.ok, compositionEvents: result.compositionEvents, trusted: result.trusted}));
await browser.close();
