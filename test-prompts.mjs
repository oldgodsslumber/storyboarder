/* test-prompts.mjs — the prompt-writing pipeline end to end, with the Gemini
 * endpoint stubbed so the request that WOULD be sent can be inspected and
 * every failure path exercised without a key.
 *
 * usage: node test-prompts.mjs
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

const stub = `
<script>
/* stand in for generativelanguage.googleapis.com */
window.__calls = [];
window.__reply = null;      // set per test
window.fetch = function (url, opts) {
  var body = {};
  try { body = JSON.parse(opts.body); } catch (e) {}
  window.__calls.push({ url: String(url), body: body });
  var r = window.__reply ? window.__reply(window.__calls.length, body) : null;
  if (!r) {
    r = { ok: true, status: 200, text: JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(
        { imagePrompt: 'A quiet office, 35mm, f/2, window light.',
          videoPrompt: 'Slow push in, two beats, then settle.' }) }] } }] }) };
  }
  return Promise.resolve({
    ok: r.ok, status: r.status,
    text: function () { return Promise.resolve(r.text); }
  });
};
</script>
`;

let html = readFileSync(join(root, 'storyboarder.html'), 'utf8');
html = html.replace('<body>', '<body>' + stub +
  '<script>window.__err=[];window.addEventListener("error",function(e){window.__err.push(e.message)});</script>');
const scenario = readFileSync(join(root, 'prompt-scenario.js'), 'utf8');
const at = html.lastIndexOf('</body>');
html = html.slice(0, at) + '<script>\n' + scenario + '\n</script>' + html.slice(at);

const tmp = join(root, '_prompttest_' + Date.now() + '.html');
writeFileSync(tmp, html, 'utf8');

const dom = execFileSync(CHROME, [
  '--headless=new', '--disable-gpu', '--virtual-time-budget=20000',
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
