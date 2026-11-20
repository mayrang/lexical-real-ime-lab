// Cell verdicts: aggregate the judgements of the runs of one cell.
// Layer 4 (cross-cell text differences) is diagnostic only.

/**
 * @param {{verdict: string, failed: number[]}[]} js
 * @returns {'pass'|'fail'|'flaky'|'harness'|'inconclusive'}
 */
export function cellVerdict(js) {
  if (js.some((j) => j.verdict === 'harness')) return 'harness';
  if (js.some((j) => j.verdict === 'inconclusive')) return 'inconclusive';
  if (js.every((j) => j.verdict === 'pass')) return 'pass';
  if (js.every((j) => j.verdict === 'fail')) {
    const sig = (j) => j.failed.join(',');
    return js.every((j) => sig(j) === sig(js[0])) ? 'fail' : 'inconclusive';
  }
  return 'flaky';
}

/**
 * Report scen|lang groups whose Lexical text differs between cells.
 * @param {{key: string, cell: {scen: string, lang: string}, text: string|null}[]} cells
 * @returns {{scen: string, lang: string, variants: {key: string, text: string}[]}[]}
 */
export function l4Diffs(cells) {
  const groups = new Map();
  for (const c of cells) {
    if (c.text === null || c.text === undefined) continue;
    const g = `${c.cell.scen}|${c.cell.lang}`;
    if (!groups.has(g)) groups.set(g, {scen: c.cell.scen, lang: c.cell.lang, variants: []});
    groups.get(g).variants.push({key: c.key, text: c.text});
  }
  return [...groups.values()].filter((g) => new Set(g.variants.map((v) => v.text)).size > 1);
}
