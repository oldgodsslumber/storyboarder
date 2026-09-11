/* fetch-models.mjs — regenerate the built-in ImagineArt model list.
 *
 *   node fetch-models.mjs        # writes js/imaginemodels.js
 *
 * Why a script and not a live fetch: ImagineArt's model listing is a web page
 * on platform.imagine.art, and that host sends no CORS headers, so the app
 * cannot read it from a browser however much it would like to. What the app
 * CAN read at runtime is the signed-in account's own tool schemas, which is
 * the authoritative list and the one it prefers. This is the floor under
 * that — what somebody sees before they sign in, and what the API-key
 * transport has instead — and it was previously eleven slugs I typed by hand
 * off the documentation. There are fifty-three.
 *
 * The listing page links every model at /api/models/<slug>/docs, so the slugs
 * are the hrefs. The kind and the mode are in the slug itself: anything
 * ending -text-to-video or -image-to-video is a video model and says which
 * way round it works; everything else is an image model.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const SOURCE = 'https://platform.imagine.art/api/models';
/* What the product advertises today, which is a different and much newer
 * thing than what the v2 API lists — FLUX 3, Kling 3.0, Veo 3.1, WAN 3.0 and
 * the rest. Names, not slugs: these pages are marketing and do not publish an
 * identifier. Carried so the app can say out loud that the API list is behind
 * the product, instead of implying the API list is everything. */
const PRODUCT = [
  'https://www.imagine.art/ai-video-generator',
  'https://www.imagine.art/ai-image-generator'
];

const res = await fetch(SOURCE, { headers: { 'User-Agent': 'storyboarder-model-sync' } });
if (!res.ok) {
  console.error('could not read ' + SOURCE + ' — HTTP ' + res.status);
  process.exit(1);
}
const html = await res.text();

const slugs = [...new Set(
  [...html.matchAll(/api\/models\/([a-z0-9][a-z0-9._-]{2,60})/g)].map(m => m[1])
)].sort();

if (slugs.length < 20) {
  console.error('only ' + slugs.length + ' models found — the page shape has probably changed, ' +
    'so js/imaginemodels.js is left alone');
  process.exit(1);
}

/* The featured model cards on the product pages. Best-effort: it is a
 * website, it will change, and a miss here costs a hint rather than a
 * feature. */
async function productNames() {
  const names = [];
  for (const url of PRODUCT) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'storyboarder-model-sync' } });
      if (!r.ok) continue;
      const body = await r.text();
      const cards = body.match(/class="[^"]*model-card[^"]*"[^>]*>[\s\S]{0,900}?<\/a>/g) || [];
      cards.forEach(c => {
        const m = c.match(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/);
        if (!m) return;
        const n = m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
        if (n && names.indexOf(n) < 0) names.push(n);
      });
    } catch (e) { /* a hint, not a feature */ }
  }
  return names;
}

const products = await productNames();

/* ---- what a generation costs ----
 *
 * No tool estimates a price, but ImagineArt publishes base credit tables for
 * every model. They are markdown tables, so they read cleanly; what they do
 * not survive is the display names, which are not the slugs the tools take
 * ("Kling 3.0 Pro" against "kling-3.0-pro", "Happy Horse" against
 * "happy_horse"). Most fall out of a normalise; the rest are named here.
 *
 * These are BASE prices — the model at its minimum duration and default
 * settings. Longer and larger costs more, and the app measures the real
 * figure from the balance either side of a push. This is the number before
 * anything has been measured.
 */
const CREDITS = [
  'https://docs.imagine.art/video-tools/video-credits.md',
  'https://docs.imagine.art/image-tools/image-credits.md'
];

const SLUG_FOR = {
  'happy horse': 'happy_horse',
  'seedance 2': 'seedance-2.0',
  'seedance 2 fast': 'seedance-2.0-fast',
  'kling o3': 'kling-o3',
  'chatgpt image 2': 'gpt-image-2',
  'imagineart 2.0': 'imagine-art-2.0',
  'imagineart 1.5': 'imagine-art-1.5',
  'imagineart 1.5 pro': 'imagine-art-1.5-pro',
  'nano banana 2': 'nano-banana-2',
  'nano banana pro': 'nano-banana-pro',
  'recraft v4.1': 'recraft-v4.1',
  'ideogram v4': 'ideogram-v4',
  'seedream v5 lite': 'seedream-v5-lite',
  'grok imagine': 'xAI-grok-imagine'
};

function slugish(name) {
  const n = name.replace(/\*\*/g, '').replace(/^google /i, '').trim().toLowerCase();
  if (SLUG_FOR[n]) return SLUG_FOR[n];
  return n.replace(/\s+/g, '-');
}

async function creditTable() {
  const out = {};
  for (const url of CREDITS) {
    let body = '';
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'storyboarder-model-sync' } });
      if (!r.ok) continue;
      body = await r.text();
    } catch (e) { continue; }
    body.split('\n').forEach(line => {
      if (line.indexOf('|') !== 0) return;
      const cell = line.split('|').map(c => c.trim());
      if (cell.length < 4) return;
      const name = cell[1];
      const price = cell[2];
      if (!name || /^-+$/.test(name) || /^model$/i.test(name)) return;
      const first = (price.match(/(\d+(?:\.\d+)?)/) || [])[1];
      if (!first) return;
      const rec = { base: Number(first), name: name.replace(/\*\*/g, '') };
      /* "49 (1K) / 73.5 (2K) / 98 (4K)" — a price per tier */
      const tiers = {};
      const re = /(\d+(?:\.\d+)?)\s*\(([^)]+)\)/g;
      let m;
      while ((m = re.exec(price))) tiers[m[2].trim()] = Number(m[1]);
      if (Object.keys(tiers).length) rec.tiers = tiers;
      out[slugish(name)] = rec;
    });
  }
  return out;
}

const credits = await creditTable();

const rows = slugs.map(slug => {
  const i2v = /-image-to-video$/.test(slug);
  const t2v = /-text-to-video$/.test(slug);
  return {
    slug,
    kind: (i2v || t2v) ? 'video' : 'image',
    mode: i2v ? 'i2v' : (t2v ? 't2v' : '')
  };
});

const img = rows.filter(r => r.kind === 'image');
const vid = rows.filter(r => r.kind === 'video');

const line = r => '    { slug: ' + JSON.stringify(r.slug) +
  ', kind: ' + JSON.stringify(r.kind) +
  (r.mode ? ', mode: ' + JSON.stringify(r.mode) : '') + ' }';

const out = `/* imaginemodels.js — GENERATED by fetch-models.mjs. Do not hand-edit.
 *
 * The ImagineArt API's model list as published at
 * ${SOURCE}
 * on ${new Date().toISOString().slice(0, 10)} — ${rows.length} models
 * (${img.length} image, ${vid.length} video).
 *
 * This is the floor. A signed-in account's own tool schemas are preferred
 * wherever they can be read, because they are what that account may actually
 * call; this is what is shown before anyone signs in, and what the API-key
 * transport has instead. Re-run the script when the list moves.
 *
 * These are NOT all the models imagine.art has. The product is an
 * aggregator and its own pages currently advertise
 * ${products.join(', ') || '(could not be read)'} — none of which appear in
 * the v2 API list below. The account's own tools are the only authority;
 * this is the floor beneath them, and the products list is here so the app can say
 * out loud that the API list is behind the product rather than implying it
 * is everything.
 */
(function (SB) {
  'use strict';

  SB.ImagineModels = {
    fetchedAt: ${JSON.stringify(new Date().toISOString().slice(0, 10))},
    source: ${JSON.stringify(SOURCE)},
    /* names the product advertises, for saying so — not sendable slugs */
    products: ${JSON.stringify(products)},
    /* base credit cost per model, as ImagineArt publishes it: the price at
       the model's minimum duration and default settings, before anything has
       been measured against a real balance */
    credits: ${JSON.stringify(credits, null, 2).split('\n').join('\n    ')},
    list: [
${rows.map(line).join(',\n')}
    ]
  };

})(window.SB);
`;

writeFileSync(join(root, 'js', 'imaginemodels.js'), out, 'utf8');
console.log('wrote js/imaginemodels.js — ' + rows.length + ' models (' +
  img.length + ' image, ' + vid.length + ' video), ' +
  Object.keys(credits).length + ' published prices, ' +
  products.length + ' product names');
