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

const dom = execFileSync(CHROME, [
  '--headless=new', '--disable-gpu', '--virtual-time-budget=6000',
  '--dump-dom', 'file:///' + tmp.replace(/\\/g, '/')
], { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

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

