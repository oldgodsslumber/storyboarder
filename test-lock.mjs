/* test-lock.mjs — nothing invented: the writer rider, the invention check, the clay opening — and no wardrobe paragraph.
 * usage: node test-lock.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = dirname(fileURLToPath(import.meta.url));
const sandbox = {
  console,
  document: { createElement: () => ({ style: {}, classList: { add() { }, remove() { } }, appendChild() { } }), getElementById: () => null },
  setTimeout, clearTimeout, indexedDB: undefined,
  localStorage: (() => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; })(),
  Uint8Array, TextEncoder, URL
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['js/util.js', 'js/focus.js', 'js/doc.js', 'js/blobs.js', 'js/geminimodels.js', 'js/providers.js',
  'js/brand.js', 'js/renders.js', 'js/imaginemodels.js', 'js/refs.js', 'js/personas.js', 'js/fields.js', 'js/model.js',
  'js/store.js', 'js/h3.js', 'js/mxm.js', 'js/prompts.js']) {
  vm.runInContext(readFileSync(join(root, f), 'utf8'), sandbox, { filename: f });
}
const SB = sandbox.SB;
SB.Focus.defer = (k, fn) => fn();

let pass = 0, fail = 0;
const cut = s => (s && s.length > 160) ? s.slice(0, 157) + '…' : s;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + '\n       got ' + cut(a) + '\n       want ' + cut(b)); }
}
const has = (t, w, l) => eq(String(t).indexOf(w) >= 0, true, l + (String(t).indexOf(w) >= 0 ? '' : '  [' + cut(String(t)) + ']'));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function board() {
  const p = SB.Model.newProject();
  SB.app = { project: p, changed() { } };
  p.scenes[0].shots = [];
  const sh = SB.Model.addShot(p, p.scenes[0].id, { type: 'Medium' });
  sh.description = 'Gus sits at his desk and reads a letter.';
  const gus = SB.Personas.add(p, { name: 'Gus', description: 'A man in his fifties. He wears a white shirt, a headset and dark slacks.' });
  SB.Personas.toggleOnShot(p, sh, gus.id);
  SB.Personas.setImage(gus, SB.Blobs.image(p, PNG, 1, 1), 'front', null);
  p.settings.aiProvider = 'ooba';
  SB.Store.setOoba({ url: 'http://127.0.0.1:5000/v1/', model: 'local', key: '' });
  return { p, sh, gus };
}
let replies = [], asked = [];
sandbox.fetch = (url, init) => {
  asked.push(JSON.parse(init.body));
  const r = replies.length > 1 ? replies.shift() : replies[0];
  return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ choices: [{ message: { content: JSON.stringify(r) } }] })) });
};

console.log('\n— the old wardrobe paragraph comes off stored prompts —');
{
  const { p, sh } = board();
  const LOCK = 'Gus wears exactly: a white shirt, a headset, dark slacks. Nothing else.\nNo coats, jackets, hats, scarves, glasses, jewellery, watches, bags, extra props or extra people beyond those described.';
  const VLOCK = 'Everyone\u2019s clothing stays exactly as in the first frame — nothing is put on, taken off or added. No coats, jackets, hats, scarves, glasses, jewellery, watches, bags, extra props or extra people beyond those described.';
  sh.prompts = { a: { imagePrompt: 'Gus reads a letter.\n\n' + LOCK, videoPrompt: 'Gus stands.\n\n' + VLOCK }, b: { imagePrompt: 'Gus reads.\n\nMy own closing note about hats.' } };
  p.settings.wardrobeLock = true;
  const q = SB.Model.migrate(JSON.parse(JSON.stringify(p))) || p;
  const sh2 = q.scenes[0].shots[0];
  eq(sh2.prompts.a.imagePrompt, 'Gus reads a letter.', 'a still loses the paragraph');
  eq(sh2.prompts.a.videoPrompt, 'Gus stands.', 'and a clip its line');
  eq(sh2.prompts.b.imagePrompt, 'Gus reads.\n\nMy own closing note about hats.', 'a closing paragraph written by hand stays');
  eq(q.settings.wardrobeLock, undefined, 'and the setting is gone');
}

console.log('\n— the invention check —');
{
  const { p, sh } = board();
  eq(SB.Brand.inventedTerms(p, sh, 'Gus, in a trench coat and a beanie, reads.'), ['trench coat', 'beanie'], 'coats and hats nobody described');
  eq(SB.Brand.inventedTerms(p, sh, 'Gus in his white shirt and headset reads.'), [], 'what the description gives is allowed');
  eq(SB.Brand.inventedTerms(p, sh, 'Gus, no jacket, reads.'), [], '"no jacket" is not a jacket');
  eq(SB.Brand.inventedTerms(p, sh, 'He reads without a jacket, a watch on his wrist.'), ['a watch'], 'a negation stops at the comma');
  eq(SB.Brand.inventedTerms(p, sh, 'No coat, hat or scarf on him.'), [], 'unless the comma carries a list');
  sh.description += ' It is raining; he keeps his coat on.';
  eq(SB.Brand.inventedTerms(p, sh, 'Gus in his coat reads.'), [], 'a coat the card mentions is allowed');
  eq(/ADD NOTHING THAT IS NOT DESCRIBED/.test(SB.Brand.systemFor(p, sh, 'image')), true, 'the writer is told, for stills');
  eq(/ADD NOTHING THAT IS NOT DESCRIBED/.test(SB.Brand.systemFor(p, sh, 'video')), true, 'and for clips');
}

console.log('\n— a still, written —');
{
  const { p, sh } = board();
  const im = p.settings.models.find(m => m.name === 'GPT Image'); p.settings.imageModelId = im.id;
  asked = []; replies = [{ imagePrompt: 'Gus in a trench coat reads a letter at his desk.' }, { imagePrompt: 'Gus reads a letter at his desk.' }];
  await SB.Prompts.generateFor(sh, { image: true });
  eq(asked.length, 2, 'an invented coat earns one corrective call');
  has(JSON.stringify(asked[1]), 'You added things nobody described: \\"trench coat\\"', 'which names it');
  const pr = sh.prompts[im.id];
  eq(pr.imagePrompt.indexOf('Gus reads a letter at his desk.'), 0, 'the corrected words are stored');
  eq(pr.imagePrompt, 'Gus reads a letter at his desk.', 'and nothing is tacked on after them');
  eq(pr.invented, undefined, 'nothing survived, so nothing is marked');
  // a writer that will not let go of the coat
  asked = []; replies = [{ imagePrompt: 'Gus in a trench coat reads.' }];
  await SB.Prompts.generateFor(sh, { image: true });
  eq(sh.prompts[im.id].invented, { imagePrompt: ['trench coat'] }, 'a coat that survives is kept, and marked');
}

console.log('\n— a still with a blocking: the clay render opens the prompt —');
{
  const { p, sh, gus } = board();
  const im = p.settings.models.find(m => m.name === 'GPT Image'); p.settings.imageModelId = im.id;
  sh.pose = { serial: 1, scene: SB.Blobs.put(p, 'data:application/json,' + encodeURIComponent('{"figures":[{}]}')),
    image: SB.Blobs.image(p, PNG, 1, 1), render: { ref: SB.Blobs.put(p, PNG), w: 1, h: 1 },
    cast: [{ fig: 'f1', personaId: gus.id, name: 'Gus', colorName: 'tan', pos: { x: 0, where: 'centre', depth: 0 } }],
    text: 'Gus (the tan mannequin): centre of frame.', lens: 35, aspect: '16:9', at: 1, perf: null };
  asked = []; replies = [{ imagePrompt: 'Gus reads a letter at his desk.' }];
  await SB.Prompts.generateFor(sh, { image: true });
  const t = sh.prompts[im.id].imagePrompt;
  eq(t.indexOf('Image 1 is a grey clay layout render of this exact shot.'), 0, 'the app’s own paragraph comes first');
  has(t, 'Do not reproduce its grey untextured material, mannequin bodies, featureless faces, studio floor, grid or backdrop.', 'saying what not to copy');
  has(t, 'The tan figure is Gus (image 2).', 'and which figure is whom');
  eq(t.endsWith('\n\nGus reads a letter at his desk.'), true, 'then the writer’s words, and nothing after them');
  has(JSON.stringify(asked[0]), 'do not mention the blocking, a render, mannequins, clay', 'the writer leaves the clay render to the app');
  has(JSON.stringify(asked[0]), 'The blocking is framed on a 35mm lens at eye level: use that focal length and that camera height.', 'the writer is told the blocking\u2019s lens and height');
  eq(SB.Prompts.blockingCamera(sh).lens, 35, 'read off the blocking');
  sh.pose.framing = { type: 'Close-up', size: 'Close-up', angle: 'a high angle, looking down' };
  eq(SB.Prompts.blockingCamera(sh).angle, 'a high angle, looking down', 'with the angle Pose Bench measured, when it sent one');
}

console.log('\n— a clip on a frame-only model —');
{
  const { p, sh } = board();
  const vm2 = p.settings.models.find(m => m.name === 'Seedance'); p.settings.videoModelId = vm2.id;
  sh.image = SB.Blobs.image(p, PNG, 1, 1);
  asked = []; replies = [{ videoPrompt: 'Gus puts on a jacket and stands.' }, { videoPrompt: 'Gus folds the letter and stands.' }];
  await SB.Prompts.generateFor(sh, { video: true });
  eq(asked.length, 2, 'a jacket put on out of nowhere is caught too');
  const t = sh.prompts[vm2.id].videoPrompt;
  eq(t.indexOf('Gus folds the letter and stands.'), 0, 'the corrected motion is stored');
  eq(t, 'Gus folds the letter and stands.', 'and nothing is tacked on');
}

console.log('\n— MiniMax keeps its formats —');
{
  const { p, sh } = board();
  eq(SB.Mxm.NEG_IMAGE.some(x => /coats, jackets, hats, bags, jewellery/.test(x)), true, 'the brief’s negatives rule out the usual additions');
  const mi = p.settings.models.find(m => m.name === 'MiniMax Image'); p.settings.imageModelId = mi.id;
  await SB.Prompts.generateFor(sh, { image: true });
  eq(/Nothing else\./.test(sh.prompts[mi.id].imagePrompt), false, 'the assembled brief is not decorated');
}

console.log('\n\u2014 the house look: in the task, then checked \u2014');
{
  const { p, sh } = board();
  const im = p.settings.models.find(m => m.name === 'GPT Image'); p.settings.imageModelId = im.id;
  const GOOD = 'Gus reads a letter at his desk, shot on an ARRI Alexa with a 35mm lens at f/2.8 from seated eye height, a shallow depth of field with the room falling soft, soft window light from the left, a muted filmic grade with fine grain, real skin texture and worn desk edges.';
  asked = []; replies = [{ imagePrompt: GOOD }];
  await SB.Prompts.generateFor(sh, { image: true });
  const user = asked[0].messages[asked[0].messages.length - 1].content;
  has(user, 'Make it look shot for real', 'the look is part of the still\u2019s task');
  has(user, 'shot on an ARRI Alexa', 'naming the camera');
  has(user, 'shallow depth of field', 'the focus');
  has(user, 'muted, filmic grade', 'and the grade');
  eq(user.indexOf('Make it look shot for real') < user.indexOf('SHOT DESCRIPTION:'), true, 'ahead of the shot description');
  eq(asked.length, 1, 'a prompt that names the look is not sent back');
  eq(sh.prompts[im.id].flat, undefined, 'and is not marked');

  asked = []; replies = [{ imagePrompt: 'Gus reads a letter at his desk.' }, { imagePrompt: GOOD }];
  await SB.Prompts.generateFor(sh, { image: true });
  eq(asked.length, 2, 'a flat prompt earns one rewrite');
  has(JSON.stringify(asked[1]), 'You left out the house look', 'which says what is missing');
  eq(sh.prompts[im.id].flat, undefined, 'fixed by the rewrite: no mark');

  asked = []; replies = [{ imagePrompt: 'Gus reads a letter at his desk.' }];
  await SB.Prompts.generateFor(sh, { image: true });
  eq(Array.isArray(sh.prompts[im.id].flat) && sh.prompts[im.id].flat.indexOf('lens') >= 0, true, 'still flat after it: marked, naming what is missing');
  asked = []; replies = [{ imagePrompt: GOOD.replace('shot on an ARRI Alexa with a', 'with a') }];
  await SB.Prompts.generateFor(sh, { image: true });
  eq(asked.length, 2, 'missing only the camera is enough for a rewrite: it is one of the three that matter');

  p.settings.brand = { enabled: false, custom: false };
  asked = []; replies = [{ imagePrompt: 'Gus reads a letter at his desk.' }];
  await SB.Prompts.generateFor(sh, { image: true });
  const u2 = asked[0].messages[asked[0].messages.length - 1].content;
  eq(/Make it look shot for real/.test(u2), false, 'house style off: no look line');
  eq(asked.length, 1, 'and no rewrite for it');
  eq(sh.prompts[im.id].flat, undefined, 'and no mark');
}

console.log('\n\u2014 off the reference list: when the @ goes, or by hand \u2014');
{
  const { p, sh, gus } = board();
  const ana = SB.Personas.add(p, { name: 'Ana', description: 'A woman in her thirties in a grey coat.' });
  const names = () => SB.Personas.forShot(p, sh).map(x => x.name).join(',');
  // Ana is @tagged in the description, which casts her
  sh.description = SB.Refs.insert(sh.description + ' ', sh.description.length + 1, sh.description.length + 1, ana.id, 'Ana').text;
  SB.Personas.castByTag(sh, ana.id);
  eq(names(), 'Gus,Ana', 'an @ casts her');
  // the @ is taken out: she comes off
  sh.description = 'Gus sits at his desk and reads a letter.';
  eq(names(), 'Gus', 'take the @ out and she is off the card');
  eq(SB.Refs.feed(p, sh, 'image').some(e => e.id === ana.id), false, 'and off its references');
  // put it back: she is back
  sh.description = SB.Refs.insert(sh.description + ' ', sh.description.length + 1, sh.description.length + 1, ana.id, 'Ana').text;
  eq(names(), 'Gus,Ana', 'put the @ back and so is she');
  // cast by hand (Gus): stays with no @ at all
  eq(SB.Refs.marked(p, sh).some(m => m.id === gus.id), false, 'Gus has no @ on this card');
  eq(names().indexOf('Gus') >= 0, true, 'but was cast by hand, so he stays');
  // the X: off entirely, the @ left as plain text
  SB.Personas.removeFromShot(p, sh, ana.id);
  eq(names(), 'Gus', 'the \u2715 takes her off');
  eq(SB.Refs.marked(p, sh).some(m => m.id === ana.id), false, 'and her @ is plain text now');
  eq(/Ana/.test(sh.description), true, 'the name itself is still in the words');
  SB.Personas.removeFromShot(p, sh, gus.id);
  eq(names(), '', 'the \u2715 works on somebody cast by hand too');
  // a reload keeps who was cast by an @
  SB.Personas.castByTag(sh, ana.id);
  const q = SB.Model.migrate(JSON.parse(JSON.stringify(p)));
  eq(q.scenes[0].shots[0].castAuto, [ana.id], 'which is remembered in the file');
}

console.log('\n\u2014 the still reads its frame box, not the general description \u2014');
{
  const { p, sh } = board();
  const im = p.settings.models.find(m => m.name === 'GPT Image'); p.settings.imageModelId = im.id;
  sh.description = 'Gus reads a letter in a high-rise office.';
  sh.imageDescription = 'Gus at a kitchen table at home, reading a letter.';
  asked = []; replies = [{ imagePrompt: 'x, shot on an ARRI Alexa, 35mm f/2, shallow depth of field, window light, muted filmic grade, grain, skin texture' }];
  await SB.Prompts.generateFor(sh, { image: true });
  const all = JSON.stringify(asked[0]);
  eq(/high-rise/.test(all), false, 'a stale general description never reaches the still');
  has(all, 'kitchen table at home', 'its frame box does');
  sh.imageDescription = '';
  asked = []; replies = [{ imagePrompt: 'x, shot on an ARRI Alexa, 35mm f/2, shallow depth of field, window light, muted filmic grade, grain, skin texture' }];
  await SB.Prompts.generateFor(sh, { image: true });
  has(JSON.stringify(asked[0]), 'high-rise office', 'with the frame box empty, the general description stands in');
}

console.log('\n\u2014 a moved camera reads as a new setup, not an edit \u2014');
{
  const { p } = board();
  const wide = SB.Model.addShot(p, p.scenes[0].id, { type: 'Wide' }), cu = SB.Model.addShot(p, p.scenes[0].id, { type: 'Close-up' });
  const cams = { [wide.id]: { target: [0, 1, 0], theta: 0, phi: 1.3, radius: 4, mm: 35 },
                 [cu.id]: { target: [0.4, 1.5, 0], theta: 0.6, phi: 1.5, radius: 1.2, mm: 85 } };
  SB.Pose = { sceneOf: (pp, sh) => cams[sh.id] ? { camera: cams[sh.id] } : null };
  const mv = SB.Personas.cameraMove(p, cu, { id: wide.id });
  has(mv.words, 'swung about 35\u00b0 to the right', 'the orbit, in degrees and side');
  has(mv.words, 'about 3.5 times closer', 'how much closer');
  has(mv.words, '85mm lens (it was 35mm)', 'the lens change');
  cams[cu.id] = Object.assign({}, cams[wide.id]);
  eq(!!SB.Personas.cameraMove(p, cu, { id: wide.id }).same, true, 'the same camera is not a move');
  delete SB.Pose;
}

console.log('\n\u2014 the video brief is about motion, in the export lane too \u2014');
{
  const { p, sh } = board();
  sh.description = 'Gus sits in a dim call-centre at night, monitors glowing, and reads a letter.';
  sh.videoDescription = 'He lowers the letter slowly and looks up toward the door.';
  sh.image = SB.Blobs.image(p, PNG, 1, 1);
  const vm = p.settings.models.find(m => m.kind === 'video' && m.name === 'Seedance');
  for (const exp of [false, true]) {
    p.settings.videoModelId = exp ? vm.id + SB.Model.EXPORT_SUFFIX : vm.id;
    asked = []; replies = [{ videoPrompt: 'He lowers the letter.' }];
    await SB.Prompts.generateFor(sh, { video: true });
    const all = JSON.stringify(asked[0]), lane = exp ? 'export: ' : 'send: ';
    eq(/HOUSE STYLE/.test(all), false, lane + 'no house style once there is a first frame');
    eq(/ARRI|Alexa|skin: pores|film grain/.test(all), false, lane + 'no camera, skin or grain notes');
    has(all, 'THE FIRST FRAME IS SUPPLIED', lane + 'told the frame is supplied');
    eq(/call-centre at night/.test(all), false, lane + 'the general description stays out once the motion box is filled');
    has(all, 'lowers the letter slowly', lane + 'the motion box is the description');
  }
  sh.image = null; sh.render = null;
  p.settings.videoModelId = vm.id + SB.Model.EXPORT_SUFFIX;
  asked = []; replies = [{ videoPrompt: 'He lowers the letter.' }];
  await SB.Prompts.generateFor(sh, { video: true });
  has(JSON.stringify(asked[0]), 'HOUSE STYLE', 'export with no frame at all still gets the look (nothing else carries it)');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
if (fail) process.exit(1);
