/* build.mjs — inline css + js into one shippable file: storyboarder.html
 * usage: node build.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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

/* Version every asset URL in index.html itself. The deployed site serves
 * index.html plus twenty separate js/css files, and a browser is free to pair
 * a fresh HTML with a stale cached board.js — which shipped half a release:
 * new button labels over old behavior, and a "the fix is not there" report
 * that was true and false at the same time. A changed query string is a URL
 * the cache has never seen, so HTML and assets move together or not at all. */
/* Not the commit — the CONTENT. `git rev-parse HEAD` is the commit that
   exists while the build runs, which is the one BEFORE the code being built,
   because a build is what you commit. Every release therefore stamped its
   assets with the previous release's hash, and a browser that already held
   that version kept every cached file. A digest of the bytes about to ship
   changes when, and only when, they do. */
const assets = [...html.matchAll(/(?:src|href)="((?:js|css)\/[^"?]+)/g)]
  .map(m2 => m2[1]);
const digest = createHash('sha1');
assets.sort().forEach(a => {
  digest.update(a);
  try { digest.update(readFileSync(join(root, a))); } catch { /* listed, absent */ }
});
const ver = digest.digest('hex').slice(0, 10);
const stamped = html.replace(
  /(src|href)="((?:js|css)\/[^"?]+)(?:\?v=[^"]*)?"/g,
  (_, attr, path) => attr + '="' + path + '?v=' + ver + '"');
if (stamped !== readFileSync(join(root, 'index.html'), 'utf8')) {
  writeFileSync(join(root, 'index.html'), stamped, 'utf8');
  console.log('stamped index.html assets ?v=' + ver);
}
html = stamped;

html = html.replace('<body>',
  '<body>\n<script>window.SB_BUILD = ' + JSON.stringify(stamp) + ';</script>');

html = html.replace(/<link rel="stylesheet" href="([^"?]+)(?:\?[^"]*)?">/g, (_, href) => {
  const css = readFileSync(join(root, href), 'utf8');
  return '<style>\n' + css + '\n</style>';
});

html = html.replace(/<script src="([^"?]+)(?:\?[^"]*)?"><\/script>\s*/g, (_, src) => {
  const js = readFileSync(join(root, src), 'utf8');
  return '<script>\n/* ===== ' + src + ' ===== */\n' + js.replace(/<\/script>/g, '<\\/script>') + '\n</script>\n';
});

const out = join(root, 'storyboarder.html');
writeFileSync(out, html, 'utf8');
console.log('wrote storyboarder.html (' + (html.length / 1024).toFixed(1) + ' KB)');

/* A file:// page is cached hard, and a reload -- even a hard one -- serves the
 * old document often enough to have cost us three rounds of "the fix is not
 * there" when it was. A query string is a different URL, so the browser cannot
 * do it. The stamp goes in the query, so every build prints an address that
 * has never been fetched before.
 *
 * Printed rather than opened: which browser, and whether now is a good moment,
 * are not this script's business. */
const bust = 'file:///' + out.replace(/\\/g, '/') + '?b=' +
  stamp.replace(/[^0-9a-z]+/gi, '');
console.log('open:  ' + bust);
