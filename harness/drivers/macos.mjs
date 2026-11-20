// macOS OsAdapter: real CGEvent keys and clicks plus TIS input source selection through the
// small Swift tool harness/native/oskeys.swift (build: swiftc -O harness/native/oskeys.swift -o harness/native/oskeys).
// Runs natively on the runner, browsers headed. The process needs Accessibility trust
// (already true on GitHub macOS runners).
//
// Lessons from the spike (run.mjs / scenarios.mjs at the repo root):
// - The input context binds at focus: select the IME source before the browser launches and before the click.
//   The spike switched away and back; here the IME stays selected (see selectLatin).
// - The first syllable after a browser launch can break: warm the IME up once per browser launch.
// - Playwright focus is fake: use a real OS click, with the browser frontmost.
import {spawnSync, execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {isToken, isRunnerToken} from '../scenarios/vocab.mjs';

const OSKEYS = process.env.OSKEYS ?? fileURLToPath(new URL('../native/oskeys', import.meta.url));

// Input source IDs (copied from the spike's scenarios.mjs SRC).
export const SRC = {
  latin: 'com.apple.keylayout.US',
  ko: 'com.apple.inputmethod.Korean.2SetKorean',
  ja: 'com.apple.inputmethod.Kotoeri.RomajiTyping.Japanese',
  zh: 'com.apple.inputmethod.SCIM.ITABC',
};

// Warm-up keys per IME (the spike's WARM without the SRC token). Each one ends with an empty field.
export const WARM = {
  ko: ['g', 'k', 'SP', 'BS', 'BS', 'BS'],
  ja: ['a', 'RET', 'BS', 'BS'],
  zh: ['n', 'i', 'SP', 'BS', 'BS'],
};

/** Path substring of the running browser app, for oskeys --activate. */
export const appOf = (browser) => `ms-playwright/${browser}`;

/** Harness tokens go to oskeys as they are (oskeys knows MOD+ = Cmd and the symbol tokens). @param {string[]} tokens */
export function toOskeys(tokens) {
  for (const t of tokens) if (!isToken(t) || isRunnerToken(t)) throw new Error(`macos: unknown key token ${t}`);
  return [...tokens];
}

/** Image identity: runner image and macOS version. */
export function imageId(env = process.env, sw = swVers()) {
  return `runner=${env.ImageOS ?? 'unknown'} ${env.ImageVersion ?? 'unknown'}; macOS ${sw.version} (${sw.build})`;
}

function swVers() {
  const q = (k) => {
    try {
      return execFileSync('sw_vers', [k], {encoding: 'utf8'}).trim();
    } catch {
      return 'unknown';
    }
  };
  return {version: q('-productVersion'), build: q('-buildVersion')};
}

/** Kotoeri live conversion as read back from the user defaults ('0', '1', or 'unset'). */
export function readLiveConversion() {
  try {
    return execFileSync('defaults', ['read', 'com.apple.inputmethod.Kotoeri', 'JIMPrefLiveConversionKey'],
      {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
  } catch {
    return 'unset';
  }
}

/** IME identity: macOS build, and for Japanese the live conversion setting (the workflow turns it off). */
export function imeVersionOf(lang, sw, liveConversion = readLiveConversion) {
  const base = `macOS ${sw.version} (${sw.build})`;
  return lang === 'ja' ? `${base}; liveConversion=${liveConversion()}` : base;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function oskeys(args) {
  const r = spawnSync(OSKEYS, args, {encoding: 'utf8'});
  if (process.env.OSKEYS_LOG) {
    try {
      appendFileSync(process.env.OSKEYS_LOG, `$ oskeys ${args.join(' ')} -> ${r.status}\n${r.stderr ?? ''}${r.error ? r.error.message + '\n' : ''}`);
    } catch { /* logging only */ }
  }
  if (r.error) throw new Error(`macos: oskeys: ${r.error.message}`);
  if (r.status !== 0) {
    const last = String(r.stderr ?? '').trim().split('\n').slice(-2).join(' / ');
    throw new Error(`macos: oskeys exit ${r.status}: ${last}`);
  }
  return r.stderr;
}

// Page-side probe: a screen point on the first line of the element and the focus state.
const PROBE = (s) => {
  const el = document.querySelector(s);
  const r = el.getBoundingClientRect();
  // First point on the first line that is the element itself, not an overlay
  // (the playground's drag handle covers left+20 when the pointer hovers there).
  const y = r.top + 15;
  const xs = [r.left + 20, r.left + r.width / 2, r.right - 20];
  const x = xs.find((cx) => el.contains(document.elementFromPoint(cx, y))) ?? xs[1];
  const desc = (n) => (n ? `${n.tagName}${n.className && typeof n.className === 'string' ? '.' + n.className.split(' ')[0] : ''}` : 'null');
  const side = (outerWidth - innerWidth) / 2;
  const top = outerHeight - innerHeight;
  return {
    sx: Math.round(screenX + side + x), sy: Math.round(screenY + top + y),
    // The element has focus, or sits inside the focused editor (a block clicked by CLICK:<text>).
    focused: el === document.activeElement || el.contains(document.activeElement)
      || (document.activeElement?.isContentEditable === true && document.activeElement.contains(el)),
    hasFocus: document.hasFocus(), active: desc(document.activeElement), hit: desc(document.elementFromPoint(x, y)),
  };
};

export function macosAdapter() {
  /** @type {{browser: any, app: string} | null} */
  let live = null;
  let nextApp = null;
  let lang = null;
  const warmed = new WeakSet();
  const primed = new Set();
  const running = () => live !== null && live.browser.isConnected();

  // Select a source. With the browser running, re-activate it so it picks up the new source.
  let current = null;
  const select = (id) => {
    if (running()) {
      if (id !== current) oskeys(['--activate', live.app, `SRC:${id}`]);
    } else {
      oskeys(['--source', id]);
    }
    current = id;
  };

  /** Real click until the window and the element have focus. */
  // keepFocus (CLICK:<text> during the keys): no blur and no bringToFront, which would end the composition
  // through a path other than the click itself.
  async function click(page, sel, app, keepFocus = false) {
    let g = null;
    let err = '';
    // Blur first, so the real click gives a real focus change. The playground autofocuses the editor on load,
    // and Firefox then sent no keys to the IME (run 44678216410: Lexical got plain "nihongo").
    if (!keepFocus) await page.evaluate(() => document.activeElement && document.activeElement.blur());
    for (let i = 0; i < 4; i++) {
      if (!keepFocus) await page.bringToFront();
      g = await page.evaluate(PROBE, sel);
      let clicked = false;
      try {
        oskeys(['--activate', app, `CLICK:${g.sx},${g.sy}`]);
        clicked = true;
      } catch (e) {
        err = String(e.message).split('\n')[0];
      }
      await sleep(150 + 300 * i);
      g = await page.evaluate(PROBE, sel);
      if (clicked && g.hasFocus && g.focused) return;
    }
    throw new Error(`macos: click did not focus ${sel}: ${err ? err + ' ' : ''}hasFocus=${g.hasFocus} active=${g.active} hit=${g.hit} at ${g.sx},${g.sy}`);
  }

  // Warm the IME up once per browser launch, in a field that is not the test editor.
  // Chromium and WebKit: a separate page. Firefox: a temporary field on the test page, removed afterwards,
  // because after the warm-up page closed Firefox sometimes sent no keys at all to the IME on the control page
  // (run 44683031598: 5 of 28 ko controls "ㅎㅏㄴㄱㅜㄱㅇㅓ", zh "nihao").
  async function warm(page, app) {
    const inPage = app === appOf('firefox');
    const w = inPage ? page : await page.context().newPage();
    try {
      const html = '<div id="__warm" contenteditable="true" style="position:fixed;left:40px;top:40px;width:400px;height:80px;' +
        'z-index:2147483647;background:#fff;border:1px solid #888"></div>';
      if (inPage) await w.evaluate((h) => document.body.insertAdjacentHTML('beforeend', h), html);
      else await w.setContent(html);
      await click(w, '#__warm', app);
      // The first warm-up of an IME in the job is not enough on Firefox (runs 44681890993, 44681894248:
      // only the very first ko control broke, "ㅎㅏㄴ국어"). Type the warm-up keys twice the first time.
      const keys = primed.has(lang) ? WARM[lang] : [...WARM[lang], 'WAIT:300', ...WARM[lang]];
      primed.add(lang);
      oskeys(['--activate', app, '--delay', '150', `SRC:${SRC[lang]}`, ...keys]);
      await sleep(300);
    } finally {
      if (inPage) await w.evaluate(() => document.getElementById('__warm')?.remove());
      else await w.close();
    }
  }


  return {
    name: 'macos',
    async env(l) {
      const ime = l && SRC[l] ? SRC[l] : 'unknown';
      const sw = swVers();
      return {image: imageId(process.env, sw), ime, imeVersion: imeVersionOf(l, sw)};
    },
    async selectIme(l) {
      if (!SRC[l]) throw new Error(`macos: no input source for ${l}`);
      lang = l;
      select(SRC[l]);
      // Firefox: after Playwright's synthetic setup keys, the first real key skipped the IME
      // (run 44679794212: "abc nいほンゴ", "ㅎㅏㄴ국어"). Send one real key that types nothing (F13) first.
      // This happens before runCell clears the event log. A window refocus made it worse (run 44680627804:
      // Lexical then got no IME at all), so the focus stays put.
      if (running() && live.app === appOf('firefox')) {
        oskeys(['--activate', live.app, 'F13']);
        await sleep(300);
      }
    },
    // No switch for setup: Playwright's synthetic keys bypass the OS IME, and on Firefox the switch back to
    // the IME after focus did not reach the editor (run 44678216410: Lexical got plain "nihongo").
    // The IME selected before launch stays selected from the click to the keys.
    async selectLatin() {},
    async click(page, sel, opts = {}) {
      if (opts.keepFocus) return click(page, sel, live.app, true);
      const browser = page.context().browser();
      if (!live || live.browser !== browser) live = {browser, app: nextApp};
      if (!warmed.has(browser) && lang) {
        warmed.add(browser);
        await warm(page, live.app);
        // The source is still the IME: the click below binds the editor's input context to it.
      }
      await click(page, sel, live.app);
    },
    async sendKeys(tokens, delayMs) {
      oskeys(['--activate', live.app, '--delay', String(delayMs), ...toOskeys(tokens)]);
    },
    launchOpts(browser) {
      nextApp = appOf(browser);
      const o = {headless: false};
      // Firefox ignores real OS focus changes unless test-mode focus is off.
      if (browser === 'firefox') o.firefoxUserPrefs = {'focusmanager.testmode': false};
      return o;
    },
  };
}

export default macosAdapter();
