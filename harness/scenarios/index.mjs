import {SCENARIOS as matrix} from './matrix.mjs';
import {SCENARIOS as android} from './android.mjs';
import {SCENARIOS as replay} from './replay.mjs';
import {SCENARIOS as audit} from './audit.mjs';

const BY_GROUP = {matrix, audit, android, replay};

/** The group names that exist. run.mjs refuses any other --group. */
export const GROUPS = Object.keys(BY_GROUP);

/** @param {string} group @returns {any[]} An unknown group gives []; callers that take user input check GROUPS. */
export function scenariosFor(group) {
  return BY_GROUP[group] ?? [];
}

/** Every scenario of every group that exists. @returns {any[]} */
export function allScenarios() {
  return Object.values(BY_GROUP).flat();
}

/**
 * Does the scenario run here? `only` lists the allowed values per field; a missing field allows all.
 * An unknown value (undefined) passes, so `only.ime` is checked only where the runner knows the IME.
 * @param {any} sc @param {{os?: string, browser?: string, ime?: string}} where
 */
export function runsOn(sc, where) {
  if (!sc.only) return true;
  return ['os', 'browser', 'ime'].every((k) => !sc.only[k] || where[k] === undefined || sc.only[k].includes(where[k]));
}

/**
 * Does the scenario run this cell? `skip(cell)` (optional) excludes single cells that `only` cannot express,
 * because `only` limits each field on its own. Skipped cells are not run, so the report never expects them.
 * @param {any} sc @param {{scen?: string, lang: string, os: string, browser: string, ime?: string}} cell
 */
export const runsCell = (sc, cell) => !sc.skip?.(cell);

/**
 * Record label of a replay variant: the scenario id plus @parent, @fix or @main.
 * @param {string} id @param {string} [variant]
 */
export const variantId = (id, variant) => (variant ? `${id}@${variant}` : id);

/**
 * The cells a run will write (planned) and the cells skip(cell) drops (skipped), for planned.json.
 * Replay scenarios (with `commits`) plan one cell per variant: parent, fix, main.
 * @param {any[]} scenarios already filtered by group, kind and `only`
 * @param {{os: string, browser: string, ime?: string, langs: string[]}} where
 */
export function planCells(scenarios, {os, browser, ime, langs}) {
  const out = {planned: [], skipped: []};
  for (const sc of scenarios) {
    for (const variant of sc.commits ? ['parent', 'fix', 'main'] : [null]) {
      for (const lang of langs.filter((l) => sc.langs.includes(l))) {
        const c = {scen: variantId(sc.id, variant), lang, os, browser, ime: ime ?? null};
        (runsCell(sc, {scen: sc.id, lang, os, browser, ime}) ? out.planned : out.skipped).push(c);
      }
    }
  }
  return out;
}
