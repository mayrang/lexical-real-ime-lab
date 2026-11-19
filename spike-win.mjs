// Throwaway CI spike: real Windows IME (Microsoft Korean / Japanese) -> headed Playwright browser.
// usage: node spike-win.mjs <chromium|webkit|firefox> <url|plain> <label> [ko|ja]
import {spawnSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {chromium, firefox, webkit} from 'playwright';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const WINKEYS = fileURLToPath(new URL('./winkeys.exe', import.meta.url));
const [browserName, target, label, lang = 'ko'] = process.argv.slice(2);
const CFG = {
  ko: {layout: '00000412', mode: '--hangul', warm: ['g', 'k', 'SP', 'BS', 'BS', 'BS'], keys: ['g', 'k', 's', 'r', 'n', 'r', 'd', 'j', 'SP'], expect: '한국어'},
  ja: {layout: '00000411', mode: '--imeon', warm: ['k', 'a', 'RET', 'BS'], keys: ['n', 'i', 'h', 'o', 'n', 'g', 'o', 'SP', 'RET'], expect: '日本語'},
}[lang];
const TOKEN = `IMELAB${label.replace(/[^a-z0-9]/gi, '')}`;
const winkeys = args => spawnSync(WINKEYS, args, {encoding: 'utf8'});
const PLAIN = 'data:text/html;charset=utf-8,' + encodeURIComponent('<title>x</title><div class="editor-shell"><div data-lexical-editor="true" contenteditable="true" style="margin:40px;width:600px;height:200px;border:1px solid #888"></div></div>');
mkdirSync('out', {recursive: true});

const browser = await {chromium, firefox, webkit}[browserName].launch({headless: false});
const context = await browser.newContext({viewport: null, locale: 'en-US'});
const page = await context.newPage();
await page.goto(target === 'plain' ? PLAIN : target);
await page.waitForSelector('.editor-shell [data-lexical-editor="true"]');
await sleep(800);
await page.evaluate(token => {
  document.title = token;
  window.lexicalEditor = document.querySelector('.editor-shell [data-lexical-editor="true"]').__lexicalEditor || null;
  window.__log = [];
  const push = e => window.__log.push(e);
  document.addEventListener('mousedown', e => push({ev: 'mousedown', x: e.clientX, y: e.clientY, tr: e.isTrusted}), true);
  document.addEventListener('keydown', e => push({ev: 'keydown', key: e.key, kc: e.keyCode, comp: e.isComposing, tr: e.isTrusted}), true);
  for (const t of ['compositionstart', 'compositionupdate', 'compositionend']) document.addEventListener(t, e => push({ev: t, data: e.data, tr: e.isTrusted}), true);
  document.addEventListener('beforeinput', e => push({ev: 'beforeinput', it: e.inputType, data: e.data, comp: e.isComposing, tr: e.isTrusted}), true);
  document.addEventListener('input', e => push({ev: 'input', it: e.inputType, data: e.data, comp: e.isComposing, tr: e.isTrusted}), true);
}, TOKEN);
await sleep(500);
const pt = await page.evaluate(() => {
  const r = document.querySelector('.editor-shell [data-lexical-editor="true"]').getBoundingClientRect();
  const chromeTop = window.outerHeight - window.innerHeight;
  const side = (window.outerWidth - window.innerWidth) / 2;
  return {x: Math.round(window.screenX + side + r.x + 40), y: Math.round(window.screenY + chromeTop - side + r.y + 20), dpr: window.devicePixelRatio};
});
const text = () => page.evaluate(() => {
  if (!window.lexicalEditor) return document.querySelector('.editor-shell [data-lexical-editor="true"]').textContent;
  const walk = n => (n.text ?? '') + (n.children ? n.children.map(walk).join('') : '');
  return walk(window.lexicalEditor.getEditorState().toJSON().root);
});
const stderr = [];
const run = args => { const r = winkeys(args); stderr.push(`$ winkeys ${args.join(' ')} -> ${r.status}\n${r.stderr}`); return r; };

run(['--info', '--activate', TOKEN, `CLICK:${pt.x},${pt.y}`, 'INFO']);
run(['--activate', TOKEN, '--layout', CFG.layout, CFG.mode, '--delay', '150', ...CFG.warm]);
await sleep(500);
const warm = await text();
const warmLog = await page.evaluate(() => window.__log.splice(0));
run(['--activate', TOKEN, CFG.mode, '--delay', process.env.KEY_DELAY || '150', ...CFG.keys, 'INFO']);
await sleep(800);
const typed = await text();
const log = await page.evaluate(() => window.__log);
await page.screenshot({path: `out/${label}.png`});
const result = {
  label, browserName, lang, target: target === 'plain' ? 'plain' : 'lexical', pt, warm, typed,
  ok: typed.replace(/ /g, ' ').includes(CFG.expect),
  trusted: [...new Set(log.filter(e => 'tr' in e).map(e => `${e.ev}:${e.tr}`))],
  compositionEvents: log.filter(e => e.ev.startsWith('composition')).length,
  stderr: stderr.join('\n'), warmLog, log,
};
writeFileSync(`out/${label}.json`, JSON.stringify(result, null, 1));
console.log(JSON.stringify({label, warm, typed, ok: result.ok, compositionEvents: result.compositionEvents, trusted: result.trusted}));
console.log(result.stderr);
await browser.close();
