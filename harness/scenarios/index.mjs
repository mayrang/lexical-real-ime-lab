import {SCENARIOS as matrix} from './matrix.mjs';

const BY_GROUP = {matrix};

/** @param {string} group @returns {any[]} */
export function scenariosFor(group) {
  return BY_GROUP[group] ?? [];
}

/** Every scenario of every group that exists. @returns {any[]} */
export function allScenarios() {
  return Object.values(BY_GROUP).flat();
}
