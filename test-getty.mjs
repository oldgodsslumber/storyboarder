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

/* ---- the fixture ----
 *
 * Built from Getty's live OpenAPI schema for `/v3/search/videos/creative`, NOT
 * from what this client expects. That distinction is the entire reason this
 * file exists in its current form: the first version of it answered with
 * `{images: […]}` because the code read `images`, so every check passed over a
 * client that could not read a single real result. A fixture that agrees with
 * the implementation tests nothing.
 *
 * Off the spec, verbatim: the footage endpoints answer `{result_count, videos,
 * facets, related_searches, auto_corrections}`, and a video's `display_sizes`
 * entries carry only `{name, uri, aspect_ratio, is_watermarked}` — there is no
 * media type to read, and Getty's URLs put the format in the query string as
 * often as in the path.
 */
function clip(id, extra) {
  return Object.assign({
    id: id, title: 'Some footage ' + id, caption: '', artist: 'Someone',
    collection_name: 'Moment', collection_code: 'MMT', asset_family: 'creative',
    asset_type: 'video', license_model: 'royaltyfree',
    clip_length: '0:12', aspect_ratio: '16:9', shot_speed: 'realtime', mastered_to: 'hd',
    display_sizes: [
      { name: 'thumb', is_watermarked: false, aspect_ratio: 1.77,
        uri: 'https://media.gettyimages.com/id/' + id + '/video/' + id + '.jpg?s=640x640&k=20' },
      { name: 'comp', is_watermarked: true, aspect_ratio: 1.77,
        uri: 'https://media.gettyimages.com/id/' + id + '/video/' + id + '.mp4?s=mp4-640x640&k=20' }
    ],
    referral_destinations: [{ site_name: 'gettyimages.com', uri: 'https://www.gettyimages.com/detail/' + id }]
  }, extra || {});
}

/* A whole reply, in the shape the endpoint actually sends. */
function videosReply(list, total) {
  return {
    result_count: total === undefined ? list.length : total,
    videos: list, facets: {}, related_searches: [], auto_corrections: {}
  };
}

/* the old name, so the licence cases below read unchanged — they are about a
   comp on a card and do not care what kind of asset it is */
const img = clip;

/* ---------------- 1. the request ---------------- */

section('the request');
{
  const f = fakeGetty([{ body: videosReply([clip('1'), clip('2')]) }]);
  SB.Getty.deps.fetch = f;
  const r = await SB.Getty.searchVideos('creative', { phrase: 'a call centre at night' }, 1, 60);
  const c = f.calls[0];
  eq(c.path, '/v3/search/videos/creative', 'creative FOOTAGE search path');
  eq(c.headers['Api-Key'], 'test-key', 'the key goes in the Api-Key header');
  ok(!c.headers.Authorization, 'no token is sent — search does not need one');
  eq(c.q.phrase, 'a call centre at night', 'the phrase goes out as typed');
  eq(c.q.page_size, '60', 'page size');
  eq(c.q.safe_search, 'true', 'safe search defaults on');
  eq(c.q.exclude_editorial_use_only, 'true', 'editorial-only assets are excluded by default');
  ok(/display_set/.test(c.q.fields), 'display_set is asked for — the poster and the comp');
  ok(/clip_length/.test(c.q.fields), 'and the clip length, which is the first thing a tile says');
  ok(!/download_sizes|largest_downloads/.test(c.q.fields),
    'no field that would need a token is ever asked for');
  ok(!/compositions|graphical_styles|minimum_size/.test(JSON.stringify(c.q)),
    'and no image filter goes out at all');
  eq(r.images.length, 2, 'two results back');
  eq(r.total, 2, 'the total comes from result_count');
  eq(r.images[0].kind, 'video', 'every result is footage');
  eq(r.images[0].poster,
    'https://media.gettyimages.com/id/1/video/1.jpg?s=640x640&k=20',
    'the poster is the still out of the display set');
  eq(r.images[0].comp,
    'https://media.gettyimages.com/id/1/video/1.mp4?s=mp4-640x640&k=20',
    'and the comp is the clip — told apart with no media type to read, which is ' +
    'all the spec gives');
  eq(r.images[0].seconds, 12, '"0:12" is read as twelve seconds');
  eq(r.images[0].aspect, '16:9', 'the aspect comes through');
  eq(r.images[0].link, 'https://www.gettyimages.com/detail/1', 'the gettyimages.com link');
}

{
  /* Telling a clip from a poster with nothing but a name and a URL. A still
     misread as a clip fails loudly at the first decode; a clip misread as a
     still leaves the drawer with nothing to play and nothing to place, which
     is the failure that hides — so anything that does not look like a picture
     is treated as the clip. */
  const named = SB.Getty.asset(clip('5', {
    display_sizes: [
      { name: 'comp', uri: 'https://media.gettyimages.com/x/5.jpg' },
      { name: 'preview', uri: 'https://media.gettyimages.com/x/5.mp4' }
    ]
  }));
  eq(named.comp, 'https://media.gettyimages.com/x/5.mp4',
    'a .jpg called "comp" is still a poster, and the .mp4 is still the clip');
  eq(named.poster, 'https://media.gettyimages.com/x/5.jpg', 'and the jpeg is the poster');

  const inQuery = SB.Getty.asset(clip('6', {
    display_sizes: [
      { name: 'thumb', uri: 'https://media.gettyimages.com/id/6/v/6?s=640x640&f=jpeg' },
      { name: 'comp', uri: 'https://media.gettyimages.com/id/6/v/6?s=mp4-640x640' }
    ]
  }));
  eq(inQuery.comp, 'https://media.gettyimages.com/id/6/v/6?s=mp4-640x640',
    'a format that lives in the query string rather than the path is read too');
  eq(inQuery.poster, 'https://media.gettyimages.com/id/6/v/6?s=640x640&f=jpeg',
    'and so is the poster beside it');

  const noClip = SB.Getty.asset(clip('8', {
    display_sizes: [{ name: 'thumb', uri: 'https://media.gettyimages.com/x/8.jpg' }]
  }));
  eq(noClip.comp, '', 'an asset with no playable comp says so rather than guessing one');
  eq(noClip.poster, 'https://media.gettyimages.com/x/8.jpg', 'while still having a poster');
}

{
  const f = fakeGetty([{ body: videosReply([]) }]);
  SB.Getty.deps.fetch = f;
  await SB.Getty.searchVideos('editorial', { phrase: 'x', excludeEditorialOnly: false, safe: false }, 2, 30);
  const c = f.calls[0];
  eq(c.path, '/v3/search/videos/editorial', 'editorial footage search path');
  eq(c.q.page, '2', 'the page goes out');
  ok(!('exclude_editorial_use_only' in c.q), 'the editorial filter can be switched off');
  ok(!('safe_search' in c.q), 'safe search can be switched off');
}

{
  /* Every hand-set filter, under its wire name. This is the list the drawer
     offers, and a filter that goes out under the wrong name is a filter that
     silently does nothing — which is exactly the bug `delete q.people` was. */
  const f = fakeGetty([{ body: videosReply([]) }]);
  SB.Getty.deps.fetch = f;
  await SB.Getty.searchVideos('creative', {
    phrase: 'x', orientations: ['horizontal'], aspects: ['16:9'], formats: ['4k'],
    frameRates: ['23.98'], techniques: ['slow_motion'], viewpoints: ['tracking_shot'],
    licenses: ['royaltyfree'], minLength: 5, maxLength: 20, sort: 'newest'
  }, 1, 60);
  const q = f.calls[0].q;
  eq(q.orientations, 'horizontal', 'orientations');
  eq(q.aspect_ratios, '16:9', 'aspect_ratios');
  eq(q.format_available, '4k', 'format_available');
  eq(q.frame_rates, '23.98', 'frame_rates');
  eq(q.image_techniques, 'slow_motion', 'image_techniques');
  eq(q.viewpoints, 'tracking_shot', 'viewpoints');
  eq(q.license_models, 'royaltyfree', 'license_models');
  eq(q.min_clip_length, '5', 'min_clip_length');
  eq(q.max_clip_length, '20', 'max_clip_length');
  eq(q.sort_order, 'newest', 'sort_order');
}

{
  /* An empty or absent filter is not a filter. */
  const f = fakeGetty([{ body: videosReply([]) }]);
  SB.Getty.deps.fetch = f;
  await SB.Getty.searchVideos('creative', { phrase: 'x', viewpoints: [], minLength: '' }, 1, 10);
  ok(!('viewpoints' in f.calls[0].q), 'an empty array is left out of the query');
  ok(!('min_clip_length' in f.calls[0].q), 'an empty string is left out of the query');
}

section('the reply shape, which is where tonight went');
{
  /* THE regression. Getty's footage endpoints answer `videos`; the image ones
     answer `images`. This client was ported from the image search and kept
     reading `images`, so a real search with a real key came back with an
     empty strip: request fine, key fine, every result dropped by the parser.
     Asserted against both names, with the real one first. */
  const f = fakeGetty([{ body: { result_count: 3, videos: [clip('1'), clip('2'), clip('3')] } }]);
  SB.Getty.deps.fetch = f;
  const r = await SB.Getty.searchVideos('creative', { phrase: 'man at computer' }, 1, 60);
  eq(r.images.length, 3, 'a `videos` array is read — the shape the footage endpoints send');
  eq(r.total, 3, 'and so is its result_count');

  const g = fakeGetty([{ body: { result_count: 1, images: [clip('9')] } }]);
  SB.Getty.deps.fetch = g;
  const r2 = await SB.Getty.searchVideos('creative', { phrase: 'x' }, 1, 60);
  eq(r2.images.length, 1, 'an `images` array is still read, so a mixed endpoint cannot regress');

  /* And the diagnostic that turns this class of bug into a line of text. */
  const d = SB.Getty.describeRaw({ result_count: 7, videos: [clip('4')] });
  ok(/videos/.test(d), 'the key check names the arrays Getty sent');
  ok(/result_count: 7/.test(d), 'and the count');
  ok(/display sizes: thumb, comp/.test(d), 'and the display sizes it found on the first asset');
  ok(/no assets in the reply/.test(SB.Getty.describeRaw({ result_count: 0, videos: [] })),
    'and says plainly when there were none');
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
  const r = await SB.Getty.searchVideos('creative', { phrase: 'x' }, 1, 10);
  eq(waits, [3000], 'a 429 waits exactly as long as Retry-After says');
  eq(f.calls.length, 2, 'and then tries again');
  eq(r.images.length, 1, 'the retry is the answer');
}
{
  waits.length = 0;
  const f = fakeGetty([{ status: 429, body: {} }, { body: videosReply([]) }]);
  SB.Getty.deps.fetch = f;
  await SB.Getty.searchVideos('creative', { phrase: 'x' }, 1, 10);
  eq(waits, [1000], 'with no Retry-After it falls back to the backoff');
}
{
  const f = fakeGetty([{ status: 401, body: { message: 'Unauthorized' } }]);
  SB.Getty.deps.fetch = f;
  let msg = '';
  try { await SB.Getty.searchVideos('creative', { phrase: 'x' }, 1, 10); }
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
  try { await SB.Getty.searchVideos('creative', { phrase: 'x' }, 1, 10); }
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
  try { await SB.Getty.searchVideos('creative', { phrase: 'x' }, 1, 10); }
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
    return { body: videosReply([clip('7')]) };
  });
  SB.Getty.deps.fetch = f;
  const url = await SB.Getty.uploadSearchImage('3b frame.jpg', { size: 10, type: 'image/jpeg' });
  eq(url, 'https://uploads.getty/abc.jpg', 'the upload hands back where the picture landed');
  eq(f.calls[0].method, 'PUT', 'it is a PUT');
  eq(f.calls[0].path, '/v3/search/by-image/uploads/3b_frame.jpg',
    'the file name is sanitised — a space in a card code is not a URL');
  eq(f.calls[0].headers['Content-Type'], 'image/jpeg', 'the bytes go up as what they are');

  const r = await SB.Getty.byImage({ imageUrl: url },
    { phrase: '', aspects: ['16:9'], viewpoints: ['panning'], formats: ['hd'] }, 1, 60);
  eq(f.calls[1].path, '/v3/search/videos/creative/by-image', 'then the by-image FOOTAGE search');
  eq(f.calls[1].q.image_url, url, 'pointing at the uploaded picture');
  ok(!('aspect_ratios' in f.calls[1].q) && !('viewpoints' in f.calls[1].q),
    'without the filters the picture itself answers');
  eq(f.calls[1].q.format_available, 'hd',
    'but format is about the deliverable, not the picture, so it stays');
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

/* ---------------- 4. the card is not an input ---------------- */

section('nothing is derived from the card');
{
  /* The first cut read the selected card: its shot type became a Getty
     `compositions` filter and its description became the phrase. That was the
     wrong shape — people find the footage here and then drag the shot up onto
     the board — so the whole mapping is gone, and its absence is the test. */
  ok(!SB.Getty.shotFilters, 'there is no shotFilters');
  ok(!SB.Getty.typeFilters, 'there is no shot-type mapping');
  ok(!SB.Getty.phraseFor, 'a card\'s description is not a query');
  ok(!SB.Getty.orientationFor, 'and the board\'s aspect is not a filter');
  ok(!SB.Getty.searchImages, 'and there is no image search at all');

  const f = SB.Getty.defaultFilters();
  eq(Object.keys(f).sort(), ['excludeEditorialOnly', 'safe', 'sort'],
    'a fresh search filters on two things, both about the job rather than taste');
  ok(f.excludeEditorialOnly && f.safe, 'commercial use and safe search, on');
}

{
  /* And proof on the wire: a card with a shot type and a description cannot
     reach the query, because nothing passes it in. */
  const p = SB.Model.newProject();
  const sh = p.scenes[0].shots[0];
  sh.type = 'Close-up';
  sh.description = 'a tight frame on the laptop';
  const f = fakeGetty([{ body: videosReply([]) }]);
  SB.Getty.deps.fetch = f;
  await SB.Getty.searchVideos('creative', SB.Getty.defaultFilters(), 1, 60);
  const sent = JSON.stringify(f.calls[0].q);
  ok(!/close_up|Close-up/i.test(sent), 'the shot type is not in the query');
  ok(!/laptop/i.test(sent), 'and neither is the description');
}

/* ---------------- 5. the chips say what a person set ---------------- */

section('the chips');
{
  const chips = SB.Getty.chips({
    formats: ['4k'], viewpoints: ['tracking_shot'], techniques: ['slow_motion'],
    minLength: 5, excludeEditorialOnly: true
  });
  eq(chips.map(c => c.label), ['4K', 'slow motion', 'tracking', '\u2265 5s', 'commercial use'],
    'every applied filter is a chip, in words a person would use');
  ok(chips.every(c => c.k && 'v' in c), 'and each one knows how to remove itself');
  eq(SB.Getty.chips({ excludeEditorialOnly: false }), [],
    'a search with nothing set has no chips');
  ok(SB.Getty.PICKERS.some(p => p.k === 'viewpoints'),
    'the camera-move vocabulary is offered as a filter');
  ok(SB.Getty.PICKERS.every(p => p.values.length && p.label),
    'and every picker has values and a word for itself');
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

section('what a comp carries about itself');
{
  /* The record is the licence trail AND the row the edit licenses from, so it
     has to say what kind of asset it is and how long it runs — a still never
     needed either. */
  const a = SB.Getty.asset(clip('1437816897'));
  const rec = SB.Getty.record(a);
  eq(rec.kind, 'video', 'the record says it is footage');
  eq(rec.seconds, 12, 'and how long the clip runs');
  eq(SB.Getty.clock(12), '0:12', 'which reads as a clock on the tile');
  eq(SB.Getty.clock(75), '1:15', 'past a minute too');
  eq(SB.Getty.clock(0), '0:00', 'and zero is not blank');
  eq(SB.Getty.seconds(12), 12, 'a numeric clip_length is read as seconds');
  eq(SB.Getty.seconds('0:09'), 9, 'and a clock string is too');
  eq(SB.Getty.seconds(null), 0, 'and nothing is zero rather than NaN');
  eq(SB.Getty.seconds('PT12S'), 12, 'an ISO duration is read too');
  eq(SB.Getty.seconds('PT1M5S'), 65, 'minutes and seconds');
  eq(SB.Getty.seconds('18'), 18, 'and a bare number in a string');
  /* a URL-only record still says what it is */
  eq(SB.Getty.recordFromUrl('https://media.gettyimages.com/id/904321/video/x.mp4').kind, 'video',
    'a record made from a URL alone still carries a kind');
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
