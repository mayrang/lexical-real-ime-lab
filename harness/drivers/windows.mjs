// Windows OsAdapter: real SendInput keys and clicks plus keyboard layout and IME mode selection through the
// small C# tool harness/native/winkeys.cs (build: csc /nologo /out:harness/native/winkeys.exe harness/native/winkeys.cs).
// Runs natively on the runner (an interactive session), browsers headed. The workflow adds ko-KR and ja-JP
// with Set-WinUserLanguageList. Chinese is out of scope on Windows (the job passes --langs ko,ja).
//
// Lessons from the spike (spike-win.mjs on the windows branch, 48/48 Korean on windows-2022/2025):
// - Find the browser window by a unique document.title token and activate it before each winkeys call.
// - Bounce the layout through en-US (00000409) before selecting the IME layout. A window that starts on the
//   target layout kept a broken IME state (Firefox + Japanese).
// - Set the IME mode (Hangul / Hiragana) after the layout, and again before the keys.
// - Real OS click via SendInput. Playwright focus is fake.
import {spawnSync, execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {release} from 'node:os';
import {fileURLToPath} from 'node:url';
import {isToken} from '../scenarios/vocab.mjs';

const WINKEYS = process.env.WINKEYS ?? fileURLToPath(new URL('../native/winkeys.exe', import.meta.url));

// Keyboard layout IDs (KLID) and the winkeys mode switch per language (copied from spike-win.mjs CFG).
export const LATIN = '00000409';
export const LAYOUT = {ko: '00000412', ja: '00000411'};
export const MODE = {ko: '--hangul', ja: '--imeon'};

// Warm-up keys per IME (spike-win.mjs CFG.warm). Each one ends with an empty field.
export const WARM = {
  ko: ['g', 'k', 'SP', 'BS', 'BS', 'BS'],
  ja: ['k', 'a', 'RET', 'BS'],
};

// IME DLL folders whose file versions go into env.imeVersion.
const IME_DIR = {ko: 'IMEKR', ja: 'IMEJP'};

/** Harness tokens go to winkeys as they are (winkeys knows MOD+ = Ctrl and the symbol tokens). @param {string[]} tokens */
export function toWinkeys(tokens) {
  for (const t of tokens) if (!isToken(t)) throw new Error(`windows: unknown key token ${t}`);
  return [...tokens];
}

/** IME identity: layout KLID and mode, e.g. "00000412+hangul". */
export function imeOf(lang) {
  return LAYOUT[lang] ? `${LAYOUT[lang]}+${MODE[lang].slice(2)}` : 'unknown';
}

/** Image identity: runner image and Windows build. */
export function imageId(env = process.env, build = winBuild()) {
  return `runner=${env.ImageOS ?? 'unknown'} ${env.ImageVersion ?? 'unknown'}; Windows ${build}`;
}

let buildCache = null;
/** Windows build with the update revision, e.g. 10.0.26100.4349. */
export function winBuild() {
  if (buildCache) return buildCache;
  let ubr = '';
  try {
    const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion', '/v', 'UBR'],
      {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']});
    const m = /UBR\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(out);
    if (m) ubr = `.${parseInt(m[1], 16)}`;
  } catch { /* reg missing outside Windows */ }
  buildCache = `${release()}${ubr}`;
  return buildCache;
}

const imeVersionCache = new Map();
/** Best effort: file versions of the IME DLLs, plus the Windows build. */
export function imeVersionOf(lang) {
  if (imeVersionCache.has(lang)) return imeVersionCache.get(lang);
  let files = 'unknown';
  if (IME_DIR[lang]) {
    try {
      const ps = `Get-ChildItem "$env:WINDIR\\System32\\IME\\${IME_DIR[lang]}" -Filter *.dll | Select-Object -First 3 | ` +
        `ForEach-Object { $_.Name + '=' + $_.VersionInfo.FileVersion }`;
      const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000});
      files = out.trim().split(/\r?\n/).filter(Boolean).join(' ') || 'unknown';
    } catch { /* powershell missing outside Windows */ }
  }
  const v = `${files}; Windows ${winBuild()}`;
  imeVersionCache.set(lang, v);
  return v;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function winkeys(args) {
  const r = spawnSync(WINKEYS, args, {encoding: 'utf8'});
  if (process.env.WINKEYS_LOG) {
    try {
      appendFileSync(process.env.WINKEYS_LOG, `$ winkeys ${args.join(' ')} -> ${r.status}\n${r.stderr ?? ''}${r.error ? r.error.message + '\n' : ''}`);
    } catch { /* logging only */ }
  }
  if (r.error) throw new Error(`windows: winkeys: ${r.error.message}`);
  if (r.status !== 0) {
    const last = String(r.stderr ?? '').trim().split('\n').slice(-2).join(' / ');
    throw new Error(`windows: winkeys exit ${r.status}: ${last}`);
  }
  return r.stderr;
}

// Page-side probe: a screen point on the first line of the element, the focus state, and where the last
// trusted mousedown landed (to correct the window frame offset).
const PROBE = ([s, cx, cy]) => {
  const el = document.querySelector(s);
  const r = el.getBoundingClientRect();
  // First point on the first line that is the element itself, not an overlay
  // (the playground's drag handle covers left+20 when the pointer hovers there).
  const y = r.top + 15;
  const xs = [r.left + 20, r.left + r.width / 2, r.right - 20];
  const x = xs.find((px) => el.contains(document.elementFromPoint(px, y))) ?? xs[1];
  const desc = (n) => (n ? `${n.tagName}${n.className && typeof n.className === 'string' ? '.' + n.className.split(' ')[0] : ''}` : 'null');
  // Windows frames have invisible resize borders: the side width is also at the bottom (spike-win.mjs).
  const side = (outerWidth - innerWidth) / 2;
  const top = outerHeight - innerHeight - side;
  const dpr = devicePixelRatio || 1;
  return {
    x, y,
    sx: Math.round((screenX + side + x) * dpr + cx), sy: Math.round((screenY + top + y) * dpr + cy),
    focused: el === document.activeElement || el.contains(document.activeElement),
    hasFocus: document.hasFocus(), active: desc(document.activeElement), hit: desc(document.elementFromPoint(x, y)),
    down: window.__imelabDown ?? null, dpr,
  };
};

const TRACK_DOWN = () => {
  window.__imelabDown = null;
  if (window.__imelabDownInstalled) return;
  window.__imelabDownInstalled = true;
  document.addEventListener('mousedown', (e) => { if (e.isTrusted) window.__imelabDown = {x: e.clientX, y: e.clientY}; }, true);
};

export function windowsAdapter() {
  /** @type {{browser: any, title: string, corr: {x: number, y: number}} | null} */
  let live = null;
  let lang = null;
  let seq = 0;
  const running = () => live !== null && live.browser.isConnected();

  /** Real click until the window and the element have focus. */
  async function click(page, sel) {
    let g = null;
    let err = '';
    // Blur first, so the real click gives a real focus change (the playground autofocuses the editor on load).
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    for (let i = 0; i < 4; i++) {
      await page.evaluate(TRACK_DOWN);
      g = await page.evaluate(PROBE, [sel, live.corr.x, live.corr.y]);
      let clicked = false;
      try {
        winkeys(['--activate', live.title, `CLICK:${g.sx},${g.sy}`]);
        clicked = true;
      } catch (e) {
        err = String(e.message).split('\n')[0];
      }
      await sleep(150 + 300 * i);
      g = await page.evaluate(PROBE, [sel, live.corr.x, live.corr.y]);
      if (clicked && g.hasFocus && g.focused) return;
      // The click landed somewhere else in the page: shift the next one by the measured offset.
      if (g.down) {
        live.corr.x += Math.round((g.x - g.down.x) * g.dpr);
        live.corr.y += Math.round((g.y - g.down.y) * g.dpr);
      }
    }
    throw new Error(`windows: click did not focus ${sel}: ${err ? err + ' ' : ''}hasFocus=${g.hasFocus} active=${g.active} hit=${g.hit} ` +
      `at ${g.sx},${g.sy} down=${JSON.stringify(g.down)} corr=${live.corr.x},${live.corr.y}`);
  }

  // Once per browser launch: select the IME on the window (layout bounce, then mode) and warm it up
  // in a temporary field on the test page, removed afterwards.
  async function prepare(page) {
    winkeys(['--activate', live.title, '--layout', LATIN, '--layout', LAYOUT[lang], MODE[lang]]);
    const html = '<div id="__warm" contenteditable="true" style="position:fixed;left:40px;top:40px;width:400px;height:80px;' +
      'z-index:2147483647;background:#fff;border:1px solid #888"></div>';
    await page.evaluate((h) => document.body.insertAdjacentHTML('beforeend', h), html);
    try {
      await click(page, '#__warm');
      winkeys(['--activate', live.title, MODE[lang], '--delay', '150', ...WARM[lang]]);
      await sleep(300);
    } finally {
      await page.evaluate(() => document.getElementById('__warm')?.remove());
    }
  }

  return {
    name: 'windows',
    async env(l) {
      return {image: imageId(), ime: imeOf(l), imeVersion: imeVersionOf(l)};
    },
    async selectIme(l) {
      if (!LAYOUT[l]) throw new Error(`windows: no keyboard layout for ${l}`);
      lang = l;
      // Before launch there is no window yet: prepare() selects the IME on the first click.
      // Before the keys: set the mode again on the running window (spike-win.mjs did the same).
      if (running()) winkeys(['--activate', live.title, MODE[l]]);
    },
    // No switch for setup: Playwright's synthetic keys bypass the OS IME, and a layout switch after the
    // click would move the input context away from the state the click bound (macOS lesson).
    async selectLatin() {},
    async click(page, sel) {
      const browser = page.context().browser();
      if (!live || live.browser !== browser) {
        const title = `IMELAB${process.pid}x${++seq}`;
        live = {browser, title, corr: {x: 0, y: 0}};
        await page.evaluate((t) => { document.title = t; }, title);
        if (lang) await prepare(page);
      }
      await click(page, sel);
    },
    async sendKeys(tokens, delayMs) {
      winkeys(['--activate', live.title, '--delay', String(delayMs), ...toWinkeys(tokens)]);
    },
    launchOpts(browser) {
      const o = {headless: false};
      // Firefox ignores real OS focus changes unless test-mode focus is off.
      if (browser === 'firefox') o.firefoxUserPrefs = {'focusmanager.testmode': false};
      return o;
    },
  };
}

export default windowsAdapter();
