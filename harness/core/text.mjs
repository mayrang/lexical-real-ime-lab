// Text comparison rules for the IME harness.
// Only Unicode NFC is applied. Whitespace, NBSP, and U+200B are kept as-is.

/**
 * Apply Unicode NFC normalization only.
 * @param {string} s
 * @returns {string}
 */
export function normalize(s) {
  return s.normalize('NFC');
}

/**
 * Join paragraph blocks with a single newline after normalizing each block.
 * @param {string[]} blocks
 * @returns {string}
 */
export function flatten(blocks) {
  return blocks.map(normalize).join('\n');
}

/**
 * Compute the text expected after replacing the selection with a word.
 * @param {{text: string, selStart: number, selEnd: number}} before
 * @param {string} word
 * @returns {string}
 */
export function expectedAfter(before, word) {
  return before.text.slice(0, before.selStart) + word + before.text.slice(before.selEnd);
}

/**
 * Find the first differing code unit between two strings, for reports.
 * @param {string} a
 * @param {string} b
 * @returns {{at: number, a: string, b: string} | null}
 */
export function firstDiff(a, b) {
  const max = Math.max(a.length, b.length);
  for (let at = 0; at < max; at++) {
    if (a[at] !== b[at]) {
      return { at, a: a[at] ?? '', b: b[at] ?? '' };
    }
  }
  return null;
}
