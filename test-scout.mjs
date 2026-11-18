/* test-scout.mjs — footage we shot, as opposed to footage we licensed.
 *
 * usage: node test-scout.mjs
 *
 * The drop itself needs a real decoder and a real board, and it is tested in
 * ui-scenario.js. What is tested here is the part that is easy to get wrong by
 * copying the Getty path: a scout frame must carry NO licence, and because it
 * carries no licence it must stay a frame a model may be handed. Every
 * assertion below has a mirror in test-getty.mjs asserting the opposite about
 * a comp, and the pair is the point.
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
    createElement: () => ({ style: {}, classList: { add() { }, remove() { }, toggle() { } }, appendChild() { }, addEventListener() { } }),
    getElementById: () => null,
    addEventListener() { },
    querySelectorAll: () => []
  },
  setTimeout, clearTimeout, setInterval, clearInterval,
  indexedDB: undefined,
  location: { protocol: 'http:', origin: 'http://localhost:8080', pathname: '/index.html', search: '' },
  localStorage: {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  },
  fetch: () => Promise.reject(new Error('the tests never go to the network')),
  crypto: { getRandomValues: a => a, subtle: {} },
  Uint8Array, TextEncoder, URL, JSON, Date, Math, Promise, Array, Object, String, Number,
  FormData: class { append() { } },
  navigator: { userAgent: 'node' }
};
sandbox.window = sandbox;
vm.createContext(sandbox);

for (const f of ['js/util.js', 'js/focus.js', 'js/doc.js', 'js/blobs.js', 'js/geminimodels.js',
  'js/providers.js', 'js/brand.js', 'js/renders.js', 'js/imaginemodels.js', 'js/imagine.js',
  'js/refs.js', 'js/getty.js', 'js/personas.js', 'js/fields.js', 'js/model.js', 'js/store.js',
  'js/framepicker.js']) {
  vm.runInContext(readFileSync(join(root, f), 'utf8'), sandbox, { filename: f });
}
const SB = sandbox.SB;

let pass = 0, fail = 0;
function ok(cond, what) {
  if (cond) { pass++; console.log('  ok   ' + what); }
  else { fail++; console.log('  FAIL ' + what); }
}
function eq(a, b, what) {
  const same = JSON.stringify(a) === JSON.stringify(b);
  if (same) { pass++; console.log('  ok   ' + what); }
  else { fail++; console.log('  FAIL ' + what + ' :: ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
}

const scoutMade = function (name, at) {
  return { by: 'scout', name: name || 'IMG_4471.MOV', at: at || Date.UTC(2026, 10, 14) };
};

console.log('\n-- a scout frame carries no licence, and so stays feedable --');
{
  const p = SB.Model.newProject();
  const sh = p.scenes[0].shots[0];
  sh.image = { ref: 'blob-scout', w: 480, h: 270 };
  sh.render = { ref: 'blob-scout-full', serial: 1, ext: 'png' };

  ok(!SB.Model.isStock(p, sh), 'a frame off our own clip is not stock');
  eq(SB.Model.stockFor(p, sh), null, 'and nothing in the licence register answers for it');
  ok(!!SB.Model.modelFrame(p, sh), 'so it IS a frame a model may be handed');
  eq(SB.Model.stockShots(p).length, 0, 'and no card reports stock');

  /* The mirror, in one project, because the risk is this path drifting into
     the other: the same card with a comp on it must behave the other way. */
  const comp = SB.Model.addShot(p, p.scenes[0].id, {});
  comp.image = { ref: 'blob-comp', w: 480, h: 270 };
  SB.Model.markStock(p, comp.image, SB.Getty.record(SB.Getty.asset({
    id: '1437816897', title: 'Office at night', asset_family: 'creative',
    license_model: 'royaltyfree', display_sizes: [{ uri: 'https://x/c.mp4' }]
  })));
  ok(SB.Model.isStock(p, comp), 'the comp beside it still reads as stock');
  eq(SB.Model.modelFrame(p, comp), null, 'and is still held out of the model feeds');
  ok(!!SB.Model.modelFrame(p, sh), 'while the scout frame beside it is unaffected');
  eq(SB.Model.stockShots(p).length, 1, 'exactly one card holds stock, and it is not ours');
}

console.log('\n-- a scout clip is not an export of "what was made in here" --');
{
  const p = SB.Model.newProject();
  const sh = p.scenes[0].shots[0];
  const rec = { ref: 'blob-clip', serial: 3, ext: 'mov', bytes: 8 * 1048576,
    dur: 6, w: 1920, h: 1080, name: 'IMG_4471.MOV', made: scoutMade() };
  SB.Model.addTake(sh, rec);

  const label = SB.Clip.label(rec);
  ok(/scout clip/.test(label), 'the label says what it is: ' + label);
  ok(/6s/.test(label) && /1920×1080/.test(label), 'and still says the ordinary things');

  const said = SB.Imagine.describeMade(p, sh, rec);
  ok(/Footage we shot/.test(said), 'the clip window says we shot it');
  ok(/IMG_4471\.MOV/.test(said), 'and names the file it came off');
  ok(/no licence/.test(said), 'and says it carries no licence');
  ok(!/Getty/.test(said), 'and does not read like a comp');
  ok(/passes it by/.test(said), 'and says an export of what was made here skips it');
}

console.log('\n-- provenance survives the round trip --');
{
  const p = SB.Model.newProject();
  const sh = p.scenes[0].shots[0];
  sh.image = { ref: 'blob-scout', w: 480, h: 270 };
  SB.Model.addTake(sh, { ref: 'blob-clip', serial: 1, ext: 'mov', name: 'A001_0032.MOV',
    made: scoutMade('A001_0032.MOV') });

  const back = JSON.parse(JSON.stringify(p));
  SB.Model.migrate(back);
  const sh2 = back.scenes[0].shots[0];
  eq(sh2.video.made.by, 'scout', 'a reopened board still knows where the clip came from');
  eq(sh2.video.made.name, 'A001_0032.MOV', 'and which file it was');
  ok(!SB.Model.isStock(back, sh2), 'and it is still not stock after a reopen');
  ok(!!SB.Model.modelFrame(back, sh2), 'and still feedable');
}

console.log('\n-- the frame extractor takes a seek target --');
{
  ok(typeof SB.frameFromVideo === 'function',
    'the decoder is in util.js, not in the Getty client');
  ok(typeof SB.frameAtPlayhead === 'function',
    'and a frame can be taken off a playing clip');
  ok(typeof SB.blankFrame === 'function', 'the blank-frame guard moved with it');
  /* It cannot decode anything in node -- there is no <video> -- but it must
     reject rather than hang, because the scout path reports the failure and
     keeps the clip. A promise that never settles is the bug that cost a day
     on the Getty side. */
  ok(SB.frameFromVideo(new Uint8Array(8), 0.3) instanceof sandbox.Promise ||
    typeof SB.frameFromVideo(new Uint8Array(8), 0.3).then === 'function',
    'and it answers with a promise either way');
}

console.log('\n-- picking the frame by hand --');
{
  ok(typeof SB.scanFrames === 'function', 'the clip can be scanned for thumbnails');
  ok(!!SB.FramePicker && typeof SB.FramePicker.open === 'function',
    'and there is a picker to show them in');
  /* The reason it exists: no automatic rule survives a viewfinder clip, which
     opens on a wall, shows the room in the middle and ends on a slate. */
  const p = SB.Model.newProject();
  const sh = p.scenes[0].shots[0];
  let said = '';
  SB.toast = function (m) { said = m; return null; };
  SB.FramePicker.open(p, sh);
  ok(/no clip/i.test(said), 'a card with no clip is told so rather than opening empty: ' + said);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
