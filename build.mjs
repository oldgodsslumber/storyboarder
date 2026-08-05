/* build.mjs — inline css + js into one shippable file: storyboarder.html
 * usage: node build.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
let html = readFileSync(join(root, 'index.html'), 'utf8');

/* Stamp the build, so "is this the version with the fix?" is answerable by
   looking at the app instead of guessing. */
let sha = 'dev';
try {
  sha = execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString().trim();
  const dirty = execSync('git status --porcelain', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString().trim();
  if (dirty) sha += '+';
} catch { /* not a git checkout — the date alone will do */ }
const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' · ' + sha;
html = html.replace('<body>',
  '<body>\n<script>window.SB_BUILD = ' + JSON.stringify(stamp) + ';</script>');

html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, href) => {
  const css = readFileSync(join(root, href), 'utf8');
  return '<style>\n' + css + '\n</style>';
});

html = html.replace(/<script src="([^"]+)"><\/script>\s*/g, (_, src) => {
  const js = readFileSync(join(root, src), 'utf8');
  return '<script>\n/* ===== ' + src + ' ===== */\n' + js.replace(/<\/script>/g, '<\\/script>') + '\n</script>\n';
});

writeFileSync(join(root, 'storyboarder.html'), html, 'utf8');
console.log('wrote storyboarder.html (' + (html.length / 1024).toFixed(1) + ' KB)');
