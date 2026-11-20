// Platform-neutral key tokens. Each driver maps a token to its OS key event.
// a-z 0-9, SP RET BS ESC TAB LEFT RIGHT UP DOWN, MOD+<k> (Cmd on macOS, Ctrl elsewhere),
// SHIFT+<k>, WAIT:<ms>, and the symbols ASTERISK HASH MINUS.
// PROBE is not a key: the desktop runner takes a mid snapshot there (Record side.mid) and goes on.

export const WORD = {ko: '한국어', ja: '日本語', zh: '你好'};

// Keys that type each word through the real IME (Korean 2-set, Japanese romaji, Pinyin).
export const WORD_KEYS = {
  ko: 'g k s r n r d j',
  ja: 'n i h o n g o SP RET',
  zh: 'n i h a o SP',
};
// Default key order: Korean gets a trailing space. Japanese and Chinese already commit.
export const DEF_KEYS = {ko: `${WORD_KEYS.ko} SP`, ja: WORD_KEYS.ja, zh: WORD_KEYS.zh};

export const NAMED = ['SP', 'RET', 'BS', 'ESC', 'TAB', 'LEFT', 'RIGHT', 'UP', 'DOWN', 'ASTERISK', 'HASH', 'MINUS'];

const isBase = (t) => /^[a-z0-9]$/.test(t) || NAMED.includes(t);

/** @param {string} t @returns {boolean} */
export function isToken(t) {
  if (typeof t !== 'string') return false;
  if (isBase(t)) return true;
  if (/^WAIT:\d+$/.test(t) || t === 'PROBE') return true;
  const m = /^(MOD|SHIFT)\+(.+)$/.exec(t);
  return m !== null && isBase(m[2]);
}

/** Split a space-separated token string into an array. @param {string} s @returns {string[]} */
export const toks = (s) => s.split(' ').filter(Boolean);
