import {SCENARIOS as matrix} from './matrix.mjs';
import {SCENARIOS as android} from './android.mjs';

const BY_GROUP = {matrix, android};

/** @param {string} group @returns {any[]} */
export function scenariosFor(group) {
  return BY_GROUP[group] ?? [];
}

/** Every scenario of every group that exists. @returns {any[]} */
export function allScenarios() {
  return Object.values(BY_GROUP).flat();
}
