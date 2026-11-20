// Record format shared by all drivers. See the plan, Task 2.
//
// Record = {cell, rep, env, control: Side, lexical: Side & LexicalExtra, harness}
// Side = {before: {text, selStart, selEnd}, after: {text, paragraphs}, trace, nKeydown, errors}
// LexicalExtra = {after: {domText, compositionKey, hasZWSP, caretInEditor, blocks, imeNode}, editorStateJSON, domHTML}
// errors entries start with 'pageerror: ' or 'console: '.

// Paths that must exist. null is a valid value only where listed in NULLABLE.
const REQUIRED = [
  'cell.scen', 'cell.lang', 'cell.os', 'cell.ime', 'cell.browser', 'rep',
  'env.os', 'env.image', 'env.browser', 'env.browserVersion', 'env.ime', 'env.imeVersion',
  'env.lexicalCommit', 'env.harnessCommit',
  ...['control', 'lexical'].flatMap((s) => [
    `${s}.before.text`, `${s}.before.selStart`, `${s}.before.selEnd`,
    `${s}.after.text`, `${s}.after.paragraphs`,
    `${s}.trace`, `${s}.nKeydown`, `${s}.errors`,
  ]),
  'lexical.after.domText', 'lexical.after.compositionKey', 'lexical.after.hasZWSP',
  'lexical.after.caretInEditor', 'lexical.after.blocks', 'lexical.after.imeNode',
  'lexical.editorStateJSON', 'lexical.domHTML',
  'harness.keysSent', 'harness.setupError', 'harness.fatal', 'harness.notes',
];
const NULLABLE = new Set([
  'lexical.after.compositionKey', 'lexical.after.imeNode', 'harness.setupError', 'harness.fatal',
]);

function get(obj, path) {
  let cur = obj;
  for (const k of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[k];
  }
  return cur;
}

/**
 * List the missing fields of a record.
 * @param {any} r
 * @returns {string[]}
 */
export function validateRecord(r) {
  if (r === null || typeof r !== 'object') return ['record'];
  const missing = [];
  for (const p of REQUIRED) {
    const v = get(r, p);
    if (v === undefined || (v === null && !NULLABLE.has(p))) missing.push(p);
  }
  return missing;
}
