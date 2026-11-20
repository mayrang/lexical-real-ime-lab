// Aggregate Records into cell verdicts. Writes results.json and report.md.
import {readdirSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {judge} from './judge.mjs';
import {cellVerdict, l4Diffs} from './cells.mjs';
import {expectedAfter, firstDiff, normalize} from './text.mjs';

const VERDICTS = ['pass', 'fail', 'flaky', 'inconclusive', 'harness'];
const show = (s) => JSON.stringify(s);
const cellKey = (c) => `${c.scen}|${c.lang}|${c.os}|${c.ime}|${c.browser}`;

function mostCommon(texts) {
  const n = new Map();
  for (const t of texts) n.set(t, (n.get(t) ?? 0) + 1);
  let best = null;
  for (const [t, k] of n) if (best === null || k > n.get(best)) best = t;
  return best;
}

function judgeRun(r, sc) {
  const file = r._file ?? `rep${r.rep}`;
  if (!sc) {
    return {file, rep: r.rep, verdict: 'inconclusive', failed: [], reasons: ['unknown scenario'], diffs: {l3: null}, l2Diff: null};
  }
  const j = judge(r, sc);
  let l2Diff = null;
  if (j.failed.includes(2)) {
    const expected = normalize((sc.lexAfter ?? expectedAfter)(r.lexical.before, sc.word(r.cell.lang)));
    const d = firstDiff(expected, normalize(r.lexical.after.text));
    if (d) l2Diff = `at ${d.at}: expected ${show(d.a)} actual ${show(d.b)}`;
  }
  return {file, rep: r.rep, ...j, l2Diff};
}

/**
 * @param {any[]} records
 * @param {{id: string}[]} scenarios
 */
export function buildReport(records, scenarios) {
  const byId = new Map(scenarios.map((s) => [s.id, s]));
  const groups = new Map();
  for (const r of records) {
    const cell = r.cell ?? {scen: '?', lang: '?', os: '?', ime: '?', browser: '?'};
    const key = cellKey(cell);
    if (!groups.has(key)) groups.set(key, {key, cell, recs: []});
    groups.get(key).recs.push(r);
  }
  const cells = [...groups.values()].map(({key, cell, recs}) => {
    const runs = recs
      .map((r) => judgeRun(r, byId.get(cell.scen)))
      .sort((a, b) => (a.rep ?? 0) - (b.rep ?? 0) || a.file.localeCompare(b.file));
    const verdict = cellVerdict(runs);
    const failed = [...new Set(runs.flatMap((r) => r.failed))].sort((a, b) => a - b);
    const texts = recs.map((r) => r.lexical?.after?.text).filter((t) => typeof t === 'string');
    const bad = runs.find((r) => r.verdict !== 'pass');
    return {
      key, cell, verdict, failed, runs,
      text: texts.length ? mostCommon(texts) : null,
      l2Diff: runs.find((r) => r.l2Diff)?.l2Diff ?? null,
      l3: runs.find((r) => r.diffs?.l3)?.diffs.l3 ?? null,
      reasons: bad ? bad.reasons : [],
    };
  }).sort((a, b) => a.key.localeCompare(b.key));
  const byVerdict = Object.fromEntries(VERDICTS.map((v) => [v, cells.filter((c) => c.verdict === v).length]));
  return {
    summary: {runs: records.length, cells: cells.length, byVerdict},
    cells,
    l4: l4Diffs(cells),
  };
}

const table = (head, rows) => [
  `| ${head.join(' | ')} |`,
  `| ${head.map(() => '---').join(' | ')} |`,
  ...rows.map((r) => `| ${r.join(' | ')} |`),
];

/** @param {ReturnType<typeof buildReport>} report */
export function renderMarkdown(report) {
  const out = ['# Real IME report', ''];
  const s = report.summary;
  out.push(`실행 ${s.runs}회, 칸 ${s.cells}개. ${VERDICTS.map((v) => `${v} ${s.byVerdict[v]}`).join(', ')}.`, '');
  const oses = [...new Set(report.cells.map((c) => c.cell.os))].sort();
  for (const os of oses) {
    const cs = report.cells.filter((c) => c.cell.os === os);
    out.push(`## ${os}`, '', ...table(['ime', 'browser', ...VERDICTS],
      [...new Set(cs.map((c) => `${c.cell.ime}|${c.cell.browser}`))].sort().map((ib) => {
        const [ime, browser] = ib.split('|');
        const mine = cs.filter((c) => c.cell.ime === ime && c.cell.browser === browser);
        return [ime, browser, ...VERDICTS.map((v) => String(mine.filter((c) => c.verdict === v).length))];
      })), '');
    out.push(`### ${os} 층별 실패 (칸 수)`, '', ...table(['ime', 'browser', 'L1', 'L2', 'L5'],
      [...new Set(cs.map((c) => `${c.cell.ime}|${c.cell.browser}`))].sort().map((ib) => {
        const [ime, browser] = ib.split('|');
        const mine = cs.filter((c) => c.cell.ime === ime && c.cell.browser === browser);
        return [ime, browser, ...[1, 2, 5].map((l) => String(mine.filter((c) => c.failed.includes(l)).length))];
      })), '');
  }
  const bad = report.cells.filter((c) => c.verdict !== 'pass');
  out.push('## 통과하지 못한 칸', '');
  if (!bad.length) out.push('없음.', '');
  for (const c of bad) {
    out.push(`- ${c.key}: ${c.verdict}${c.failed.length ? ` (층 ${c.failed.join(',')})` : ''}`);
    out.push(`  - 이유: ${c.reasons.join('; ') || '-'}`);
    if (c.l2Diff) out.push(`  - firstDiff: ${c.l2Diff}`);
    out.push(`  - 기록: ${c.runs.map((r) => `${r.file} (${r.verdict})`).join(', ')}`);
  }
  out.push('', '## 차이 (진단용, 판정에 쓰지 않음)', '');
  const l3 = report.cells.filter((c) => c.l3);
  out.push('### 3층 control과 Lexical', '');
  if (!l3.length) out.push('없음.');
  for (const c of l3) out.push(`- ${c.key}: ${c.l3}`);
  out.push('', '### 4층 칸 사이', '');
  if (!report.l4.length) out.push('없음.');
  for (const g of report.l4) {
    out.push(`- ${g.scen}|${g.lang}`);
    for (const v of g.variants) out.push(`  - ${v.key}: ${show(v.text)}`);
  }
  return out.join('\n') + '\n';
}

async function main() {
  const [dir, outDir] = process.argv.slice(2);
  if (!dir || !outDir) {
    console.error('usage: node harness/core/report.mjs <records-dir> <out-dir>');
    process.exit(2);
  }
  const {allScenarios} = await import('../scenarios/index.mjs');
  const records = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => ({...JSON.parse(readFileSync(join(dir, f), 'utf8')), _file: f}));
  const report = buildReport(records, allScenarios());
  mkdirSync(outDir, {recursive: true});
  writeFileSync(join(outDir, 'results.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(outDir, 'report.md'), renderMarkdown(report));
  console.log(`wrote ${outDir}/results.json and report.md`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
