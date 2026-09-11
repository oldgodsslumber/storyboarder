/* test-export.mjs — what the export panel would write, without a browser.
 *
 * The panel is a shell around one pure function: plan(project, options) hands
 * back the exact list of files, their names, their bytes and the two warnings
 * that have to be shown before anyone presses Export. That list is the part
 * worth testing — a wrong filename or a silently-skipped clip is only ever
 * found afterwards, in a folder somebody has already sent on.
 *
 * usage: node test-export.mjs
 */
import { readFileSync } from 'node:fs';
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
  Uint8Array, TextEncoder, URL, FormData: class { append() { } }
};
sandbox.window = sandbox;
vm.createContext(sandbox);

for (const f of ['js/util.js', 'js/doc.js', 'js/blobs.js', 'js/geminimodels.js', 'js/providers.js',
  'js/brand.js', 'js/renders.js', 'js/imagine.js', 'js/refs.js', 'js/personas.js', 'js/fields.js',
  'js/model.js', 'js/store.js', 'js/exportpanel.js']) {
  vm.runInContext(readFileSync(join(root, f), 'utf8'), sandbox, { filename: f });
}
const SB = sandbox.SB;

let pass = 0, fail = 0;
function t(name, ok, got) {
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (got === undefined ? '' : ' :: ' + got)); }
}
function section(s) { console.log('\n' + s); }

/* ---------------------------------------------------------------- a board */

function board() {
  const p = SB.Model.newProject();
  p.name = 'Bridge Crest';
  const sc = p.scenes[0];
  const a = sc.shots[0];
  const b = SB.Model.addShot(p, sc.id, {});
  const c = SB.Model.addShot(p, sc.id, {});
  const im = SB.Model.imageModel(p), vm2 = SB.Model.videoModel(p);

  const put = (mime, n) => SB.Blobs.put(p, 'data:' + mime + ';base64,' + 'A'.repeat(n));

  /* a — generated here: original + clip, both made by ImagineArt */
  a.image = SB.Blobs.image(p, 'data:image/jpeg;base64,' + 'b'.repeat(400), 854, 480);
  a.render = {
    ref: put('image/webp', 4000), serial: 1, ext: 'webp', w: 1184, h: 672, bytes: 3000,
    made: { by: 'imagine', role: 'image', model: im.name, slug: 'flux-dev', at: 1 }
  };
  a.video = {
    ref: put('video/mp4', 8000), serial: 2, ext: 'mp4', bytes: 6000,
    made: { by: 'imagine', role: 'video', model: vm2.name, slug: 'kling-1.0-pro', at: 2 }
  };
  a.prompts[im.id] = { imagePrompt: 'A wide of the floor, one lamp on.', videoPrompt: '' };
  a.prompts[vm2.id] = { imagePrompt: '', videoPrompt: 'She turns, slowly.' };

  /* b — dropped in from elsewhere: an original, no provenance */
  b.image = SB.Blobs.image(p, 'data:image/jpeg;base64,' + 'c'.repeat(400), 854, 480);
  b.render = { ref: put('image/webp', 2000), serial: 3, ext: 'webp', w: 1184, h: 672, bytes: 1500 };
  b.description = 'Reverse of the floor.';

  /* c — a folder-era frame, and a clip that is only a link */
  c.image = SB.Blobs.image(p, 'data:image/jpeg;base64,' + 'd'.repeat(400), 854, 480);
  c.render = { serial: 4, ext: 'png', bytes: 900, at: 1 };
  c.video = { url: 'https://cdn.x/late.mp4', at: 2 };

  sandbox.SB.app = { project: p, selectedSceneId: sc.id, selection: [a.id], changed() { } };
  sandbox.SB.Board = { selection: () => sandbox.SB.app.selection };
  return { p, sc, a, b, c, im, vm: vm2 };
}

const E = SB.ExportPanel;
const base = { originals: true, clips: true, proxies: false, refsets: false,
  shotlist: false, manifest: false, scope: 'board', madeOnly: false, naming: 'serial' };
const withOpts = o => Object.assign({}, base, o);

/* ---------------------------------------------------------------- names */
section('the serials are already the names');
{
  const { p } = board();
  const pl = E.plan(p, withOpts({}));
  const names = pl.items.map(i => i.name);
  t('an original exports under its serial', names.indexOf('0001.webp') >= 0, names.join(' '));
  t('and a clip under its own', names.indexOf('0002.mp4') >= 0, names.join(' '));
  t('so the clip sorts next to the frame it came from',
    names.indexOf('0001.webp') < names.indexOf('0002.mp4'), names.join(' '));
  t('the other board original comes too', names.indexOf('0003.webp') >= 0, names.join(' '));
  t('three files, no more', pl.items.length === 3, pl.items.length);

  const coded = E.plan(p, withOpts({ naming: 'code' })).items.map(i => i.name);
  t('shot-code naming puts the code first', coded.indexOf('1A_0001.webp') >= 0, coded.join(' '));
  t('and still ends in the serial', coded.indexOf('1B_0003.webp') >= 0, coded.join(' '));
}

/* ------------------------------------------------------------- the warnings */
section('what it says before you press Export');
{
  const { p } = board();
  const pl = E.plan(p, withOpts({}));
  t('a clip held as a link is counted, not exported', pl.linkOnly === 1, pl.linkOnly);
  t('and never appears as a file',
    !pl.items.some(i => i.kind === 'clip' && !i.data), '');
  t('a folder-era frame is counted as missing', pl.missing === 1, pl.missing);
  t('the bytes are totalled', pl.bytes === 3000 + 6000 + 1500, pl.bytes);
}

/* --------------------------------------------------------------- the filter */
section('only what was made in here');
{
  const { p } = board();
  const pl = E.plan(p, withOpts({ madeOnly: true }));
  const names = pl.items.map(i => i.name);
  t('the generated still and clip survive the filter',
    names.length === 2 && names.indexOf('0001.webp') >= 0 && names.indexOf('0002.mp4') >= 0,
    names.join(' '));
  t('the one dropped in from elsewhere does not',
    names.indexOf('0003.webp') < 0, names.join(' '));
  t('a folder-era frame is not reported as missing under this filter',
    pl.missing === 0, pl.missing);
  t('every file carries what made it', pl.items.every(i => i.made && i.made.by === 'imagine'), '');
}

/* ---------------------------------------------------------------- scope */
section('which shots');
{
  const { p } = board();
  t('the whole board is three shots', E.plan(p, withOpts({})).shots === 3, '');
  t('selected means the ones selected',
    E.plan(p, withOpts({ scope: 'selected' })).items.length === 2,
    E.plan(p, withOpts({ scope: 'selected' })).items.length);
  t('and a scene is its own scene',
    E.plan(p, withOpts({ scope: 'scene' })).shots === 3, '');
}

/* ------------------------------------------------------------ board copies */
section('the board copies, when they are asked for');
{
  const { p } = board();
  const pl = E.plan(p, withOpts({ originals: false, clips: false, proxies: true }));
  const names = pl.items.map(i => i.name);
  t('a proxy has no serial, so it is named for its card',
    names.indexOf('1A_board.jpg') >= 0, names.join(' '));
  t('one per card that has a picture', pl.items.length === 3, pl.items.length);
}

/* --------------------------------------------------------------- the CSV */
section('the shot list');
{
  const { p, im } = board();
  const pl = E.plan(p, withOpts({ originals: false, clips: false, shotlist: true }));
  t('one file', pl.items.length === 1 && /\.csv$/.test(pl.items[0].name), pl.items[0].name);
  const text = pl.items[0].text;
  const lines = text.split('\r\n');
  t('a header and a row per shot', lines.length === 4, lines.length);
  t('it names the model each prompt was written for',
    lines[0].indexOf(im.name) >= 0, lines[0]);
  t('the prompt is in it', text.indexOf('A wide of the floor, one lamp on.') >= 0, '');
  t('and the files it points at',
    text.indexOf('0001.webp') >= 0 && text.indexOf('0002.mp4') >= 0, '');
  t('a comma in a description cannot break the row',
    (function () {
      const b2 = board();
      b2.b.description = 'Two things, and a "quote".';
      const one = E.csv(b2.p, [{ scene: b2.sc, shot: b2.b, code: '1B' }]);
      return one.split('\r\n')[1].indexOf('"Two things, and a ""quote""."') >= 0;
    })(), '');
}

/* ---------------------------------------------------------- the manifest */
section('the manifest, which is the half nobody can rebuild later');
{
  const { p, im } = board();
  const pl = E.plan(p, withOpts({ manifest: true }));
  const man = pl.items.filter(i => /\.json$/.test(i.name))[0];
  t('it rides along with the files', !!man, pl.items.map(i => i.name).join(' '));
  const j = JSON.parse(man.text);
  t('named for the board', j.board === 'Bridge Crest', j.board);
  t('one entry per file, itself excluded', j.files.length === 3, j.files.length);
  const first = j.files.filter(f => f.file === '0001.webp')[0];
  t('it says which shot', first.shot === '1A', first.shot);
  t('which model made it', first.model === im.name, first.model);
  t('which ImagineArt model that was', first.imagineModel === 'flux-dev', first.imagineModel);
  t('the prompt on the card',
    first.promptOnTheCardNow === 'A wide of the floor, one lamp on.', first.promptOnTheCardNow);
  t('and the pixels behind it', first.pixels === '1184×672', first.pixels);
  const dropped = j.files.filter(f => f.file === '0003.webp')[0];
  t('a file nobody generated says so plainly',
    dropped.madeHere === false && dropped.model === null, JSON.stringify(dropped));
  const clip = j.files.filter(f => f.file === '0002.mp4')[0];
  t('a clip carries its own prompt, not the still\'s',
    clip.promptOnTheCardNow === 'She turns, slowly.', clip.promptOnTheCardNow);
}

/* ------------------------------------------------------- reference sets */
section('reference sets go in a folder of their own');
{
  const { p, a, b } = board();
  const her = SB.Personas.add(p, { name: 'Nat' });
  SB.Personas.addImage(her, SB.Blobs.image(p, 'data:image/jpeg;base64,' + 'e'.repeat(300), 4, 3), '',
    { ref: SB.Blobs.put(p, 'data:image/webp;base64,' + 'F'.repeat(1200)), serial: 9, ext: 'webp' });
  b.description = 'Reverse of ' + SB.Refs.mark(p, a.id, '1A');
  b.personaIds = [her.id];

  const pl = E.plan(p, withOpts({ originals: false, clips: false, refsets: true }));
  const ref = pl.items.filter(i => i.kind === 'reference')[0];
  t('there is a set for the card that has references', !!ref,
    pl.items.map(i => i.name).join(' '));
  t('in a folder named for the shot', ref.sub === 'refs/1B', ref.sub);
  t('numbered in feed order, because that is the order they go in',
    /^1_/.test(ref.name), ref.name);
  t('and named for who it is', ref.name.indexOf('Nat') >= 0 || ref.name.indexOf('1A') >= 0,
    ref.name);
  t('made-only turns them off, since a reference is an input',
    E.plan(p, withOpts({ originals: false, clips: false, refsets: true, madeOnly: true }))
      .items.length === 0, '');
}

/* ------------------------------------------------------------- nothing on */
section('nothing selected');
{
  const { p } = board();
  const pl = E.plan(p, withOpts({ originals: false, clips: false, manifest: false }));
  t('writes nothing at all', pl.items.length === 0, pl.items.length);
  t('and totals nothing', pl.bytes === 0, pl.bytes);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
