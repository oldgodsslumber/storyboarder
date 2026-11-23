/* test-pptx.mjs — the PowerPoint deck, without a browser.
 *
 * plan() and parts() are pure; only the picture decode needs a canvas, and
 * that is injected here. What is checked is the package itself: every part a
 * relationship names exists, every slide is listed, every picture resolves —
 * the things PowerPoint answers with "needs to be repaired".
 *
 * usage: node test-pptx.mjs            (writes test-out/*.pptx for a manual open)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = dirname(fileURLToPath(import.meta.url));
const store = new Map();
const sandbox = {
  console,
  document: {
    createElement: () => ({ style: {}, dataset: {}, classList: { add() { }, remove() { }, toggle() { } }, appendChild() { } }),
    getElementById: () => null,
    addEventListener() { }, removeEventListener() { }
  },
  setTimeout, clearTimeout, setInterval, clearInterval,
  indexedDB: undefined,
  location: { protocol: 'https:', origin: 'https://x.test', pathname: '/', search: '' },
  localStorage: {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  },
  fetch: () => Promise.reject(new Error('the tests never go to the network')),
  crypto: { getRandomValues: a => a, subtle: {} },
  Uint8Array, ArrayBuffer, DataView, Uint32Array, TextEncoder, URL, Blob, atob,
  FormData: class { append() { } },
  addEventListener() { }, removeEventListener() { }
};
sandbox.window = sandbox;
vm.createContext(sandbox);

for (const f of ['js/util.js', 'js/focus.js', 'js/doc.js', 'js/blobs.js', 'js/geminimodels.js', 'js/providers.js',
  'js/brand.js', 'js/renders.js', 'js/imaginemodels.js', 'js/imagine.js', 'js/refs.js', 'js/personas.js', 'js/fields.js',
  'js/model.js', 'js/store.js', 'js/pose.js', 'js/zip.js', 'js/pdf.js', 'js/pptx.js']) {
  vm.runInContext(readFileSync(join(root, f), 'utf8'), sandbox, { filename: f });
}
const SB = sandbox.SB;

let pass = 0, fail = 0;
function t(name, ok, got) {
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (got === undefined ? '' : ' :: ' + got)); }
}
function section(s) { console.log('\n' + s); }

/* a real 1×1 JPEG, so the files written can be opened */
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////' +
  '////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

function board(nScenes, perScene) {
  const p = SB.Model.newProject();
  p.name = 'Bridge Crest';
  p.versionName = 'v2';
  for (let s = 0; s < nScenes; s++) {
    const sc = s === 0 ? p.scenes[0] : SB.Model.addScene(p);
    sc.heading = 'INT. SCENE ' + (s + 1) + ' — DAY';
    sc.description = 'Scene ' + (s + 1) + ' & <stuff>';
    while (sc.shots.length < perScene) SB.Model.addShot(p, sc.id, {});
    sc.shots.forEach((sh, j) => {
      sh.type = 'Wide';
      sh.image = SB.Blobs.image(p, JPEG.replace('A=', 'A' + '='.repeat(0)) + (j % 2 ? '' : ''), 854, 480);
      sh.description = 'Shot ' + j + ' — a "quoted" <tag> & ampersand';
    });
  }
  SB.app = { project: p, changed() { } };
  return p;
}

const decode = (url) => Promise.resolve({ bytes: SB.Zip.fromDataUrl(JPEG), w: 1600, h: 900, ext: 'jpeg' });

function partMap(parts) {
  const m = {};
  parts.forEach(x => { m[x.name] = typeof x.data === 'string' ? x.data : x.data; });
  return m;
}

/* resolve a relationship Target against the part that owns the .rels */
function resolveTarget(relsName, target) {
  const owner = relsName.replace(/_rels\/([^/]+)\.rels$/, '$1');
  const base = owner.includes('/') ? owner.slice(0, owner.lastIndexOf('/') + 1) : '';
  const stack = (base + target).split('/');
  const out = [];
  stack.forEach(s => { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); });
  return out.join('/');
}

function checkPackage(label, parts, expectSlides) {
  const m = partMap(parts);
  const names = Object.keys(m);
  t(label + ': content types present', !!m['[Content_Types].xml']);
  const slides = names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  t(label + ': ' + expectSlides + ' slides', slides.length === expectSlides, slides.length);
  const ct = m['[Content_Types].xml'];
  t(label + ': every slide has an override', slides.every(s => ct.includes('PartName="/' + s + '"')));
  const pres = m['ppt/presentation.xml'];
  t(label + ': sldIdLst matches', (pres.match(/<p:sldId /g) || []).length === expectSlides);
  t(label + ': 16:9', pres.includes('cx="12192000" cy="6858000"'));
  let dangling = [];
  names.filter(n => n.endsWith('.rels')).forEach(rn => {
    for (const mm of m[rn].matchAll(/Target="([^"]+)"/g)) {
      const full = rn === '_rels/.rels' ? mm[1] : resolveTarget(rn, mm[1]);
      if (!m[full]) dangling.push(rn + ' -> ' + full);
    }
  });
  t(label + ': no dangling relationships', !dangling.length, dangling.slice(0, 3).join('; '));
  let badEmbed = [];
  slides.forEach(s => {
    const rels = m[s.replace('slides/', 'slides/_rels/') + '.rels'];
    for (const mm of m[s].matchAll(/r:embed="([^"]+)"/g)) {
      if (!rels.includes('Id="' + mm[1] + '"')) badEmbed.push(s + ':' + mm[1]);
    }
  });
  t(label + ': every picture embed resolves', !badEmbed.length, badEmbed.join(','));
  const ids = slides.map(s => [...m[s].matchAll(/<p:cNvPr id="(\d+)"/g)].map(x => x[1]));
  t(label + ': shape ids unique per slide', ids.every(a => new Set(a).size === a.length));
  t(label + ': no raw & in text', slides.every(s =>
    [...m[s].matchAll(/<a:t>([^<]*)<\/a:t>/g)].every(x => !/&(?!amp;|lt;|gt;|quot;)/.test(x[1]))));
  return m;
}

section('six panels');
{
  board(2, 4);   // 8 shots, 4 a scene
  const pl = SB.Pptx.plan({ slidePreset: 'six' });
  t('8 shots at six → 2 slides', pl.slides.length === 2, pl.slides.length);
  t('first slide holds 6', pl.slides[0].cards.length === 6);
  const r = await SB.Pptx.build({ slidePreset: 'six' }, decode);
  const parts = SB.Pptx.parts(pl, (await SB.Pptx.resolve(pl, decode)).media);
  checkPackage('six', parts, 2);
  mkdirSync(join(root, 'test-out'), { recursive: true });
  writeFileSync(join(root, 'test-out', 'six.pptx'), Buffer.from(await r.blob.arrayBuffer()));
}

section('three panels, scene breaks and title slides');
{
  board(2, 4);
  const pl = SB.Pptx.plan({ slidePreset: 'three', scenePageBreak: true });
  t('two scenes of 4 at three with breaks → 4 slides', pl.slides.length === 4, pl.slides.length);
  const pl2 = SB.Pptx.plan({ slidePreset: 'three', sceneBanner: true });
  t('with title slides → 2 sections + 4 panel slides', pl2.slides.length === 6, pl2.slides.length);
  t('a section slide leads', pl2.slides[0].kind === 'section');
  const r = await SB.Pptx.build({ slidePreset: 'three', sceneBanner: true }, decode);
  const media = (await SB.Pptx.resolve(pl2, decode)).media;
  const m = checkPackage('three', SB.Pptx.parts(pl2, media), 6);
  t('scene description escaped', m['ppt/slides/slide1.xml'].includes('&amp; &lt;stuff&gt;'));
  writeFileSync(join(root, 'test-out', 'three.pptx'), Buffer.from(await r.blob.arrayBuffer()));
}

section('no shot, empty, bad text, failed decode');
{
  const p = board(1, 3);
  p.scenes[0].shots[1].noShot = true;
  t('no-shot cards drop out', SB.Pptx.plan({}).shots === 2);
  p.scenes[0].shots.forEach(s => { s.noShot = true; });
  const pl = SB.Pptx.plan({});
  t('nothing to show → one slide', pl.slides.length === 1 && pl.slides[0].kind === 'empty');
  checkPackage('empty', SB.Pptx.parts(pl, {}), 1);

  const p2 = board(1, 2);
  p2.scenes[0].shots[0].description = 'bad\u000bcontrol\u0001chars \ud800 here';
  const pl2 = SB.Pptx.plan({});
  const media = (await SB.Pptx.resolve(pl2, () => Promise.reject(new Error('nope')))).media;
  const m = checkPackage('failed decode', SB.Pptx.parts(pl2, media), 1);
  const s1 = m['ppt/slides/slide1.xml'];
  t('control chars stripped', !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s1));
  t('lone surrogate stripped', !/[\ud800-\udfff]/.test(s1));
  t('failed frame says so', s1.includes('FRAME COULD NOT BE READ'));
  t('no media parts when none decoded', !Object.keys(m).some(n => n.startsWith('ppt/media/')));
}

section('text fitting');
{
  const long = 'word '.repeat(400);
  const paras = [{ size: 11, runs: [{ t: '1A', b: true }] }, { size: 9, runs: [{ t: long }] }];
  const out = SB.Pptx.fit(paras, 3698240, 731520);
  const txt = out.map(p => p.runs.map(r => r.t).join('')).join('');
  t('long caption cut with ellipsis', txt.endsWith('…') && txt.length < long.length);
  t('code survives', out[0].runs[0].t === '1A');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
