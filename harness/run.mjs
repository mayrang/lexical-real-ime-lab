// CLI: node harness/run.mjs --os <macos|linux|windows> --browser <b> --group <g> --langs ko,ja,zh
//        --reps 3 --lexical-url <u> --out <dir> [--control-url <u>] [--scen <id>]
// Writes <dir>/<scen>-<lang>-<browser>-r<n>.json for every cell and repetition.
import {mkdirSync, writeFileSync} from 'node:fs';
import {parseArgs} from 'node:util';
import {join} from 'node:path';
import {scenariosFor} from './scenarios/index.mjs';
import {runCell} from './drivers/desktop.mjs';

const {values: v} = parseArgs({
  options: {
    os: {type: 'string'},
    browser: {type: 'string', default: 'chromium'},
    group: {type: 'string', default: 'matrix'},
    langs: {type: 'string', default: 'ko,ja,zh'},
    reps: {type: 'string', default: '3'},
    'lexical-url': {type: 'string'},
    'control-url': {type: 'string', default: new URL('./page/control.html', import.meta.url).href},
    scen: {type: 'string'},
    out: {type: 'string', default: 'out'},
  },
});

if (!['macos', 'linux', 'windows'].includes(v.os) || !v['lexical-url']) {
  console.error('usage: node harness/run.mjs --os <macos|linux|windows> --lexical-url <url> [--browser b] [--group g] [--langs ko,ja,zh] [--reps 3] [--scen id] [--out dir]');
  process.exit(2);
}

const adapter = (await import(`./drivers/${v.os}.mjs`)).default;
const langs = v.langs.split(',');
const scenarios = scenariosFor(v.group).filter((s) => !v.scen || s.id === v.scen);
mkdirSync(v.out, {recursive: true});

for (const sc of scenarios) {
  for (const lang of langs.filter((l) => sc.langs.includes(l))) {
    for (let rep = 1; rep <= Number(v.reps); rep++) {
      const rec = await runCell(adapter, sc, {
        lang, browser: v.browser, rep, lexicalUrl: v['lexical-url'], controlUrl: v['control-url'],
      });
      const file = join(v.out, `${sc.id}-${lang}-${v.browser}-r${rep}.json`);
      writeFileSync(file, JSON.stringify(rec, null, 1));
      console.log(`${file}${rec.harness.fatal ? ' FATAL ' + rec.harness.fatal : ''}${rec.harness.setupError ? ' SETUP ' + rec.harness.setupError : ''}`);
    }
  }
}
