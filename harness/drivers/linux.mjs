// Linux OsAdapter: Xvfb + openbox + xdotool, IME = ibus or fcitx5 (in the Docker image of
// harness/native/linux). The container entry (harness/native/linux/env.sh) starts the display,
// dbus and the IME daemon, and exports IME_ENGINE.
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const IMSWITCH = fileURLToPath(new URL('../native/linux/imswitch.sh', import.meta.url));

const sh = (cmd, args) => execFileSync(cmd, args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();

// Engine packages whose versions go into env.imeVersion.
const PACKAGES = {
  ibus: ['ibus', 'ibus-hangul', 'ibus-mozc', 'ibus-libpinyin'],
  fcitx5: ['fcitx5', 'fcitx5-hangul', 'fcitx5-mozc', 'fcitx5-chinese-addons'],
};

const NAMED = {
  SP: 'space', RET: 'Return', BS: 'BackSpace', ESC: 'Escape', TAB: 'Tab',
  LEFT: 'Left', RIGHT: 'Right', UP: 'Up', DOWN: 'Down',
  ASTERISK: 'asterisk', HASH: 'numbersign', MINUS: 'minus',
};

/** One harness token (see scenarios/vocab.mjs) to one xdotool key name. @param {string} t */
export function toKeysym(t) {
  const m = /^(MOD|SHIFT)\+(.+)$/.exec(t);
  if (m) return `${m[1] === 'MOD' ? 'ctrl' : 'shift'}+${toKeysym(m[2])}`;
  if (/^[a-z0-9]$/.test(t)) return t;
  if (NAMED[t]) return NAMED[t];
  throw new Error(`linux: unknown key token ${t}`);
}

/** Split tokens into xdotool key batches and waits. @param {string[]} tokens */
export function keyPlan(tokens) {
  const plan = [];
  let batch = [];
  for (const t of tokens) {
    const w = /^WAIT:(\d+)$/.exec(t);
    if (w) {
      if (batch.length) plan.push({keys: batch});
      batch = [];
      plan.push({wait: Number(w[1])});
    } else {
      batch.push(toKeysym(t));
    }
  }
  if (batch.length) plan.push({keys: batch});
  return plan;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @param {'ibus'|'fcitx5'} engine */
export function linuxAdapter(engine) {
  if (!PACKAGES[engine]) throw new Error(`linux: unknown engine ${engine}`);
  const imswitch = (lang) => sh(IMSWITCH, [lang]);
  return {
    name: 'linux',
    async env() {
      let imeVersion = 'unknown';
      try {
        imeVersion = sh('dpkg-query', ['-W', '-f', '${Package}=${Version} ', ...PACKAGES[engine]]);
      } catch { /* dpkg-query missing outside the image */ }
      return {image: process.env.HARNESS_IMAGE ?? 'unknown', ime: engine, imeVersion};
    },
    async selectIme(lang) { imswitch(lang); },
    async selectLatin() { imswitch('en'); },
    async click(page, sel) {
      // Real X click: xdotool coordinates are relative to the browser's outer window.
      const g = await page.evaluate((s) => {
        const r = document.querySelector(s).getBoundingClientRect();
        return {dx: (outerWidth - innerWidth) / 2, dy: outerHeight - innerHeight, x: r.left + 20, y: r.top + 15};
      }, sel);
      const w = sh('xdotool', ['getactivewindow']);
      sh('xdotool', ['windowactivate', '--sync', w, 'mousemove', '--window', w,
        String(Math.round(g.dx + g.x)), String(Math.round(g.dy + g.y)), 'click', '1']);
    },
    async sendKeys(tokens, delayMs) {
      for (const step of keyPlan(tokens)) {
        if (step.wait !== undefined) await sleep(step.wait);
        else sh('xdotool', ['key', '--delay', String(delayMs), ...step.keys]);
      }
    },
    launchOpts(browser) {
      const o = {headless: false};
      // Firefox ignores real OS focus changes unless test-mode focus is off.
      if (browser === 'firefox') o.firefoxUserPrefs = {'focusmanager.testmode': false};
      return o;
    },
  };
}

export default linuxAdapter(/** @type {any} */ (process.env.IME_ENGINE ?? 'ibus'));
