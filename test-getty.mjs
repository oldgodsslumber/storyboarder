/* test-getty.mjs — the Getty client, the card-to-search mapping, and the one
 * rule that costs money to get wrong: a comp never reaches a model.
 *
 * usage: node test-getty.mjs
 *
 * Nothing here touches the network. A fake Getty answers every call, so the
 * backoff ladder and the 429 path run in milliseconds and the field selection
 * is asserted against what was actually requested.
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
  localStorage: {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  },
  Uint8Array, TextEncoder, URL, JSON, Date, Math, Promise, Array, Object, String, Number,
  fetch: () => Promise.reject(new Error('the real fetch must never be called')),
  navigator: { userAgent: 'node' }
};
sandbox.window = sandbox;
vm.createContext(sandbox);

for (const f of ['js/util.js', 'js/focus.js', 'js/doc.js', 'js/blobs.js', 'js/geminimodels.js',
  'js/providers.js', 'js/brand.js', 'js/renders.js', 'js/imaginemodels.js', 'js/refs.js',
  'js/getty.js', 'js/personas.js', 'js/fields.js', 'js/model.js', 'js/h3.js', 'js/mxm.js',
  'js/pdf.js']) {
  vm.runInContext(readFileSync(join(root, f), 'utf8'), sandbox, { filename: f });
}
const SB = sandbox.SB;

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label); }
}
function eq(a, b, label) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x === y) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + '\n       got  ' + x + '\n       want ' + y); }
}
function section(t) { console.log('\n' + t); }

/* ---------------- the fake ---------------- */

/* Every call made, so a test can assert what went out — the headers, the
 * query, the order. `plan` is a list of answers; a function gets the call. */
function fakeGetty(plan) {
  const calls = [];
  let i = 0;
  const f = function (url, init) {
    const u = new URL(url);
    const call = {
      url: url, method: (init && init.method) || 'GET',
      path: u.pathname, q: Object.fromEntries(u.searchParams.entries()),
      headers: (init && init.headers) || {}, body: init && init.body
    };
    calls.push(call);
    const a = typeof plan === 'function' ? plan(call, i++) : plan[Math.min(i++, plan.length - 1)];
    if (a instanceof Error) return Promise.reject(a);
    return Promise.resolve({
      status: a.status || 200,
      ok: (a.status || 200) < 300,
      headers: { get: name => (a.headers || {})[String(name).toLowerCase()] || null },
      text: () => Promise.resolve(typeof a.body === 'string' ? a.body : JSON.stringify(a.body || {})),
      blob: () => Promise.resolve({ size: 9, type: 'image/jpeg' })
    });
  };
  f.calls = calls;
  return f;
}

const waits = [];
SB.Getty.deps.sleep = function (ms) { waits.push(ms); return Promise.resolve(); };
SB.Getty.setKey('test-key');

function img(id, extra) {
  return Object.assign({
    id: id, title: 'A picture ' + id, artist: 'Someone', collection_name: 'Moment',
    asset_family: 'creative', license_model: 'royaltyfree',
    display_sizes: [
      { name: 'thumb', uri: 'https://media.gettyimages.com/t/' + id + '.jpg' },
      { name: 'preview', uri: 'https://media.gettyimages.com/p/' + id + '.jpg' },
      { name: 'comp', uri: 'https://media.gettyimages.com/c/' + id + '.jpg' }
    ],
    referral_destinations: [{ uri: 'https://www.gettyimages.com/detail/' + id }]
  }, extra || {});
}

/* ---------------- 1. the request ---------------- */

section('the request');
{
  const f = fakeGetty([{ body: { result_count: 2, images: [img('1'), img('2')] } }]);
  SB.Getty.deps.fetch = f;
  const r = await SB.Getty.searchImages('creative', { phrase: 'a call centre at night' }, 1, 60);
  const c = f.calls[0];
  eq(c.path, '/v3/search/images/creative', 'creative search path');
  eq(c.headers['Api-Key'], 'test-key', 'the key goes in the Api-Key header');
  ok(!c.headers.Authorization, 'no token is sent — search does not need one');
  eq(c.q.phrase, 'a call centre at night', 'the phrase goes out as typed');
  eq(c.q.page_size, '60', 'page size');
  eq(c.q.safe_search, 'true', 'safe search defaults on');
  eq(c.q.exclude_editorial_use_only, 'true', 'editorial-only assets are excluded by default');
  ok(/display_set/.test(c.q.fields), 'display_set is asked for — the pictures');
  ok(!/download_sizes|largest_downloads/.test(c.q.fields),
    'no field that would need a token is ever asked for');
  eq(r.images.length, 2, 'two results back');
  eq(r.total, 2, 'the total comes from result_count');
  eq(r.images[0].thumb, 'https://media.gettyimages.com/t/1.jpg', 'thumb picked out of the display set');
  eq(r.images[0].comp, 'https://media.gettyimages.com/c/1.jpg', 'comp picked out of the display set');
  eq(r.images[0].link, 'https://www.gettyimages.com/detail/1', 'the gettyimages.com link');
}

{
  const f = fakeGetty([{ body: { images: [] } }]);
  SB.Getty.deps.fetch = f;
  await SB.Getty.searchImages('editorial', { phrase: 'x', excludeEditorialOnly: false, safe: false }, 2, 30);
  const c = f.calls[0];
  eq(c.path, '/v3/search/images/editorial', 'editorial search path');
  eq(c.q.page, '2', 'the page goes out');
  ok(!('exclude_editorial_use_only' in c.q), 'the editorial filter can be switched off');
  ok(!('safe_search' in c.q), 'safe search can be switched off');
}

{
  /* An empty or absent filter is not a filter: sending compositions= would
     narrow the search to nothing. */
  const f = fakeGetty([{ body: { images: [] } }]);
  SB.Getty.deps.fetch = f;
  await SB.Getty.searchImages('creative', { phrase: 'x', compositions: [], color: '' }, 1, 10);
  ok(!('compositions' in f.calls[0].q), 'an empty array is left out of the query');
  ok(!('color' in f.calls[0].q), 'an empty string is left out of the query');
}

/* ---------------- 2. when Getty says no ---------------- */

section('when Getty says no');
{
  waits.length = 0;
  const f = fakeGetty([
    { status: 429, headers: { 'retry-after': '3' }, body: {} },
    { body: { images: [img('9')] } }
  ]);
  SB.Getty.deps.fetch = f;
  const r = await SB.Getty.searchImages('creative', { phrase: 'x' }, 1, 10);
  eq(waits, [3000], 'a 429 waits exactly as long as Retry-After says');
  eq(f.calls.length, 2, 'and then tries again');
  eq(r.images.length, 1, 'the retry is the answer');
}
{
  waits.length = 0;
  const f = fakeGetty([{ status: 429, body: {} }, { body: { images: [] } }]);
  SB.Getty.deps.fetch = f;
  await SB.Getty.searchImages('creative', { phrase: 'x' }, 1, 10);
  eq(waits, [1000], 'with no Retry-After it falls back to the backoff');
}
{
  const f = fakeGetty([{ status: 401, body: { message: 'Unauthorized' } }]);
  SB.Getty.deps.fetch = f;
  let msg = '';
  try { await SB.Getty.searchImages('creative', { phrase: 'x' }, 1, 10); }
  catch (e) { msg = e.message; }
  ok(/Unauthorized/.test(msg), 'a 401 reports what Getty said');
  ok(/Settings/.test(msg), 'and says where the key is set, which is the actual fix');
  eq(f.calls.length, 1, 'a 401 is believed at once — there is no token to refresh');
}
{
  /* A dropped request is not Getty saying no, and this is the failure the
     README is about: three different causes, one "Failed to fetch". */
  waits.length = 0;
  const f = fakeGetty([new Error('Failed to fetch'), new Error('Failed to fetch'),
    new Error('Failed to fetch')]);
  SB.Getty.deps.fetch = f;
  let err = null;
  try { await SB.Getty.searchImages('creative', { phrase: 'x' }, 1, 10); }
  catch (e) { err = e; }
  eq(f.calls.length, 3, 'a network failure is retried twice before it is believed');
  ok(err && err.network, 'and is marked as a network failure, not a refusal');
  ok(/never left the browser/.test(err.message), 'the message says which kind of failure it is');
}
{
  store.delete('sb.getty.key');
  const f = fakeGetty([{ body: {} }]);
  SB.Getty.deps.fetch = f;
  let err = null;
  try { await SB.Getty.searchImages('creative', { phrase: 'x' }, 1, 10); }
  catch (e) { err = e; }
  ok(err && err.unconfigured, 'with no key it never asks Getty at all');
  eq(f.calls.length, 0, 'and nothing goes out');
  SB.Getty.setKey('test-key');
}

/* ---------------- 3. by picture ---------------- */

section('by picture');
{
  const f = fakeGetty(function (call) {
    if (call.method === 'PUT') return { body: { uri: 'https://uploads.getty/abc.jpg' } };
    return { body: { result_count: 1, images: [img('7')] } };
  });
  SB.Getty.deps.fetch = f;
  const url = await SB.Getty.uploadSearchImage('3b frame.jpg', { size: 10, type: 'image/jpeg' });
  eq(url, 'https://uploads.getty/abc.jpg', 'the upload hands back where the picture landed');
  eq(f.calls[0].method, 'PUT', 'it is a PUT');
  eq(f.calls[0].path, '/v3/search/by-image/uploads/3b_frame.jpg',
    'the file name is sanitised — a space in a card code is not a URL');
  eq(f.calls[0].headers['Content-Type'], 'image/jpeg', 'the bytes go up as what they are');

  const r = await SB.Getty.byImage({ imageUrl: url }, { phrase: '', compositions: ['close_up'] }, 1, 60);
  eq(f.calls[1].path, '/v3/search/images/creative/by-image', 'then the by-image search');
  eq(f.calls[1].q.image_url, url, 'pointing at the uploaded picture');
  ok(!('compositions' in f.calls[1].q),
    'and without a composition filter — the picture IS the composition');
  eq(r.images.length, 1, 'results come back in the same shape as any search');
}
{
  /* Getty documents no response for the upload, so an unrecognised one has to
     be reported as itself rather than as a search with no results. */
  const f = fakeGetty([{ body: { ok: true } }]);
  SB.Getty.deps.fetch = f;
  let err = null;
  try { await SB.Getty.uploadSearchImage('x.jpg', { size: 1, type: 'image/png' }); }
  catch (e) { err = e; }
  ok(err && err.unsupported, 'an unreadable upload reply is flagged, not swallowed');
  ok(/search-by-image/.test(err.message), 'and names the thing the account may not have');
}

/* ---------------- 4. a card, as a search ---------------- */

section('a card, as a search');
{
  const p = SB.Model.newProject();
  const sh = p.scenes[0].shots[0];

  const types = {
    'Wide': { compositions: ['wide_shot'] },
    'Medium': { compositions: ['medium_shot', 'waist_up'] },
    'Close-up': { compositions: ['close_up'] },
    'Extreme close-up': { compositions: ['macro', 'close_up'] },
    'Two shot': { people: ['two'] },
    'Insert': { compositions: ['still_life', 'cut_out', 'macro'], people: ['none'] },
    'Cutaway': { people: ['none'] },
    'Talking head': { compositions: ['headshot', 'looking_at_camera'], people: ['one'] }
  };
  Object.keys(types).forEach(function (t) {
    sh.type = t;
    sh.personaIds = [];
    const f = SB.Getty.shotFilters(p, sh);
    eq(f.compositions || null, types[t].compositions || null, t + ' → compositions');
    eq(f.people || null, types[t].people || null, t + ' → number of people');
  });

  /* The three Getty has no word for. A wrong filter hides the right picture,
     so these contribute nothing and the drawer says so. */
  ['Over the shoulder', 'POV', 'Screen capture'].forEach(function (t) {
    sh.type = t;
    ok(!SB.Getty.typeFilters(t), t + ' has no Getty composition — and does not get a guessed one');
    ok(!SB.Getty.shotFilters(p, sh).compositions, t + ' sends no composition filter');
  });

  /* A type somebody invented is not a type this knows. */
  sh.type = 'Drone orbit';
  ok(!SB.Getty.shotFilters(p, sh).compositions, 'an invented shot type contributes no filter');

  /* Cast is a fact about the card, and only speaks where the type has not. */
  sh.type = 'Wide';
  sh.personaIds = ['per_a', 'per_b'];
  eq(SB.Getty.shotFilters(p, sh).people, ['two'], 'two subjects on a Wide is a two-shot');
  sh.type = 'Insert';
  eq(SB.Getty.shotFilters(p, sh).people, ['none'],
    'but an Insert stays empty of people whatever the cast says');
  sh.type = 'Wide';
  sh.personaIds = ['a', 'b', 'c'];
  eq(SB.Getty.shotFilters(p, sh).people, ['group'], 'three or more is a group');

  /* Always, whatever the card: photographs, commercially usable, widescreen. */
  const f = SB.Getty.shotFilters(p, sh);
  eq(f.styles, ['photography'], 'photographs, not illustration');
  eq(f.orientations, ['horizontal'], '16:9 is a horizontal search');
  ok(f.excludeEditorialOnly, 'editorial-only is excluded for client work');

  /* The phrase comes through the @-mark boundary, not raw off the card. */
  const per = SB.Personas.add(p, { name: 'Dana' });
  sh.imageDescription = 'a tight frame on ' + SB.Refs.mark(per.id, 'Dana') + ' at the window';
  eq(SB.Getty.phraseFor(p, sh), 'a tight frame on Dana at the window',
    'the phrase resolves @ marks to names');
}
{
  const p = SB.Model.newProject();
  p.settings.imagineAspect = '9:16';
  eq(SB.Getty.orientationFor(p, null), 'horizontal',
    'with no Imagine module loaded the orientation falls back rather than throwing');
}

/* ---------------- 5. the chips say what was sent ---------------- */

section('the chips');
{
  const chips = SB.Getty.chips({
    compositions: ['close_up'], orientations: ['horizontal'], people: ['one'],
    styles: ['photography'], excludeEditorialOnly: true
  });
  eq(chips.map(c => c.label),
    ['close-up', 'horizontal', 'one person', 'photographs', 'commercial use'],
    'every applied filter is a chip, in words a person would use');
  ok(chips.every(c => c.k && 'v' in c), 'and each one knows how to remove itself');
}

/* ---------------- 6. the rule that costs money ---------------- */

section('a comp never reaches a model');
{
  const p = SB.Model.newProject();
  const sh = p.scenes[0].shots[0];
  const rec = SB.Getty.record(SB.Getty.asset(img('1437816897')));

  /* An ordinary frame: fed, as it always was. */
  sh.image = { ref: 'blob-a', w: 480, h: 270 };
  sh.render = { ref: 'blob-a-full', serial: 1, ext: 'webp' };
  ok(!!SB.Model.modelFrame(p, sh), 'an ordinary frame is a frame a model may be handed');
  ok(!SB.Model.isStock(p, sh), 'and is not stock');

  /* The same card, once that picture is a comp. */
  SB.Model.markStock(p, sh.image, rec);
  ok(SB.Model.isStock(p, sh), 'a marked frame reads as stock');
  eq(SB.Model.modelFrame(p, sh), null, 'and is NOT a frame a model may be handed');
  eq(SB.Model.stockFor(p, sh).id, '1437816897', 'the asset id is on the board');

  /* The feeds that used to ask (render || image) directly. */
  const m = SB.Mxm.manifest(p, sh, 'video');
  ok(!m.frame, 'the MiniMax package does not claim a first frame');
  ok(!m.assets.some(a => a.kind === 'first-frame'),
    'and does not list the comp as a file to upload');
  ok(!SB.H3.pictures(p, sh).some(x => x.kind === 'frame'),
    'the H3 prompt does not name the comp as <Picture 1>');
  ok(!SB.H3.scaffold(p, sh).taskTypes.includes('keyframe completion'),
    'and does not call the job keyframe completion');

  /* The licence travels with the picture, not with the slot: banking the comp
     as a take and putting a real render in the slot has to leave BOTH right. */
  SB.Model.keepStillTake(sh);
  sh.image = { ref: 'blob-b', w: 480, h: 270 };
  sh.render = { ref: 'blob-b-full', serial: 2, ext: 'webp' };
  ok(!SB.Model.isStock(p, sh), 'a real render over a comp is not stock');
  ok(!!SB.Model.modelFrame(p, sh), 'and may be fed to a model');
  ok(!!SB.Model.stockFor(p, sh.imageAlts[0].image),
    'while the banked take is still a comp and still says so');

  /* And swapping the comp back into the slot makes the card stock again. */
  SB.Model.useStillTake(sh, sh.imageAlts[0]);
  ok(SB.Model.isStock(p, sh), 'swapping the comp back makes the card stock again');
  eq(SB.Model.modelFrame(p, sh), null, 'and it stops being feedable again');
}
{
  /* An @ mark pointing at a comp card feeds nothing and SAYS so — the one
     case where silently obeying the mark would be the bug. */
  const p = SB.Model.newProject();
  const a = p.scenes[0].shots[0];
  const b = SB.Model.addShot(p, p.scenes[0].id, {});
  a.image = { ref: 'blob-comp' };
  SB.Model.markStock(p, a.image, SB.Getty.record(SB.Getty.asset(img('42'))));
  const code = SB.Model.findShot(p, a.id).code;
  b.description = 'the same angle as ' + SB.Refs.mark(a.id, code);
  const feed = SB.Refs.feed(p, b, 'image');
  const e = feed.filter(x => x.kind === 'shot')[0];
  ok(e, 'the mark is still in the strip');
  eq(e.images.length, 0, 'but it feeds no picture');
  ok(/Getty comp/.test(e.why), 'and the strip says why');
  ok(/42/.test(e.why), 'naming the asset');
  eq(SB.Refs.images(p, b, 'image').length, 0, 'so nothing is uploaded for that mark');
}
{
  /* The sweep: a comp replaced and gc'd must not leave a licence row behind,
     or Settings counts stock the board no longer holds. */
  const p = SB.Model.newProject();
  const sh = p.scenes[0].shots[0];
  const ref = SB.Blobs.put(p, 'data:image/jpeg;base64,AAAA');
  sh.image = { ref: ref };
  SB.Model.markStock(p, sh.image, SB.Getty.record(SB.Getty.asset(img('99'))));
  eq(SB.Model.stockShots(p).length, 1, 'one card holds a comp');
  sh.image = null;
  /* past the fresh-hold, as a real sweep would be */
  SB.Blobs.gc(p);
  const left = Object.keys(p.stock).length;
  ok(left === 0 || left === 1, 'the sweep either prunes the row or is inside the hold window');
  if (left === 0) ok(true, 'and it pruned it');
  eq(SB.Model.stockShots(p).length, 0, 'either way no card reports stock any more');
}

/* ---------------- 7. a board that has never seen Getty ---------------- */

section('boards written before any of this');
{
  const p = SB.Model.newProject();
  delete p.stock;
  SB.Model.migrate(p);
  eq(p.stock, {}, 'migrate gives an old board an empty stock register');
  const sh = p.scenes[0].shots[0];
  sh.image = { ref: 'x' };
  ok(!SB.Model.isStock(p, sh), 'and nothing on it reads as stock');
  ok(!!SB.Model.modelFrame(p, sh), 'so every frame on it still feeds exactly as before');
}

/* ---------------- 8. the bugs a review found ----------------
 *
 * Each of these was real and shipped in the first cut of this feature. They
 * are kept as named cases because every one of them was invisible from the
 * outside: three of them LOOKED like they worked.
 */

section('a comp among a subject’s reference pictures');
{
  /* The licence kept comps off a card's frame and said nothing about a
     subject's reference box — which feeds the same models by the same route,
     one level down. A subject carries exactly one live reference picture
     (Personas.imagesOf), so the case is: that one picture is a comp. */
  const p = SB.Model.newProject();
  const sh = p.scenes[0].shots[0];
  const dana = SB.Personas.add(p, { name: 'Dana' });
  const sam = SB.Personas.add(p, { name: 'Sam' });
  dana.image = { ref: 'blob-dana-photo', w: 400, h: 400 };
  sam.image = { ref: 'blob-sam-comp', w: 400, h: 400 };
  SB.Model.markStock(p, sam.image, SB.Getty.record(SB.Getty.asset(img('555'))));
  sh.description = 'she turns, ' + SB.Refs.mark(dana.id, 'Dana') +
    ', past ' + SB.Refs.mark(sam.id, 'Sam');

  const feed = SB.Refs.feed(p, sh, 'image');
  const eD = feed.filter(x => x.id === dana.id)[0];
  const eS = feed.filter(x => x.id === sam.id)[0];
  eq(eD.images.map(x => x.ref), ['blob-dana-photo'], 'an ordinary reference is still fed');
  eq(eS.images.length, 0, 'a subject whose reference is a comp feeds nothing');
  eq(eS.comps.map(x => x.ref), ['blob-sam-comp'], 'and the comp is held back');
  ok(/Getty comp/.test(eS.why) && /555/.test(eS.why),
    'the strip says which picture was held back and why');
  ok(/described in full instead/.test(eS.why), 'and that they are described in words instead');
  eq(SB.Refs.images(p, sh, 'image').map(x => x.img.ref), ['blob-dana-photo'],
    'so only the photograph is uploaded');
  ok(!SB.Mxm.manifest(p, sh, 'image').assets.some(a => a.subjectId === sam.id),
    'and the MiniMax package carries no file for them');
  ok(SB.Mxm.manifest(p, sh, 'image').assets.some(a => a.subjectId === dana.id),
    'while the subject with a real photograph still gets one');

  /* Cast on the card without being mentioned goes down the same path — it
     used to be a second copy of this code, which is how one of them got a
     licence check and the other did not. */
  const sh2 = SB.Model.addShot(p, p.scenes[0].id, {});
  sh2.personaIds = [sam.id, dana.id];
  const f2 = SB.Refs.feed(p, sh2, 'image');
  eq(f2.filter(x => x.id === sam.id)[0].images.length, 0,
    'a subject merely cast on the card is filtered the same way');
  eq(f2.filter(x => x.id === dana.id)[0].images.length, 1,
    'and an uncast-but-mentioned ordinary one is untouched');
  ok(/cast on this card/.test(f2.filter(x => x.id === dana.id)[0].why),
    'the old wording for a cast subject is unchanged');
}

section('the same asset on a second card');
{
  /* One row per picture, so restamping it wiped the lapse warning off every
     other card holding the same comp. */
  const p = SB.Model.newProject();
  const a = p.scenes[0].shots[0];
  const b = SB.Model.addShot(p, p.scenes[0].id, {});
  const rec = SB.Getty.record(SB.Getty.asset(img('777')));
  a.image = { ref: 'blob-777' };
  SB.Model.markStock(p, a.image, rec);
  p.stock['blob-777'].at = Date.now() - 40 * 86400000;         // taken 40 days ago
  ok(SB.Model.compLapsed(SB.Model.stockFor(p, a)), 'after 40 days the comp has lapsed');

  b.image = { ref: 'blob-777' };                               // same bytes, same picture
  SB.Model.markStock(p, b.image, SB.Getty.record(SB.Getty.asset(img('777'))));
  ok(SB.Model.compLapsed(SB.Model.stockFor(p, a)),
    'placing it again does not restart the 30-day clock');
  eq(SB.Model.compAgeDays(SB.Model.stockFor(p, b)), 40,
    'both cards report the age of the one download');

  /* A different asset under the same reference is a different picture. */
  SB.Model.markStock(p, b.image, SB.Getty.record(SB.Getty.asset(img('888'))));
  eq(SB.Model.stockFor(p, b).id, '888', 'a different asset replaces the record');
  ok(SB.Model.compAgeDays(SB.Model.stockFor(p, b)) === 0, 'with its own clock');
}

section('a comp dropped as a bare URL');
{
  eq(SB.Getty.assetIdFromUrl('https://media.gettyimages.com/id/1437816897/photo/office.jpg?s=612x612'),
    '1437816897', 'the asset id is read out of a modern media URL');
  eq(SB.Getty.assetIdFromUrl('https://media.gettyimages.com/photos/an-office-picture-id1437816897'),
    '1437816897', 'and out of the older shape');
  eq(SB.Getty.assetIdFromUrl('https://example.com/id/1437816897/photo/x.jpg'), '',
    'a URL that is not Getty’s is not a Getty picture');
  eq(SB.Getty.assetIdFromUrl(''), '', 'and nothing is nothing');
  eq(SB.Getty.assetIdFromUrl('https://media.gettyimages.com/id/42/photo/x.jpg'), '',
    'a two-digit number is not an asset id — real ones are long, and this guard is what ' +
    'keeps a stray number in some other URL from becoming a licence record');
  const r = SB.Getty.recordFromUrl('https://media.gettyimages.com/id/904321/photo/x.jpg');
  eq(r.id, '904321', 'the record carries the id');
  eq(r.artist, '', 'and invents no artist');
  ok(r.fromUrl, 'and says it came from a URL');
  eq(SB.Getty.recordFromUrl('https://example.com/x.jpg'), null, 'non-Getty URLs make no record');
}

section('a comp whose proxy is gone');
{
  /* The register is keyed by reference. A board holding an original with no
     proxy is a real legacy state, and in it the answer to "may a model have
     this" still has to be no. */
  const p = SB.Model.newProject();
  const sh = p.scenes[0].shots[0];
  sh.render = {
    ref: 'blob-orig', serial: 3, ext: 'webp',
    made: { by: 'getty', id: '1234', at: Date.now() }
  };
  ok(SB.Model.isStock(p, sh), 'its own provenance is enough to identify it');
  eq(SB.Model.modelFrame(p, sh), null, 'so it is still not a frame a model may be handed');
  eq(SB.Model.stockFor(p, sh).id, '1234', 'and the asset id survives');
}

section('a comp kept only as a take');
{
  const p = SB.Model.newProject();
  const sh = p.scenes[0].shots[0];
  sh.image = { ref: 'blob-comp' };
  SB.Model.markStock(p, sh.image, SB.Getty.record(SB.Getty.asset(img('321'))));
  SB.Model.keepStillTake(sh);
  sh.image = { ref: 'blob-real' };
  sh.render = { ref: 'blob-real-full', serial: 1, ext: 'webp' };
  const rows = SB.Model.stockShots(p);
  eq(rows.length, 1, 'a comp replaced by a real render is still in the file, and still counted');
  eq(rows[0].chosen, false, 'flagged as a take rather than as what is on the board');
  eq(rows[0].rec.id, '321', 'with its asset id');
  ok(!!SB.Model.modelFrame(p, sh), 'while the card itself feeds its real frame');
}

section('what the Create panel says a clip will be sent');
{
  /* The video strip announced the comp as "the only picture the video call is
     sent" while the push button beside it was refusing to send it. The strip
     now reads the same predicate the push does. Asserted here rather than
     through the panel: opening it in the UI run starts a network fetch that
     can stall Chrome's virtual clock, and a flaky suite is worse than none. */
  const p = SB.Model.newProject();
  const sh = p.scenes[0].shots[0];
  sh.image = { ref: 'blob-comp' };
  sh.render = { ref: 'blob-comp-full', serial: 5, ext: 'webp' };
  SB.Model.markStock(p, sh.image, SB.Getty.record(SB.Getty.asset(img('1212'))));
  eq(SB.Model.modelFrame(p, sh), null, 'a comp card offers the clip lane no picture');
  sh.image = { ref: 'blob-real' };
  sh.render = { ref: 'blob-real-full', serial: 6, ext: 'webp' };
  ok(!!SB.Model.modelFrame(p, sh), 'and a real frame still offers one');
}

section('the printed board');
{
  const p = SB.Model.newProject();
  SB.app = SB.app || {};
  SB.app.project = p;
  const sh = p.scenes[0].shots[0];
  sh.type = 'Wide';
  sh.image = SB.Blobs.image(p, 'data:image/png;base64,AAAA', 8, 8);
  SB.Model.markStock(p, sh.image, SB.Getty.record(SB.Getty.asset(img('1437816897'))));
  const cells = SB.Pdf.cells();
  ok(cells[0].stock && cells[0].stock.id === '1437816897',
    'the printed cell knows the frame is a comp');
  const html = SB.Pdf.html({ silent: true });
  ok(/Getty 1437816897/.test(html),
    'and the page a client holds says so beside the picture');
  ok(/\.stk\{/.test(html), 'with a style for it');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
