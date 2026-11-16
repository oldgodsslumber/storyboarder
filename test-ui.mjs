/* test-ui.mjs — boots the built single file in headless Chrome and drives it.
 * usage: node test-ui.mjs
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find(p => { try { readFileSync(p); return true; } catch { return false; } });
if (!CHROME) { console.error('No Chrome/Edge found'); process.exit(2); }

let html = readFileSync(join(root, 'storyboarder.html'), 'utf8');
const scenario = readFileSync(join(root, 'ui-scenario.js'), 'utf8');
html = html.replace('<body>',
  '<body><script>window.__err=[];window.addEventListener("error",e=>window.__err.push(e.message));</script>');
// NB: pdf.js contains a "</body>" inside a string literal — inject at the real one.
const at = html.lastIndexOf('</body>');
html = html.slice(0, at) + '<script>\n' + scenario + '\n</script>' + html.slice(at);
const tmp = join(root, '_uitest_' + Date.now() + '.html');   // unique: file:// gets cached
writeFileSync(tmp, html, 'utf8');

/* The budget is how long the scenario gets, in virtual ms, before Chrome
   dumps whatever is on screen. It was 6000, which was plenty until the
   scenario grew a PDF section that renders every preset into an iframe and
   now a second document besides -- past that, the run stopped mid-way and
   reported "did not report", which reads like a crash and is not one.
   If this file ever says that again, try raising this before hunting. */
/* The budget is VIRTUAL ms and the virtual clock stops dead while a network
   request is in flight, so a single request to a host that is not on this
   machine does not slow the run down -- it stops it, silently, for ever. One
   left in the scenario sat here for fifteen hours. The scenario now refuses
   anything that tries to leave the machine, and this wall-clock ceiling is
   the backstop: whatever gets past that, the run ends and says so instead of
   becoming a Chrome nobody notices. */
const WALL_MS = 120000;
let dom;
try {
  dom = execFileSync(CHROME, [
    /* Raised from 20000 when the scenario grew the Getty drawer: the footage
       section alone waits out several placements, and a budget that runs out
       mid-scenario reports "did not report", which reads like a crash and is
       not one. */
    '--headless=new', '--disable-gpu', '--virtual-time-budget=40000',
    '--dump-dom', 'file:///' + tmp.replace(/\\/g, '/')
  ], {
    maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    timeout: WALL_MS, killSignal: 'SIGKILL'
  });
} catch (e) {
  try { unlinkSync(tmp); } catch { /* already gone */ }
  if (e && (e.code === 'ETIMEDOUT' || e.signal)) {
    console.error('Chrome ran past ' + (WALL_MS / 1000) + 's of wall clock and was killed.\n' +
      'The virtual clock had almost certainly stalled on a pending request.\n' +
      'Look for a URL in ui-scenario.js that is not on 127.0.0.1 -- the\n' +
      'scenario reports those itself as "went out to the network" when it\n' +
      'gets far enough to report at all.');
    process.exit(3);
  }
  throw e;
}

unlinkSync(tmp);

const m = dom.match(/RESULT&gt;&gt;([\s\S]*?)&lt;&lt;RESULT ERRORS:(.*?)<\//) ||
  dom.match(/RESULT>>([\s\S]*?)<<RESULT ERRORS:(.*?)<\//);
if (!m) {
  writeFileSync(join(root, '_dump.html'), dom, 'utf8');
  console.error('scenario did not report — see _dump.html');
  process.exit(1);
}

const lines = m[1].split(' | ').map(s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim());
let fail = 0;
for (const l of lines) { console.log('  ' + l); if (l.startsWith('FAIL')) fail++; }
const errs = m[2];
console.log('\n  page errors: ' + errs);
if (errs && errs !== '[]') fail++;
console.log('\n' + (lines.length - fail) + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);

