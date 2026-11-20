import {SCENARIOS as matrix} from './matrix.mjs';
import {SCENARIOS as android} from './android.mjs';
import {SCENARIOS as replay} from './replay.mjs';
import {SCENARIOS as audit} from './audit.mjs';

const BY_GROUP = {matrix, audit, android, replay};

/** @param {string} group @returns {any[]} */
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
 * Record label of a replay variant: the scenario id plus @parent, @fix or @main.
 * @param {string} id @param {string} [variant]
 */
export const variantId = (id, variant) => (variant ? `${id}@${variant}` : id);
