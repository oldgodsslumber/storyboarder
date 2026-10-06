/* test-mxm.mjs — the MiniMax package (js/mxm.js): labels, file order, prompts.
 * usage: node test-mxm.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = dirname(fileURLToPath(import.meta.url));
const sandbox = {
  console,
  document: {
    createElement: () => ({ style: {}, classList: { add() { }, remove() { } }, appendChild() { } }),
    getElementById: () => null
  },
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

let pass = 0, fail = 0;
const cut = s => (s && s.length > 160) ? s.slice(0, 157) + '…' : s;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + '\n       got ' + cut(a) + '\n       want ' + cut(b)); }
}
function has(text, what, label) { eq(String(text).indexOf(what) >= 0, true, label + (String(text).indexOf(what) >= 0 ? '' : '  [' + cut(String(text)) + ']')); }

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const WEBP = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';

function board() {
  const p = SB.Model.newProject();
  SB.app = { project: p, changed() { } };
  const sc = p.scenes[0];
  sc.shots = [];
  sc.heading = 'INT. OFFICE';
  const sh = SB.Model.addShot(p, sc.id, { type: 'Medium' });
  sh.description = 'A man sits and looks at his phone, a confused expression on his face.';
  sh.videoDescription = 'He looks down at his phone, confused. Then he looks up quickly and hurriedly puts the phone away.';
  const gus = SB.Personas.add(p, { name: 'Gus', description: 'A man in a white shirt, headset and dark slacks.' });
  const nat = SB.Personas.add(p, { name: 'Nat', description: 'Red blazer, short dark hair.' });
  SB.Personas.toggleOnShot(p, sh, gus.id); SB.Personas.toggleOnShot(p, sh, nat.id);
  SB.Personas.setImage(gus, SB.Blobs.image(p, PNG, 1, 1), 'front', null);
  SB.Personas.setImage(nat, SB.Blobs.image(p, WEBP, 1, 1), 'front', null);
  return { p, sh, gus, nat };
}
function block(p, sh, gus, nat) {
  sh.pose = {
    serial: 1, scene: SB.Blobs.put(p, 'data:application/json,' + encodeURIComponent('{"figures":[{}]}')),
    image: SB.Blobs.image(p, PNG, 1, 1), render: { ref: SB.Blobs.put(p, PNG), w: 1, h: 1 },
    cast: [{ fig: 'f1', personaId: gus.id, name: 'Gus', colorName: 'tan', pos: { x: -0.5, where: 'left', depth: 0 } },
      { fig: 'f2', personaId: nat.id, name: 'Nat', colorName: 'blue', pos: { x: 0.5, where: 'right', depth: 1 } }],
    text: 'Gus (the tan mannequin): left of frame.', lens: 35, aspect: '16:9', at: 1, perf: null
  };
}

console.log('\n— the still: MiniMax Image —');
{
  const { p, sh, gus, nat } = board();
  block(p, sh, gus, nat);
  const m = SB.Mxm.manifest(p, sh, 'image');
  eq(m.assets.map(a => a.file), ['01_clay.png', '02_Gus.png', '03_Nat.jpg'], 'files in upload order; a WebP original goes up as JPEG');
  eq(m.assets.map(a => a.label), ['[Image 1]', '[Image 2]', '[Image 3]'], 'labels count the same way');
  const b = SB.Mxm.brief(m);
  has(b, '[Image 1] is an untextured grey clay render of this exact shot', 'the brief opens with the clay render\'s role');
  has(b, 'the tan figure is Gus [Image 2]; the blue figure is Nat [Image 3]', 'and binds each clay figure to its person and picture');
  has(b, 'Left figure [Image 2]: Gus, a man in a white shirt', 'figure lines carry position, picture and description');
  has(b, 'Right figure [Image 3]: Nat', 'the second figure is on the right');
  has(b, 'Camera: comes entirely from [Image 1].', 'the camera is the render\'s');
  has(b, 'Negative: no clay, mannequin or grey untextured surfaces', 'negatives listed');
  const labels = (b.match(/\[Image \d+\]/g) || []).filter((x, i, a) => a.indexOf(x) === i).sort();
  eq(labels, m.assets.map(a => a.label).sort(), 'every label in the prompt is a file, and every file is named');
  eq(m.warnings, [], 'a clean card has nothing to check');

  // an arrival is not in the still
  sh.castEnters = [nat.id];
  const m2 = SB.Mxm.manifest(p, sh, 'image');
  eq(m2.assets.map(a => a.role), ['the grey clay render of this shot', 'Gus'], 'someone who arrives later is not in the still\'s files');
  sh.castEnters = [];

  // a rename reaches the brief
  gus.name = 'Augustus';
  has(SB.Mxm.brief(SB.Mxm.manifest(p, sh, 'image')), 'Augustus', 'a rename reaches the brief');
  gus.name = 'Gus';

  // style and negatives from the board
  p.settings.mxm = { style: 'warm backlight, film grain', negImage: ['logos'], negVideo: [] };
  const b3 = SB.Mxm.brief(SB.Mxm.manifest(p, sh, 'image'));
  has(b3, 'Style: Warm backlight, film grain.', 'the board\'s style');
  has(b3, 'Negative: no logos.', 'and its negatives');
}

console.log('\n— no blocking —');
{
  const { p, sh } = board();
  const m = SB.Mxm.manifest(p, sh, 'image');
  eq(m.assets.map(a => a.kind), ['subject', 'subject'], 'no clay render without a blocking');
  has(m.warnings.join(' '), 'No 3D blocking', 'and it says so');
  has(SB.Mxm.brief(m), 'Camera: Medium.', 'the camera falls back to the shot type');
}

console.log('\n— the video: MiniMax H3 full reference —');
{
  const { p, sh, gus, nat } = board();
  block(p, sh, gus, nat);
  sh.image = SB.Blobs.image(p, PNG, 1, 1);
  const link = { id: 'tk1', name: 'Take 1', version: 3, at: 1.5, in: 1.5, out: 4.5, cam: 'c1', camName: 'A', fps: 24 };
  sh.pose.perf = link;
  SB.Pose = { PASSES: ['depth', 'openpose', 'normal', 'mask'], perfLink: s => (s.pose && s.pose.perf) || null, perfOf: () => ({ id: 'tk1', version: 3 }), perfStale: () => false, stale: () => false };
  const m = SB.Mxm.manifest(p, sh, 'video');
  eq(m.assets.map(a => a.file), ['01_clay.mp4', '02_first_frame.png', '03_Gus.png', '04_Nat.jpg'], 'clip, first frame, subjects');
  eq(m.assets.map(a => a.h3), ['<Video 1>', '<Picture 1>', '<Picture 2>', '<Picture 3>'], 'H3 numbers videos and pictures separately');
  eq(m.duration, 3, 'a 3 s clip is a 3 s video — the default shortest is 3 s');
  eq(m.warnings.some(w => /at least/.test(w)), false, 'with nothing to warn about');
  p.settings.mxm = { minS: 4 };
  const m4 = SB.Mxm.manifest(p, sh, 'video');
  eq(m4.duration, 4, 'a board whose setup starts at 4 s asks for 4 s');
  has(m4.warnings.join(' '), 'makes 4 s at least', 'and warns about it');
  sh.pose.perf = Object.assign({}, link, { out: 1.5 + 2.2 });
  p.settings.mxm = {};
  has(SB.Mxm.manifest(p, sh, 'video').warnings.join(' '), 'makes 3 s at least', 'a 2.2 s clip is short even of 3 s');
  sh.pose.perf = link;
  const sc = SB.Mxm.h3Scaffold(m);
  eq(sc.taskTypes, ['keyframe completion', 'reference generation'], 'task types from the files');
  has(sc.definitions, '<Video 1> is an untextured grey clay render of this exact shot. It defines layout, staging, camera and animation', 'the clay clip\'s role, in H3 labels');
  has(sc.definitions, '<Subject 1> is Gus, seen in <Picture 2>', 'the subject cites its picture');
  has(sc.definitions, 'In <Video 1>, Gus is the tan figure on the left of frame.', 'and is bound to their clay figure');
  has(sc.retention, '<Video 1> (appears in [Shot 1]): fully_preserved', 'the clip is kept within its role');
  const markers = sc.retention.split('\n').map(l => (l.match(/: (\w+) - /) || [])[1]);
  eq(markers.every(x => ['fully_preserved', 'partially_preserved', 'attribute_transfer', 'weak_reference'].indexOf(x) >= 0), true,
    'every retention marker is one the guide allows');
  const text = SB.Mxm.h3Prompt(m, null);
  eq(SB.H3.SECTIONS.map(k => text.indexOf(k + ':\n') >= 0), [true, true, true, true, true, true], 'all six sections');
  eq(SB.H3.SECTIONS.map(k => text.indexOf(k + ':\n')).every((v, i, a) => !i || v > a[i - 1]), true, 'in order');
  const fb = SB.Mxm.h3Fallback(m, sc);
  eq(SB.H3.problems(sc, fb).filter(x => !/too short/.test(x)), [], 'the assembled version passes the format check (apart from length)');
  eq(SB.H3.problems(sc, { summary: fb.summary, detailed_description: fb.detailed_description + ' <Video 2> too.' }).length > 0, true,
    'an invented <Video 2> is caught');
  has(fb.detailed_description, 'The shot begins from <Picture 1> and follows <Video 1> exactly', 'begins from the still, follows the clip');
  has(fb.detailed_description, 'contains no on-screen text', 'the negatives are sentences in the style opening');
  const used = (text.match(/<(?:Video|Picture) \d+>/g) || []).filter((x, i, a) => a.indexOf(x) === i).sort();
  eq(used, m.assets.map(a => a.h3).sort(), 'every H3 file label in the prompt is a file, and every file is named');
  const rider = SB.Mxm.h3Rider(m, sc);
  has(rider, 'overrides anything above about a locked-off camera', 'the writer is told the camera is the clip\'s');

  // still taken away from the in-point
  sh.pose.perf = Object.assign({}, link, { at: 2.5 });
  has(SB.Mxm.manifest(p, sh, 'video').warnings.join(' '), 'not at its start', 'a still taken mid-clip is flagged');
  sh.pose.perf = link;

  // no still yet: the recommended order is said
  sh.image = null;
  const m2 = SB.Mxm.manifest(p, sh, 'video');
  eq(m2.assets.map(a => a.h3), ['<Video 1>', '<Picture 1>', '<Picture 2>'], 'without a still the pictures renumber');
  has(m2.warnings.join(' '), 'image lane first', 'and the order of work is suggested');
  const fb2 = SB.Mxm.h3Fallback(m2, SB.Mxm.h3Scaffold(m2));
  eq(fb2.detailed_description.indexOf('begins from <Picture') < 0, true, 'and nothing claims to begin from a picture');
  eq(SB.Mxm.h3Scaffold(m2).taskTypes, ['reference generation'], 'reference generation only');
  delete SB.Pose;
}

console.log('\n— stored prompts —');
{
  const { p, sh, gus, nat } = board();
  block(p, sh, gus, nat);
  const m = SB.Mxm.manifest(p, sh, 'image');
  eq(SB.Mxm.promptFor(p, sh, 'image').source, 'assembled', 'nothing stored: assembled');
  SB.Mxm.remember(sh, 'image', { prompt: 'MY OWN', sig: m.sig, edited: true });
  eq(SB.Mxm.promptFor(p, sh, 'image').text, 'MY OWN', 'a hand edit is used');
  sh.description += ' He frowns.';
  const later = SB.Mxm.promptFor(p, sh, 'image');
  eq([later.text, later.current], ['MY OWN', false], 'kept after the card changes, but flagged');
  SB.Mxm.remember(sh, 'video', { prompt: 'WRITTEN', sig: 'old', written: true });
  eq(SB.Mxm.promptFor(p, sh, 'video').source, 'assembled', 'a written prompt from before a change is replaced');
  eq(SB.Model.CONTENT_KEYS.indexOf('mxm') >= 0, true, 'copies and swaps carry the package prompts');
  const c = JSON.parse(JSON.stringify(p)); delete c.scenes[0].shots[0].mxm; SB.Model.migrate(c);
  eq(c.scenes[0].shots[0].mxm, null, 'an older board migrates to null');
  eq([typeof c.settings.mxm.style, Array.isArray(c.settings.mxm.negImage)], ['string', true], 'and gets MiniMax settings');
}

console.log('\n— MiniMax Image as the board\'s image model —');
{
  const { p, sh, gus, nat } = board();
  block(p, sh, gus, nat);
  const im = p.settings.models.filter(m => m.name === 'MiniMax Image')[0];
  eq(!!im, true, 'MiniMax Image ships as an image model');
  p.settings.imageModelId = im.id;
  const jobs = SB.Prompts.jobsFor(sh, im, null, { image: true, video: false });
  eq([jobs.length, typeof jobs[0].local], [1, 'function'], 'its prompt is assembled, not written');
  has(jobs[0].local().imagePrompt, '[Image 1] is an untextured grey clay render', 'and it is the brief');
  const edited = Object.assign({}, im, { imageTemplate: 'my own words {{DESCRIPTION}}' });
  eq(typeof SB.Prompts.jobsFor(sh, edited, null, { image: true, video: false })[0].local, 'undefined', 'an edited template goes to the writer');
  const old = JSON.parse(JSON.stringify(p));
  old.settings.models = old.settings.models.filter(m => m.name !== 'MiniMax Image');
  old.settings.modelSeeds = (old.settings.modelSeeds || []).filter(n => n !== 'MiniMax Image');
  SB.Model.migrate(old);
  eq(old.settings.models.some(m => m.name === 'MiniMax Image'), true, 'an existing board is offered it');
}

console.log('\n— Write: the H3 prose from the writer, against a stubbed local server —');
{
  const { p, sh, gus, nat } = board();
  block(p, sh, gus, nat);
  sh.image = SB.Blobs.image(p, PNG, 1, 1);
  sh.pose.perf = { id: 'tk1', name: 'Take 1', version: 3, at: 0, in: 0, out: 6, cam: 'c1', camName: 'A', fps: 24 };
  SB.Pose = { PASSES: [], perfLink: s => (s.pose && s.pose.perf) || null, perfOf: () => ({ id: 'tk1', version: 3 }), perfStale: () => false, stale: () => false };
  SB.Focus.defer = (k, fn) => fn();
  const asked = [];
  const good = {
    summary: '[keyframe completion + reference generation] In the target video, <Subject 1> checks a phone.',
    detailed_description: 'The target video is photorealistic. ' + 'word '.repeat(200) +
      '\n[Shot 1] The shot begins from <Picture 1> and follows <Video 1>. <Subject 1> looks down.'
  };
  const replies = [
    { summary: good.summary, detailed_description: good.detailed_description + ' <Video 2> as well.' },   // invented label
    good
  ];
  sandbox.fetch = (url, init) => {
    asked.push(JSON.parse(init.body));
    const r = replies.shift() || good;
    return Promise.resolve({ ok: true, status: 200,
      text: () => Promise.resolve(JSON.stringify({ choices: [{ message: { content: JSON.stringify(r) } }] })) });
  };
  p.settings.aiProvider = 'ooba';
  SB.Store.setOoba({ url: 'http://127.0.0.1:5000/v1/', model: 'local', key: '' });
  const text = await SB.Prompts.writeMxm(sh);
  const sent = JSON.stringify(asked[0]);
  has(sent, 'THE MINIMAX FULL-REFERENCE CALL', 'the writer is told what the call carries');
  has(sent, '<Video 1> = the grey clay render of this shot, animated', 'with the label table for the clip');
  has(sent, 'the tan figure is <Subject 1> (Gus)', 'and which clay figure is whom');
  eq(asked.length, 2, 'an invented <Video 2> earns one corrective call');
  has(text, 'detailed_description:\nThe target video is photorealistic.', 'the stored prompt is the corrected one');
  eq(text.indexOf('<Video 2>') < 0, true, 'without the invented label');
  eq(SB.Mxm.promptFor(p, sh, 'video').source, 'writer', 'and the package now carries it');
  sh.videoDescription = 'Something else happens.';
  eq(SB.Mxm.promptFor(p, sh, 'video').source, 'assembled', 'until the card changes');
  eq(Object.keys(sh.prompts).length, 0, 'nothing is written onto the push prompts');
  delete SB.Pose;
}

console.log('\n— the video lane: a blocked card with a still and no performance —');
{
  const { p, sh, gus, nat } = board();
  block(p, sh, gus, nat);
  SB.Pose = { PASSES: [], perfLink: s => (s.pose && s.pose.perf) || null, perfOf: () => null, perfStale: () => false, stale: () => false };
  eq(SB.Mxm.manifest(p, sh, 'video').assets[0].kind, 'clay-still', 'with no frame yet, the clay still is the clip\'s layout');
  sh.image = SB.Blobs.image(p, PNG, 1, 1);
  const m = SB.Mxm.manifest(p, sh, 'video');
  eq(m.assets.map(a => a.kind), ['first-frame', 'subject', 'subject'], 'once there is a frame, the clay still leaves the video files');
  eq(m.assets[0].h3, '<Picture 1>', 'and the frame is the first picture');
  eq(SB.Mxm.manifest(p, sh, 'image').assets[0].kind, 'clay-still', 'the still lane keeps it');
  delete SB.Pose;
}

console.log('\n— Create on a stock H3 board: a blocked card with no still —');
{
  const { p, sh, gus, nat } = board();
  block(p, sh, gus, nat);                       // blocking only: no still on the card
  const vm = p.settings.models.filter(m => m.name === SB.H3.NAME)[0];
  p.settings.videoModelId = vm.id;
  SB.Pose = { PASSES: [], perfLink: s => (s.pose && s.pose.perf) || null, perfOf: () => null, perfStale: () => false, stale: () => false };
  eq(SB.Mxm.h3Card(p, sh), true, 'the card counts as the full-reference call');
  const jobs = SB.Prompts.jobsFor(sh, null, vm, { image: false, video: true });
  eq([jobs.length, jobs[0].route], [1, 'mxm'], 'Create writes it as the full-reference call, not frame-only');
  has(jobs[0].text, '<Picture 1> = the grey clay render of this shot (layout and camera)', 'the blocking is in the label table');
  has(jobs[0].text, 'is a grey clay render of THIS shot, fixing its camera, framing and positions', 'and the writer is told what it is');
  has(jobs[0].text.split('=== THE MINIMAX')[1], 'This overrides the instruction above to state that the shot begins from <Picture 1>', 'the template’s "begins from <Picture 1>" is overridden when there is no still');
  sandbox.fetch = (url, init) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
    summary: '[reference generation] In the target video, <Subject 1> looks at a phone.',
    detailed_description: 'The target video is photorealistic. ' + 'word '.repeat(200) + '\n[Shot 1] Framed as <Picture 1>, <Subject 1> looks down at the phone.' }) } }] })) });
  p.settings.aiProvider = 'ooba';
  SB.Store.setOoba({ url: 'http://127.0.0.1:5000/v1/', model: 'local', key: '' });
  const r = await SB.Prompts.generateFor(sh, { image: false, video: true });
  eq(r.written, ['videoPrompt'], 'Create writes the card’s video prompt');
  const pr = sh.prompts[vm.id];
  has(pr.videoPrompt, '<Picture 1> is an untextured grey clay render of this exact shot', 'and it defines the blocking');
  has(pr.videoPrompt, 'In <Picture 1>, Gus is the tan figure on the left of frame.', 'binds the people to their figures');
  eq(pr.route, 'mxm', 'marked as the full-reference call, so the frame-only push holds back');
  eq(SB.Mxm.promptFor(p, sh, 'video').text, pr.videoPrompt, 'the MiniMax package carries the same prompt');
  pr.videoPrompt += '\nMY EDIT'; pr.at = Date.now() + 1000;
  eq(/MY EDIT/.test(SB.Mxm.promptFor(p, sh, 'video').text), true, 'an edit on the card reaches the package');
  // a card with no blocking on the same board keeps the frame-only H3 prompt
  const plain = SB.Model.addShot(p, p.scenes[0].id, { type: 'Wide' }); plain.description = 'An empty corridor.';
  eq(SB.Prompts.jobsFor(plain, null, vm, { image: false, video: true })[0].route, undefined, 'an unblocked card keeps the frame-only H3 prompt');
  delete SB.Pose;
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
if (fail) process.exit(1);
