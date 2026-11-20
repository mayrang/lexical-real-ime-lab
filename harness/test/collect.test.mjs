import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {installLogger, snapshot} from '../page/collect.js';
import {runCell, keySteps, armClickCheck} from '../drivers/desktop.mjs';
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
function fakeAdapter({failSend = false, clickError = false} = {}) {
  let page = null;
  return {
    name: 'macos',
    env: async () => ({os: 'test', image: 'test', ime: 'none', imeVersion: '0'}),
    selectIme: async () => {},
    selectLatin: async () => {},
    click: async (p, sel) => {
      page = p;
      // A warm-up page error, as an adapter's click may raise.
      if (clickError) await p.evaluate(() => setTimeout(() => { throw new Error('warm-up noise'); }));
      await p.click(sel);
    },
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

test('runCell: PROBE splits the keys and records a mid snapshot', async () => {
  const sent = [];
  const a = fakeAdapter();
  const send = a.sendKeys;
  a.sendKeys = async (tokens, d) => { sent.push(tokens); await send(tokens, d); };
  const r = await runCell(a, {...sc, keys: () => ['a', 'PROBE', 'b']}, cellOpts);
  assert.deepEqual(sent, [['a'], ['b']]);
  assert.equal(r.control.mid.text, 'abc a');
  assert.equal(r.control.after.text, 'abc ab');
  assert.deepEqual(validateRecord(r), []);
});

test('keySteps', () => {
  assert.deepEqual(keySteps(['a', 'b']), [{keys: ['a', 'b']}]);
  assert.deepEqual(keySteps(['a', 'PROBE']), [{keys: ['a']}, {probe: true}]);
  assert.deepEqual(keySteps(['a', 'CLICK:abc', 'b', 'PROBE', 'c']),
    [{keys: ['a']}, {click: 'abc'}, {keys: ['b']}, {probe: true}, {keys: ['c']}]);
});

test('runCell: CLICK clicks the block that holds the text, with keepFocus, between the keys', async () => {
  const sent = [];
  const clicks = [];
  const a = fakeAdapter();
  const send = a.sendKeys;
  a.sendKeys = async (tokens, d) => { sent.push([tokens, d]); await send(tokens, d); };
  const click = a.click;
  // Real adapters click the first line of the element (left + 20, top + 15); so does this one for the CLICK.
  a.click = async (p, s, opts) => { clicks.push([s, opts ?? null]); await (opts?.keepFocus ? p.click(s, {position: {x: 20, y: 15}}) : click(p, s)); };
  const two = {...sc, setup: async (c) => { await c.page.keyboard.type('abc'); await c.page.keyboard.press('Enter'); await c.page.keyboard.type('def'); }};
  const r = await runCell(a, {...two, keyDelay: 40, keys: () => ['x', 'CLICK:abc', 'y']}, cellOpts);
  assert.deepEqual(sent, [[['x'], 40], [['y'], 40]]);
  // The first click focuses the editor; the second is the CLICK, on the block (or the root) that holds "abc".
  assert.equal(clicks.length, 2);
  assert.deepEqual(clicks[1][1], {keepFocus: true});
  assert.match(clicks[1][0], /^#ed( > :nth-child\(1\))?$/);
  assert.equal(r.harness.fatal, null);
  assert.equal(r.harness.setupError, null);
  assert.match(r.control.after.text, /y/);
});

test('runCell: a CLICK that lands on another block is a harness setupError', async () => {
  const a = fakeAdapter();
  const click = a.click;
  // Miss on purpose: click the last block instead of the one that holds "abc".
  a.click = async (p, s, opts) => (opts?.keepFocus ? p.click('#ed > :last-child', {position: {x: 20, y: 10}}) : click(p, s));
  const two = {...sc, setup: async (c) => { await c.page.keyboard.type('abc'); await c.page.keyboard.press('Enter'); await c.page.keyboard.type('def'); }};
  const r = await runCell(a, {...two, keys: () => ['x', 'CLICK:abc', 'y']}, cellOpts);
  assert.match(r.harness.setupError ?? '', /CLICK:abc: mousedown .* not the block with abc/);
});

test('runCell: the CLICK target is resolved at mousedown time, not after the click', async () => {
  const a = fakeAdapter();
  const click = a.click;
  // A correct click, then the page reorders its blocks (as an editor may re-render after a click). A check made
  // after the click would find "def" under the old point and report a miss.
  a.click = async (p, s, opts) => {
    if (!opts?.keepFocus) return click(p, s);
    await p.click(s, {position: {x: 20, y: 15}});
    await p.evaluate(() => { const ed = document.querySelector('#ed'); ed.appendChild(ed.firstElementChild); });
  };
  const three = {...sc, setup: async (c) => {
    for (const w of ['abc', 'def']) { await c.page.keyboard.type(w); await c.page.keyboard.press('Enter'); }
    await c.page.keyboard.type('ghi');
  }};
  const r = await runCell(a, {...three, keys: () => ['x', 'CLICK:def', 'y']}, cellOpts);
  assert.equal(r.harness.setupError, null);
});

test('armClickCheck: only the first trusted mousedown counts, then the listener is gone', async () => {
  const html = '<div id="ed" contenteditable><p>abc</p><p>def</p></div>';
  await withPage(html, async (page) => {
    const target = await page.evaluate(armClickCheck, ['#ed', 'abc']);
    assert.equal(target, '#ed > :nth-child(1)');
    // An untrusted event is ignored and leaves the listener armed.
    await page.evaluate(() => document.querySelector('#ed p').dispatchEvent(new MouseEvent('mousedown', {bubbles: true})));
    assert.equal(await page.evaluate(() => window.__imelabClick), null);
    await page.click('#ed > :nth-child(1)', {position: {x: 5, y: 5}});
    assert.equal((await page.evaluate(() => window.__imelabClick)).miss, null);
    await page.evaluate(() => { window.__imelabClick = null; });
    await page.click('#ed > :nth-child(2)', {position: {x: 5, y: 5}});
    assert.equal(await page.evaluate(() => window.__imelabClick), null);
  });
});

test('snapshot: compositionEnds holds the compositionend times since the log reset', async () => {
  const html = '<div id="ed" contenteditable>ab</div>';
  const s = await withPage(html, async (page) => {
    await page.evaluate(installLogger, '#ed');
    await page.evaluate(async () => {
      const ed = document.querySelector('#ed');
      ed.dispatchEvent(new CompositionEvent('compositionend', {data: 'x'}));
      await new Promise((r) => setTimeout(r, 50));
      ed.dispatchEvent(new CompositionEvent('compositionend', {data: 'y'}));
    });
    return page.evaluate(snapshot, ['#ed', false]);
  });
  assert.equal(s.compositionEnds.length, 2);
  assert.ok(s.compositionEnds[1] - s.compositionEnds[0] >= 45, String(s.compositionEnds));
});

test('snapshot: focusInEditor is the focus, caretInEditor also accepts a selection', async () => {
  const html = '<div id="ed" contenteditable><p>abc</p></div><input id="out">';
  const s = await withPage(html, async (page) => {
    await page.evaluate(() => {
      const p = document.querySelector('#ed p');
      document.getSelection().setBaseAndExtent(p.firstChild, 1, p.firstChild, 1);
      // Setting the selection focuses the editor in Chromium; blur keeps the selection where it is.
      document.activeElement?.blur();
    });
    const a = await page.evaluate(snapshot, ['#ed', false]);
    await page.focus('#ed');
    const b = await page.evaluate(snapshot, ['#ed', false]);
    return [a, b];
  });
  assert.equal(s[0].caretInEditor, true);
  assert.equal(s[0].focusInEditor, false);
  assert.equal(s[1].focusInEditor, true);
});

test('runCell: the Record side keeps compositionEnds', async () => {
  const r = await runCell(fakeAdapter(), sc, cellOpts);
  assert.deepEqual(r.control.compositionEnds, []);
  assert.deepEqual(r.lexical.compositionEnds, []);
});

test('runCell: adapter notes per target go into harness.notes', async () => {
  const a = fakeAdapter();
  let pending = 'stale';
  a.selectIme = async () => { pending = (pending ? pending + ' ' : '') + 'keys[imeon smode=0x0>0x8]'; };
  a.takeNotes = () => { const s = pending; pending = ''; return s; };
  const r = await runCell(a, sc, cellOpts);
  assert.deepEqual(validateRecord(r), []);
  // Notes left from before the target are dropped. Each selectIme of the target (before launch, before keys) adds one.
  assert.equal(r.harness.notes, 'control: keys[imeon smode=0x0>0x8] keys[imeon smode=0x0>0x8]; ');
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
  assert.equal(s.menuPresent, false);
  assert.equal(s.menuItems, 0);
  assert.deepEqual(s.imeNode, {key: 't2', type: 'text', format: 1, anc: ['paragraph']});
  assert.deepEqual(s.blocks, [{
    type: 'paragraph', text: 'a​b한',
    nodes: [{key: 't1', type: 'text', text: 'a​b', format: 0}, {key: 't2', type: 'text', text: '한', format: 1}],
  }]);
});

test('runCell: a sendKeys failure keeps the partial control data', async () => {
  const r = await runCell(fakeAdapter({failSend: true}), sc, cellOpts);
  assert.match(r.harness.fatal, /^control: .*boom/);
  assert.equal(r.control.before.text, 'abc ');
  assert.equal(r.control.before.selStart, 4);
});

test('snapshot: Lexical domText maps <br> to a newline like the model, not the placeholder', async () => {
  const html = '<div id="ed" contenteditable><p><span>a</span><br><span>b</span></p><p><br></p><p><span>c</span><br><br></p></div>';
  const s = await withPage(html, async (page) => {
    await page.evaluate(() => {
      const nodes = new Map();
      const mk = (key, type, o = {}) => {
        const n = {
          __key: key, __type: type, __parent: null, __kids: o.kids || [], __text: o.text,
          getKey: () => key, getType: () => type, getParent: () => nodes.get(n.__parent) ?? null,
          isInline: () => false, isAttached: () => true, getFormat: () => 0,
        };
        if (o.leaf) n.getTextContent = () => o.leaf;
        else {
          n.getChildren = () => n.__kids.map((k) => nodes.get(k));
          n.getTextContent = () => n.getChildren().map((c) => c.getTextContent()).join('');
        }
        nodes.set(key, n);
      };
      mk('root', 'root', {kids: ['p1', 'p2', 'p3']});
      mk('p1', 'paragraph', {kids: ['a', 'lb1', 'b']});
      mk('p2', 'paragraph');
      mk('p3', 'paragraph', {kids: ['c', 'lb2']});
      mk('a', 'text', {leaf: 'a', text: 'a'});
      mk('b', 'text', {leaf: 'b', text: 'b'});
      mk('c', 'text', {leaf: 'c', text: 'c'});
      mk('lb1', 'linebreak', {leaf: '\n'});
      mk('lb2', 'linebreak', {leaf: '\n'});
      for (const n of nodes.values()) n.__kids.forEach((k) => { nodes.get(k).__parent = n.__key; });
      const st = {_nodeMap: nodes, _selection: null, read: (fn) => fn(), toJSON: () => ({})};
      document.getElementById('ed').__lexicalEditor = {_compositionKey: null, getEditorState: () => st};
    });
    return page.evaluate(snapshot, ['#ed', true, 'x']);
  });
  assert.equal(s.text, 'a\nb\n\nc\n');
  assert.equal(s.domText, s.text);
});

test('snapshot: Lexical domText skips table colgroup and the hidden sticky scrollbar', async () => {
  // DOM copied from the playground (table-cell, linux run 44657614302).
  const html = '<div id="ed" contenteditable><div data-lexical-sticky-scrollbar="true"><div><table><colgroup><col><col></colgroup>'
    + '<tr><td><p><span>a</span></p></td><td><p><span>b</span></p></td></tr></table></div>'
    + '<div aria-hidden="true" tabindex="-1" style="display: none;"><div style="height: 1px;"></div></div></div></div>';
  const s = await withPage(html, async (page) => {
    await page.evaluate(() => {
      const nodes = new Map();
      const mk = (key, type, o = {}) => {
        const n = {
          __key: key, __parent: null, __kids: o.kids || [],
          getKey: () => key, getType: () => type, getParent: () => nodes.get(n.__parent) ?? null,
          isInline: () => false, isAttached: () => true, getFormat: () => 0,
        };
        if (o.leaf !== undefined) { n.__text = o.leaf; n.getTextContent = () => o.leaf; } else {
          n.getChildren = () => n.__kids.map((k) => nodes.get(k));
          n.getTextContent = () => n.getChildren().map((c) => c.getTextContent()).join('');
        }
        nodes.set(key, n);
      };
      mk('root', 'root', {kids: ['p1', 'p2']});
      mk('p1', 'paragraph', {kids: ['a']});
      mk('p2', 'paragraph', {kids: ['b']});
      mk('a', 'text', {leaf: 'a'});
      mk('b', 'text', {leaf: 'b'});
      for (const n of nodes.values()) n.__kids.forEach((k) => { nodes.get(k).__parent = n.__key; });
      const st = {_nodeMap: nodes, _selection: null, read: (fn) => fn(), toJSON: () => ({})};
      document.getElementById('ed').__lexicalEditor = {_compositionKey: null, getEditorState: () => st};
    });
    return page.evaluate(snapshot, ['#ed', true, 'a']);
  });
  assert.equal(s.domText, 'a\nb');
});

test('snapshot: Lexical domText still reads aria-hidden text inside a paragraph', async () => {
  const html = '<div id="ed" contenteditable><p><span>a</span><span aria-hidden="true">x</span></p></div>';
  const s = await withPage(html, async (page) => {
    await page.evaluate(() => {
      const nodes = new Map();
      const mk = (key, type, o = {}) => {
        const n = {
          __key: key, __parent: null, __kids: o.kids || [],
          getKey: () => key, getType: () => type, getParent: () => nodes.get(n.__parent) ?? null,
          isInline: () => false, isAttached: () => true, getFormat: () => 0,
        };
        if (o.leaf !== undefined) { n.__text = o.leaf; n.getTextContent = () => o.leaf; } else {
          n.getChildren = () => n.__kids.map((k) => nodes.get(k));
          n.getTextContent = () => n.getChildren().map((c) => c.getTextContent()).join('');
        }
        nodes.set(key, n);
      };
      mk('root', 'root', {kids: ['p']});
      mk('p', 'paragraph', {kids: ['a', 'x']});
      mk('a', 'text', {leaf: 'a'});
      mk('x', 'text', {leaf: 'x'});
      for (const n of nodes.values()) n.__kids.forEach((k) => { nodes.get(k).__parent = n.__key; });
      const st = {_nodeMap: nodes, _selection: null, read: (fn) => fn(), toJSON: () => ({})};
      document.getElementById('ed').__lexicalEditor = {_compositionKey: null, getEditorState: () => st};
    });
    return page.evaluate(snapshot, ['#ed', true, 'a']);
  });
  assert.equal(s.domText, 'ax');
});

test('runCell: errors raised during the adapter click are not counted; setup-phase errors go to notes', async () => {
  const r = await runCell(fakeAdapter({clickError: true}), sc, cellOpts);
  assert.deepEqual(r.control.errors, []);
  const late = {...sc, setup: async (c) => {
    await c.page.evaluate(() => setTimeout(() => { throw new Error('setup error'); }));
    await new Promise((res) => setTimeout(res, 100));
  }};
  const r2 = await runCell(fakeAdapter({clickError: true}), late, cellOpts);
  assert.deepEqual(r2.control.errors, []);
  assert.match(r2.harness.notes, /control setup-phase errors \(not judged\): pageerror: .*setup error/);
});

test('runCell: errors raised during the measured keys stay in side.errors', async () => {
  const a = fakeAdapter();
  const send = a.sendKeys;
  let page = null;
  const click = a.click;
  a.click = async (p, sel) => { page = p; await click(p, sel); };
  a.sendKeys = async (tokens, d) => {
    await page.evaluate(() => setTimeout(() => { throw new Error('keys error'); }));
    await send(tokens, d);
  };
  const r = await runCell(a, sc, cellOpts);
  assert.equal(r.control.errors.length, 1);
  assert.match(r.control.errors[0], /keys error/);
  assert.doesNotMatch(r.harness.notes, /setup-phase/);
});

test('snapshot: compositionOpen is true only while a compositionstart has no compositionend after it', async () => {
  const html = '<div id="ed" contenteditable>ab</div>';
  const s = await withPage(html, async (page) => {
    await page.evaluate(installLogger, '#ed');
    const fire = (types) => page.evaluate((ts) => {
      const ed = document.querySelector('#ed');
      for (const t of ts) ed.dispatchEvent(new CompositionEvent(t, {data: 'a b'}));
    }, types);
    const out = [];
    out.push(await page.evaluate(snapshot, ['#ed', false]));
    await fire(['compositionstart', 'compositionupdate']);
    out.push(await page.evaluate(snapshot, ['#ed', false]));
    await fire(['compositionend']);
    out.push(await page.evaluate(snapshot, ['#ed', false]));
    return out;
  });
  assert.deepEqual(s.map((x) => x.compositionOpen), [false, true, false]);
});
