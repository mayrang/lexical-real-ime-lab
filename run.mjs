// usage: node run.mjs <scenario> <commitLabel> <repeat> [url]
//        node run.mjs prime <browser> 0 [url]   (load the page once so Vite finishes its dependency scan)
// Writes out/<scenario>-<commitLabel>-<repeat>.json and .png
import {spawnSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {chromium, firefox, webkit} from 'playwright';
import {SCENARIOS, SRC, WARM} from './scenarios.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const OSKEYS = new URL('./oskeys', import.meta.url).pathname;
const [name, commit, rep, urlArg] = process.argv.slice(2);
const URL_ = urlArg || 'http://127.0.0.1:3012/?isRichText=true&emptyEditor=true&showNestedEditorTreeView=false';
const EDITOR = '.editor-shell [data-lexical-editor="true"]';
mkdirSync('out', {recursive: true});

if (name === 'prime') {
  const b = await {chromium, firefox, webkit}[commit].launch({headless: false});
  const p = await b.newPage();
  for (let i = 0; i < 3; i++) {
    await p.goto(URL_, {timeout: 180000});
    await p.waitForSelector(EDITOR, {timeout: 180000});
    await sleep(5000);
  }
  console.log('primed');
  await b.close();
  process.exit(0);
}

const sc = SCENARIOS[name];
const ACTIVATE = `ms-playwright/${sc.browser}`;
const log = [];
const oskeys = (tokens, delay = 150) => {
  const args = ['--activate', ACTIVATE, '--delay', String(delay), ...tokens];
  const r = spawnSync(OSKEYS, args, {encoding: 'utf8'});
  log.push(`$ oskeys ${args.join(' ')} -> ${r.status}\n${r.stderr}`);
  if (r.status !== 0) throw new Error(`oskeys exit ${r.status}`);
};

// Page-side reader: model blocks (from the editor state) and DOM blocks.
const readState = () => {
  const root = document.querySelector('.editor-shell [data-lexical-editor="true"]');
  const ed = root.__lexicalEditor;
  const st = ed.getEditorState();
  const map = st._nodeMap;
  const kids = n => {
    if (Array.isArray(n.__children)) return n.__children.map(k => map.get(k));
    const out = [];
    let k = n.__first;
    while (k != null) { const c = map.get(k); out.push(c); k = c.__next; }
    return out;
  };
  const isEl = n => n.__first !== undefined || Array.isArray(n.__children);
  const walk = n => {
    const o = {k: n.__key, type: n.__type};
    if (typeof n.__text === 'string') { o.text = n.__text; o.format = n.__format; }
    if (n.__tag) o.tag = n.__tag;
    if (isEl(n)) o.c = kids(n).map(walk);
    return o;
  };
  const leaves = n => (n.text !== undefined ? [n] : (n.c || []).flatMap(leaves));
  const tree = walk(map.get('root'));
  const blocks = tree.c.map(b => {
    const nodes = leaves(b);
    return {type: b.type, tag: b.tag, text: nodes.map(n => n.text ?? '').join(''), nodes};
  });
  const sel = st._selection && st._selection.anchor
    ? {ak: st._selection.anchor.key, ao: st._selection.anchor.offset, fk: st._selection.focus.key, fo: st._selection.focus.offset}
    : null;
  return {
    model: {blocks, sel},
    tree,
    json: JSON.stringify(st.toJSON()),
    dom: {blocks: [...root.children].map(e => ({tag: e.tagName, text: e.textContent})), innerText: root.innerText, html: root.innerHTML},
    composing: ed.isComposing ? ed.isComposing() : null,
  };
};

const result = {scenario: name, commit, rep: Number(rep), browser: sc.browser, ime: sc.ime};
const t0 = Date.now();
const launchOpts = {headless: false};
const browser = await {chromium, firefox, webkit}[sc.browser].launch(launchOpts);
const errors = [];
try {
  const context = await browser.newContext({viewport: null, locale: 'en-US'});
  const page = await context.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + String(e && e.stack || e).slice(0, 600)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 600)); });
  const clickPoint = async () => {
    await page.bringToFront();
    return page.evaluate(sel => {
      const r = document.querySelector(sel).getBoundingClientRect();
      const chromeTop = window.outerHeight - window.innerHeight;
      const side = (window.outerWidth - window.innerWidth) / 2;
      return {x: Math.round(window.screenX + side + r.x + 40), y: Math.round(window.screenY + chromeTop + r.y + 15)};
    }, EDITOR);
  };
  const load = async () => {
    await page.goto(URL_, {timeout: 120000});
    await page.waitForSelector(EDITOR, {timeout: 120000});
    await sleep(1500);
  };
  // 1) Warm-up the input method in this browser process, then reload.
  oskeys([`SRC:${SRC.latin}`]);
  await load();
  let pt = await clickPoint();
  oskeys([`CLICK:${pt.x},${pt.y}`]);
  oskeys([...WARM[sc.ime], `SRC:${SRC.latin}`]);
  await sleep(500);
  result.warm = (await page.evaluate(readState)).model.blocks.map(b => b.text);
  errors.length = 0;
  // 2) Fresh page, real click, scenario keys.
  await load();
  await page.evaluate(() => {
    window.__log = [];
    const push = e => window.__log.push(e);
    const t = () => Math.round(performance.now());
    document.addEventListener('keydown', e => push({t: t(), ev: 'keydown', key: e.key, code: e.code, kc: e.keyCode, comp: e.isComposing}), true);
    for (const n of ['compositionstart', 'compositionupdate', 'compositionend']) document.addEventListener(n, e => push({t: t(), ev: n, data: e.data}), true);
    document.addEventListener('beforeinput', e => push({t: t(), ev: 'beforeinput', it: e.inputType, data: e.data, comp: e.isComposing}), true);
    document.addEventListener('input', e => push({t: t(), ev: 'input', it: e.inputType, data: e.data, comp: e.isComposing}), true);
  });
  pt = await clickPoint();
  result.click = pt;
  oskeys([`SRC:${SRC.latin}`, `CLICK:${pt.x},${pt.y}`]);
  await sleep(300);
  oskeys(sc.keys);
  await sleep(1200);
  const end = await page.evaluate(readState);
  oskeys([`SRC:${SRC.latin}`]);
  const st = {model: end.model, dom: end.dom, errors: [...errors]};
  result.pass = !!sc.oracle(st);
  if (sc.strict) result.strict = !!sc.strict(st);
  result.observed = {
    modelBlocks: end.model.blocks.map(b => ({type: b.type, tag: b.tag, text: b.text, nodes: b.nodes.map(n => `${n.type}:${JSON.stringify(n.text)}:f${n.format}`)})),
    domBlocks: end.dom.blocks,
    innerText: end.dom.innerText,
    sel: end.model.sel,
    composing: end.composing,
  };
  result.editorStateJSON = end.json;
  result.domHTML = end.dom.html;
  result.events = await page.evaluate(() => window.__log);
  result.errors = [...errors];
  await page.screenshot({path: `out/${name}-${commit}-${rep}.png`});
} catch (e) {
  result.pass = null;
  result.harnessError = String(e && e.stack || e).slice(0, 1000);
  result.errors = [...errors];
} finally {
  result.oskeys = log.join('\n');
  result.ms = Date.now() - t0;
  writeFileSync(`out/${name}-${commit}-${rep}.json`, JSON.stringify(result, null, 1));
  console.log('RESULT ' + JSON.stringify({scenario: name, commit, rep, pass: result.pass, strict: result.strict,
    text: result.observed && result.observed.modelBlocks.map(b => `${b.type}:${JSON.stringify(b.text)}`).join(' | '),
    errors: (result.errors || []).length, harnessError: result.harnessError}));
  await browser.close();
}
