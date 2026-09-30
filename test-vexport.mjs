/* test-vexport.mjs — video models, exported (js/vexport.js): the twin, its prompt, its files.
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
  'js/store.js', 'js/h3.js', 'js/mxm.js', 'js/vexport.js', 'js/prompts.js']) {
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


console.log('\n\u2014 the twin \u2014');
{
  const { p } = board();
  const vm = p.settings.models.find(m => m.kind === 'video');
  const im = p.settings.models.find(m => m.kind === 'image');
  const t = SB.Model.modelById(p, vm.id + SB.Model.EXPORT_SUFFIX);
  eq(!!t && t.export === true, true, 'a video model has an export twin');
  eq(t.videoRefs, 'full-reference', 'written for all the files, not one frame');
  eq(t.name, vm.name + ' \u00b7 export', 'and says so in its name');
  eq(/reference-to-video/.test(t.videoTemplate) && !/first frame is supplied/.test(t.videoTemplate), true, 'its own instructions: every file uploaded, no single supplied frame');
  eq(t.referenceTemplate === vm.referenceTemplate, true, 'the rest comes from the base model');
  eq(SB.Model.modelById(p, vm.id + SB.Model.EXPORT_SUFFIX) === t, true, 'one twin per model');
  eq(vm.export, undefined, 'the base model is untouched');
  eq(SB.Model.modelById(p, im.id + SB.Model.EXPORT_SUFFIX), null, 'image models have no twin');
  p.settings.videoModelId = vm.id + SB.Model.EXPORT_SUFFIX;
  const q = SB.Model.migrate(JSON.parse(JSON.stringify(p)));
  eq(q.settings.videoModelId, vm.id + SB.Model.EXPORT_SUFFIX, 'the choice survives a reload');
}

console.log('\n\u2014 an exported clip, written \u2014');
{
  const { p, sh, gus } = board();
  const base = p.settings.models.find(m => m.name === 'Seedance') || p.settings.models.find(m => m.kind === 'video' && !SB.H3.stock(m));
  p.settings.videoModelId = base.id + SB.Model.EXPORT_SUFFIX;
  const vm = SB.Model.videoModel(p);
  sh.pose = { serial: 1, scene: SB.Blobs.put(p, 'data:application/json,' + encodeURIComponent('{"figures":[{}]}')),
    image: SB.Blobs.image(p, PNG, 1, 1), render: { ref: SB.Blobs.put(p, PNG), w: 1, h: 1 },
    cast: [{ fig: 'f1', personaId: gus.id, name: 'Gus', colorName: 'tan', pos: { x: 0, where: 'centre', depth: 0 } }],
    text: 'Gus (the tan mannequin): centre of frame.', lens: 35, aspect: '16:9', at: 1, perf: null };
  const list = SB.VExport.assets(p, sh);
  eq(list.map(a => a.kind + ':' + a.cite), ['clay-still:image 1', 'subject:image 2'], 'files: the blocking, then Gus');
  asked = []; replies = [{ videoPrompt: 'Gus (image 2) folds the letter and stands.' }];
  await SB.Prompts.generateFor(sh, { video: true });
  const req = JSON.stringify(asked[0]);
  if (process.env.DUMP) (await import('node:fs')).writeFileSync(process.env.DUMP, JSON.stringify(asked[0], null, 1));
  has(req, 'FILES UPLOADED WITH THIS CLIP', 'the writer gets the numbered file list');
  has(req, 'image 1 = the grey clay render of this shot', 'with the blocking as image 1');
  has(req, 'image 2 = Gus', 'and Gus as image 2');
  eq(/WHO AND WHAT IS IN THE SUPPLIED FRAME/.test(req), false, 'and nothing about a single supplied frame');
  has(req, 'No first frame is supplied', 'no frame yet: it is told so');
  eq(/The first frame is supplied|Do not re-describe anything already in the frame/.test(req), false, 'the request never claims a first frame is supplied');
  has(req, 'REFERENCE-TO-VIDEO PROMPT', 'and is headed as reference-to-video');
  eq((sh.prompts[vm.id] || {}).videoPrompt, 'Gus (image 2) folds the letter and stands.', 'stored under the export twin');
  eq((sh.prompts[base.id] || {}).videoPrompt, undefined, 'the send version is untouched');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
if (fail) process.exit(1);
