// CLI: node harness/run.mjs --os <macos|linux|windows|android> --browser <b> --group <g> --langs ko,ja,zh
//        --reps 3 --lexical-url <u> --out <dir> [--control-url <u>] [--scen <id>]
//        [--playgrounds <dir>] [--main-playground <dir>] [--replay-port 3015]
// Writes <dir>/<scen>-<lang>-<browser>-r<n>.json for every cell and repetition.
// Android: browser is always chrome, scenarios with steps run; desktop: scenarios with keys run.
// The other kind is skipped, so one --group list serves every platform. Scenarios with `only` run only there,
// and a scenario's skip(cell) drops single cells (scenarios/index.mjs runsCell).
// Replay scenarios (with `commits`) run three times: on <playgrounds>/playground-<parent sha>, on
// <playgrounds>/playground-<fix sha> and on the main build (--main-playground). Each build is served in turn on
// --replay-port. The Record's cell.scen and the file name get the variant: <id>@parent, <id>@fix, <id>@main.
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {parseArgs} from 'node:util';
import {join} from 'node:path';
import {scenariosFor, runsOn, runsCell, variantId} from './scenarios/index.mjs';
import {runCell} from './drivers/desktop.mjs';
import {serve} from './serve.mjs';

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
    playgrounds: {type: 'string', default: 'playgrounds'},
    'main-playground': {type: 'string', default: 'playground'},
    'replay-port': {type: 'string', default: '3015'},
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
// The IME is known before a run only on Linux (engine) and Android (test IME).
const ime = isAndroid ? 'testime' : v.os === 'linux' ? process.env.IME_ENGINE : undefined;
const scenarios = scenariosFor(v.group)
  .filter((s) => !v.scen || s.id === v.scen)
  .filter((s) => (isAndroid ? s.steps : s.keys) !== undefined)
  .filter((s) => runsOn(s, {os: v.os, browser, ime}));
mkdirSync(v.out, {recursive: true});
const mainCommit = v['lexical-commit'] ?? process.env.LEXICAL_COMMIT ?? 'unknown';

/** Build mode the workflow wrote next to the build (harness-build.txt), for env.lexicalBuild. */
function buildOf(dir) {
  try {
    return readFileSync(join(dir, 'harness-build.txt'), 'utf8').trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Where one variant of a scenario runs: [{variant, lexicalUrl, lexicalCommit, dir}] (dir: build to serve). */
function variantsOf(sc) {
  if (!sc.commits) {
    return [{variant: null, lexicalUrl: v['lexical-url'], lexicalCommit: mainCommit, dir: null, build: buildOf(v['main-playground'])}];
  }
  const u = new URL(v['lexical-url']);
  u.port = v['replay-port'];
  return [['parent', sc.commits.parent], ['fix', sc.commits.fix], ['main', null]].map(([variant, sha]) => ({
    variant, lexicalUrl: u.href, lexicalCommit: sha ?? mainCommit,
    dir: sha ? join(v.playgrounds, `playground-${sha}`) : v['main-playground'],
  })).map((t) => ({...t, build: buildOf(t.dir)}));
}

for (const sc of scenarios) {
  for (const t of variantsOf(sc)) {
    const id = variantId(sc.id, t.variant);
    let server = null;
    let missing = null;
    if (t.dir) {
      if (existsSync(join(t.dir, 'index.html'))) server = await serve(t.dir, Number(v['replay-port']));
      else missing = `no playground build at ${t.dir}`;
    }
    try {
      const runLangs = langs.filter((l) => sc.langs.includes(l))
        .filter((lang) => runsCell(sc, {scen: sc.id, lang, os: v.os, browser, ime}));
      for (const lang of runLangs) {
        for (let rep = 1; rep <= Number(v.reps); rep++) {
          const o = {lang, browser, rep, lexicalUrl: t.lexicalUrl, controlUrl, lexicalCommit: t.lexicalCommit, lexicalBuild: t.build};
          // A missing build is a harness fault: the Record has only the cell, so the judge says inconclusive.
          const rec = missing
            ? {cell: {scen: id, lang, os: v.os, ime: ime ?? 'unknown', browser}, rep, harness: {fatal: missing}}
            : isAndroid ? await android.runAndroidCell(sc, o) : await runCell(adapter, sc, o);
          rec.cell.scen = id;
          const file = join(v.out, `${id}-${lang}-${browser}-r${rep}.json`);
          writeFileSync(file, JSON.stringify(rec, null, 1));
          console.log(`${file}${rec.harness.fatal ? ' FATAL ' + rec.harness.fatal : ''}${rec.harness.setupError ? ' SETUP ' + rec.harness.setupError : ''}`);
        }
      }
    } finally {
      if (server) {
        server.close();
        server.closeAllConnections();
      }
    }
  }
}
await android?.closeAndroid();
