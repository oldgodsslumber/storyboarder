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
  Uint8Array, TextEncoder, URL, FormData: class { append() { } }
};
sandbox.window = sandbox;
vm.createContext(sandbox);

for (const f of ['js/util.js', 'js/doc.js', 'js/blobs.js', 'js/geminimodels.js', 'js/providers.js',
  'js/brand.js', 'js/renders.js', 'js/imagine.js', 'js/refs.js', 'js/personas.js', 'js/fields.js',
  'js/model.js', 'js/store.js']) {
  vm.runInContext(readFileSync(join(root, f), 'utf8'), sandbox, { filename: f });
}
const SB = sandbox.SB;

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

const b = SB.Imagine._bind(toolA, { prompt: 'x', slug: 'flux-dev', aspect: '21:9' });
t('an aspect the tool does not offer is dropped, not sent',
  b.aspect_ratio === undefined, b.aspect_ratio);

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
t('Kling arrives pointed at a Kling slug',
  p.settings.models.filter(m => m.name === 'Kling')[0].imagineSlug === 'kling-1.0-pro',
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

/* ----------------------------------------------------------- the catalog */
section('the model catalog');

t('the documented stills are offered', SB.Imagine.catalog('image').indexOf('flux-dev') >= 0, '');
t('the documented clips are offered', SB.Imagine.catalog('video').indexOf('kling-1.0-pro') >= 0, '');
t('and the two lists are not the same list',
  SB.Imagine.catalog('image').indexOf('kling-1.0-pro') < 0, '');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
