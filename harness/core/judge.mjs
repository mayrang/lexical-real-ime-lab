// Pure judge: Record + Scenario -> Judgement. Layers 1, 2, 5 decide failure.
// Layer 3 (control vs Lexical) is diagnostic only.
import {normalize, expectedAfter, firstDiff} from './text.mjs';
import {validateRecord} from './record.mjs';

// Benign errors. Firefox ResizeObserver notice, and the Vite overlay bug
// that throws "text is undefined" after it. Copied from the old analyze.js.
export const IGNORED_ERRORS = [
  /can't access property "length", text is undefined/,
  /ResizeObserver loop/,
];

// A resource the page failed to load (e.g. a 404 for a font or an icon) is a network or server fault, not Lexical
// code. It is not judged; the judgement lists it in `notes`.
export const RESOURCE_ERROR = /^console: Failed to load resource\b/;

/**
 * Is the composition still open at the end of the trace (a compositionstart with no compositionend after it)?
 * Parses the trace tokens of collect.js (`s:<data>` start, `e:<data>` end). The trace is space-joined and event
 * data can hold spaces, so a data piece becomes its own token; only tokens that begin with `s:` or `e:` count.
 * @param {string|undefined} trace @returns {boolean}
 */
export function compositionOpen(trace) {
  let open = false;
  for (const t of String(trace ?? '').split(' ')) {
    if (t.startsWith('s:')) open = true;
    else if (t.startsWith('e:')) open = false;
  }
  return open;
}

/**
 * The side's composition state at the end: the structured `compositionOpen` field of the snapshot (new Records),
 * else parsed from the trace (Records from before the field).
 * @param {{compositionOpen?: boolean, trace?: string}} side @returns {boolean}
 */
export const sideCompositionOpen = (side) =>
  (typeof side?.compositionOpen === 'boolean' ? side.compositionOpen : compositionOpen(side?.trace));

const eq = (a, b) => normalize(a) === normalize(b);
const show = (s) => JSON.stringify(s);

/**
 * @param {any} r Record
 * @param {{id: string, word: (lang: string, cell: any) => string,
 *   lexAfter?: (before: any, word: string) => string,
 *   paragraphs?: (before: any) => number,
 *   blursEditor?: boolean,
 *   precondition?: (r: any) => string|null,   (reads r.control only)
 *   intent?: {check: (lexicalSide: any) => string|null, evidence: string}}} sc
 * @returns {{verdict: 'pass'|'fail'|'harness'|'inconclusive', failed: number[], reasons: string[], diffs: {l3: string|null},
 *   notes: string[]}} notes: not judged (resource-load errors)
 */
export function judge(r, sc) {
  if (sc.intent && !(typeof sc.intent.evidence === 'string' && sc.intent.evidence.trim())) {
    throw new Error(`scenario ${sc.id}: intent needs non-empty evidence`);
  }
  const notes = [];
  const out = (verdict, failed, reasons, l3 = null) => ({verdict, failed, reasons, diffs: {l3}, notes});

  if (r?.harness?.fatal) return out('inconclusive', [], [`fatal: ${r.harness.fatal}`]);
  const missing = validateRecord(r);
  if (missing.length) return out('inconclusive', [], [`H3 missing fields: ${missing.join(', ')}`]);
  if (r.harness.setupError) return out('harness', [], [`setup error: ${r.harness.setupError}`]);
  // A condition of the scenario that the harness, not Lexical, must meet (e.g. IME timing). A string = not met.
  // A precondition reads the control side only, never what Lexical received.
  const pre = sc.precondition ? sc.precondition(r) : null;

  const word = sc.word(r.cell.lang, r.cell);
  const ctl = r.control;
  const lex = r.lexical;

  const hReasons = [];
  const ctlExpected = expectedAfter(ctl.before, word);
  if (!eq(ctl.after.text, ctlExpected)) {
    hReasons.push(`H1 control ${show(ctl.after.text)} != expected ${show(ctlExpected)}`);
  }
  if (!(lex.nKeydown > 0 && ctl.nKeydown > 0)) {
    hReasons.push(`H2 keydown count lexical=${lex.nKeydown} control=${ctl.nKeydown}`);
  }
  // H4: the keys must end the composition on the control page. Otherwise the control text is open preedit, not
  // committed text, and the layer 1 checks that assume an ended composition (compositionKey, model = DOM) do not
  // apply. Control side only, like a precondition: what Lexical received never makes a run harness.
  const ctlOpen = sideCompositionOpen(ctl);
  if (ctlOpen) {
    hReasons.push('H4 control composition still open at the end (no compositionend after the last compositionstart)');
  }
  if (typeof pre === 'string') return out('harness', [], [`precondition: ${pre}`, ...hReasons]);
  if (hReasons.length) return out('harness', [], hReasons);

  const a = lex.after;
  const diff = firstDiff(normalize(ctl.after.text), normalize(a.text));
  const l3 = diff ? `control!=lexical at ${diff.at}: ${show(diff.a)} vs ${show(diff.b)}` : null;

  const failed = [];
  const reasons = [];
  const fail = (layer, msg) => {
    if (!failed.includes(layer)) failed.push(layer);
    reasons.push(`L${layer} ${msg}`);
  };

  // Layer 1: the editor is internally sound.
  if (!eq(a.text, a.domText)) fail(1, `model ${show(a.text)} != dom ${show(a.domText)}`);
  const resourceErrors = lex.errors.filter((e) => RESOURCE_ERROR.test(e));
  if (resourceErrors.length) notes.push(`resource-load errors (not judged): ${resourceErrors.join(' | ')}`);
  const realErrors = lex.errors.filter(
    (e) => /^(pageerror|console): /.test(e) && !RESOURCE_ERROR.test(e) && !IGNORED_ERRORS.some((re) => re.test(e)),
  );
  if (realErrors.length) fail(1, `errors: ${realErrors.join(' | ')}`);
  // The control ended its composition (H4 passed). If the Lexical page did not, with the same keys and IME, the
  // composition did not end in Lexical: that is a layer 1 failure, with its own reason.
  if (sideCompositionOpen(lex)) {
    fail(1, `composition still open on the Lexical side at the end (the control's ended; compositionKey ${a.compositionKey})`);
  } else if (a.compositionKey !== null) {
    fail(1, `compositionKey ${a.compositionKey} not cleared`);
  }
  if (a.hasZWSP) fail(1, 'ZWSP left in DOM');
  if (!sc.blursEditor && !a.caretInEditor) fail(1, 'caret not in editor');

  // Layer 2: the result matches what the user typed.
  const lexExpected = (sc.lexAfter ?? expectedAfter)(lex.before, word);
  if (!eq(a.text, lexExpected)) fail(2, `text ${show(a.text)} != expected ${show(lexExpected)}`);
  const paraExpected = sc.paragraphs ? sc.paragraphs(lex.before) : lex.before.text.split('\n').length;
  if (a.paragraphs !== paraExpected) fail(2, `paragraphs ${a.paragraphs} != expected ${paraExpected}`);

  // Layer 5: scenario intent.
  if (sc.intent) {
    const msg = sc.intent.check(lex);
    if (typeof msg === 'string') fail(5, `${msg} (evidence: ${sc.intent.evidence})`);
  }

  failed.sort((x, y) => x - y);
  return out(failed.length ? 'fail' : 'pass', failed, reasons, l3);
}
