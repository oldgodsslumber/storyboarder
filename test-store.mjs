/* test-store.mjs — the autosave path, with a stubbed File System Access API.
 *
 * The real pickers need a user gesture and a native dialog, so the handle is
 * faked here: an in-memory file with the same semantics Chrome gives us,
 * including createWritable() TRUNCATING the file the moment it is opened.
 * That is the only way to test what happens to a project file when a write
 * goes wrong.
 *
 * usage: node test-store.mjs
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

const harness = `
<script>
/* ---- fake File System Access ---- */
window.__disk = { name: 'board.storyboard', data: '' };
window.__failWrite = false;
window.__perm = 'granted';

function FakeHandle() {
  this.name = window.__disk.name;
  this.kind = 'file';
}
FakeHandle.prototype.queryPermission = function () { return Promise.resolve(window.__perm); };
FakeHandle.prototype.requestPermission = function () { return Promise.resolve(window.__perm); };
FakeHandle.prototype.getFile = function () {
  const d = window.__disk.data;
  return Promise.resolve({ text: function () { return Promise.resolve(d); } });
};
/* Chrome writes to a swap file and commits it on close(). With
   keepExistingData the swap starts as a copy of the board; without it the swap
   starts EMPTY — so a write that fails and still closes commits nothing. */
FakeHandle.prototype.createWritable = function (opts) {
  const keep = !!(opts && opts.keepExistingData);
  const state = { swap: keep ? window.__disk.data : '', open: true };
  window.__lastKeepExisting = keep;
  return Promise.resolve({
    write: function (chunk) {
      if (window.__failWrite) return Promise.reject(new Error('simulated write failure'));
      if (typeof chunk === 'string') { state.swap = chunk; return Promise.resolve(); }
      if (chunk && chunk.type === 'write') {
        const at = chunk.position || 0;
        state.swap = state.swap.slice(0, at) + chunk.data +
          state.swap.slice(at + chunk.data.length);
        return Promise.resolve();
      }
      return Promise.resolve();
    },
    truncate: function (n) { state.swap = state.swap.slice(0, n); return Promise.resolve(); },
    abort: function () { state.open = false; return Promise.resolve(); },
    close: function () {
      if (state.open) window.__disk.data = state.swap;   // commit
      state.open = false;
      return Promise.resolve();
    }
  });
};
window.__handle = new FakeHandle();
window.showSaveFilePicker = function () { return Promise.resolve(window.__handle); };
window.showOpenFilePicker = function () { return Promise.resolve([window.__handle]); };
</script>
`;

let html = readFileSync(join(root, 'storyboarder.html'), 'utf8');
html = html.replace('<body>', '<body>' + harness +
  '<script>window.__err=[];window.addEventListener("error",function(e){window.__err.push(e.message)});</script>');

const scenario = readFileSync(join(root, 'store-scenario.js'), 'utf8');
const at = html.lastIndexOf('</body>');
html = html.slice(0, at) + '<script>\n' + scenario + '\n</script>' + html.slice(at);

const tmp = join(root, '_storetest_' + Date.now() + '.html');
writeFileSync(tmp, html, 'utf8');

const dom = execFileSync(CHROME, [
  '--headless=new', '--disable-gpu', '--virtual-time-budget=15000',
  '--dump-dom', 'file:///' + tmp.replace(/\\/g, '/')
], { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

unlinkSync(tmp);

const m = dom.match(/RESULT&gt;&gt;([\s\S]*?)&lt;&lt;RESULT/) || dom.match(/RESULT>>([\s\S]*?)<<RESULT/);
if (!m) {
  writeFileSync(join(root, '_dump.html'), dom, 'utf8');
  console.error('scenario did not report — see _dump.html');
  process.exit(1);
}
const dec = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const lines = m[1].split(' | ').map(s => dec(s).trim());
let fail = 0;
for (const l of lines) { console.log('  ' + l); if (l.startsWith('FAIL')) fail++; }
console.log('\n' + (lines.length - fail) + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
