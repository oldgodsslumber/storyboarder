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
  'js/brand.js', 'js/renders.js', 'js/imaginemodels.js', 'js/imagine.js', 'js/refs.js', 'js/personas.js', 'js/fields.js',
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
  sc.heading = 'INT. BRIDGECREST — DAY';
  const a = sc.shots[0];
  const b = SB.Model.addShot(p, sc.id, {});
  const c = SB.Model.addShot(p, sc.id, {});
  const im = SB.Model.imageModel(p), vm2 = SB.Model.videoModel(p);

  const put = (mime, n) => SB.Blobs.put(p, 'data:' + mime + ';base64,' + 'A'.repeat(n));

  /* a — generated here: original + clip, both made by ImagineArt */
  a.image = SB.Blobs.image(p, 'data:image/jpeg;base64,' + 'b'.repeat(400), 854, 480);
  a.render = {
    ref: put('image/webp', 4000), serial: 1, ext: 'webp', w: 1184, h: 672, bytes: 3000,
    made: { by: 'imagine', role: 'image', model: im.name, modelId: im.id, slug: 'flux-dev', at: 1 }
  };
  a.video = {
    ref: put('video/mp4', 8000), serial: 2, ext: 'mp4', bytes: 6000,
    made: { by: 'imagine', role: 'video', model: vm2.name, modelId: vm2.id, slug: 'kling-1.0-pro', at: 2 }
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
  SB.Personas.setImage(her, SB.Blobs.image(p, 'data:image/jpeg;base64,' + 'e'.repeat(300), 4, 3), '',
    { ref: SB.Blobs.put(p, 'data:image/webp;base64,' + 'F'.repeat(1200)), serial: 9, ext: 'webp' });
  b.description = 'Reverse of ' + SB.Refs.mark(a.id, '1A');
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

/* ------------------------------------------------- what QA found, fixed */
section('the things a QA pass found');

{
  /* 1. a scene has a heading, not a name — every CSV row and every manifest
        entry was reporting an empty scene */
  const { p } = board();
  const pl = E.plan(p, withOpts({ shotlist: true, manifest: true }));
  const rows2 = pl.items.filter(i => /\.csv$/.test(i.name))[0].text.split('\r\n');
  t('the CSV names the scene', rows2[1].indexOf('INT. BRIDGECREST — DAY') === 0, rows2[1]);
  const man = JSON.parse(pl.items.filter(i => /\.json$/.test(i.name))[0].text);
  t('and so does the manifest', man.files[0].scene === 'INT. BRIDGECREST — DAY',
    man.files[0].scene);
}

{
  /* 2. a reference set that falls back to the board copy must say so, and
        must not report the original's bytes for a file it did not write */
  const { p, a, b } = board();
  const her = SB.Personas.add(p, { name: 'Nat' });
  SB.Personas.setImage(her, SB.Blobs.image(p, 'data:image/jpeg;base64,' + 'e'.repeat(300), 854, 480),
    '', { serial: 9, ext: 'webp', bytes: 1048576, w: 3840, h: 2160 });   // folder-era: no ref
  b.personaIds = [her.id];
  b.description = 'Nat at the rack.';
  const pl = E.plan(p, withOpts({ originals: false, clips: false, refsets: true, manifest: true }));
  const ref = pl.items.filter(i => /^refs\//.test(i.sub || ''))[0];
  t('the fallback is labelled for what it is', ref.kind === 'reference (board copy)', ref.kind);
  t('and weighs what was actually written', ref.bytes < 1000, ref.bytes);
  t('the footer counts it as missing rather than shipping it quietly',
    pl.missing === 1, pl.missing);
  const man = JSON.parse(pl.items.filter(i => /\.json$/.test(i.name))[0].text);
  t('the manifest does not claim 4K for a 480p file',
    man.files[0].pixels === null && man.files[0].serial === null,
    JSON.stringify(man.files[0]));
}

{
  /* 3. a record pointing at bytes that are gone was invisible to everything */
  const { p, b } = board();
  b.render = { ref: 'nope-1', serial: 30, ext: 'webp', w: 100, h: 100, bytes: 10 };
  t('a dangling reference counts as missing', E.plan(p, withOpts({})).missing === 2,
    E.plan(p, withOpts({})).missing);
  t('and weigh() sees it', SB.Renders.weigh(p).dangling === 1, SB.Renders.weigh(p).dangling);
  t('Renders.isMissing covers both kinds',
    SB.Renders.isMissing(p, b.render) &&
    SB.Renders.isMissing(p, { serial: 4, ext: 'png' }) &&
    !SB.Renders.isMissing(p, { serial: 1, ref: null }) === false, '');
}

{
  /* 4. a clip with neither bytes nor a link is not nothing */
  const { p, c } = board();
  c.video = { serial: 22, ext: 'mp4', bytes: 5 };
  t('a clip record with nothing behind it is counted',
    E.plan(p, withOpts({})).missing === 2, E.plan(p, withOpts({})).missing);
}

{
  /* 5. the manifest finds the model by id, and says so when it cannot */
  const { p, a, im } = board();
  const twin = JSON.parse(JSON.stringify(im));
  twin.id = 'm_twin';
  p.settings.models.push(twin);                       // two models, one name
  const man1 = JSON.parse(E.plan(p, withOpts({ manifest: true }))
    .items.filter(i => /\.json$/.test(i.name))[0].text);
  t('a duplicate name cannot confuse it, because it looks up the id',
    man1.files[0].promptOnTheCardNow === 'A wide of the floor, one lamp on.',
    man1.files[0].promptOnTheCardNow);

  p.settings.models = p.settings.models.filter(m => m.id !== im.id && m.id !== 'm_twin');
  const man2 = JSON.parse(E.plan(p, withOpts({ manifest: true }))
    .items.filter(i => /\.json$/.test(i.name))[0].text);
  t('a model that has been deleted says so instead of going blank',
    /no longer on this board/.test(man2.files[0].promptOnTheCardNow),
    man2.files[0].promptOnTheCardNow);
}

{
  /* 6. an empty plan is not an export */
  const { p } = board();
  const pl = E.plan(p, withOpts({ originals: false, clips: false, manifest: true }));
  t('a manifest of nothing is not offered', pl.items.length === 0, pl.items.length);
}

{
  /* 7. the CSV cannot be made to split a row or run a formula */
  const { p, b, sc } = board();
  b.description = 'Carriage\rreturn';
  const one = E.csv(p, [{ scene: sc, shot: b, code: '1B', sceneName: sc.heading }]);
  t('a lone carriage return is quoted', one.split('\r\n')[1].indexOf('"Carriage\rreturn"') >= 0,
    JSON.stringify(one.split('\r\n')[1]));
  b.description = '=cmd|\'/c calc\'!A1';
  const two = E.csv(p, [{ scene: sc, shot: b, code: '1B', sceneName: sc.heading }]);
  t('and a formula is defused with a leading quote',
    two.indexOf("'=cmd") >= 0, two.split('\r\n')[1]);
}

{
  /* 8. text sizes are bytes, not UTF-16 units */
  const { p } = board();
  p.name = '日本語 ボード';
  const pl = E.plan(p, withOpts({ manifest: true }));
  const man = pl.items.filter(i => /\.json$/.test(i.name))[0];
  t('a manifest full of Japanese is measured in bytes',
    man.bytes === new TextEncoder().encode(man.text).length && man.bytes > man.text.length,
    man.bytes + ' vs ' + man.text.length);
}

{
  /* a clip that was dropped on a card rather than generated */
  const { p, b } = board();
  b.video = { ref: SB.Blobs.put(p, 'data:video/mp4;base64,' + 'M'.repeat(600)),
    serial: 40, ext: 'mp4', bytes: 450, dur: 2, name: 'old-cut.mp4' };
  const all = E.plan(p, withOpts({}));
  t('a clip from a file exports like any other',
    all.items.filter(i => i.name === '0040.mp4').length === 1,
    all.items.map(i => i.name).join(' '));
  const mine = E.plan(p, withOpts({ madeOnly: true }));
  t('but "only what was made in here" passes it by',
    mine.items.filter(i => i.name === '0040.mp4').length === 0,
    mine.items.map(i => i.name).join(' '));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
