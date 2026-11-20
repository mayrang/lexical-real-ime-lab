// Calibration guard: a scenario's `word` (the control's expected text) must come from control runs whose
// composition ended. Open preedit text is not a result (final review C1). The judge's H4 makes such a run harness
// at judge time; this check reads stored control Records offline, so a calibration taken from an open composition
// is found before a measurement, not after.
//
// CLI: node harness/core/calibcheck.mjs <records-dir>... (folders are searched recursively for *.json Records)
// Prints one line per control run whose composition is still open at the end, with its status:
//   violation   the current scenario still runs that cell with the same keys: fix the keys or skip the cell
//   skipped     the current scenario's skip(cell) drops that cell
//   stale-keys  the current scenario sends other keys than the Record did (recalibrate with the new keys)
//   dropped     the current scenario no longer runs that language
//   unknown     no current scenario has that id
// Exit code 1 if any violation, else 0.
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sideCompositionOpen} from './judge.mjs';
import {expectedAfter, normalize} from './text.mjs';

const baseId = (scen) => String(scen).replace(/@([a-z]+)$/, '');

/** The keys the scenario sends now, in the Record's keysSent form (Android steps are JSON strings). */
function keysNow(sc, lang) {
  if (sc.keys) return sc.keys(lang);
  if (sc.steps) return sc.steps(lang).map((s) => JSON.stringify(s));
  return null;
}

/**
 * Control runs that ended with an open composition, each with a status (see the file header).
 * @param {any[]} records @param {any[]} scenarios
 * @returns {{file: string, cell: any, rep: number, status: string, controlText: string, wordFromOpen: boolean}[]}
 */
export function openControlRuns(records, scenarios) {
  const byId = new Map(scenarios.map((s) => [s.id, s]));
  const out = [];
  for (const r of records) {
    if (!r?.control || !r.cell || !sideCompositionOpen(r.control)) continue;
    const sc = byId.get(baseId(r.cell.scen));
    let status = 'violation';
    let wordFromOpen = false;
    if (!sc) {
      status = 'unknown';
    } else if (!sc.langs?.includes(r.cell.lang)) {
      status = 'dropped';
    } else if (sc.skip?.({...r.cell, scen: sc.id})) {
      status = 'skipped';
    } else if (JSON.stringify(keysNow(sc, r.cell.lang)) !== JSON.stringify(r.harness?.keysSent)) {
      status = 'stale-keys';
    }
    if (sc && status !== 'dropped') {
      // Does the current word equal the open preedit text? Then the word was calibrated from it.
      const exp = expectedAfter(r.control.before, sc.word(r.cell.lang, r.cell));
      wordFromOpen = normalize(exp) === normalize(r.control.after.text);
    }
    out.push({file: r._file ?? '?', cell: r.cell, rep: r.rep, status, controlText: r.control.after.text, wordFromOpen});
  }
  return out;
}

function jsonFiles(dir) {
  const out = [];
  for (const f of readdirSync(dir).sort()) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...jsonFiles(p));
    else if (f.endsWith('.json')) out.push(p);
  }
  return out;
}

async function main() {
  const dirs = process.argv.slice(2);
  if (!dirs.length) {
    console.error('usage: node harness/core/calibcheck.mjs <records-dir>...');
    process.exit(2);
  }
  const {allScenarios} = await import('../scenarios/index.mjs');
  const records = [];
  for (const d of dirs) {
    for (const p of jsonFiles(d)) {
      try {
        const x = JSON.parse(readFileSync(p, 'utf8'));
        if (x && x.control) records.push({...x, _file: p});
      } catch { /* not a Record */ }
    }
  }
  const open = openControlRuns(records, allScenarios());
  const c = (x) => `${x.cell.scen}|${x.cell.lang}|${x.cell.os}|${x.cell.ime}|${x.cell.browser}`;
  for (const x of open) {
    console.log(`${x.status}\t${c(x)}\tr${x.rep}\tcontrol ${JSON.stringify(x.controlText)}${x.wordFromOpen ? '\tword = open preedit' : ''}`);
  }
  const n = (s) => open.filter((x) => x.status === s).length;
  console.log(`${records.length} control Records, ${open.length} with an open composition: violation ${n('violation')}, `
    + `skipped ${n('skipped')}, stale-keys ${n('stale-keys')}, dropped ${n('dropped')}, unknown ${n('unknown')}`);
  process.exit(n('violation') ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
