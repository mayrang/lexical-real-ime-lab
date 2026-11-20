import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {installLogger, snapshot} from '../page/collect.js';
import {runCell} from '../drivers/desktop.mjs';
import {validateRecord} from '../core/record.mjs';
import {judge} from '../core/judge.mjs';
import {SCENARIOS} from '../scenarios/matrix.mjs';

const CONTROL = new URL('../page/control.html', import.meta.url).href;

async function withPage(html, fn) {
  const b = await chromium.launch({headless: true});
  try {
    const page = await b.newPage();
    await page.setContent(html);
    return await fn(page);
  } finally {
    await b.close();
  }
}

test('snapshot: control text and selection offsets', async () => {
  const html = '<div id="ed" contenteditable><p>abc</p><p>def</p></div>';
  const s = await withPage(html, async (page) => {
    await page.evaluate(() => {
      const ps = document.querySelectorAll('#ed p');
      document.getSelection().setBaseAndExtent(ps[0].firstChild, 2, ps[1].firstChild, 2);
    });
    return page.evaluate(snapshot, ['#ed', false]);
  });
  // "abc\ndef": offset 2 in the first block, and 4 + 2 in the second.
  assert.equal(s.text, 'abc\ndef');
  assert.equal(s.selStart, 2);
  assert.equal(s.selEnd, 6);
  assert.equal(s.paragraphs, 2);
});

test('snapshot: bare text and div blocks, reversed selection', async () => {
  const html = '<div id="ed" contenteditable>ab<div>cd</div><div><br></div></div>';
  const s = await withPage(html, async (page) => {
    await page.evaluate(() => {
      const d = document.querySelector('#ed div');
      document.getSelection().setBaseAndExtent(d.firstChild, 1, document.getElementById('ed').firstChild, 1);
    });
    return page.evaluate(snapshot, ['#ed', false]);
  });
  assert.equal(s.text, 'ab\ncd\n');
  assert.equal(s.selStart, 1);
  assert.equal(s.selEnd, 4);
  assert.equal(s.paragraphs, 3);
});

test('installLogger and snapshot: trace and keydown count', async () => {
  const s = await withPage('<div id="ed" contenteditable></div>', async (page) => {
    await page.evaluate(installLogger, '#ed');
    await page.evaluate(installLogger, '#ed'); // twice must not double the events
    await page.focus('#ed');
    await page.keyboard.type('hi');
    return page.evaluate(snapshot, ['#ed', false]);
  });
  assert.equal(s.text, 'hi');
  assert.equal(s.nKeydown, 2);
  assert.match(s.trace, /k:h/);
});

// Fake adapter: Playwright keys stand in for the OS IME. Only the control page is run (lexicalUrl null).
function fakeAdapter({failSend = false} = {}) {
  let page = null;
  return {
    name: 'macos',
    env: async () => ({os: 'test', image: 'test', ime: 'none', imeVersion: '0'}),
    selectIme: async () => {},
    selectLatin: async () => {},
    click: async (p, sel) => { page = p; await p.click(sel); },
    sendKeys: async (tokens) => {
      if (failSend) throw new Error('boom');
      for (const t of tokens) await page.keyboard.press(t === 'SP' ? 'Space' : t);
    },
    launchOpts: () => ({headless: true}),
  };
}

const sc = SCENARIOS.find((s) => s.id === 'plain-end');
const cellOpts = {lang: 'zh', browser: 'chromium', rep: 1, lexicalUrl: null, controlUrl: CONTROL, settleMs: 50};

test('runCell: control Record passes validateRecord', async () => {
  const keys = ['a', 'b'];
  const r = await runCell(fakeAdapter(), {...sc, keys: () => keys}, cellOpts);
  assert.deepEqual(validateRecord(r), []);
  assert.deepEqual(r.harness.keysSent, keys);
  assert.equal(r.harness.fatal, null);
  assert.equal(r.control.before.text, 'abc '); // control NBSP is mapped to a space
  assert.equal(r.control.after.text, 'abc ab');
  assert.ok(r.control.nKeydown >= 2);
  assert.equal(r.cell.scen, 'plain-end');
  assert.ok(r.env.browserVersion);
});

test('runCell: adapter error becomes harness.fatal, no throw', async () => {
  const r = await runCell(fakeAdapter({failSend: true}), sc, cellOpts);
  assert.deepEqual(validateRecord(r), []);
  assert.match(r.harness.fatal, /boom/);
  assert.equal(judge(r, sc).verdict, 'inconclusive');
});

test('runCell: setup error becomes harness.setupError', async () => {
  const bad = {...sc, setup: async () => { throw new Error('no such node'); }};
  const r = await runCell(fakeAdapter(), bad, cellOpts);
  assert.deepEqual(validateRecord(r), []);
  assert.match(r.harness.setupError, /no such node/);
  assert.equal(r.harness.fatal, null);
});

test('snapshot: control maps NBSP to a space, before and after', async () => {
  const s = await withPage('<div id="ed" contenteditable></div>', async (page) => {
    await page.focus('#ed');
    await page.keyboard.type('abc ');
    const before = await page.evaluate(snapshot, ['#ed', false]);
    await page.keyboard.type('d');
    return {before, after: await page.evaluate(snapshot, ['#ed', false])};
  });
  assert.equal(s.before.text, 'abc ');
  assert.equal(s.before.selStart, 4);
  assert.equal(s.after.text, 'abc d');
});

test('snapshot: Lexical branch against a faked editor surface', async () => {
  const html = '<div id="ed" contenteditable><p><span>a​b</span><b>한</b></p></div>';
  const s = await withPage(html, async (page) => {
    await page.evaluate(() => {
      // Minimal fake of what snapshot reads: root > paragraph > two text nodes.
      const nodes = new Map();
      const mk = (key, type, o = {}) => {
        const n = {
          __key: key, __type: type, __parent: null, __kids: o.kids || [], __text: o.text, __fmt: o.format || 0,
          getKey: () => key, getType: () => type, getParent: () => nodes.get(n.__parent) ?? null,
          isInline: () => false, isAttached: () => true, getFormat: () => n.__fmt,
        };
        if (o.text === undefined) {
          n.getChildren = () => n.__kids.map((k) => nodes.get(k));
          n.getTextContent = () => n.getChildren().map((c) => c.getTextContent()).join('');
        } else {
          n.getTextContent = () => n.__text;
        }
        nodes.set(key, n);
        return n;
      };
      mk('root', 'root', {kids: ['p']});
      mk('p', 'paragraph', {kids: ['t1', 't2']});
      mk('t1', 'text', {text: 'a​b'});
      mk('t2', 'text', {text: '한', format: 1});
      for (const n of nodes.values()) n.__kids.forEach((k) => { nodes.get(k).__parent = n.__key; });
      const st = {_nodeMap: nodes, _selection: null, read: (fn) => fn(), toJSON: () => ({fake: true})};
      document.getElementById('ed').__lexicalEditor = {_compositionKey: 't2', getEditorState: () => st};
    });
    return page.evaluate(snapshot, ['#ed', true, '한']);
  });
  assert.equal(s.text, 'a​b한');
  assert.equal(s.domText, 'a​b한');
  assert.equal(s.paragraphs, 1);
  assert.equal(s.hasZWSP, true);
  assert.equal(s.compositionKey, 't2');
  assert.deepEqual(s.imeNode, {type: 'text', format: 1, anc: ['paragraph']});
  assert.deepEqual(s.blocks, [{
    type: 'paragraph', text: 'a​b한',
    nodes: [{type: 'text', text: 'a​b', format: 0}, {type: 'text', text: '한', format: 1}],
  }]);
});
