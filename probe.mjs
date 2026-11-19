// Probe how to switch input sources mid-session. usage: node probe.mjs <browser> <ime ko|zh|ja> <strategy>
// strategies: pre (select IME before launch), mid (launch with Latin, switch later), back (launch with IME, Latin, then IME again)
import {spawnSync} from 'node:child_process';
import {chromium, firefox, webkit} from 'playwright';
import {SRC} from './scenarios.mjs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const [bn, ime, strat] = process.argv.slice(2);
const OSK = new URL('./oskeys', import.meta.url).pathname;
const KEYS = {ko: ['g', 'k', 's'], zh: ['n', 'i'], ja: ['k', 'a']}[ime];
const run = (a, act = true) => { const r = spawnSync(OSK, [...(act ? ['--activate', `ms-playwright/${bn}`] : []), '--delay', '150', ...a], {encoding: 'utf8'}); return r.status + ' ' + r.stderr.split('\n').filter(l => /select|ABORT/.test(l)).join(';'); };
run([`SRC:${strat === 'mid' ? SRC.latin : SRC[ime]}`], false);
const b = await {chromium, firefox, webkit}[bn].launch({headless: false});
const p = await (await b.newContext({viewport: null})).newPage();
await p.goto('data:text/html,<div id=e contenteditable style="margin:40px;width:500px;height:200px;border:1px solid"></div>');
await p.evaluate(() => { window.L = []; for (const t of ['keydown', 'compositionstart', 'compositionend', 'beforeinput']) document.addEventListener(t, e => L.push(t[0] + ':' + (e.key || e.inputType || '') + ':' + (e.data || '')), true); });
const pt = await p.evaluate(() => { const r = e.getBoundingClientRect(); return {x: Math.round(screenX + (outerWidth - innerWidth) / 2 + r.x + 30), y: Math.round(screenY + outerHeight - innerHeight + r.y + 15)}; });
const log = [];
log.push(run([`CLICK:${pt.x},${pt.y}`]));
if (strat === 'back') log.push(run([`SRC:${SRC.latin}`, 'x', 'y']));
log.push(run([`SRC:${SRC[ime]}`, ...KEYS, 'WAIT:2000', ...KEYS]));
await sleep(800);
const text = await p.evaluate(() => e.textContent);
console.log('PROBE', JSON.stringify({bn, ime, strat, text, ev: (await p.evaluate(() => L)).join(' ').slice(0, 400), log}));
await b.close();
run([`SRC:${SRC.latin}`], false);
