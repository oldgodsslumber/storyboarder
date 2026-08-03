/* build.mjs — inline css + js into one shippable file: storyboarder.html
 * usage: node build.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
let html = readFileSync(join(root, 'index.html'), 'utf8');

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
