// CLI: node harness/run.mjs --os <macos|linux|windows|android> --browser <b> --group <g> --langs ko,ja,zh
//        --reps 3 --lexical-url <u> --out <dir> [--control-url <u>] [--scen <id>]
// Writes <dir>/<scen>-<lang>-<browser>-r<n>.json for every cell and repetition.
// Android: browser is always chrome, scenarios with steps run; desktop: scenarios with keys run.
// The other kind is skipped, so one --group list serves every platform.
import {mkdirSync, writeFileSync} from 'node:fs';
import {parseArgs} from 'node:util';
import {join} from 'node:path';
import {scenariosFor} from './scenarios/index.mjs';
import {runCell} from './drivers/desktop.mjs';

const {values: v} = parseArgs({
  options: {
    os: {type: 'string'},
    browser: {type: 'string'},
    group: {type: 'string', default: 'matrix'},
    langs: {type: 'string', default: 'ko,ja,zh'},
    reps: {type: 'string', default: '3'},
    'lexical-url': {type: 'string'},
    'control-url': {type: 'string'},
    'lexical-commit': {type: 'string'},
    scen: {type: 'string'},
    out: {type: 'string', default: 'out'},
  },
});

if (!['macos', 'linux', 'windows', 'android'].includes(v.os) || !v['lexical-url']) {
  console.error('usage: node harness/run.mjs --os <macos|linux|windows|android> --lexical-url <url> [--browser b] [--group g] [--langs ko,ja,zh] [--reps 3] [--lexical-commit sha] [--scen id] [--out dir]');
  process.exit(2);
}

const isAndroid = v.os === 'android';
const browser = isAndroid ? 'chrome' : (v.browser ?? 'chromium');
const controlUrl = v['control-url']
  ?? (isAndroid ? 'http://127.0.0.1:3014/control.html' : new URL('./page/control.html', import.meta.url).href);
const android = isAndroid ? await import('./drivers/android.mjs') : null;
const adapter = isAndroid ? null : (await import(`./drivers/${v.os}.mjs`)).default;
const langs = v.langs.split(',');
const scenarios = scenariosFor(v.group)
  .filter((s) => !v.scen || s.id === v.scen)
  .filter((s) => (isAndroid ? s.steps : s.keys) !== undefined);
mkdirSync(v.out, {recursive: true});

for (const sc of scenarios) {
  for (const lang of langs.filter((l) => sc.langs.includes(l))) {
    for (let rep = 1; rep <= Number(v.reps); rep++) {
      const o = {
        lang, browser, rep, lexicalUrl: v['lexical-url'], controlUrl,
        lexicalCommit: v['lexical-commit'] ?? process.env.LEXICAL_COMMIT ?? 'unknown',
      };
      const rec = isAndroid ? await android.runAndroidCell(sc, o) : await runCell(adapter, sc, o);
      const file = join(v.out, `${sc.id}-${lang}-${browser}-r${rep}.json`);
      writeFileSync(file, JSON.stringify(rec, null, 1));
      console.log(`${file}${rec.harness.fatal ? ' FATAL ' + rec.harness.fatal : ''}${rec.harness.setupError ? ' SETUP ' + rec.harness.setupError : ''}`);
    }
  }
}
await android?.closeAndroid();
