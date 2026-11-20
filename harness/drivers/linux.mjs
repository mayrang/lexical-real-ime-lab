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
      // Sometimes the click does not focus the editor (run 44657614302: 2 of 1008 runs typed into
      // nothing; 44662606328: 4 of 1008, all on the playground). Measure again, retry, and on
      // failure say what was under the pointer.
      const probe = () => page.evaluate((s) => {
        const el = document.querySelector(s);
        const r = el.getBoundingClientRect();
        const x = r.left + 20;
        const y = r.top + 15;
        const desc = (n) => (n ? `${n.tagName}${n.className && typeof n.className === 'string' ? '.' + n.className.split(' ')[0] : ''}` : 'null');
        return {
          dx: (outerWidth - innerWidth) / 2, dy: outerHeight - innerHeight, x, y,
          focused: el === document.activeElement || el.contains(document.activeElement),
          hasFocus: document.hasFocus(), active: desc(document.activeElement), hit: desc(document.elementFromPoint(x, y)),
        };
      }, sel);
      let g = null;
      let win = '';
      for (let i = 0; i < 4; i++) {
        g = await probe();
        try {
          const w = sh('xdotool', ['getactivewindow']);
          win = sh('xdotool', ['getwindowname', w]);
          sh('xdotool', ['windowactivate', '--sync', w, 'mousemove', '--window', w,
            String(Math.round(g.dx + g.x)), String(Math.round(g.dy + g.y)), 'click', '1']);
        } catch (e) {
          win = `no active window (${String(e.message).split('\n')[0]})`;
        }
        await sleep(150 + 300 * i);
        g = await probe();
        if (g.focused) return;
      }
      throw new Error(`linux: click did not focus ${sel}: window=${JSON.stringify(win)} hasFocus=${g.hasFocus} active=${g.active} hit=${g.hit} at ${Math.round(g.x)},${Math.round(g.y)}`);
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
