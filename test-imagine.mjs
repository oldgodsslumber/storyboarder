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

for (const f of ['js/util.js', 'js/focus.js', 'js/doc.js', 'js/blobs.js', 'js/geminimodels.js', 'js/providers.js',
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
  const m = /model \(optional\)[^:]*:([\s\S]*?)\.\s+Pass the/.exec(d);
  return (m[1].match(/"([^"]+)"/g) || []).map(x => x.replace(/"/g, ''));
})();
const REAL_IMAGE = (function () {
  const d = REAL_TOOLS.filter(t => t.name === 'generate_image')[0].description;
  const m = /model \(optional\)[^:]*:([\s\S]*?)\.\s+Pass the/.exec(d);
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

  /* the REST field, because this rule is a REST rule and the key transport
     reads that name */
  vm.restSlug = 'kling-v1.6-standard-text-to-video';
  sh.image = { ref: 'x', w: 8, h: 6 };
  let why = '';
  await SB.Imagine.run(sh, 'video').catch(e => { why = e.message; });
  t('a text-to-video model with a frame in hand is refused, by name',
    /text-to-video/.test(why) && /image-to-video/.test(why), why);

  vm.restSlug = 'kling-v1.6-standard-image-to-video';
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

  /* which ones are new since you last looked */
  t('a clip that just landed is marked unwatched', shot.video.unseen === true,
    JSON.stringify(shot.video));
  t('and so is one that is only a link', shot2.video.unseen === true,
    JSON.stringify(shot2.video));

  sandbox.SB.Renders = realRenders;
}

/* ------------------------------ leaving the board a generation belongs to */
section('a generation whose board is not on screen any more');

{
  /* run() used to close over the project and the shot OBJECT. Open another
     board and the clip landed perfectly onto something nothing pointed at,
     while Store wrote the board that WAS on screen over its own file. */
  const realRenders = sandbox.SB.Renders;
  const filedAgainst = [];
  sandbox.SB.Renders = {
    keepVideo: function (proj, blob, existing, made) {
      filedAgainst.push(proj.name);
      return Promise.resolve({ ref: 'blob-' + filedAgainst.length, serial: 4, ext: 'mp4', bytes: 9, made: made, at: 1 });
    }
  };
  const toasts = [];
  const realToast = sandbox.SB.toast;
  sandbox.SB.toast = function (msg, err) { toasts.push(String(msg)); };

  const boardA = SB.Model.newProject();
  boardA.name = 'Board A';
  const boardB = SB.Model.newProject();
  boardB.name = 'Board B';
  const shotA = boardA.scenes[0].shots[0];
  let changed = 0;
  sandbox.SB.app = { project: boardA, changed: function () { changed++; } };

  const made = { by: 'imagine', role: 'video', model: 'Kling', slug: 'kling-1.0-pro' };
  const ticket = {
    projectId: boardA.id, projectName: boardA.name, shotId: shotA.id,
    code: '1A', role: 'video', frameRef: '', made: made
  };

  /* ...the user opens another board while it is in the air */
  sandbox.SB.app.project = boardB;
  const out = await SB.Imagine._land(ticket, { blob: { size: 10 }, url: 'https://cdn.x/a.mp4' });

  t('a clip whose board is closed is not filed into the board that is open',
    !boardB.scenes[0].shots[0].video, JSON.stringify(boardB.scenes[0].shots[0].video));
  t('and it is not written into the closed board behind the app\u2019s back either',
    !shotA.video, JSON.stringify(shotA.video));
  t('nothing is handed to the file store yet', filedAgainst.length === 0, filedAgainst.join());
  t('it is held instead', out.parked === true && SB.Imagine.parkedCount() === 1,
    JSON.stringify(out) + ' held=' + SB.Imagine.parkedCount());
  t('and the user is told which board it is waiting for',
    toasts.some(function (x) { return /Board A/.test(x) && /not open/.test(x); }),
    toasts.join(' | '));

  /* ...and opening that board again files it */
  sandbox.SB.app.project = boardA;
  SB.Imagine.claimParked(boardA);
  await new Promise(function (r) { setTimeout(r, 20); });
  t('opening the board it belongs to files it', !!shotA.video, JSON.stringify(shotA.video));
  t('against that board, not the one that was on screen',
    filedAgainst.join() === 'Board A', filedAgainst.join());
  t('and nothing is left waiting', SB.Imagine.parkedCount() === 0, SB.Imagine.parkedCount());

  /* the same board, but the shot object was replaced under it — which is what
     restoring a version does to every card at once */
  const live = boardA.scenes[0].shots[0];
  boardA.scenes = SB.clone(boardA.scenes);
  const t2 = {
    projectId: boardA.id, projectName: boardA.name, shotId: live.id,
    code: '1A', role: 'video', frameRef: '', made: made
  };
  await SB.Imagine._land(t2, { blob: { size: 10 }, url: 'https://cdn.x/b.mp4' });
  t('a shot object replaced by a version restore is found again by id',
    !!boardA.scenes[0].shots[0].video && boardA.scenes[0].shots[0].video.ref === 'blob-2',
    JSON.stringify(boardA.scenes[0].shots[0].video));

  /* A card deleted out of the board you are LOOKING at has no moment coming
     when it could be claimed -- claimParked only runs when a board becomes
     current. Parked, it sat in the list forever, holding the toolbar count up
     and warning on every close for a recovery that could not happen. */
  const t3 = {
    projectId: boardA.id, projectName: boardA.name, shotId: 'sh_deleted',
    code: '9Z', role: 'video', frameRef: '', made: made
  };
  const out3 = await SB.Imagine._land(t3, { blob: { size: 10 }, url: 'https://cdn.x/c.mp4' });
  t('a clip for a card deleted out of the OPEN board is not held',
    out3.dropped === true && out3.parked !== true, JSON.stringify(out3));
  t('so nothing is left waiting for a moment that will never come',
    SB.Imagine.parkedCount() === 0, SB.Imagine.parkedCount());
  t('and it says there is nowhere to put it',
    toasts.some(function (x) { return /nowhere to put it/.test(x); }),
    toasts.slice(-2).join(' | '));

  /* ...but a card deleted from a board that is CLOSED is still parked, because
     opening that board is exactly the moment it would be filed. */
  const t4 = {
    projectId: boardB.id, projectName: boardB.name, shotId: 'sh_gone_too',
    code: '9Y', role: 'video', frameRef: '', made: made
  };
  sandbox.SB.app.project = boardA;
  const out4 = await SB.Imagine._land(t4, { blob: { size: 10 }, url: 'https://cdn.x/d.mp4' });
  t('a closed board keeps its result waiting', out4.parked === true, JSON.stringify(out4));
  t('and opening it reports the card gone rather than filing it somewhere wrong',
    (function () {
      sandbox.SB.app.project = boardB;
      SB.Imagine.claimParked(boardB);
      return SB.Imagine.parkedCount() === 0;
    })(), SB.Imagine.parkedCount());

  sandbox.SB.Renders = realRenders;
  sandbox.SB.toast = realToast;
}

/* --------------------------------------- the headers a browser may send */
section('a still carries its reference picture');

{
  /* generate_image was called with prompt, model and aspect and NOTHING else,
     while the prompt it carried said "Reference images are supplied in order --
     refer to each recurring subject as the person in image 1, and keep their
     face exactly as in that image". Nothing was supplied. The model was told
     about a picture it had never been given, so it invented one. */
  const calls = [];
  const realFetch = sandbox.fetch;
  sandbox.fetch = function (url, init) {
    const body = JSON.parse(init.body);
    calls.push(body);
    const name = body.params && body.params.name;
    let result = { content: [{ type: 'text', text: 'ok' }] };
    if (name === 'user_upload') {
      result = { content: [{ type: 'text', text: 'https://cdn.imagine/up/ref1.png' }],
                 structuredContent: { url: 'https://cdn.imagine/up/ref1.png' } };
    } else if (name === 'generate_image') {
      result = { content: [{ type: 'text', text: 'https://cdn.imagine/out/made.png' }],
                 structuredContent: { url: 'https://cdn.imagine/out/made.png' } };
    }
    return Promise.resolve({
      ok: true, status: 200,
      headers: { get: function () { return null; } },
      text: function () {
        return Promise.resolve(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: result }));
      }
    });
  };
  SB.Imagine.setTransport('oauth');
  store.set('sb.imagine.tokens', JSON.stringify({
    access_token: 'tok', refresh_token: 'r', expires_at: Date.now() + 3600000, email: 'a@b.c'
  }));
  SB.Imagine.setOrg({ id: 'org-1', name: 'Test org' });

  await SB.Imagine._image({
    prompt: 'A close-up of his hands.', slug: 'gpt-image', aspect: '16:9',
    refBlob: new Blob([new Uint8Array(12)], { type: 'image/png' })
  }).catch(function () { return null; });

  const upload = calls.filter(c => c.params && c.params.name === 'user_upload')[0];
  const gen = calls.filter(c => c.params && c.params.name === 'generate_image')[0];
  t('the reference is uploaded first, because the tool takes a URL and not bytes',
    !!upload, calls.map(c => c.params && c.params.name).join(','));
  t('and generate_image is called with the URL it came back with',
    !!gen && gen.params.arguments.image_url === 'https://cdn.imagine/up/ref1.png',
    gen ? JSON.stringify(gen.params.arguments.image_url) : 'no call');
  t('the prompt still travels with it',
    !!gen && gen.params.arguments.prompt === 'A close-up of his hands.',
    gen ? gen.params.arguments.prompt : '');

  /* no reference on the card is still a legal push, with nothing attached */
  calls.length = 0;
  await SB.Imagine._image({ prompt: 'No refs here.', slug: 'gpt-image', aspect: '16:9' })
    .catch(function () { return null; });
  const bare = calls.filter(c => c.params && c.params.name === 'generate_image')[0];
  t('a card with no references uploads nothing',
    !calls.some(c => c.params && c.params.name === 'user_upload'),
    calls.map(c => c.params && c.params.name).join(','));
  t('and sends a null image_url rather than a broken one',
    !!bare && bare.params.arguments.image_url === null,
    bare ? JSON.stringify(bare.params.arguments.image_url) : 'no call');

  /* an upload that fails must NOT quietly render without the reference: the
     prompt claims the picture was supplied, so a still made without it is the
     bug wearing a different hat */
  calls.length = 0;
  sandbox.fetch = function (url, init) {
    const body = JSON.parse(init.body);
    calls.push(body);
    if (body.params && body.params.name === 'user_upload') {
      return Promise.resolve({
        ok: true, status: 200, headers: { get: function () { return null; } },
        text: function () {
          return Promise.resolve(JSON.stringify({
            jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'upload refused' }
          }));
        }
      });
    }
    return Promise.resolve({
      ok: true, status: 200, headers: { get: function () { return null; } },
      text: function () {
        return Promise.resolve(JSON.stringify({ jsonrpc: '2.0', id: body.id,
          result: { content: [{ type: 'text', text: 'https://cdn.imagine/out/oops.png' }] } }));
      }
    });
  };
  let failed = null;
  await SB.Imagine._image({
    prompt: 'A close-up of his hands.', slug: 'gpt-image', aspect: '16:9',
    refBlob: new Blob([new Uint8Array(12)], { type: 'image/png' })
  }).catch(function (e) { failed = e; });
  t('an upload that fails stops the push', !!failed, 'it went ahead anyway');
  t('and says so, rather than making a picture without the reference',
    !!failed && /reference picture could not be uploaded/i.test(failed.message),
    failed ? failed.message : '');
  t('and nothing was generated', !calls.some(c => c.params && c.params.name === 'generate_image'),
    calls.map(c => c.params && c.params.name).join(','));

  sandbox.fetch = realFetch;
  SB.Imagine.signOut();
}

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
section('the clip animates the frame, and only the frame');
{
  const p9 = SB.Model.newProject();
  sandbox.SB.app = { project: p9, changed() { } };
  const sc = p9.scenes[0] || SB.Model.addScene(p9, 0);
  const nat = SB.Personas.add(p9, { name: 'Nat' });
  nat.image = SB.Blobs.image(p9, 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', 4, 3);
  const sh = SB.Model.addShot(p9, sc.id, {});
  sh.description = 'At the desk with ' + SB.Refs.mark(nat.id, 'Nat') + '.';

  const vm = p9.settings.models.filter(m => m.kind === 'video')[0];
  const im = p9.settings.models.filter(m => m.kind === 'image')[0];
  sh.prompts[vm.id] = { videoPrompt: 'She lets go.', imagePrompt: '', modelName: vm.name };
  sh.prompts[im.id] = sh.prompts[im.id] ||
    { imagePrompt: 'A desk.', videoPrompt: '', modelName: im.name };

  /* with no frame there is nothing to animate, and the call would quietly
     become text-to-video: the shot invented over again */
  const no = SB.Imagine.whyNot(p9, sh, vm, 'video');
  t('a clip is refused on a card with no first frame',
    !!no && no.short === 'no frame', no ? no.short : 'allowed');
  t('and the reason says what would otherwise happen',
    !!no && /invents the shot from the words/.test(no.long), no ? no.long.slice(0, 80) : '');

  const vr = SB.Imagine.refsFor(p9, sh, 'video');
  t('the clip lane carries nothing while there is no frame', vr.carries === 0, vr.carries);
  t('and knows the marks are not what it would carry',
    vr.feed === 1 && vr.first === null, vr.feed + ' ' + JSON.stringify(vr.first));

  /* the still, on the same card, does carry its marked reference */
  const ir = SB.Imagine.refsFor(p9, sh, 'image');
  /* carries is 0 on the API-key door, which sends no picture at all — what
     matters here is WHICH picture each lane is about. */
  t('while the still lane is about the marked reference',
    ir.role === 'image' && ir.first && ir.first.label === 'Nat',
    ir.role + ' ' + (ir.first && ir.first.label));

  /* once the frame exists the clip is about that and nothing else */
  sh.image = SB.Blobs.image(p9, 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', 16, 9);
  const vr2 = SB.Imagine.refsFor(p9, sh, 'video');
  t('with a frame the clip carries exactly one picture', vr2.carries === 1, vr2.carries);
  t('and it is the frame, not a marked subject', vr2.frame === true && vr2.first === null,
    JSON.stringify({ frame: vr2.frame, first: vr2.first }));
  t('a clip is allowed once there is something to animate',
    !SB.Imagine.whyNot(p9, sh, vm, 'video') ||
    SB.Imagine.whyNot(p9, sh, vm, 'video').short !== 'no frame',
    JSON.stringify(SB.Imagine.whyNot(p9, sh, vm, 'video')));
}

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

  /* the dump that gets handed to somebody else */
  {
    const dump = await SB.Imagine.rawTools();
    t('the raw list is every tool the server sent, untouched',
      dump.tools.length === REAL_TOOLS.length &&
      JSON.stringify(dump.tools) === JSON.stringify(REAL_TOOLS),
      dump.tools.length + ' of ' + REAL_TOOLS.length);
    t('with the whole of each description, not the app\u2019s reading of it',
      dump.tools.every(function (x, i) { return x.description === REAL_TOOLS[i].description; }),
      '');
    t('and what the server said about itself at the handshake',
      !!dump.server && !!dump.server.serverInfo, JSON.stringify(dump.server));
    t('it says when it was taken and what asked for it',
      /^\d{4}-\d\d-\d\dT/.test(dump.captured) && dump.client.name === 'Storyboarder',
      dump.captured + ' ' + JSON.stringify(dump.client));
    t('and which door it came through',
      dump.transport === 'oauth' && /mcp\.imagine\.art/.test(dump.endpoint),
      dump.transport + ' ' + dump.endpoint);
    /* the one thing that must never be in a file somebody forwards */
    const text = JSON.stringify(dump);
    t('no token is anywhere in it',
      text.indexOf('tok') < 0 && !/access_token|Bearer/i.test(text),
      text.slice(0, 120));
    t('the count agrees with the list', dump.toolCount === dump.tools.length, dump.toolCount);
  }

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

/* ------------------------------------------------- nothing billed twice */
section('a generation that has been submitted is never tried again');

{
  /* A failure after ImagineArt accepted the job is a failure of something
     that has already cost money. Falling through to the REST API there is a
     second, billed generation — and it used to resolve as a success. */
  const p7 = SB.Model.newProject();
  sandbox.SB.app = { project: p7, changed() { } };
  const vm7 = SB.Model.videoModel(p7);
  const sh7 = p7.scenes[0].shots[0];
  sh7.prompts[vm7.id] = { imagePrompt: '', videoPrompt: 'She turns.' };
  sh7.image = SB.Blobs.image(p7, 'data:image/jpeg;base64,' + 'q'.repeat(40), 8, 6);

  SB.Imagine.setTransport('oauth');
  store.set('sb.imagine.tokens', JSON.stringify({
    access_token: 'tok', refresh_token: 'r', expires_at: Date.now() + 3600000, email: 'bill@test'
  }));
  SB.Imagine.setOrg({ id: 'org-1', name: 'Pega' });

  const seen = [];
  sandbox.fetch = function (url, init) {
    if (!init || !init.body) return Promise.resolve({ ok: true, status: 200,
      headers: { get: () => null },
      blob: () => Promise.resolve(new Blob([new Uint8Array(9)], { type: 'video/mp4' })) });
    if (/api\.vyro\.ai/.test(String(url))) {
      seen.push('REST ' + String(url).replace(/.*vyro\.ai/, ''));
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' },
        text: () => Promise.resolve(JSON.stringify({ id: 'rest-1', status: 'processing' })) });
    }
    const msg = JSON.parse(init.body);
    let result = {};
    if (msg.method === 'initialize') result = { serverInfo: { name: 'i', version: '1' } };
    else if (msg.method === 'tools/list') result = { tools: REAL_TOOLS };
    else if (msg.method === 'tools/call') {
      seen.push('MCP ' + msg.params.name);
      if (msg.params.name === 'user_upload') {
        result = { content: [{ type: 'text', text: 'https://asset.imagine.art/processed/a.webp' }] };
      } else if (msg.params.name === 'fetch_status') {
        /* accepted, then failed */
        result = { content: [{ type: 'text', text: 'it fell over' }],
          structuredContent: { status: 'failed' } };
      } else if (msg.params.name === 'get_balance') {
        result = { content: [{ type: 'text', text: '4210 credits' }] };
      } else {
        result = { content: [{ type: 'text', text: 'queued' }],
          structuredContent: { uuid: '11111111-2222-3333-4444-555555555555', status: 'queued' } };
      }
    }
    return Promise.resolve({ ok: true, status: 200, headers: { get: () => null },
      text: () => Promise.resolve(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: result })) });
  };

  let err = '';
  await SB.Imagine.run(sh7, 'video').catch(e => { err = e.message; });
  t('a job that failed after it was accepted reports the failure',
    /fell over/.test(err), JSON.stringify(err));
  t('and nothing was sent to the other door',
    seen.filter(x => /^REST/.test(x)).length === 0, seen.join(' | '));
  t('the shot has no clip, because none was made', !sh7.video, JSON.stringify(sh7.video));

  /* the tools refusing the job outright is the one case the fallback is for.
     (An earlier section may have taught this browser that the REST API does
     not accept its token, which is remembered on purpose — clear it.) */
  seen.length = 0;
  store.delete('sb.imagine.oauthRest');
  const refuse = sandbox.fetch;
  sandbox.fetch = function (url, init) {
    /* only the JSON-RPC calls have a string body — a REST post carries form
       data, and parsing that threw inside the stub, which looked exactly
       like the fallback never running */
    if (init && typeof init.body === 'string') {
      const msg = JSON.parse(init.body);
      if (msg.method === 'tools/call' && msg.params.name === 'generate_video') {
        seen.push('MCP generate_video (refused)');
        return Promise.resolve({ ok: true, status: 200, headers: { get: () => null },
          text: () => Promise.resolve(JSON.stringify({ jsonrpc: '2.0', id: msg.id,
            error: { code: -32602, message: 'that model is not available to you' } })) });
      }
    }
    return refuse(url, init);
  };
  err = '';
  await SB.Imagine.run(sh7, 'video').catch(e => { err = e.message; });
  t('a refusal before submission does try the other door',
    seen.filter(x => /^REST/.test(x)).length > 0, seen.join(' | '));
  t('and the other door is sent the name IT knows, not the account one',
    seen.some(x => /text-to-video|image-to-video/.test(x)) ||
    JSON.stringify(seen).indexOf('ltx-2.3') < 0, seen.join(' | '));

  sandbox.fetch = () => Promise.reject(new Error('no network in tests'));
  SB.Imagine.signOut();
  SB.Imagine.setOrg(null);
  SB.Imagine.setTransport('key');
}

section('the floor is never taken by accident');

{
  /* The allow-lists arrive with tools/list, and the generation path only ever
     ran initialize — so an ordinary session sent no resolution at all, which
     is the model's floor. */
  const p8 = SB.Model.newProject();
  sandbox.SB.app = { project: p8, changed() { } };
  const im8 = SB.Model.imageModel(p8);      // GPT Image -> gpt-image-2
  const sh8 = p8.scenes[0].shots[0];
  sh8.prompts[im8.id] = { imagePrompt: 'A wide of the floor.', videoPrompt: '' };

  SB.Imagine.setTransport('oauth');
  store.set('sb.imagine.tokens', JSON.stringify({
    access_token: 'tok', refresh_token: 'r', expires_at: Date.now() + 3600000, email: 'res@test'
  }));
  SB.Imagine.setOrg({ id: 'org-1', name: 'Pega' });
  SB.Imagine.signOut();                      // clears the loaded tools
  store.set('sb.imagine.tokens', JSON.stringify({
    access_token: 'tok', refresh_token: 'r', expires_at: Date.now() + 3600000, email: 'res@test'
  }));
  SB.Imagine.setOrg({ id: 'org-1', name: 'Pega' });

  let sent = null;
  sandbox.fetch = function (url, init) {
    if (!init || !init.body) return Promise.resolve({ ok: true, status: 200,
      headers: { get: () => null },
      blob: () => Promise.resolve(new Blob([new Uint8Array(9)], { type: 'image/webp' })) });
    const msg = JSON.parse(init.body);
    let result = {};
    if (msg.method === 'initialize') result = { serverInfo: { name: 'i', version: '1' } };
    else if (msg.method === 'tools/list') result = { tools: REAL_TOOLS };
    else if (msg.method === 'tools/call') {
      if (msg.params.name === 'generate_image') {
        sent = msg.params.arguments;
        result = { content: [{ type: 'text', text: 'done' }],
          structuredContent: { status: 'complete', url: 'https://cdn.x/a.webp' } };
      } else {
        result = { content: [{ type: 'text', text: '10 credits' }] };
      }
    }
    return Promise.resolve({ ok: true, status: 200, headers: { get: () => null },
      text: () => Promise.resolve(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: result })) });
  };

  await SB.Imagine.run(sh8, 'image').catch(() => null);
  t('a first push of the session reads the tools before it decides anything',
    !!sent, 'nothing was sent');
  t('so the resolution goes out, rather than the model\u2019s floor',
    sent && sent.resolution === '4K', JSON.stringify(sent && sent.resolution));
  t('and the quality with it', sent && sent.quality === 'high',
    JSON.stringify(sent && sent.quality));

  /* an aspect the model does not offer is refused, not silently squared */
  p8.settings.imagineAspect = '3:2';
  const vm8 = SB.Model.videoModel(p8);       // LTX 2.3: 16:9 and 9:16 only
  sh8.prompts[vm8.id] = { imagePrompt: '', videoPrompt: 'She turns.' };
  let why8 = '';
  await SB.Imagine.run(sh8, 'video').catch(e => { why8 = e.message; });
  t('an aspect ratio the model does not offer is refused by name',
    /3:2/.test(why8) && /16:9/.test(why8), why8);

  sandbox.fetch = () => Promise.reject(new Error('no network in tests'));
  SB.Imagine.signOut();
  SB.Imagine.setOrg(null);
  SB.Imagine.setTransport('key');
}

section('a measured price has to mean something');

{
  const p9 = SB.Model.newProject();
  sandbox.SB.app = { project: p9, changed() { } };
  store.delete('sb.imagine.cost');
  /* proving a slug works must not erase which way round it runs */
  const before9 = SB.Imagine.modelInfo('kling-v1.6-standard-text-to-video');
  t('a published slug knows its mode', before9 && before9.mode === 't2v',
    JSON.stringify(before9));
  SB.Imagine.noteWorked('kling-v1.6-standard-text-to-video', 'video');
  const after9 = SB.Imagine.modelInfo('kling-v1.6-standard-text-to-video');
  t('and still knows it after it has been proven', after9 && after9.mode === 't2v',
    JSON.stringify(after9));

  /* a catalog that is not a catalog cannot be stored */
  const p10 = SB.Model.newProject();
  p10.settings.imagine = { setUpBy: 'x@y.z', at: Date.now(), orgId: null,
    catalog: 'not-a-list', costs: {} };
  sandbox.SB.app = { project: p10, changed() { } };
  const r10 = await SB.Imagine.adoptBoard(p10);
  t('a malformed catalog in a board is refused rather than stored',
    (r10.took || []).join(' ').indexOf('models') < 0, JSON.stringify(r10));
  t('and the catalog still works afterwards',
    SB.Imagine.catalog('video').length > 10, SB.Imagine.catalog('video').length);
  t('as does modelInfo, which Settings calls while it draws',
    SB.Imagine.modelInfo('ltx-2.3') !== undefined, '');
  store.delete('sb.imagine.cost');
  store.delete('sb.imagine.worked');
}

/* ----------------------------------- what the board hands the next person */
section('a board that was set up for you');

{
  const p5 = SB.Model.newProject();
  sandbox.SB.app = { project: p5, changed() { } };
  store.delete('sb.imagine.catalog');
  store.delete('sb.imagine.cost');
  store.delete('sb.imagine.org');

  /* one model, two names, and the door decides which is sent */
  const vm5 = SB.Model.videoModel(p5);
  t('a shipped model carries both names',
    vm5.imagineSlug === 'ltx-2.3' && vm5.restSlug === 'ltx-video-v095-image-to-video',
    vm5.imagineSlug + ' / ' + vm5.restSlug);
  SB.Imagine.setTransport('oauth');
  t('signed in, the account name is the one sent',
    SB.Imagine.slugOf(vm5) === 'ltx-2.3', SB.Imagine.slugOf(vm5));
  SB.Imagine.setTransport('key');
  t('on an API key, the v2 name is', SB.Imagine.slugOf(vm5) === 'ltx-video-v095-image-to-video',
    SB.Imagine.slugOf(vm5));
  t('and a model with only one name still sends it',
    SB.Imagine.slugOf({ imagineSlug: 'nano-banana-pro' }) === 'nano-banana-pro', '');

  /* an old board's slug was written for REST, so that is where it lands */
  const oldBoard = SB.Model.newProject();
  oldBoard.settings.models.forEach(function (m) { delete m.restSlug; });
  const k = oldBoard.settings.models.filter(function (m) { return m.name === 'Kling'; })[0];
  k.imagineSlug = 'kling-v1.6-pro-image-to-video';
  SB.Model.migrate(oldBoard);
  const k2 = oldBoard.settings.models.filter(function (m) { return m.name === 'Kling'; })[0];
  t('a board from before the two names keeps its old slug where it works',
    k2.restSlug === 'kling-v1.6-pro-image-to-video', k2.restSlug);
  t('and gains the account-side name beside it',
    k2.imagineSlug === 'kling-3.0-pro', k2.imagineSlug);

  /* what gets written into the file */
  SB.Imagine.setTransport('oauth');
  store.set('sb.imagine.tokens', JSON.stringify({
    access_token: 'tok', refresh_token: 'r', expires_at: Date.now() + 3600000, email: 'lead@pega.com'
  }));
  SB.Imagine.setOrg({ id: 'org-1', name: 'Pega' });
  SB.Imagine.noteCost('ltx-2.3', '', '2160p', 215);
  const block = SB.Imagine.publishToBoard(p5);
  t('the board records who set it up', block.setUpBy === 'lead@pega.com', block.setUpBy);
  t('and the organization, because the switch is on',
    block.orgId === 'org-1' && p5.settings.imagineShareOrg === true, block.orgId);
  t('and the prices it measured', block.costs['ltx-2.3||2160p'].credits === 215,
    JSON.stringify(block.costs));
  t('the token is not in it, and never is',
    JSON.stringify(block).indexOf('tok') < 0, JSON.stringify(block).slice(0, 120));

  p5.settings.imagineShareOrg = false;
  t('and with the switch off the organization stays out',
    SB.Imagine.publishToBoard(p5).orgId === null, '');
  p5.settings.imagineShareOrg = true;
  SB.Imagine.publishToBoard(p5);

  /* the next person opens it */
  store.delete('sb.imagine.org');
  store.delete('sb.imagine.cost');
  const offer = SB.Imagine.boardOffer(p5);
  t('a teammate is offered what the board carries', !!offer && offer.setUpBy === 'lead@pega.com',
    JSON.stringify(!!offer));
  const took = await SB.Imagine.adoptBoard(p5);
  t('taking it brings the measured prices across',
    SB.Imagine.costFor('ltx-2.3', '', '2160p').credits === 215,
    JSON.stringify(SB.Imagine.costFor('ltx-2.3', '', '2160p')));
  t('and says what it took', (took.took || []).join(' ').indexOf('prices') >= 0,
    JSON.stringify(took));
  t('and having answered, it does not ask again',
    SB.Imagine.boardOffer(p5) === null, '');

  /* an organization the account is not in is left alone */
  const p6 = SB.Model.newProject();
  p6.settings.imagine = { setUpBy: 'someone@else.com', at: Date.now(), orgId: 'org-nope',
    catalog: null, costs: {} };
  sandbox.fetch = function (url, init) {
    const msg = JSON.parse(init.body);
    const result = msg.method === 'initialize'
      ? { serverInfo: { name: 'x', version: '1' } }
      : { content: [{ type: 'text', text: 'Pega 11111111-2222-3333-4444-555555555555' }] };
    return Promise.resolve({
      ok: true, status: 200, headers: { get: () => null },
      text: () => Promise.resolve(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: result }))
    });
  };
  SB.Imagine.setOrg({ id: 'org-mine', name: 'Mine' });
  const orgBefore = SB.Imagine.orgId();
  const r6 = await SB.Imagine.adoptBoard(p6);
  t('an organization this account is not in is refused, with a reason',
    /not a member/.test(r6.orgSkipped || ''), JSON.stringify(r6));
  t('and whatever organization was already in hand is untouched',
    SB.Imagine.orgId() === orgBefore, SB.Imagine.orgId() + ' vs ' + orgBefore);

  sandbox.fetch = () => Promise.reject(new Error('no network in tests'));
  SB.Imagine.signOut();
  SB.Imagine.setOrg(null);
  SB.Imagine.setTransport('key');
  store.delete('sb.imagine.cost');
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
  /* Counted off the account's own description rather than typed in here: two
     image models appeared between one capture and the next, and a hard number
     would have failed for being out of date rather than for being wrong. */
  t('every model the account lists, and no others',
    SB.Imagine.catalog('video').length === REAL_VIDEO.length &&
    SB.Imagine.catalog('image').length === REAL_IMAGE.length,
    SB.Imagine.catalog('video').length + '/' + REAL_VIDEO.length + ' video, ' +
    SB.Imagine.catalog('image').length + '/' + REAL_IMAGE.length + ' image');
  /* Three things the real tool list broke that the digest never could. */
  t('a model list that wraps mid-sentence still parses',
    SB.Imagine.catalog('image').indexOf('gpt-image-2.5-flare') >= 0,
    SB.Imagine.catalog('image').slice(0, 4).join(', '));
  t('the newest image models are seen at all',
    SB.Imagine.catalog('image').indexOf('gpt-image-2.5-sunburst') >= 0, '');
  t('a duration written as a range is a list of seconds, not a sentence',
    (SB.Imagine.allowFor('generate_video', 'seedance-2.5', 'duration') || []).length === 27,
    JSON.stringify((SB.Imagine.allowFor('generate_video', 'seedance-2.5', 'duration') || []).slice(0, 3)));
  t('and it starts and ends where the account says',
    (function () {
      const d = SB.Imagine.allowFor('generate_video', 'seedance-2.5', 'duration') || [];
      return d[0] === '4' && d[d.length - 1] === '30';
    })(), '');

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
