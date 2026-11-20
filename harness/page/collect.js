// Page-side collector. Both exports run inside the browser through page.evaluate,
// so each one is self-contained: no closure over module scope, no imports.
// Text rules match core/text.mjs: NFC only, no whitespace change, U+200B kept.
// Blocks are joined with '\n' (same as flatten()).

/**
 * Record keydown, composition, beforeinput and input events of the editor in window.__log.
 * Calling it again on the same page resets the log but adds no second set of listeners.
 * @param {string} sel Editor selector.
 */
export function installLogger(sel) {
  window.__log = [];
  const ed = document.querySelector(sel);
  if (!ed || ed.__imeLoggerInstalled) return;
  ed.__imeLoggerInstalled = true;
  // ts: the event's timeStamp (ms, page clock), for timing preconditions such as the history merge window.
  const L = (e, x) => window.__log.push(Object.assign({t: e.type, tr: e.isTrusted, ts: e.timeStamp}, x));
  ed.addEventListener('keydown', (e) => L(e, {key: e.key, kc: e.keyCode, comp: e.isComposing}), true);
  for (const n of ['compositionstart', 'compositionupdate', 'compositionend']) {
    ed.addEventListener(n, (e) => L(e, {data: e.data}), true);
  }
  for (const n of ['beforeinput', 'input']) {
    ed.addEventListener(n, (e) => L(e, {it: e.inputType, data: e.data, comp: e.isComposing}), true);
  }
}

/**
 * Read the editor state. Argument is one array because page.evaluate takes one value.
 *   [sel, isLexical, first?]  first = first character of the expected word (for imeNode, Lexical only).
 * Control: text from block elements' textContent. Lexical: text from the editor model.
 * selStart/selEnd are offsets in the same joined text (selStart <= selEnd).
 * @param {[string, boolean, string?]} arg
 */
export function snapshot([sel, isLexical, first]) {
  const nfc = (s) => (s || '').normalize('NFC');
  const root = document.querySelector(sel);
  const out = {};

  // --- events
  const log = window.__log || [];
  out.trace = log
    .map((e) => {
      if (e.t === 'keydown') return 'k:' + e.key + (e.kc === 229 ? '/229' : '');
      if (e.t.startsWith('composition')) return e.t.replace('composition', '')[0] + ':' + (e.data ?? '');
      if (e.t === 'beforeinput') return 'bi:' + e.it + (e.data != null ? '(' + e.data + ')' : '');
      return null;
    })
    .filter(Boolean)
    .join(' ');
  out.nKeydown = log.filter((e) => e.t === 'keydown').length;
  // compositionend times (ms, page clock) since the log was last reset.
  out.compositionEnds = log.filter((e) => e.t === 'compositionend').map((e) => Math.round(e.ts ?? 0));

  // --- DOM leaf blocks (control text, Lexical domText, control selection)
  const BLOCK = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE',
    'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH']);
  const isBlockEl = (n) => n.nodeType === 1 && BLOCK.has(n.tagName);
  // Lexical: a <br> is a model linebreak ('\n'), except the trailing placeholder <br> that Lexical adds
  // to an empty block or after a final linebreak. Control keeps plain textContent.
  const brText = (n) => (n.nodeType === 1 && n.tagName === 'BR' ? '\n' : null);
  const lexText = (n) => {
    const b = brText(n);
    if (b !== null) return b;
    return n.nodeType === 1 ? [...n.childNodes].map(lexText).join('') : n.textContent;
  };
  const textOf = (nodes) => {
    if (!isLexical) return nodes.map((n) => n.textContent).join('');
    const last = nodes.length - 1;
    const placeholder = last >= 0 && brText(nodes[last]) !== null && (last === 0 || brText(nodes[last - 1]) !== null);
    return (placeholder ? nodes.slice(0, last) : nodes).map(lexText).join('');
  };
  const leaves = [];
  // Not text content: table column specs, and the playground's table sticky scrollbar (aria-hidden,
  // no text). Without this they become empty DOM blocks. Other aria-hidden content is still read.
  const skip = (n) => n.nodeType === 1 && (n.tagName === 'COLGROUP'
    || (n.getAttribute('aria-hidden') === 'true'
      && (/StickyScrollbar/.test(n.getAttribute('class') ?? '') || getComputedStyle(n).display === 'none')));
  const walk = (parent) => {
    const kids = [...parent.childNodes].filter((n) => !skip(n));
    if (!kids.some(isBlockEl)) {
      leaves.push({el: parent, nodes: kids, text: textOf(kids)});
      return;
    }
    let run = [];
    const flush = () => {
      if (run.some((n) => n.nodeType !== 3 || n.data.trim() !== '')) {
        leaves.push({el: parent, nodes: run, text: textOf(run), run: true});
      }
      run = [];
    };
    for (const k of kids) {
      if (isBlockEl(k)) { flush(); walk(k); } else run.push(k);
    }
    flush();
  };
  walk(root);
  // Control only: a plain contenteditable turns a typed space into NBSP natively, which is not IME output.
  // Never map on the Lexical side: an NBSP there is a real bug (#7061).
  const plain = (t) => (isLexical ? t : t.replace(/\u00a0/g, ' '));
  const domBlocks = leaves.map((l) => nfc(plain(l.text)));

  const findLeaf = (node, off, depth = 0) => {
    for (const [i, l] of leaves.entries()) {
      const inside = l.run
        ? l.nodes.some((n) => n === node || n.contains(node))
        : l.el === node || l.el.contains(node);
      if (inside) return {i, node, off};
    }
    if (depth > 20 || node.nodeType !== 1) return null;
    const kids = node.childNodes;
    if (off < kids.length) return findLeaf(kids[off], 0, depth + 1);
    const last = kids[kids.length - 1];
    if (!last) return null;
    return findLeaf(last, last.nodeType === 3 ? last.data.length : last.childNodes.length, depth + 1);
  };
  const domPos = (node, off) => {
    const hit = findLeaf(node, off);
    if (!hit) return null;
    const l = leaves[hit.i];
    const r = document.createRange();
    if (l.run) r.setStartBefore(l.nodes[0]); else r.setStart(l.el, 0);
    r.setEnd(hit.node, hit.off);
    let start = 0;
    for (let k = 0; k < hit.i; k++) start += domBlocks[k].length + 1;
    return start + nfc(plain(r.toString())).length;
  };
  const domSel = () => {
    const s = document.getSelection();
    if (!s || !s.rangeCount || !s.anchorNode || !root.contains(s.anchorNode) || !root.contains(s.focusNode)) return null;
    const a = domPos(s.anchorNode, s.anchorOffset);
    const f = domPos(s.focusNode, s.focusOffset);
    return a === null || f === null ? null : [Math.min(a, f), Math.max(a, f)];
  };

  const s0 = document.getSelection();
  out.caretInEditor = !!(root.contains(document.activeElement) || (s0 && s0.focusNode && root.contains(s0.focusNode)));

  if (!isLexical) {
    out.text = domBlocks.join('\n');
    out.paragraphs = domBlocks.length;
    const ds = domSel();
    out.selStart = ds ? ds[0] : 0;
    out.selEnd = ds ? ds[1] : 0;
    return out;
  }

  // --- Lexical model
  const ed = root.__lexicalEditor;
  const st = ed.getEditorState();
  out.compositionKey = ed._compositionKey ?? null;
  out.editorStateJSON = JSON.stringify(st.toJSON());
  out.domHTML = root.innerHTML;
  out.domText = domBlocks.join('\n');
  st.read(() => {
    const map = st._nodeMap;
    const rootNode = map.get('root');
    const kidsOf = (n) => (typeof n.getChildren === 'function' ? n.getChildren() : []);
    const isBlock = (n) => typeof n.getChildren === 'function' && !(n.isInline && n.isInline()) && n.getType() !== 'root';
    const mleaves = [];
    const mwalk = (n) => {
      const kids = kidsOf(n);
      if (isBlock(n) && !kids.some(isBlock)) { mleaves.push(n); return; }
      kids.forEach(mwalk);
    };
    mwalk(rootNode);
    const btext = mleaves.map((n) => nfc(n.getTextContent()));
    out.text = btext.join('\n');
    out.paragraphs = mleaves.length;
    out.hasZWSP = rootNode.getTextContent().includes('​');
    const descend = (n) => {
      const k = kidsOf(n);
      return k.length ? k.flatMap(descend) : [n];
    };
    out.blocks = mleaves.map((n, i) => ({
      type: n.getType(),
      text: btext[i],
      nodes: descend(n).map((x) => ({
        key: x.getKey(),
        type: x.getType(),
        text: x.getTextContent(),
        format: typeof x.getFormat === 'function' && x.__text !== undefined ? x.getFormat() : 0,
      })),
    }));

    // Offset of a model point in the joined text.
    const isIn = (n, anc) => { for (let p = n; p; p = p.getParent()) if (p === anc) return true; return false; };
    const before = (el, target) => {
      let acc = 0;
      for (const c of kidsOf(el)) {
        if (c === target) return acc;
        if (isIn(target, c)) return acc + before(c, target);
        acc += c.getTextContent().length;
      }
      return acc;
    };
    const starts = [];
    btext.reduce((acc, t) => { starts.push(acc); return acc + t.length + 1; }, 0);
    const mpos = (key, off, depth = 0) => {
      const n = map.get(key);
      if (!n) return null;
      const i = mleaves.findIndex((l) => isIn(n, l));
      if (i >= 0) {
        const leaf = mleaves[i];
        const within = n.__text !== undefined
          ? before(leaf, n) + off
          : n === leaf
            ? kidsOf(leaf).slice(0, off).reduce((a, c) => a + c.getTextContent().length, 0)
            : before(leaf, n) + kidsOf(n).slice(0, off).reduce((a, c) => a + c.getTextContent().length, 0);
        return starts[i] + within;
      }
      // Point on a container above the leaf blocks (root, list, table cell).
      if (depth > 20) return null;
      const kids = kidsOf(n);
      if (off < kids.length) return mpos(kids[off].getKey(), 0, depth + 1);
      const last = kids[kids.length - 1];
      return last ? mpos(last.getKey(), kidsOf(last).length || last.getTextContent().length, depth + 1) : null;
    };
    const sel = st._selection;
    let range = null;
    if (sel && sel.anchor && sel.focus) {
      const a = mpos(sel.anchor.key, sel.anchor.offset);
      const f = mpos(sel.focus.key, sel.focus.offset);
      if (a !== null && f !== null) range = [Math.min(a, f), Math.max(a, f)];
    }
    if (!range) range = domSel();
    out.selStart = range ? range[0] : 0;
    out.selEnd = range ? range[1] : 0;

    // The first attached text node that holds the first character of the expected word.
    out.imeNode = null;
    if (first) {
      for (const [, n] of map) {
        if (n.__text !== undefined && n.isAttached() && n.__text.includes(first)) {
          const anc = [];
          for (let p = n.getParent(); p && p.getType() !== 'root'; p = p.getParent()) anc.push(p.getType());
          out.imeNode = {key: n.getKey(), type: n.getType(), format: n.getFormat(), anc};
          break;
        }
      }
    }
  });
  // Typeahead menu: menuPresent is what Lexical's own test checks (the container exists); menuItems is diagnostic.
  out.menuPresent = !!document.querySelector('#typeahead-menu');
  out.menuItems = document.querySelectorAll('#typeahead-menu ul li').length;
  return out;
}
