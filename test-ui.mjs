/* test-ui.mjs — boots the built single file in headless Chrome and drives it.
 * usage: node test-ui.mjs
 *
 * This used to load the page from file:// with --virtual-time-budget and
 * --dump-dom. That was quick and it was quietly unsound. Virtual time does not
 * just run the clock fast: it STOPS the clock while any load is in flight. One
 * request that does not settle therefore does not fail the suite and does not
 * slow it down -- it hangs it, with no output, indefinitely. A run of it sat
 * here for fifteen hours. Worse, whether a given run hung was a race between
 * the stalling load and the scenario's last assertions, so the suite passed
 * five times out of eight and looked merely slow the rest of the time. Chasing
 * the loads one at a time (an <img> pointed at Getty, then a srcdoc document
 * pulling three CDNs) fixed instances and not the class.
 *
 * So the clock is real now. The page is served over http://127.0.0.1 on an
 * ephemeral port, Chrome runs with no virtual time, and the page POSTs its
 * result back same-origin -- which needs no CORS and no file:// privileges,
 * and has none of a URL's length limit. A load that never settles now costs
 * what it actually costs and the suite still finishes.
 *
 * Two things fall out of it that are worth keeping. The page reports progress
 * as it goes, so a hang names the last assertion that passed instead of
 * printing nothing. And each run gets a fresh origin, so localStorage no
 * longer leaks between runs the way it did on file://.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find(p => { try { readFileSync(p); return true; } catch { return false; } });
if (!CHROME) { console.error('No Chrome/Edge found'); process.exit(2); }

/* How long the whole run gets on a real clock. The scenario is a few seconds
   of deliberate waits; this is loose enough not to be flaky on a busy machine
   and tight enough that nobody waits on it. */
const WALL_MS = 90000;

/* Injected before the app: the error trap, the array the scenario fills, and
   a watcher that ships progress out as it happens. The watcher is what makes
   a stall legible -- it reports the count and the last line every 200ms, so a
   run that dies names where it was. */
const HEAD = `<script>
window.__err = [];
window.addEventListener("error", function (e) { window.__err.push(e.message); });
window.__out = [];
(function () {
  var sent = 0, done = false;
  var post = function (path, body) {
    try { return fetch(path, { method: "POST", body: String(body) }).catch(function () {}); }
    catch (e) { /* the run is over; nothing to do about it here */ }
  };
  setInterval(function () {
    if (done) return;
    var el = document.getElementById("toastRoot");
    var txt = el ? el.textContent : "";
    if (txt.indexOf("RESULT>>") >= 0) { done = true; post("/done", txt); return; }
    var n = (window.__out || []).length;
    if (n !== sent) { sent = n; post("/progress", n + " :: " + (window.__out[n - 1] || "")); }
  }, 200);
})();
</script>`;

let html = readFileSync(join(root, 'storyboarder.html'), 'utf8');
const scenario = readFileSync(join(root, 'ui-scenario.js'), 'utf8');
html = html.replace('<body>', '<body>' + HEAD);
// NB: pdf.js contains a "</body>" inside a string literal — inject at the real one.
const at = html.lastIndexOf('</body>');
html = html.slice(0, at) + '<script>\n' + scenario + '\n</script>' + html.slice(at);

const body = req => new Promise(res => {
  let s = '';
  req.on('data', d => { s += d; });
  req.on('end', () => res(s));
});

let progress = '(nothing reported)';
let settle;
const got = new Promise(r => { settle = r; });

const srv = createServer(async (req, res) => {
  const path = (req.url || '').split('?')[0];
  if (path === '/progress') {
    progress = await body(req);
    res.writeHead(204); res.end(); return;
  }
  if (path === '/done') {
    const txt = await body(req);
    res.writeHead(204); res.end();
    settle(txt); return;
  }
  if (path === '/' || path === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html); return;
  }
  res.writeHead(404); res.end();
});

const port = await new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  /* headless still throttles work it thinks nobody is looking at, and this
     scenario is nothing but timers */
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--autoplay-policy=no-user-gesture-required',
  'http://127.0.0.1:' + port + '/'
], { stdio: ['ignore', 'ignore', 'pipe'] });

let chromeSaid = '';
chrome.stderr.on('data', d => {
  const s = String(d);
  if (!/external_registry|Missing value path|GCM|DevTools listening|Fontconfig/i.test(s)) chromeSaid += s;
});
chrome.on('error', e => { chromeSaid += 'spawn: ' + e.message; });

const started = Date.now();
const dom = await Promise.race([
  got,
  new Promise(r => setTimeout(() => r(null), WALL_MS))
]);

try { chrome.kill(); } catch { /* already gone */ }
srv.close();

const secs = ((Date.now() - started) / 1000).toFixed(1);

if (dom == null) {
  console.error('The page never reported, after ' + secs + 's of real time.');
  console.error('Last thing it got through: ' + progress);
  if (chromeSaid.trim()) console.error('Chrome said: ' + chromeSaid.trim().slice(0, 600));
  writeFileSync(join(root, '_dump.html'), html, 'utf8');
  process.exit(1);
}

const m = dom.match(/RESULT>>([\s\S]*?)<<RESULT ERRORS:(.*)$/);
if (!m) {
  console.error('reported something unreadable — see _dump.html');
  writeFileSync(join(root, '_dump.html'), dom, 'utf8');
  process.exit(1);
}

const lines = m[1].split(' | ').map(s => s.trim());
let fail = 0;
for (const l of lines) { console.log('  ' + l); if (l.startsWith('FAIL')) fail++; }
const errs = m[2];
console.log('\n  page errors: ' + errs);
if (errs && errs !== '[]') fail++;
console.log('\n' + (lines.length - fail) + ' passed, ' + fail + ' failed  (' + secs + 's)\n');
process.exit(fail ? 1 : 0);
