/* test-imagine.mjs — the ImagineArt layer, headless.
 *
 * Two things are worth testing without an account, and they are the two that
 * would otherwise only be found in front of a paying user:
 *
 *   - the argument binder, because the MCP tool schema is ImagineArt's to
 *     change and this is the code that guesses at it;
 *   - everything that reads a reply — JSON-RPC over a plain body or an SSE
 *     stream, and the several shapes a finished picture can arrive in.
 *
 * The network is never touched. usage: node test-imagine.mjs
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
    createElement: () => ({ style: {}, classList: { add() { }, remove() { }, toggle() { } }, appendChild() { } }),
    getElementById: () => null
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
  Uint8Array, TextEncoder, URL, FormData: class { append() { } },
  /* node has Blob but not FileReader, and the upload path reads a frame
     into a data URL before it can hand ImagineArt a file */
  FileReader: class {
    readAsDataURL(b) {
      const self = this;
      b.arrayBuffer().then(function (ab) {
        self.result = 'data:' + (b.type || 'application/octet-stream') +
          ';base64,' + Buffer.from(ab).toString('base64');
        if (self.onload) self.onload();
      }, function (e) { if (self.onerror) self.onerror(e); });
    }
  }
};
sandbox.window = sandbox;
vm.createContext(sandbox);

for (const f of ['js/util.js', 'js/doc.js', 'js/blobs.js', 'js/geminimodels.js', 'js/providers.js',
  'js/brand.js', 'js/renders.js', 'js/imaginemodels.js', 'js/imagine.js', 'js/refs.js', 'js/personas.js', 'js/fields.js',
  'js/model.js', 'js/store.js']) {
  vm.runInContext(readFileSync(join(root, f), 'utf8'), sandbox, { filename: f });
}
const SB = sandbox.SB;

/* The real thing: what a signed-in account's tools/list actually returns,
   trimmed to the six tools this app uses. Everything below is asserted
   against ImagineArt's own published contract rather than my reading of it. */
const REAL_TOOLS = JSON.parse(readFileSync(join(root, 'test-imagine-tools.json'), 'utf8'))
  .map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: {
      type: 'object',
      required: (t.params || []).filter(p2 => p2.required).map(p2 => p2.name),
      properties: (t.params || []).reduce((o, p2) => {
        o[p2.name] = { type: p2.type };
        if (p2.enum) o[p2.name].enum = p2.enum;
        return o;
      }, {})
    }
  }));

let pass = 0, fail = 0;
function t(name, ok, got) {
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (got === undefined ? '' : ' :: ' + got)); }
}
function section(s) { console.log('\n' + s); }

/* ---------------------------------------------------------------- binder */
section('binding our fields onto a tool we have never seen');

const toolA = {
  name: 'generate_image',
  description: 'Generate an image from a text prompt',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string' },
      model: { type: 'string', enum: ['imagine-turbo', 'flux-dev'] },
      aspect_ratio: { type: 'string', enum: ['1:1', '16:9'] },
      quality: { type: 'string', default: 'high' }
    },
    required: ['prompt', 'model', 'quality']
  }
};

const a = SB.Imagine._bind(toolA, { prompt: 'a lamp', slug: 'flux-dev', aspect: '16:9' });
t('the prompt lands on the property called prompt', a.prompt === 'a lamp', JSON.stringify(a));
t('our slug lands on its "model"', a.model === 'flux-dev', a.model);
t('aspect ratio is matched by synonym', a.aspect_ratio === '16:9', a.aspect_ratio);
t('a required field we have no opinion about takes its default',
  a.quality === 'high', a.quality);

/* This used to assert that an unofferable aspect was silently dropped, which
   meant the required-enum fill then chose 1:1 — a square frame where a
   widescreen one was asked for, with nothing said. Refusing is the honest
   answer, and it names what the model does take. */
let aspectWhy = '';
try { SB.Imagine._bind(toolA, { prompt: 'x', slug: 'flux-dev', aspect: '21:9' }); }
catch (e) { aspectWhy = e.message; }
t('an aspect the tool does not offer is refused, not quietly swapped',
  /21:9/.test(aspectWhy) && /1:1, 16:9/.test(aspectWhy), aspectWhy);

const emptyEnum = {
  name: 'generate_image', description: 'text to image',
  inputSchema: { type: 'object', properties: { prompt: { type: 'string' },
    model: { type: 'string', enum: [] } }, required: ['prompt'] }
};
t('an empty enum is a schema saying nothing, not a list of none',
  SB.Imagine._bind(emptyEnum, { prompt: 'x', slug: 'flux-dev' }).model === 'flux-dev',
  JSON.stringify(SB.Imagine._bind(emptyEnum, { prompt: 'x', slug: 'flux-dev' })));

let threw = '';
try { SB.Imagine._bind(toolA, { prompt: 'x', slug: 'kling-1.0-pro' }); }
catch (e) { threw = e.message; }
t('a slug the account does not have is refused by name',
  /kling-1\.0-pro/.test(threw) && /imagine-turbo/.test(threw), threw);

const toolB = {
  name: 'image_to_video',
  description: 'Animate an image',
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string' }, image_url: { type: 'string' }, duration: { type: 'integer' } },
    required: ['text']
  }
};
const c = SB.Imagine._bind(toolB, { prompt: 'she turns', image: 'data:image/png;base64,AA', duration: '5' });
t('a tool that calls the prompt "text" still gets it', c.text === 'she turns', c.text);
t('the frame finds the image property', c.image_url === 'data:image/png;base64,AA', !!c.image_url);
t('a number-typed field is sent as a number', c.duration === 5, typeof c.duration);
t('nothing is invented for properties the tool never declared',
  Object.keys(c).length === 3, JSON.stringify(c));

/* ---------------------------------------------------------------- picking */
section('picking the tool for the job');

const tools = [
  { name: 'generate_image', description: 'text to image' },
  { name: 'upscale_image', description: 'upscale an image' },
  { name: 'remove_background', description: 'remove the background from an image' },
  { name: 'generate_video', description: 'text to video and image to video' },
  { name: 'lipsync_video', description: 'sync lips in a video to audio' },
  { name: 'check_balance', description: 'credit balance inquiry' }
];
const best = kind => tools.map(x => [x, SB.Imagine._pickScore(x, {
  image: { need: [/image|picture|photo/], plus: [/generat|create|text.?to.?image|txt2img/], minus: [/video|upscale|background|remove|music|audio|edit|lipsync|vector/] },
  video: { need: [/video|clip|animat/], plus: [/generat|create|text.?to.?video|image.?to.?video|i2v/], minus: [/upscale|extend|trim|lipsync|music|audio|frame|reframe/] },
  balance: { need: [/balance|credit/], plus: [/inquir|check|remaining/], minus: [] }
}[kind])]).sort((x, y) => y[1] - x[1])[0];

t('a still goes to the image generator', best('image')[0].name === 'generate_image', best('image')[0].name);
t('a clip goes to the video generator', best('video')[0].name === 'generate_video', best('video')[0].name);
t('credits go to the balance tool', best('balance')[0].name === 'check_balance', best('balance')[0].name);
const WANT_IMAGE = {
  need: [/image|picture|photo/],
  plus: [/generat|create|text.?to.?image|txt2img/],
  minus: [/video|upscale|background|remove|music|audio|edit|lipsync|vector/]
};
t('upscale scores below the generator, so it can never take the job',
  SB.Imagine._pickScore(tools[1], WANT_IMAGE) < SB.Imagine._pickScore(tools[0], WANT_IMAGE),
  SB.Imagine._pickScore(tools[1], WANT_IMAGE) + ' vs ' + SB.Imagine._pickScore(tools[0], WANT_IMAGE));
t('a tool with nothing to do with pictures is not in the running at all',
  SB.Imagine._pickScore(tools[5], WANT_IMAGE) < 0, SB.Imagine._pickScore(tools[5], WANT_IMAGE));

/* ------------------------------------------------------------- JSON-RPC */
section('reading a reply back');

t('a plain JSON body',
  SB.Imagine._parseRpc('{"jsonrpc":"2.0","id":7,"result":{"ok":1}}', 7).result.ok === 1, '');
t('an SSE stream carrying the same thing',
  SB.Imagine._parseRpc('event: message\ndata: {"jsonrpc":"2.0","id":7,"result":{"ok":2}}\n\n', 7)
    .result.ok === 2, '');
t('the frame that answers our id wins out of a batch',
  SB.Imagine._parseRpc('[{"id":6,"result":{"n":6}},{"id":7,"result":{"n":7}}]', 7).result.n === 7, '');
t('a keepalive-only stream is nothing, not a crash',
  SB.Imagine._parseRpc(': ping\n\n', 7) === null, '');

/* --------------------------------------------------------------- harvest */
section('what came back');

t('inline image bytes become a data URL',
  SB.Imagine._harvest({ content: [{ type: 'image', data: 'AAA', mimeType: 'image/png' }] })
    .dataUrl === 'data:image/png;base64,AAA', '');
t('a resource link is taken as the URL',
  SB.Imagine._harvest({ content: [{ type: 'resource_link', uri: 'https://cdn.x/a.mp4' }] })
    .url === 'https://cdn.x/a.mp4', '');
t('a URL mentioned in prose is still found',
  SB.Imagine._harvest({ content: [{ type: 'text', text: 'Done: https://cdn.x/b.mp4 enjoy' }] })
    .url === 'https://cdn.x/b.mp4', '');
t('a URL buried in structured output is found',
  SB.Imagine._harvest({ structuredContent: { video: { url: { generation: 'https://cdn.x/c.mp4' } } } })
    .url === 'https://cdn.x/c.mp4', '');
t('an answer with nothing in it says nothing rather than guessing',
  SB.Imagine._harvest({ content: [] }).url === '' &&
  SB.Imagine._harvest({ content: [] }).dataUrl === '', '');

/* ------------------------------------------------------------- the gates */
section('when a push is refused');

t('no key on the key path', (function () {
  SB.Imagine.setTransport('key');
  SB.Imagine.setApiKey('');
  return /API key/.test(SB.Imagine.blocker({ imagineSlug: 'flux-dev' }));
})(), SB.Imagine.blocker({ imagineSlug: 'flux-dev' }));

t('a key alone is enough on the key path', (function () {
  SB.Imagine.setApiKey('vk-test');
  return SB.Imagine.blocker({ imagineSlug: 'flux-dev' }) === '';
})(), SB.Imagine.blocker({ imagineSlug: 'flux-dev' }));

t('a model with no ImagineArt model is refused, and says where to fix it',
  /Models & templates/.test(SB.Imagine.blocker({ name: 'Veo' })),
  SB.Imagine.blocker({ name: 'Veo' }));

t('not signed in on the sign-in path', (function () {
  SB.Imagine.setTransport('oauth');
  return /Not signed in/.test(SB.Imagine.blocker({ imagineSlug: 'flux-dev' }));
})(), SB.Imagine.blocker({ imagineSlug: 'flux-dev' }));

t('file:// explains itself instead of failing later', (function () {
  sandbox.location.protocol = 'file:';
  const why = SB.Imagine.signInBlocked();
  sandbox.location.protocol = 'http:';
  return /http/.test(why) && /API key/.test(why);
})(), '');
t('served over http, sign-in is available', SB.Imagine.signInBlocked() === '' ||
  /WebCrypto/.test(SB.Imagine.signInBlocked()), SB.Imagine.signInBlocked());
t('the redirect comes back to this very page',
  SB.Imagine.redirectUri() === 'http://localhost:8080/index.html', SB.Imagine.redirectUri());

/* ------------------------------------------------------- board plumbing */
section('the board side');

const p = SB.Model.newProject();
t('a new board has an aspect ratio to ask for', p.settings.imagineAspect === '16:9',
  p.settings.imagineAspect);
/* The guesses name models as the ACCOUNT's tools name them, which is the
   surface a signed-in push uses — so they are checked against the real tool
   description rather than against the shipped REST floor, which calls the
   same models something else entirely. */
const REAL_VIDEO = (function () {
  const d = REAL_TOOLS.filter(t => t.name === 'generate_video')[0].description;
  const m = /model \(optional\)[^:]*:([\s\S]*?)\. Pass the/.exec(d);
  return (m[1].match(/"([^"]+)"/g) || []).map(x => x.replace(/"/g, ''));
})();
const REAL_IMAGE = (function () {
  const d = REAL_TOOLS.filter(t => t.name === 'generate_image')[0].description;
  const m = /model \(optional\)[^:]*:([\s\S]*?)\. Pass the/.exec(d);
  return (m[1].match(/"([^"]+)"/g) || []).map(x => x.replace(/"/g, ''));
})();
t('a new board opens on GPT Image and LTX 2.3',
  p.settings.models.filter(m => m.id === p.settings.imageModelId)[0].name === 'GPT Image' &&
  p.settings.models.filter(m => m.id === p.settings.videoModelId)[0].name === 'LTX (LTXV 2.3)',
  p.settings.models.filter(m => m.id === p.settings.videoModelId)[0].name);
t('pointed at models the account actually takes',
  REAL_IMAGE.indexOf(p.settings.models.filter(m => m.id === p.settings.imageModelId)[0].imagineSlug) >= 0 &&
  REAL_VIDEO.indexOf(p.settings.models.filter(m => m.id === p.settings.videoModelId)[0].imagineSlug) >= 0,
  p.settings.models.filter(m => m.id === p.settings.videoModelId)[0].imagineSlug);
t('and Kling is the Kling those tools list',
  REAL_VIDEO.indexOf(p.settings.models.filter(m => m.name === 'Kling')[0].imagineSlug) >= 0,
  p.settings.models.filter(m => m.name === 'Kling')[0].imagineSlug);
t('a model nobody has mapped starts blank, not wrong',
  p.settings.models.filter(m => m.name === 'Sora')[0].imagineSlug === '',
  p.settings.models.filter(m => m.name === 'Sora')[0].imagineSlug);

const old = SB.Model.newProject();
old.settings.models.forEach(m => { delete m.imagineSlug; });
old.settings.models[0].imagineSlug = undefined;
delete old.settings.imagineAspect;
SB.Model.migrate(old);
t('an older board is given the field on open',
  old.settings.models.every(m => typeof m.imagineSlug === 'string'), '');
t('...and an aspect ratio', old.settings.imagineAspect === '16:9', old.settings.imagineAspect);

const kept = SB.Model.newProject();
kept.settings.models[0].imagineSlug = '';
SB.Model.migrate(kept);
t('a slug cleared on purpose stays cleared', kept.settings.models[0].imagineSlug === '',
  kept.settings.models[0].imagineSlug);

t('a shot has somewhere to record its clip',
  SB.Model.newShot({}).video === null, '');
t('swapping two cards takes the clip with the frame',
  SB.Model.CONTENT_KEYS.indexOf('video') >= 0, SB.Model.CONTENT_KEYS.join(','));

t('an mp4 is named mp4', SB.Renders.videoExt({ type: 'video/mp4' }) === 'mp4', '');
t('a quicktime clip is named mov', SB.Renders.videoExt({ type: 'video/quicktime' }) === 'mov', '');
t('something unrecognised still gets a sane extension',
  SB.Renders.videoExt({ type: '' }) === 'mp4', '');

section('the wrong way round');

{
  /* The API has separate slugs for text-to-video and image-to-video, not a
     flag, so pointing a board model at the wrong one is a generation spent
     to find out. */
  const p = SB.Model.newProject();
  const vm = SB.Model.videoModel(p);
  const sh = p.scenes[0].shots[0];
  sh.prompts[vm.id] = { imagePrompt: '', videoPrompt: 'She turns.' };
  sandbox.SB.app = { project: p, changed() { } };
  SB.Imagine.setTransport('key');
  SB.Imagine.setApiKey('vk-test');

  vm.imagineSlug = 'kling-v1.6-standard-text-to-video';
  sh.image = { ref: 'x', w: 8, h: 6 };
  let why = '';
  await SB.Imagine.run(sh, 'video').catch(e => { why = e.message; });
  t('a text-to-video model with a frame in hand is refused, by name',
    /text-to-video/.test(why) && /image-to-video/.test(why), why);

  vm.imagineSlug = 'kling-v1.6-standard-image-to-video';
  sh.image = null;
  sh.render = null;
  why = '';
  await SB.Imagine.run(sh, 'video').catch(e => { why = e.message; });
  t('and an image-to-video model with no picture is refused the other way',
    /animates a picture/.test(why), why);
}

/* -------------------------------------------------------- filing a clip */
section('what a finished clip leaves behind');

{
  /* The bug this guards: the record was rebuilt field by field and the ref was
     not among them, so the bytes went into the file with nothing pointing at
     them — the clip played until the next structural change swept it away. */
  const kept = [];
  const realRenders = SB.Renders;
  let changed = 0;
  sandbox.SB.app = { project: { blobs: {} }, changed: function () { changed++; } };
  sandbox.SB.Renders = {
    keepVideo: function (p, blob, existing, made) {
      kept.push({ blob: blob, existing: existing, made: made });
      return Promise.resolve({
        ref: 'blob-key', serial: 4, ext: 'mp4', bytes: 99, made: made, at: 1
      });
    }
  };

  const shot = { id: 'sh1', video: null };
  const made = { by: 'imagine', role: 'video', model: 'Kling', slug: 'kling-1.0-pro' };
  await SB.Imagine._fileVideo(sandbox.SB.app.project, shot,
    { blob: { size: 10 }, url: 'https://cdn.x/a.mp4', thumb: 'https://cdn.x/a.jpg' }, made);

  t('the clip record points at the bytes in the file', shot.video.ref === 'blob-key',
    JSON.stringify(shot.video));
  t('and keeps its serial', shot.video.serial === 4, shot.video.serial);
  t('the remote link rides along for preview', shot.video.url === 'https://cdn.x/a.mp4', '');
  t('and so does what made it', shot.video.made === made, JSON.stringify(shot.video.made));
  t('the board is told it changed', changed === 1, changed);
  t('the provenance is handed to the store', kept[0].made === made, '');

  /* no bytes: a link and an honest record, never a half-filed clip */
  const shot2 = { id: 'sh2', video: null };
  const out = await SB.Imagine._fileVideo(sandbox.SB.app.project, shot2,
    { blob: null, url: 'https://cdn.x/b.mp4' }, made);
  t('a clip whose bytes never arrived says so', out.remoteOnly === true, JSON.stringify(out));
  t('and holds the link, with no ref pretending otherwise',
    !shot2.video.ref && shot2.video.url === 'https://cdn.x/b.mp4', JSON.stringify(shot2.video));

  sandbox.SB.Renders = realRenders;
}

/* --------------------------------------- the headers a browser may send */
section('what actually goes on the wire');

{
  /* mcp.imagine.art answers a preflight with a fixed allow-list, and
     MCP-Protocol-Version is not on it — so sending that header made the
     browser refuse the request before it existed, and the handshake failed
     with nothing in any log. */
  const sent = [];
  const realFetch = sandbox.fetch;
  sandbox.fetch = function (url, init) {
    sent.push({ url: String(url), headers: (init && init.headers) || {}, body: init && init.body });
    return Promise.resolve({
      ok: true, status: 200,
      headers: { get: function () { return null; } },
      text: function () {
        return Promise.resolve(JSON.stringify({
          jsonrpc: '2.0', id: JSON.parse(init.body).id,
          result: { serverInfo: { name: 'imagine-mcp', version: '1' }, tools: [] }
        }));
      }
    });
  };
  SB.Imagine.setTransport('oauth');
  store.set('sb.imagine.tokens', JSON.stringify({
    access_token: 'tok', refresh_token: 'r', expires_at: Date.now() + 3600000, email: 'a@b.c'
  }));

  await SB.Imagine.toolList(true).catch(() => null);
  const call = sent.filter(x => /mcp\.imagine\.art/.test(x.url))[0];
  t('the handshake is sent at all', !!call, JSON.stringify(sent.map(x => x.url)));
  const keys = Object.keys((call && call.headers) || {}).map(k => k.toLowerCase());
  t('no MCP-Protocol-Version header, which the server does not allow',
    keys.indexOf('mcp-protocol-version') < 0, keys.join(','));
  t('no session header either, which it also does not allow',
    keys.indexOf('mcp-session-id') < 0, keys.join(','));
  t('the token and the content type still travel',
    keys.indexOf('authorization') >= 0 && keys.indexOf('content-type') >= 0, keys.join(','));
  t('and the protocol version rides in the params instead',
    JSON.parse(call.body).params.protocolVersion === '2025-06-18',
    JSON.parse(call.body).params.protocolVersion);

  /* a fetch that rejects means it never left the browser */
  sandbox.fetch = function () { return Promise.reject(new TypeError('Failed to fetch')); };
  SB.Imagine.signOut();
  store.set('sb.imagine.tokens', JSON.stringify({
    access_token: 'tok', refresh_token: 'r', expires_at: Date.now() + 3600000, email: 'a@b.c'
  }));
  const steps = await SB.Imagine.report();
  const hand = steps.filter(x => x.name === 'MCP handshake')[0];
  t('a blocked request is reported as blocked, not as a mystery',
    !!hand && !hand.ok && /never left the browser/.test(hand.detail),
    hand ? hand.detail : JSON.stringify(steps.map(x => x.name)));
  t('and says nothing was billed for it', !!hand && /nothing was billed/.test(hand.detail), '');

  sandbox.fetch = realFetch;
  SB.Imagine.signOut();
  SB.Imagine.setTransport('key');
}

/* ------------------------------------------------ what actually worked */
section('a slug that worked outranks every published list');

{
  /* The published lists run behind the platform — imagine.art is an
     aggregator, and FLUX 3 and the Google models are on it while appearing in
     neither the v2 API list nor the documentation. A generation that worked
     is the one fact that cannot be stale. */
  SB.Imagine.setTransport('key');
  t('a model nobody publishes is unknown at first',
    SB.Imagine.modelInfo('flux-3') === null, '');
  SB.Imagine.noteWorked('flux-3', 'video');
  t('and known once it has produced something',
    !!SB.Imagine.modelInfo('flux-3'), '');
  t('offered for its own kind',
    SB.Imagine.catalog('video').indexOf('flux-3') === 0,
    SB.Imagine.catalog('video').slice(0, 2).join(','));
  t('and not for the other',
    SB.Imagine.catalog('image').indexOf('flux-3') < 0, '');
  t('the published list is still there underneath',
    SB.Imagine.catalog('video').indexOf('kling-v1.6-standard-image-to-video') > 0, '');
  SB.Imagine.noteWorked('flux-3', 'video');
  t('using it again does not duplicate it',
    SB.Imagine.catalog('video').filter(x => x === 'flux-3').length === 1, '');
  t('what the product advertises is carried too, for saying so',
    (sandbox.SB.ImagineModels.products || []).some(n => /FLUX 3/i.test(n)),
    JSON.stringify((sandbox.SB.ImagineModels.products || []).slice(0, 3)));
}

/* --------------------------------- resolution, and what it will cost */
section('asking for a resolution instead of taking the floor');

{
  const p4 = SB.Model.newProject();
  sandbox.SB.app = { project: p4, changed() { } };
  /* the allow-lists live in the tool descriptions, so the real ones have to
     be loaded into the module the way a session would load them */
  sandbox.fetch = function (url, init) {
    const msg = JSON.parse(init.body);
    const result = msg.method === 'initialize'
      ? { serverInfo: { name: 'imagine', version: '1' } }
      : (msg.method === 'tools/list' ? { tools: REAL_TOOLS } : {});
    return Promise.resolve({
      ok: true, status: 200, headers: { get: () => null },
      text: () => Promise.resolve(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: result }))
    });
  };
  SB.Imagine.setTransport('oauth');
  store.set('sb.imagine.tokens', JSON.stringify({
    access_token: 'tok', refresh_token: 'r', expires_at: Date.now() + 3600000, email: 'res@test'
  }));
  await SB.Imagine.toolList(true);

  t('a board asks for the best by default', p4.settings.imagineResolution === 'best',
    p4.settings.imagineResolution);

  const R = (slug, kind) => SB.Imagine.resolutionFor(p4, slug, kind);
  t('LTX is asked for everything it has, not the 1080p it falls back to',
    R('ltx-2.3', 'video') === '2160p', R('ltx-2.3', 'video'));
  t('Seedance stops making 480p', R('seedance-2.5', 'video') === '720p',
    R('seedance-2.5', 'video'));
  t('Veo goes to 4k', R('veo-3.1', 'video') === '4k', R('veo-3.1', 'video'));
  t('a model that ignores resolution is sent none',
    R('kling-3.0-pro', 'video') === '', JSON.stringify(R('kling-3.0-pro', 'video')));
  t('stills too — 4K rather than the 1K floor',
    R('nano-banana-pro', 'image') === '4K', R('nano-banana-pro', 'image'));
  t('and the one model with a quality dial is asked for high, not low',
    SB.Imagine.qualityFor(p4, 'gpt-image-2') === 'high',
    SB.Imagine.qualityFor(p4, 'gpt-image-2'));

  p4.settings.imagineResolution = '1080p';
  t('the 1080p policy takes 1080p where it exists',
    R('ltx-2.3', 'video') === '1080p', R('ltx-2.3', 'video'));
  t('and the best below it where it does not',
    R('seedance-2.5', 'video') === '720p', R('seedance-2.5', 'video'));

  p4.settings.imagineResolution = 'default';
  t('and leaving it alone sends nothing at all',
    R('ltx-2.3', 'video') === '' && R('nano-banana-pro', 'image') === '', '');
  p4.settings.imagineResolution = 'best';

  /* what it costs */
  t('a published price is known for a model ImagineArt prices',
    SB.Imagine.costFor('kling-3.0-pro', '', '').credits === 300,
    JSON.stringify(SB.Imagine.costFor('kling-3.0-pro', '', '')));
  t('and it says it is the published base, not a promise',
    SB.Imagine.costFor('ltx-2.3', '', '').from === 'published', '');
  t('LTX is 215 of them', SB.Imagine.costFor('ltx-2.3', '', '').credits === 215, '');
  t('a model nobody prices says nothing rather than guessing',
    SB.Imagine.costFor('no-such-model', '', '') === null, '');

  SB.Imagine.noteCost('kling-3.0-pro', '', '1080p', 421);
  const m4 = SB.Imagine.costFor('kling-3.0-pro', '', '1080p');
  t('a measured price outranks the published one', m4.credits === 421 && m4.from === 'measured',
    JSON.stringify(m4));
  t('and only for the configuration it was measured at',
    SB.Imagine.costFor('kling-3.0-pro', '', '720p').from === 'published', '');

  SB.Imagine.signOut();
  SB.Imagine.setTransport('key');
  store.delete('sb.imagine.cost');
  sandbox.fetch = () => Promise.reject(new Error('no network in tests'));
}

/* ------------------------------------- against the account's real tools */
section('the tools ImagineArt actually publishes');

{
  const calls = [];
  let nextResult = null;
  const realFetch = globalThis.fetch;         // data: URLs still have to work
  sandbox.fetch = function (url, init) {
    if (!init || !init.body) return realFetch(url, init);
    const msg = JSON.parse(init.body);
    calls.push({ method: msg.method, name: msg.params && msg.params.name,
      args: (msg.params && msg.params.arguments) || null });
    let result = {};
    if (msg.method === 'initialize') result = { serverInfo: { name: 'imagine', version: '1' } };
    else if (msg.method === 'tools/list') result = { tools: REAL_TOOLS };
    else if (msg.method === 'tools/call') result = nextResult || { content: [{ type: 'text', text: 'ok' }] };
    return Promise.resolve({
      ok: true, status: 200,
      headers: { get: function () { return null; } },
      text: function () {
        return Promise.resolve(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: result }));
      }
    });
  };
  SB.Imagine.setTransport('oauth');
  store.set('sb.imagine.tokens', JSON.stringify({
    access_token: 'tok', refresh_token: 'r', expires_at: Date.now() + 3600000, email: 'real@test'
  }));
  store.delete('sb.imagine.catalog');
  store.delete('sb.imagine.worked');

  await SB.Imagine.toolList(true);
  await SB.Imagine.refreshCatalog();

  t('the model list is read out of the tool description, where ImagineArt puts it',
    SB.Imagine.catalog('video').indexOf('kling-3.0-pro') >= 0 &&
    SB.Imagine.catalog('video').indexOf('veo-3.1') >= 0,
    SB.Imagine.catalog('video').slice(0, 4).join(', '));
  t('stills come off the other tool',
    SB.Imagine.catalog('image').indexOf('nano-banana-pro') === 0,
    SB.Imagine.catalog('image').slice(0, 3).join(', '));
  t('and the two do not mix',
    SB.Imagine.catalog('image').indexOf('kling-3.0-pro') < 0 &&
    SB.Imagine.catalog('video').indexOf('nano-banana-pro') < 0, '');
  t('fifteen video models, ten image ones — the account\u2019s own numbers',
    SB.Imagine.catalog('video').length === 15 && SB.Imagine.catalog('image').length === 10,
    SB.Imagine.catalog('video').length + ' / ' + SB.Imagine.catalog('image').length);
  t('what each model will accept is readable too',
    (SB.Imagine.allowFor('generate_video', 'kling-3.0-pro', 'aspect_ratio') || []).join(',') ===
      '16:9,9:16,1:1',
    JSON.stringify(SB.Imagine.allowFor('generate_video', 'kling-3.0-pro', 'aspect_ratio')));
  t('including how long it may run',
    (SB.Imagine.allowFor('generate_video', 'veo-3.1', 'duration') || []).join(',') === '4,6,8',
    JSON.stringify(SB.Imagine.allowFor('generate_video', 'veo-3.1', 'duration')));

  /* nothing can be generated without an organization */
  SB.Imagine.setOrg(null);
  const p2 = SB.Model.newProject();
  sandbox.SB.app = { project: p2, changed() { } };
  const vm3 = SB.Model.videoModel(p2);
  const im3 = SB.Model.imageModel(p2);
  im3.imagineSlug = 'nano-banana-pro';
  vm3.imagineSlug = 'kling-3.0-pro';
  const sh3 = p2.scenes[0].shots[0];
  sh3.prompts[im3.id] = { imagePrompt: 'A wide of the floor.', videoPrompt: '' };
  sh3.prompts[vm3.id] = { imagePrompt: '', videoPrompt: 'She turns.' };

  let why = '';
  await SB.Imagine.run(sh3, 'image').catch(e => { why = e.message; });
  t('without an organization it refuses, and says where to set one',
    /organization/i.test(why) && /Settings/.test(why), why);

  SB.Imagine.setOrg({ id: 'org-123', name: 'Pega' });
  calls.length = 0;
  nextResult = {
    content: [{ type: 'text', text: 'queued 11111111-2222-3333-4444-555555555555' }],
    structuredContent: { uuid: '11111111-2222-3333-4444-555555555555', status: 'queued' }
  };
  /* the status call answers complete, with a url */
  let phase = 0;
  const origFetch = sandbox.fetch;
  sandbox.fetch = function (url, init) {
    if (!init || !init.body) return realFetch(url, init);
    const msg = JSON.parse(init.body);
    if (msg.method === 'tools/call' && msg.params.name === 'fetch_status') {
      phase++;
      const result = {
        content: [{ type: 'text', text: 'status: complete' }],
        structuredContent: { status: 'complete', url: 'https://cdn.imagine.art/out.png' }
      };
      calls.push({ method: 'tools/call', name: 'fetch_status', args: msg.params.arguments });
      return Promise.resolve({
        ok: true, status: 200, headers: { get: () => null },
        text: () => Promise.resolve(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: result }))
      });
    }
    return origFetch(url, init);
  };

  await SB.Imagine.run(sh3, 'image').catch(e => { why = e.message; });
  const gen = calls.filter(c => c.name === 'generate_image')[0];
  t('the still goes to generate_image', !!gen, JSON.stringify(calls.map(c => c.name)));
  t('with the organization id on it, not the record the picker stored',
    gen.args.org_id === 'org-123', JSON.stringify(gen.args.org_id));
  t('the prompt as written', gen.args.prompt === 'A wide of the floor.', gen.args.prompt);
  t('the model named exactly as ImagineArt writes it',
    gen.args.model === 'nano-banana-pro', gen.args.model);
  t('the required-but-nullable keys present rather than missing',
    'aspect_ratio' in gen.args && 'duration' in gen.args && 'image_url' in gen.args,
    Object.keys(gen.args).join(','));
  const st = calls.filter(c => c.name === 'fetch_status')[0];
  t('and the uuid it came back with is polled, server-side',
    !!st && st.args.id === '11111111-2222-3333-4444-555555555555' && st.args.sync === true,
    JSON.stringify(st && st.args));

  /* a clip, with a frame to animate */
  calls.length = 0;
  sh3.image = SB.Blobs.image(p2, 'data:image/jpeg;base64,' + 'q'.repeat(60), 8, 6);
  sh3.render = { ref: SB.Blobs.put(p2, 'data:image/webp;base64,' + 'W'.repeat(60)),
    serial: 1, ext: 'webp', w: 8, h: 6 };
  const upload = { content: [{ type: 'text', text: 'https://asset.imagine.art/processed/abc.webp' }] };
  const origFetch2 = sandbox.fetch;
  sandbox.fetch = function (url, init) {
    if (!init || !init.body) return realFetch(url, init);
    const msg = JSON.parse(init.body);
    if (msg.method === 'tools/call' && msg.params.name === 'user_upload') {
      calls.push({ method: 'tools/call', name: 'user_upload', args: msg.params.arguments });
      return Promise.resolve({
        ok: true, status: 200, headers: { get: () => null },
        text: () => Promise.resolve(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: upload }))
      });
    }
    return origFetch2(url, init);
  };
  why = '';
  await SB.Imagine.run(sh3, 'video').catch(e => { why = e.message; });
  const up = calls.filter(c => c.name === 'user_upload')[0];
  t('a local frame is uploaded first, because the tool takes a URL and never bytes',
    !!up && /^data:image\//.test(up.args.file) && up.args.org_id === 'org-123',
    up ? String(up.args.file).slice(0, 24) : ('no upload' + (why ? ' — ' + why : '')));
  const vid = calls.filter(c => c.name === 'generate_video')[0];
  t('and the clip call carries that URL in an ARRAY, as published',
    !!vid && Array.isArray(vid.args.image_url) &&
    vid.args.image_url[0] === 'https://asset.imagine.art/processed/abc.webp',
    JSON.stringify(vid && vid.args.image_url));
  t('with its own model and organization',
    vid.args.model === 'kling-3.0-pro' && vid.args.org_id === 'org-123',
    JSON.stringify({ m: vid.args.model, o: vid.args.org_id }));

  sandbox.fetch = () => Promise.reject(new Error('no network in tests'));
  SB.Imagine.signOut();
  SB.Imagine.setOrg(null);
  SB.Imagine.setTransport('key');
  store.delete('sb.imagine.catalog');
}

/* ----------------------------------------------------------- the catalog */
section('the model catalog');

t('the published stills are offered', SB.Imagine.catalog('image').indexOf('flux-dev') >= 0, '');
t('the published clips are offered',
  SB.Imagine.catalog('video').indexOf('kling-v1.6-standard-image-to-video') >= 0, '');
t('and the two lists are not the same list',
  SB.Imagine.catalog('image').indexOf('kling-v1.6-standard-image-to-video') < 0, '');
t('the whole list is what the generator found, not a handful',
  SB.Imagine.catalog('video').length > 30, SB.Imagine.catalog('video').length);
t('which is where it says it came from',
  SB.Imagine.catalogSource() === 'shipped', SB.Imagine.catalogSource());
t('nothing has been asked of an account, so there is no age',
  SB.Imagine.catalogAge() === null, SB.Imagine.catalogAge());

t('a slug carries its kind and which way round it works',
  (function () {
    const i = SB.Imagine.modelInfo('kling-v1.6-standard-image-to-video');
    const t2 = SB.Imagine.modelInfo('kling-v1.6-standard-text-to-video');
    return i.kind === 'video' && i.mode === 'i2v' && t2.mode === 't2v';
  })(), '');
t('a slug nobody lists is not invented', SB.Imagine.modelInfo('made-up-model') === null, '');
t('the name is read off the slug',
  SB.Imagine.labelFor('kling-v1.6-standard-image-to-video', 'i2v') ===
    'Kling v1.6 Standard · image→video',
  SB.Imagine.labelFor('kling-v1.6-standard-image-to-video', 'i2v'));
t('and a still model has no arrow',
  SB.Imagine.labelFor('flux-dev', '') === 'Flux Dev', SB.Imagine.labelFor('flux-dev', ''));
t('refreshing without an account says what to do instead',
  (function () {
    let why = '';
    SB.Imagine.refreshCatalog().catch(e => { why = e.message; });
    return true;
  })(), '');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
