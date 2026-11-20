// Aggregate Records into cell verdicts. Writes results.json and report.md.
import {readdirSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {judge} from './judge.mjs';
import {cellVerdict, l4Diffs} from './cells.mjs';
import {expectedAfter, firstDiff, normalize} from './text.mjs';

// Replay Records label cell.scen `<id>@parent|fix|main` (run.mjs). The variant stays in the cell key, so each
// build is its own cell; the scenario is looked up without it.
const VARIANT = /@([a-z]+)$/;
const baseId = (scen) => String(scen).replace(VARIANT, '');

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
    const expected = normalize((sc.lexAfter ?? expectedAfter)(r.lexical.before, sc.word(r.cell.lang, r.cell)));
    const d = firstDiff(expected, normalize(r.lexical.after.text));
    if (d) l2Diff = `at ${d.at}: expected ${show(d.a)} actual ${show(d.b)}`;
  }
  return {file, rep: r.rep, ...j, l2Diff};
}

/**
 * @param {any[]} records
 * @param {{id: string}[]} scenarios
 * @param {{reps?: number, plans?: {planned: any[], skipped: any[], reps?: number, _file?: string}[],
 *   expect?: string[]}} [opts] runs expected per cell (H3); the run plans (planned-<group>.json from run.mjs): a
 *   planned cell with no Record becomes a harness cell (H3 missing cell); expect: plan file names that must be
 *   present (one per job and group). A missing one becomes a harness line (H3 missing plan).
 */
export function buildReport(records, scenarios, {reps = 3, plans = [], expect = []} = {}) {
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
      .map((r) => judgeRun(r, byId.get(baseId(cell.scen))))
      .sort((a, b) => (a.rep ?? 0) - (b.rep ?? 0) || a.file.localeCompare(b.file));
    // H3: exactly `reps` Records with distinct rep numbers. Fewer, more, or duplicates make the cell harness.
    const nReps = new Set(runs.map((r) => r.rep)).size;
    const missing = runs.length !== reps || nReps !== reps;
    const h3 = runs.length < reps && nReps === runs.length
      ? `H3 missing runs: ${runs.length}/${reps}`
      : `H3 runs: ${runs.length} Records, ${nReps} distinct reps, expected ${reps}`;
    const verdict = missing ? 'harness' : cellVerdict(runs);
    const failed = [...new Set(runs.flatMap((r) => r.failed))].sort((a, b) => a - b);
    const texts = recs.map((r) => r.lexical?.after?.text).filter((t) => typeof t === 'string');
    const bad = runs.find((r) => r.verdict !== 'pass');
    return {
      key, cell, verdict, failed, runs,
      text: texts.length ? mostCommon(texts) : null,
      l2Diff: runs.find((r) => r.l2Diff)?.l2Diff ?? null,
      l3: runs.find((r) => r.diffs?.l3)?.diffs.l3 ?? null,
      reasons: missing ? [h3] : bad ? bad.reasons : [],
    };
  });
  // Planned cells with no Record (a job died, a cell never ran). A plan with an IME (Linux, Android) is matched on
  // the full cell key. On macOS and Windows the runner learns the IME only from the Record (ime null in the plan),
  // so those plans are matched without it.
  const planKey = (c) => `${c.scen}|${c.lang}|${c.os}|${c.browser}`;
  const fullKey = (c) => cellKey({...c, ime: c.ime ?? 'unknown'});
  const seenLoose = new Set(cells.map((c) => planKey(c.cell)));
  const seenFull = new Set(cells.map((c) => c.key));
  for (const p of plans.flatMap((x) => x.planned ?? [])) {
    const has = p.ime ? seenFull.has(fullKey(p)) : seenLoose.has(planKey(p));
    if (has) continue;
    seenFull.add(fullKey(p));
    seenLoose.add(planKey(p));
    const cell = {scen: p.scen, lang: p.lang, os: p.os, ime: p.ime ?? 'unknown', browser: p.browser};
    cells.push({key: cellKey(cell), cell, verdict: 'harness', failed: [], runs: [], text: null, l2Diff: null, l3: null,
      reasons: ['H3 missing cell: planned, no Record']});
  }
  cells.sort((a, b) => a.key.localeCompare(b.key));
  const skipKeys = new Set();
  // Warnings: a job or group that wrote no plan (it failed before run.mjs), and plans run with other reps.
  const files = new Set(plans.map((x) => x._file).filter(Boolean));
  const missingPlans = expect.filter((f) => !files.has(f)).sort();
  const warnings = [
    ...missingPlans.map((f) => `H3 missing plan: ${f} (that job or group wrote no plan; its cells are not counted)`),
    ...plans.filter((x) => x.reps !== undefined && x.reps !== reps)
      .map((x) => `plan ${x._file ?? '?'} ran with reps ${x.reps}, report expects ${reps}`),
  ];
  const skipped = plans.flatMap((x) => x.skipped ?? []).filter((c) => !skipKeys.has(planKey(c)) && skipKeys.add(planKey(c)))
    .sort((a, b) => planKey(a).localeCompare(planKey(b)));
  const byVerdict = Object.fromEntries(VERDICTS.map((v) => [v, cells.filter((c) => c.verdict === v).length]));
  return {
    summary: {runs: records.length, cells: cells.length, byVerdict, skipped: skipped.length, missingPlans: missingPlans.length},
    cells,
    skipped,
    warnings,
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
  out.push(`시나리오의 skip(cell)으로 돌리지 않은 칸: ${s.skipped ?? 0}개 (칸 수에 들지 않음).`, '');
  if (report.warnings?.length) {
    out.push('## 경고: 숫자가 불완전하다', '');
    for (const w of report.warnings) out.push(`- **${w}**`);
    out.push('');
  }
  const oses = [...new Set(report.cells.map((c) => c.cell.os))].sort();
  for (const os of oses) {
    const cs = report.cells.filter((c) => c.cell.os === os);
    out.push(`## ${os}`, '', ...table(['ime', 'browser', ...VERDICTS],
      [...new Set(cs.map((c) => `${c.cell.ime}|${c.cell.browser}`))].sort().map((ib) => {
        const [ime, browser] = ib.split('|');
        const mine = cs.filter((c) => c.cell.ime === ime && c.cell.browser === browser);
        return [ime, browser, ...VERDICTS.map((v) => String(mine.filter((c) => c.verdict === v).length))];
      })), '');
    out.push(`### ${os} 층별 실패, 칸 수 (흔들림 포함)`, '', ...table(['ime', 'browser', 'L1', 'L2', 'L5'],
      [...new Set(cs.map((c) => `${c.cell.ime}|${c.cell.browser}`))].sort().map((ib) => {
        const [ime, browser] = ib.split('|');
        const mine = cs.filter((c) => c.cell.ime === ime && c.cell.browser === browser);
        return [ime, browser, ...[1, 2, 5].map((l) => String(mine.filter((c) => c.failed.includes(l)).length))];
      })), '');
  }
  const replay = report.cells.filter((c) => VARIANT.test(c.cell.scen));
  if (replay.length) {
    out.push('## replay: 커밋별 판정', '');
    const rows = new Map();
    for (const c of replay) {
      const k = `${baseId(c.cell.scen)}|${c.cell.lang}|${c.cell.os}|${c.cell.ime}|${c.cell.browser}`;
      if (!rows.has(k)) rows.set(k, {});
      rows.get(k)[VARIANT.exec(c.cell.scen)[1]] = `${c.verdict}${c.failed.length ? ` [${c.failed.join(',')}]` : ''}`;
    }
    out.push(...table(['칸', 'parent', 'fix', 'main'],
      [...rows].sort(([a], [b]) => a.localeCompare(b)).map(([k, r]) => [k, r.parent ?? '-', r.fix ?? '-', r.main ?? '-'])), '');
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
  if (report.skipped?.length) {
    out.push('', '## 돌리지 않은 칸 (skip)', '');
    for (const c of report.skipped) out.push(`- ${c.scen}|${c.lang}|${c.os}|${c.browser}`);
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
  const argv = process.argv.slice(2);
  const ri = argv.indexOf('--reps');
  const reps = ri >= 0 ? Number(argv.splice(ri, 2)[1]) : 3;
  // --expect a,b,c: plan file names (as copied into <records-dir>) that every job and group must leave.
  const ei = argv.indexOf('--expect');
  const expect = ei >= 0 ? argv.splice(ei, 2)[1].split(',').filter(Boolean) : [];
  if (!Number.isInteger(reps) || reps < 1) {
    console.error('--reps needs a positive integer');
    process.exit(2);
  }
  const [dir, outDir] = argv;
  if (!dir || !outDir) {
    console.error('usage: node harness/core/report.mjs <records-dir> <out-dir> [--reps N] [--expect plan,files]');
    process.exit(2);
  }
  const {allScenarios} = await import('../scenarios/index.mjs');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => ({...JSON.parse(readFileSync(join(dir, f), 'utf8')), _file: f}));
  // run.mjs plans ({planned, skipped}) travel with the Records; everything else is a Record.
  const isPlan = (x) => Array.isArray(x.planned);
  const report = buildReport(files.filter((x) => !isPlan(x)), allScenarios(), {reps, plans: files.filter(isPlan), expect});
  mkdirSync(outDir, {recursive: true});
  writeFileSync(join(outDir, 'results.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(outDir, 'report.md'), renderMarkdown(report));
  console.log(`wrote ${outDir}/results.json and report.md`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
