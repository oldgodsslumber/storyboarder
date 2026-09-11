/* test-core.mjs — headless checks of the anchored-range engine.
 * usage: node test-core.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = dirname(fileURLToPath(import.meta.url));

/* Minimal DOM stubs — doc.js/model.js only touch window + a couple of helpers. */
const sandbox = {
  console,
  document: {
    createElement: () => ({ style: {}, classList: { add() { }, remove() { } }, appendChild() { } }),
    getElementById: () => null
  },
  setTimeout, clearTimeout,
  indexedDB: undefined,
  localStorage: (() => {
    const m = new Map();
    return {
      getItem: k => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: k => m.delete(k)
    };
  })(),
  Uint8Array, TextEncoder, URL
};
sandbox.window = sandbox;
vm.createContext(sandbox);

for (const f of ['js/util.js', 'js/doc.js', 'js/blobs.js', 'js/geminimodels.js', 'js/providers.js',
  'js/brand.js', 'js/renders.js', 'js/imaginemodels.js', 'js/refs.js', 'js/personas.js', 'js/fields.js', 'js/model.js', 'js/store.js',
  'js/coverage.js']) {
  vm.runInContext(readFileSync(join(root, f), 'utf8'), sandbox, { filename: f });
}
const SB = sandbox.SB;

let pass = 0, fail = 0;
const cut = s => (s && s.length > 120) ? s.slice(0, 117) + '…(' + s.length + ' chars)' : s;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + '\n       got ' + cut(a) + '\n       want ' + cut(b)); }
}

function projectWith(text) {
  const p = SB.Model.newProject();
  p.scenes[0].shots = [];
  p.master = SB.Doc.make(text);
  return p;
}
function addLinked(p, from, to) {
  return SB.Model.addShot(p, p.scenes[0].id, { link: { from, to } });
}
function win(p, sh) {
  const w = SB.Model.windowFor(p, sh);
  return w.doc.text.slice(w.from, w.to);
}
function tie(p, from, to, widen) {
  return SB.Model.tieScene(p, p.scenes[0].id, from, to, widen);
}
/* null when the scene claims nothing — a state no shot can be in */
function swin(p, sc) {
  const w = SB.Model.windowForScene(p, sc);
  return w ? w.doc.text.slice(w.from, w.to) : null;
}

console.log('\n— anchors survive edits elsewhere —');
{
  const p = projectWith('ONE two THREE four');
  const a = addLinked(p, 0, 3);      // "ONE"
  const b = addLinked(p, 8, 13);     // "THREE"
  SB.Model.applyMasterEdit(p, 3, 3, ' zero', null);   // insert after "ONE"
  eq(p.master.text, 'ONE zero two THREE four', 'master text after insert');
  eq(win(p, a), 'ONE zero', 'edge insertion grows the shot ending there');
  eq(win(p, b), 'THREE', 'later shot keeps its own text');
}

console.log('\n— overlapping ranges —');
{
  const p = projectWith('AAA BBB CCC');
  const master = addLinked(p, 0, 7);   // "AAA BBB"
  const insert = addLinked(p, 4, 11);  // "BBB CCC"
  SB.Model.applyMasterEdit(p, 5, 6, 'X', null);   // BBB -> BXB, inside the shared region
  eq(p.master.text, 'AAA BXB CCC', 'shared edit lands in master');
  eq(win(p, master), 'AAA BXB', 'first shot sees the shared edit');
  eq(win(p, insert), 'BXB CCC', 'second shot sees the shared edit');
  SB.Model.applyMasterEdit(p, 1, 2, '', null);    // delete inside first shot only
  eq(win(p, master), 'AA BXB', 'unique-region edit hits only that shot');
  eq(win(p, insert), 'BXB CCC', 'other shot untouched by unique-region edit');
}

console.log('\n— typing inside a shot box —');
{
  const p = projectWith('hello world');
  const sh = addLinked(p, 0, 5);       // "hello"
  SB.Model.applyShotEdit(p, sh, 5, 5, '!!');   // at the shot box's own end
  eq(p.master.text, 'hello!! world', 'shot edit writes through to master');
  eq(win(p, sh), 'hello!!', 'shot grows at its trailing edge');
  SB.Model.applyShotEdit(p, sh, 0, 0, '>');    // at the leading edge
  eq(win(p, sh), '>hello!!', 'shot grows at its leading edge');
  eq(p.master.text, '>hello!! world', 'master carries the leading insert');
}

console.log('\n— deletion orphans a linked window —');
{
  const p = projectWith('keep DELETEME keep');
  const sh = addLinked(p, 5, 13);      // "DELETEME"
  SB.Model.applyMasterEdit(p, 5, 13, '', null);
  eq(win(p, sh), '', 'window is empty');
  eq(sh.broken, true, 'shot flagged as broken, not silently blank');
}

console.log('\n— break link makes text freestanding —');
{
  const p = projectWith('alpha beta');
  const sh = addLinked(p, 0, 5);
  SB.Doc.toggleMark(p.master, 'b', 0, 5);
  SB.Model.breakLink(p, sh);
  eq(sh.link, null, 'link cleared');
  eq(win(p, sh), 'alpha', 'text kept locally');
  eq(sh.local.marks.b, [[0, 5]], 'marks came along, rebased');
  SB.Model.applyMasterEdit(p, 0, 5, 'ALPHA', null);
  eq(win(p, sh), 'alpha', 'freestanding box no longer syncs');
}

console.log('\n— deleting a shot leaves the script alone —');
{
  const p = projectWith('one two');
  const sh = addLinked(p, 0, 3);
  SB.Model.deleteShot(p, sh.id);
  eq(p.master.text, 'one two', 'master text untouched by shot deletion');
  eq(p.scenes[0].shots.length, 0, 'shot removed');
}

console.log('\n— marks track edits —');
{
  const d = SB.Doc.make('the quick fox');
  SB.Doc.toggleMark(d, 'b', 4, 9);        // "quick"
  SB.Doc.replace(d, 0, 4, 'a ');          // "a quick fox"
  eq(d.marks.b, [[2, 7]], 'bold range shifted with the text');
  eq(SB.Doc.hasMark(d, 'b', 2, 7), true, 'range still fully bold');
  SB.Doc.toggleMark(d, 'b', 2, 7);
  eq(d.marks.b, [], 'toggle removes when fully covered');
}

console.log('\n— numbering —');
{
  const p = SB.Model.newProject();
  SB.Model.addScene(p);
  SB.Model.addShot(p, p.scenes[1].id, {});
  SB.Model.addShot(p, p.scenes[1].id, {});
  eq(SB.Model.code(0, 0), '1A', 'first shot of first scene');
  eq(SB.Model.code(1, 1), '2B', 'second shot of second scene');
  eq(SB.letters(26), 'AA', 'letters roll over past Z');
  const id = p.scenes[1].shots[1].id;
  SB.Model.moveShot(p, id, p.scenes[0].id, 0);
  eq(SB.Model.findShot(p, id).code, '1A', 'code recalculates after a move');
}

console.log('\n— coverage for the highlight underlay —');
{
  const p = projectWith('AAAABBBB');
  addLinked(p, 0, 6);
  addLinked(p, 4, 8);
  eq(Array.from(SB.Model.coverage(p)), [1, 1, 1, 1, 2, 2, 1, 1], 'overlap counted per character');
}

console.log('\n— gemini model list —');
{
  const G = SB.GeminiModels;
  eq(G.LIST.some(m => m.id === G.DEFAULT), true, 'the default is in the list');
  /* Pinned to a version number this rots every time the list moves on. What
     actually matters is that the default is one the app still considers live. */
  eq(G.isRetired(G.DEFAULT), false, 'the default is not itself a retired id');
  eq(G.normalize(G.DEFAULT), G.DEFAULT, 'and normalize leaves it alone');
  eq(G.isAlias(G.DEFAULT), false, 'the default is a pinned id, never a floating alias');
  eq(G.LIST.some(m => /image|tts|embedding|live|veo/.test(m.id)), false,
    'no non-text models in the picker');
  eq(G.normalize('gemini-2.0-flash'), G.DEFAULT, 'retired id falls back to the default');
  eq(G.normalize('gemini-flash-latest'), G.DEFAULT, 'a floating alias falls back too');
  eq(G.normalize('gemini-pro-latest'), G.DEFAULT, 'every -latest alias does');
  eq(G.isAlias('gemini-flash-latest'), true, 'and is recognised as an alias, not a retirement');
  eq(G.normalize('gemini-2.5-pro'), 'gemini-2.5-pro', 'a live id is left alone');
  eq(G.normalize('some-custom-id'), 'some-custom-id', 'a custom id is left alone');
  eq(G.LIST.some(m => m.id === 'gemma-4-31b-it'), true, 'Gemma 4 31B is offered');
  eq(G.isGemma('gemma-4-31b-it'), true, 'gemma is recognised (it has no JSON mode)');
  eq(G.isGemma(G.DEFAULT), false, 'gemini is not treated as gemma');
  eq(G.limit('gemma-4-31b-it'), 1500, 'gemma ships with its larger free quota');

  const p = SB.Model.newProject();
  eq(p.settings.geminiModel, G.DEFAULT, 'new projects start on the default');
  const old = SB.Model.migrate(Object.assign(SB.Model.newProject(),
    { settings: Object.assign(SB.Model.newProject().settings, { geminiModel: 'gemini-2.0-flash' }) }));
  eq(old.settings.geminiModel, G.DEFAULT, 'opening an old file migrates a dead model id');
}

console.log('\n— free-call counting —');
{
  const G = SB.GeminiModels;
  const id = 'gemini-3.6-flash';
  eq(G.count(id), 0, 'starts at zero today');
  G.bump(id); G.bump(id);
  eq(G.count(id), 2, 'requests are counted');
  eq(G.remaining(id), null, 'no limit set -> no remaining figure');
  eq(G.usageText(id), '2 requests today', 'count-only text');
  G.setLimit(id, 20);
  eq(G.remaining(id), 18, 'remaining against a set limit');
  eq(G.usageText(id), '2 / 20 today · 18 left', 'count/limit text');
  G.markExhausted(id);
  eq(G.remaining(id), 0, 'a 429 burns the rest of the day');
  eq(G.limit('gemini-2.5-flash'), 20, 'known free-tier default limit');
  eq(G.limit('gemini-3.5-flash'), 0, 'unknown limits stay unset rather than guessed');
}

console.log('\n— brand style —');
{
  const B = SB.Brand;
  const p = SB.Model.newProject();
  eq(p.settings.brand.enabled, true, 'house style is on by default');
  eq(B.brandOf(p).text === B.DEFAULT, true, 'uses the app house style');
  eq(p.settings.brand.custom, false, 'nothing stored until it is edited');
  // a board left on the stock text follows the app when the style is corrected
  const stale = SB.Model.migrate(Object.assign(SB.Model.newProject(), {
    settings: Object.assign(SB.Model.newProject().settings,
      { brand: { enabled: true, text: 'OLD 9-frame grid text' } })
  }));
  eq(B.brandOf(stale).text, B.DEFAULT, 'an unedited board picks up the corrected style');
  const mine = SB.Model.migrate(Object.assign(SB.Model.newProject(), {
    settings: Object.assign(SB.Model.newProject().settings,
      { brand: { enabled: true, custom: true, text: 'MY OWN STYLE' } })
  }));
  eq(B.brandOf(mine).text, 'MY OWN STYLE', 'a hand-edited style is kept');

  const sc = p.scenes[0];
  sc.heading = 'Opening'; sc.description = 'Client office, morning.';
  sc.shots = [];
  const a = SB.Model.addShot(p, sc.id, { type: 'Wide' });
  const b = SB.Model.addShot(p, sc.id, { type: 'Close-up' });
  const c = SB.Model.addShot(p, sc.id, { type: 'Insert', noShot: true });
  a.description = 'Open-plan office, the subject mid-stride.';
  b.description = 'Hands on a laptop trackpad.';

  const sys = B.systemFor(p, b, 'image');
  eq(/HOUSE STYLE/.test(sys), true, 'system instruction carries the house style');
  eq(/No gender references|gendered language/i.test(sys), false,
    'and no longer forbids saying what a subject looks like');
  eq(/SCENE CONTEXT/.test(sys), true, 'the scene context block is added');
  eq(/beat 2 of 2/.test(sys), true, 'the shot knows which beat it is');
  eq(/Scene 1: Opening/.test(sys), true, 'scene heading is passed through');
  eq(/Client office, morning\./.test(sys), true, 'scene description is passed through');
  eq(/Hands on a laptop trackpad[\s\S]*writing/.test(sys), true, 'the frame being written is marked');
  eq(/\[1A\] Wide/.test(sys), true, 'sibling beats are listed with their codes');
  eq(sys.indexOf('Insert') < 0, true, '“no shot” fragments are not part of the sequence');

  // the 9-frame grid language is gone for good
  eq(/9 frames|entire grid|the grid|matches reference|matches the reference/i.test(sys), false,
    'no grid language survives');
  eq(/reference photo later|wide\/reference frame/i.test(sys), false,
    'no wide-as-reference-photo mandate');
  eq(/consistent subject|identical across every frame/i.test(sys), false,
    'no locked-subject language — personas handle that');
  eq(/9 frames|grid|matches reference 100/i.test(B.DEFAULT), false,
    'and none of it is left in the house style itself');

  eq(/MOTION/.test(B.systemFor(p, b, 'image')), false, 'image jobs get no motion rider');
  eq(/MOTION/.test(B.systemFor(p, b, 'video')), true, 'video jobs do');
  eq(/MOTION/.test(B.systemFor(p, b, 'both')), true, 'combined jobs do too');

  /* A first frame is one instant. The rider that says so is not part of the
     house style — it is what the still IS — so it ships either way. */
  eq(/THE FIRST FRAME IS ONE INSTANT/.test(B.systemFor(p, b, 'image')), true,
    'image jobs are told the frame is a single moment');
  eq(/THE FIRST FRAME IS ONE INSTANT/.test(B.systemFor(p, b, 'both')), true,
    'and so are combined jobs, which write the still as well');
  eq(/THE FIRST FRAME IS ONE INSTANT/.test(B.systemFor(p, b, 'video')), false,
    'a video-only job is not — it is the half that moves');

  p.settings.brand.enabled = false;
  eq(/HOUSE STYLE/.test(B.systemFor(p, b, 'image')), false,
    'turning the house style off sends no house style');
  eq(/THE FIRST FRAME IS ONE INSTANT/.test(B.systemFor(p, b, 'image')), true,
    'but the craft rules are not the brand, and go anyway');
  eq(/MOTION/.test(B.systemFor(p, b, 'video')), true, 'the motion rules likewise');
}

console.log('\n— personas —');
{
  const Per = SB.Personas;
  const p = SB.Model.newProject();
  const sc = p.scenes[0];
  const shot = sc.shots[0];
  shot.description = 'Two people at a whiteboard.';

  const a = Per.add(p, { name: 'Ops lead', description: 'Late 30s, cropped hair, charcoal knit.' });
  const b = Per.add(p, { name: 'Technician', description: 'Twenties, navy work shirt, tool roll.' });
  eq(Per.all(p).length, 2, 'personas are stored on the project');
  eq(Per.block(p, shot, null), '', 'a shot with no cast adds nothing');

  Per.toggleOnShot(p, shot, a.id);
  Per.toggleOnShot(p, shot, b.id);
  eq(Per.forShot(p, shot).length, 2, 'both are cast in the shot');

  const model = { name: 'Qwen-Image', referenceTemplate: 'Use "the person in image {{N}}".' };
  let blk = Per.block(p, shot, model);
  eq(/CAST/.test(blk), true, 'cast block is built');
  eq(/Ops lead/.test(blk) && /Technician/.test(blk), true, 'everyone cast is named');
  eq(/charcoal knit/.test(blk), true, 'wardrobe travels with the description');
  eq(/No reference image/.test(blk), true, 'a persona with no image says so');
  eq(/image 1 =/.test(blk), false, 'no image numbering when nobody has an image');

  a.image = { data: 'data:image/jpeg;base64,x', w: 4, h: 3 };
  b.image = { data: 'data:image/jpeg;base64,y', w: 4, h: 3 };
  blk = Per.block(p, shot, model);
  eq(/the person in image \{\{N\}\}/.test(blk), false, 'the placeholder is not left raw');
  eq(/image 1 = Ops lead/.test(blk), true, 'reference images are numbered in cast order');
  eq(/image 2 = Technician/.test(blk), true, 'and the second one too');
  eq(/Use "the person in image N"/.test(blk), true, "the model's own wording is used");

  const named = { name: 'Other', referenceTemplate: 'Refer to them by name ({{NAME}}).' };
  eq(/Refer to them by name \(Ops lead, Technician\)/.test(Per.block(p, shot, named)), true,
    'a model that wants names gets names');

  eq(Per.block(p, shot, { name: 'NoRef', referenceTemplate: '' }).indexOf('image 1 =') > 0, true,
    'the mapping is still listed even with no wording template');

  Per.toggleOnShot(p, shot, b.id);
  eq(Per.forShot(p, shot).length, 1, 'a persona can be taken off a shot');
  Per.remove(p, a.id);
  eq(Per.all(p).length, 1, 'removing a persona deletes it');
  eq((shot.personaIds || []).length, 0, 'and takes it off every shot');

  eq(SB.Model.newProject().settings.models[0].referenceTemplate === Per.DEFAULT_REF_TEMPLATE, true,
    'models ship with a default reference wording');
}

console.log('\n— people, places and things are one record —');
{
  const Per = SB.Personas;
  const p = SB.Model.newProject();
  const shot = p.scenes[0].shots[0];

  const lead = Per.add(p, { kind: 'person', name: 'Ops lead', description: 'Charcoal knit.' });
  const room = Per.add(p, { kind: 'place', name: 'Server room', description: 'Cold aisle, blue LEDs.' });
  const set = Per.add(p, { kind: 'thing', name: 'Handset', description: 'Matte black, one green LED.' });

  eq(Per.add(p, {}).kind, 'person', 'a subject with no kind named is a person');
  eq(Per.kindOf({ kind: 'nonsense' }).id, 'person', 'and so is one with a kind nobody recognises');
  eq(Per.ofKind(p, 'place').length, 1, 'kinds can be asked for on their own');
  eq(Per.ofKind(p, 'person').length, 2, 'and everything else stays where it was');

  shot.personaIds = [lead.id, room.id, set.id];
  const blk = Per.block(p, shot, null);
  eq(/CAST/.test(blk) && /LOCATIONS/.test(blk) && /OBJECTS/.test(blk), true,
    'each kind gets its own labelled block');
  eq(blk.indexOf('CAST') < blk.indexOf('LOCATIONS'), true, 'in a fixed order, whatever order they were cast in');
  eq(/Cold aisle/.test(blk) && /green LED/.test(blk), true,
    'a place and a thing carry their description exactly as a person does');
  eq(/people, places and things/.test(blk), true,
    'and the block claims authority over all three, not just the wardrobe');

  /* a wardrobe repair is about people — a room on the card says nothing about
     whose clothes a description is describing */
  const other = p.scenes[0].shots[0];
  other.description = 'Late thirties, in a charcoal fleece and heavy boots, at the rack.';
  other.personaIds = [room.id];
  eq(SB.Coverage.carriesWardrobe(p, other), null,
    'a shot cast with only a location is never flagged as carrying a wardrobe');
  other.personaIds = [lead.id];
  eq(!!SB.Coverage.carriesWardrobe(p, other), true, 'with a person on it, it is');
}

console.log('\n— a subject holds as many reference frames as it needs —');
{
  const Per = SB.Personas;
  const p = SB.Model.newProject();
  const shot = p.scenes[0].shots[0];
  const img = function (c) { return SB.Blobs.image(p, 'data:image/jpeg;base64,' + c.repeat(80), 4, 3); };

  const per = Per.add(p, { name: 'Ops lead', description: 'Charcoal knit.' });
  eq(Per.hasImage(per), false, 'a new subject has no frames');

  Per.setImage(per, img('A'), 'front');
  eq(Per.imagesOf(per).length, 1, 'a subject holds one reference');
  eq(Per.hero(per).label, 'front', 'labelled with what it shows');

  Per.setImage(per, img('B'), '3/4');
  eq(Per.imagesOf(per).length, 1, 'and a second one replaces it rather than joining it');
  eq(Per.hero(per).label, '3/4', 'the new one brings its own label');
  Per.labelImage(per, 'front view');
  eq(Per.hero(per).label, 'front view', 'which stays editable in place');

  const mate = Per.add(p, { name: 'Technician', description: 'Navy work shirt.' });
  Per.setImage(mate, img('C'));
  shot.personaIds = [per.id, mate.id];

  const blk = Per.block(p, shot, null);
  eq(/image 1 — Ops lead/.test(blk), true, 'a subject cites its one image');
  eq(/image 2 — Technician/.test(blk), true, 'and numbering runs on across subjects');
  eq(/image 1 = Ops lead \(front view\)/.test(blk), true, 'the mapping names what it shows');
  eq(/images \d+–\d+/.test(blk), false, 'no ranges, because nobody can hold two');
  eq(/SAME\b[\s\S]*different angles/.test(blk), false,
    'and the sentence explaining that several frames are one person is gone with them');

  Per.clearImage(per);
  eq(Per.hasImage(per), false, 'a reference can be taken off');

  /* what gc() deletes is decided by the blob sweep, so every extra frame has
     to be visible to it or somebody loses their references */
  SB.Blobs.gc(p);                                  // the frame removed above goes here
  const before = Object.keys(p.blobs).length;
  eq(before, 1, 'the one frame still pointed at is the one that is kept');
  SB.Blobs.gc(p);
  eq(Object.keys(p.blobs).length, before, 'a reference frame survives a second collection');
  Per.clearImage(mate);
  SB.Blobs.gc(p);
  eq(Object.keys(p.blobs).length, before - 1, 'and one nothing points at any more does not');

  /* what a board that carried several keeps */
  const many = Per.add(p, { name: 'Understudy' });
  many.images = [
    { ref: SB.Blobs.put(p, 'data:image/jpeg;base64,' + 'X'.repeat(40)), w: 4, h: 3, label: 'front' },
    { ref: SB.Blobs.put(p, 'data:image/jpeg;base64,' + 'Y'.repeat(40)), w: 4, h: 3, label: 'back' },
    { ref: SB.Blobs.put(p, 'data:image/jpeg;base64,' + 'Z'.repeat(40)), w: 4, h: 3, label: 'hat' }
  ];
  SB.Model.migrate(p);
  eq(Per.hero(many).label, 'front', 'migration keeps the first as the reference');
  eq(Per.retiredOf(many).length, 2, 'and retires the rest rather than deleting them');
  eq(Per.imagesOf(many).length, 1, 'only one is ever fed');
  SB.Blobs.gc(p);
  eq(Per.retiredOf(many).every(function (x) { return !!p.blobs[x.ref]; }), true,
    'a retired frame is still referenced, so the sweep leaves it alone');
  eq(SB.Renders.weigh(p).retired.n, 2, 'and Settings can say what they weigh');
  Per.useRetired(many, 1);
  eq(Per.hero(many).label, 'hat', 'one can be brought back');
  eq(Per.retiredOf(many).map(function (x) { return x.label; }).indexOf('front') >= 0, true,
    'and the one it replaced steps down rather than being lost');
  Per.dropRetired(many);
  eq(Per.retiredOf(many).length, 0, 'they can be thrown away deliberately');
  SB.Blobs.gc(p);
  eq(SB.Renders.weigh(p).retired.n, 0, 'which is when the bytes actually go');
}

console.log('\n— a shot naming the same subject twice ——');
{
  const Per = SB.Personas;
  const p = SB.Model.newProject();
  const sh = p.scenes[0].shots[0];
  const img = function (c) { return SB.Blobs.image(p, 'data:image/jpeg;base64,' + c.repeat(80), 4, 3); };

  const dup = Per.add(p, { name: 'Dup', description: 'Twice named.' });
  const other = Per.add(p, { name: 'Other', description: 'Once named.' });
  Per.setImage(dup, img('A'));
  Per.setImage(other, img('B'));

  /* not reachable through the UI — toggleOnShot and coverage both dedupe — but
     a hand-edited or third-party file can say this, and it used to produce
     "images 1–3" for a subject holding images 1 and 3 */
  sh.personaIds = [dup.id, other.id, dup.id];
  eq(Per.forShot(p, sh).length, 2, 'a subject named twice on one shot is only cast once');

  const blk = Per.block(p, sh, null);
  eq((blk.match(/^ +\d+\. /gm) || []).length, 2, 'and the block lists two subjects, not three');
  eq(/image 1 = Dup/.test(blk) && /image 2 = Other/.test(blk), true,
    'so the image numbering stays honest');
  eq(/images 1–3/.test(blk), false, 'no range is claimed across somebody else’s image');
}

console.log('\n— a first frame is one instant —');
{
  const Per = SB.Personas;
  const p = SB.Model.newProject();
  const sh = p.scenes[0].shots[0];
  sh.description = 'He sits writing at the desk. A moment later somebody walks into frame behind him.';

  const him = Per.add(p, { name: 'Writer', description: 'Charcoal knit.' });
  const her = Per.add(p, { name: 'Colleague', description: 'Rust-orange jacket.' });
  Per.toggleOnShot(p, sh, him.id);
  Per.toggleOnShot(p, sh, her.id);

  eq(Per.presentAtOpen(p, sh).length, 2, 'everybody cast is in the opening frame until told otherwise');
  eq(Per.arriving(p, sh).length, 0, 'nobody arrives by default — which is what every old board means');

  /* the block used to read as a guest list: it named everyone cast and handed
     over a numbered reference image each, so the writer drew them all */
  const img = Per.block(p, sh, null, 'image');
  eq(/not a list of who or what is visible/.test(img), true,
    'the image job is told the cast block is not a list of who is in frame');
  eq(/present at the instant the shot opens/.test(img), true,
    'and that only what is there when it opens gets drawn');
  eq(/not a list of who or what is visible/.test(Per.block(p, sh, null, 'video')), false,
    'the video job is not — it covers the movement, arrivals included');

  Per.toggleEnters(sh, her.id);
  eq(Per.enters(sh, her.id), true, 'somebody can be marked as arriving partway through');
  eq(Per.presentAtOpen(p, sh).length, 1, 'so the opening frame holds one of them');
  eq(Per.arriving(p, sh)[0].name, 'Colleague', 'and the other is the one who walks in');

  const img2 = Per.block(p, sh, null, 'image');
  eq(/ARRIVES DURING THE SHOT — NOT IN THE FIRST FRAME/.test(img2), true,
    'the marked subject is flagged in the list itself');
  eq(/MARKED AS ARRIVING[\s\S]*Colleague/.test(img2), true, 'and named again, so it cannot be missed');
  eq(/opening door, a shadow or a look off-screen/.test(img2), true,
    'including the ways a model hints at somebody it was told to leave out');
  eq(/Rust-orange/.test(img2), true,
    'their description still travels — the still does not show them, the video will');

  /* A frame-only video call is handed the first frame as a picture, so the look
     of everybody standing in it is inherited and must not be written down again.
     The one exception is whoever is NOT in that picture yet. */
  const vid = Per.block(p, sh, null, 'video');
  eq(/NOT IN THE SUPPLIED FRAME[\s\S]*Colleague/.test(vid), true,
    'the video job is told the arrival is movement it owns');
  eq(/Rust-orange/.test(vid), true,
    'and gets their description — an arrival is the one thing the frame cannot show');
  eq(/Writer/.test(vid), true, 'somebody already in frame is still named, so the action can use it');
  eq(/Charcoal knit/.test(vid), false,
    'but not described: that is in the supplied frame, and restating it re-renders the shot');

  /* the numbering has to mean the same thing in both prompts — it is the order
     the person feeding the model puts their files in */
  const im = function (c) { return SB.Blobs.image(p, 'data:image/jpeg;base64,' + c.repeat(60), 4, 3); };
  Per.setImage(him, im('A'));
  Per.setImage(her, im('B'));
  const a = Per.block(p, sh, null, 'image'), b = Per.block(p, sh, null, 'video');
  eq(/image 1 = Writer/.test(a) && /image 2 = Colleague/.test(a), true, 'the image job numbers both');
  /* ...and the frame-only video job numbers nothing, because it is handed no
     reference images. A mapping there was a promise about files that are never
     passed over — the numbering only has to agree where images are actually
     fed, which is the still and a full-reference video model. */
  eq(/image \d+ = /.test(b), false,
    'the frame-only video job carries no mapping — it is shown no reference images');
  const h3m = { name: 'MiniMax H3 (Hailuo)', videoRefs: SB.Model.FULL_REFERENCE };
  const c = Per.block(p, sh, h3m, 'video');
  eq(/image 1 = Writer/.test(c) && /image 2 = Colleague/.test(c), true,
    'a full-reference video job numbers them identically to the still');

  /* the mark is a subset of the cast, and nothing else */
  Per.toggleOnShot(p, sh, her.id);
  eq(Per.enters(sh, her.id), false, 'taking somebody off the card takes their arrival mark too');
  Per.toggleOnShot(p, sh, her.id);
  Per.toggleEnters(sh, her.id);
  Per.remove(p, her.id);
  eq((sh.castEnters || []).length, 0, 'and deleting the subject outright clears it as well');

  const old = { id: 'x', personaIds: ['a'], castEnters: ['a', 'ghost'] };
  const mp = SB.Model.newProject();
  mp.scenes[0].shots = [old];
  SB.Model.migrate(mp);
  eq(old.castEnters, ['a'], 'migration keeps only marks for people actually on the card');
}

console.log('\n— the board notices when a description reads as an arrival —');
{
  const Per = SB.Personas;
  eq(Per.readsAsArrival('A colleague walks into frame behind him.'), true, 'walks into frame');
  eq(Per.readsAsArrival('She enters as the lift doors part.'), true, 'enters');
  eq(Per.readsAsArrival('A second figure appears at the far end.'), true, 'appears');
  eq(Per.readsAsArrival('Two people lean over a whiteboard, talking.'), false,
    'a shot where everybody is simply present is not flagged');
  eq(Per.readsAsArrival(''), false, 'and an empty description is not either');
}

console.log('\n— a version freezes its cast with it —');
{
  const Per = SB.Personas;
  const p = SB.Model.newProject();
  const sh = p.scenes[0].shots[0];
  const img = function (c) { return SB.Blobs.image(p, 'data:image/jpeg;base64,' + c.repeat(80), 4, 3); };

  const lead = Per.add(p, { name: 'Ops lead', description: 'Charcoal knit.' });
  const room = Per.add(p, { kind: 'place', name: 'Server room', description: 'Cold aisle.' });
  Per.setImage(lead, img('A'));
  Per.setImage(room, img('B'));
  sh.personaIds = [lead.id, room.id];
  Per.setEnters(sh, room.id, false);

  /* freeze() is what newVersion() does once the name is settled */
  p.versions.push({
    n: 1, name: 'v1', createdAt: 1,
    snapshot: {
      master: SB.clone(p.master), scenes: SB.clone(p.scenes),
      personas: SB.clone(p.personas), scriptComments: [],
      versionNumber: 1, versionName: 'v1'
    }
  });
  eq(p.versions[0].snapshot.personas.length, 2,
    'the cast and the locations go into the snapshot');

  /* the bug this fixes: delete a subject and its frames were collected as
     orphans, so the frozen version's cards pointed at nothing */
  const before = Object.keys(p.blobs).length;
  Per.remove(p, lead.id);
  SB.Blobs.gc(p);
  eq(Object.keys(p.blobs).length, before,
    'deleting a subject afterwards does not collect the frames the version still needs');
  eq(SB.Blobs.src(p, SB.Personas.hero(p.versions[0].snapshot.personas[0])).length > 0, true,
    'and the frozen copy still resolves');
  eq(Per.all(p).length, 1, 'while the working board really has lost them');
}

console.log('\n— an old file is brought up to date on load —');
{
  const frame = 'data:image/jpeg;base64,' + 'Z'.repeat(400);
  const old = SB.Model.newProject();
  /* a board as it was written: one persona with a single image and no kind,
     and a version snapshot from before the cast froze with it */
  old.personas = [{ id: 'p1', name: 'Lead', description: 'Knit.',
    image: { data: frame, w: 4, h: 3 } }];
  old.scenes[0].shots[0].personaIds = ['p1'];
  old.versions = [{
    n: 1, name: 'v1', createdAt: 1,
    snapshot: {
      master: SB.Doc.make(''), versionNumber: 1, versionName: 'v1',
      scenes: [{ id: 'sc', heading: '', description: '',
        shots: [{ id: 'x', personaIds: ['p1'] }] }]
    }
  }];

  const p = SB.Model.migrate(old);
  eq(p.personas[0].kind, 'person', 'a persona from before kinds is a person');
  eq(!!SB.Personas.hero(p.personas[0]).ref, true, 'and its lone image became the reference');
  eq(Array.isArray(p.versions[0].snapshot.personas), true,
    'a snapshot with no cast is given one, so restoring it does not drop the cast');
  eq(p.versions[0].snapshot.personas[0].id, 'p1',
    'backfilled from the cast as it stands, which is the closest recoverable thing');
  eq(p.versions[0].snapshot.scenes[0].shots[0].castEnters, [],
    'and its shots gain the arrival field, empty — everybody was already there');

  /* the frames the snapshot needs are referenced, so a later delete keeps them */
  const n = Object.keys(p.blobs).length;
  SB.Personas.remove(p, 'p1');
  SB.Blobs.gc(p);
  eq(Object.keys(p.blobs).length, n, 'an old version keeps its frames alive too');

  /* migrating twice must not double anything up */
  const twice = SB.Model.migrate(p);
  eq(twice.versions[0].snapshot.personas.length, 1, 'and migrating again changes nothing');
}

console.log('\n— a model that takes no reference wording —');
{
  const Per = SB.Personas;
  const p = SB.Model.newProject();
  const sh = p.scenes[0].shots[0];
  const per = Per.add(p, { name: 'Ops lead', description: 'Knit.' });
  Per.setImage(per, SB.Blobs.image(p, 'data:image/jpeg;base64,' + 'Q'.repeat(80), 4, 3));
  sh.personaIds = [per.id];

  const none = Per.block(p, sh, { name: 'Plain', referenceTemplate: '' }, 'image');
  eq(/Reference images are supplied in order/.test(none), false,
    'a blank wording sends no wording, as the Settings box has always said it would');
  eq(/image 1 = Ops lead/.test(none), true,
    'but the mapping still goes — it is what tells you which file is which');

  const missing = Per.block(p, sh, { name: 'Unset' }, 'image');
  eq(/Reference images are supplied in order/.test(missing), true,
    'a model with no wording field at all still gets the default');

  const model = SB.Model.newProject().settings.models[0];
  eq(typeof model.referenceTemplate, 'string', 'every shipped model has the field set');
}

console.log('\n— @ means the model will be shown a picture of this —');
{
  const R = SB.Refs, Per = SB.Personas;
  const p = SB.Model.newProject();
  const sc = p.scenes[0];
  const a = sc.shots[0];
  const img = function (c) { return SB.Blobs.image(p, 'data:image/jpeg;base64,' + c.repeat(80), 4, 3); };

  const him = Per.add(p, { name: 'Writer', description: 'Charcoal knit.' });
  const her = Per.add(p, { name: 'Colleague', description: 'Rust-orange jacket.' });
  Per.setImage(him, img('A'), 'front');
  Per.setImage(her, img('B'), 'front');

  a.description = R.mark(him.id, 'Writer') + ' sits writing. ' +
    R.mark(her.id, 'Colleague') + ' walks in behind him.';

  /* the boundary: nothing downstream should ever see a mark */
  eq(R.plain(p, a.description), 'Writer sits writing. Colleague walks in behind him.',
    'a description reads as ordinary prose');
  eq(R.parse(p, a.description).map(function (m) { return m.label; }), ['Writer', 'Colleague'],
    'and the marks are known, in the order they were written');

  /* the mark carries the id, so nothing has to be rewritten, ever */
  him.name = 'The writer';
  eq(R.plain(p, a.description), 'The writer sits writing. Colleague walks in behind him.',
    'renaming a subject needs no text rewriting at all');
  him.name = 'Writer';

  /* order in the sentence is order in the feed — the one thing the writer controls */
  a.personaIds = [her.id, him.id];               // cast in the other order on purpose
  let f = R.feed(p, a);
  eq(f.map(function (e) { return e.label; }), ['Writer', 'Colleague'],
    'the feed follows the sentence, not the order they were cast');
  eq(f[0].numbers, [1], 'the first mark takes image 1');
  eq(f[1].numbers, [2], 'and each subject takes exactly one number');
  eq(R.images(p, a).map(function (e) { return e.n + ':' + e.label + ':' + e.role; }),
    ['1:Writer:front', '2:Colleague:front'],
    'which is the list of files to hand over, in order, labelled');

  /* cast but never mentioned: still sent, because dropping it would change what
     every board made before this sends — but called out */
  const room = Per.add(p, { kind: 'place', name: 'The office', description: 'Night, one lamp.' });
  Per.setImage(room, img('D'));
  a.personaIds.push(room.id);
  f = R.feed(p, a);
  eq(f.length, 3, 'a cast subject nobody mentioned is still in the feed');
  eq(f[2].mentioned, false, 'flagged as unmentioned');
  eq(f[2].numbers, [3], 'and last in the order, since nobody chose its place');

  /* a mark with nothing behind it takes no number — there is nothing to feed */
  const ghost = Per.add(p, { kind: 'thing', name: 'Handset' });
  a.description += ' A hand reaches for ' + R.mark(ghost.id, 'Handset') + '.';
  f = R.feed(p, a);
  const h = f.filter(function (e) { return e.label === 'Handset'; })[0];
  eq(h.images.length, 0, 'a subject with no reference image feeds nothing');
  eq(h.numbers, [], 'so it takes no image number');
  eq(/no reference image/.test(h.why), true, 'and says why');

  /* deleting the subject degrades the mention to plain prose */
  Per.remove(p, ghost.id);
  eq(/reaches for Handset\.$/.test(R.plain(p, a.description)), true,
    'a deleted subject leaves its last known name behind as text');
  eq(R.parse(p, a.description).filter(function (m) { return m.dead; }).length, 1,
    'and the mark knows it is dead');
}

console.log('\n— a shot is a reference image too: that is riffing —');
{
  const R = SB.Refs, Per = SB.Personas;
  const p = SB.Model.newProject();
  const sc = p.scenes[0];
  const a = sc.shots[0];
  const b = SB.Model.addShot(p, sc.id, { type: 'Close-up' });
  const img = function (c) { return SB.Blobs.image(p, 'data:image/jpeg;base64,' + c.repeat(80), 4, 3); };

  const her = Per.add(p, { name: 'Colleague', description: 'Rust-orange jacket.' });
  Per.setImage(her, img('B'), 'front');
  a.image = img('Z');                               // 1A has been rendered
  b.description = 'Push into ' + R.mark(a.id, '1A') + ' — tight on ' +
    R.mark(her.id, 'Colleague') + ' as she smiles.';
  b.personaIds = [her.id];

  eq(R.plain(p, b.description), 'Push into 1A — tight on Colleague as she smiles.',
    'the prose reads as a director would say it');
  const f = R.feed(p, b);
  eq(f[0].kind, 'shot', 'the shot it riffs on is the first thing fed');
  eq(f[0].numbers, [1], 'as image 1 — the source');
  eq(f[1].numbers, [2], 'and her face after it, which the source may not show');

  /* the code is derived, so reordering never breaks a reference */
  const sc2 = SB.Model.addScene(p);
  SB.Model.moveScene(p, sc2.id, 0);
  eq(/Push into 2A/.test(R.plain(p, b.description)), true,
    'renumbering the board renumbers the reference with it');

  /* a source with no frame is the failure worth naming */
  a.image = null;
  eq(/has no frame yet/.test(R.feed(p, b)[0].why), true,
    'riffing on a shot nobody has rendered says so rather than feeding nothing');

  const blk = Per.block(p, b, null, 'image');
  eq(/THE SOURCE FRAME/.test(blk), false,
    'with no frame there is nothing to tell the model about');
  a.image = img('Z');
  const blk2 = Per.block(p, b, null, 'image');
  eq(/THE SOURCE FRAME/.test(blk2), true, 'with one, the source is declared');
  /* and declared as a constraint on the OUTPUT: told merely how to "treat" the
     image, the writer ignored it and rebuilt the room from scratch */
  eq(/The prompt you write is an EDIT of that frame/.test(blk2), true,
    'as an edit of that frame, not a fresh description of a scene');
  eq(/Do NOT re-describe the place, the light, the lens/.test(blk2), true,
    'with the setting explicitly inherited rather than rewritten');
  eq(blk2.indexOf('THE SOURCE FRAME') > blk2.indexOf('CURRENT and AUTHORITATIVE'), true,
    'and last, because it overrides what is above it');
  eq(/image 1 = 2A/.test(blk2), true, 'and the mapping agrees with the feed');
  eq(/image 2 = Colleague \(front\)/.test(blk2), true, 'right down to the labels');
}

console.log('\n— a name typed without a mark feeds nothing, and that is findable —');
{
  const R = SB.Refs, Per = SB.Personas;
  const p = SB.Model.newProject();
  const sh = p.scenes[0].shots[0];
  Per.add(p, { name: 'Ops' });
  const lead = Per.add(p, { name: 'Ops lead' });

  sh.description = 'Ops lead crosses to the rack while Ops watches.';
  const loose = R.unlinked(p, sh.description);
  eq(loose.length, 2, 'both names are found');
  eq(loose[0].name, 'Ops lead', 'the longest name wins — "Ops lead" is not two references');
  eq(loose[1].name, 'Ops', 'and the shorter one is still found on its own');

  sh.description = R.linkAll(p, sh.description);
  eq(R.parse(p, sh.description).length, 2, 'linking them writes both marks');
  eq(R.plain(p, sh.description), 'Ops lead crosses to the rack while Ops watches.',
    'and changes not one word of the prose');
  eq(R.unlinked(p, sh.description).length, 0, 'with nothing left unlinked');
  eq(R.linkAll(p, sh.description), sh.description, 'running it again does nothing');

  /* a name inside another word is not a reference */
  const p2 = SB.Model.newProject();
  Per.add(p2, { name: 'Lead' });
  eq(R.unlinked(p2, 'Leadership meets in the boardroom.').length, 0,
    'a name inside a longer word is left alone');
}

console.log('\n— no mark ever reaches a model —');
{
  const R = SB.Refs, Per = SB.Personas;
  const p = SB.Model.newProject();
  SB.app = SB.app || {};
  SB.app.project = p;
  const sc = p.scenes[0];
  const sh = sc.shots[0];
  const her = Per.add(p, { name: 'Colleague', description: 'Rust-orange jacket.' });
  const room = Per.add(p, { kind: 'place', name: 'The office', description: 'Night.' });
  sh.type = 'Medium';
  sh.description = R.mark(her.id, 'Colleague') + ' waits in ' + R.mark(room.id, 'The office') + '.';
  sh.personaIds = [her.id, room.id];
  const other = SB.Model.addShot(p, sc.id, {});
  other.description = 'Reverse of ' + R.mark(sh.id, '1A') + '.';

  /* jobsFor() is asserted clean in ui-scenario.js, against the built app —
     prompts.js is not loaded in this sandbox. Here: every other place a
     description is quoted for a machine. */
  const sys = SB.Brand.systemFor(p, other, 'image');
  eq(/@\{/.test(sys), false, 'the scene context quotes the other beats as prose');
  eq(/Reverse of 1A\./.test(sys), true, 'resolved to the code that shot has now');

  const blk = SB.Personas.block(p, sh, null, 'image');
  eq(/@\{/.test(blk), false, 'and the cast block carries no tokens either');

  /* the wardrobe detector reads prose too — a mark is not a garment */
  sh.description = R.mark(her.id, 'Colleague') +
    ' in a charcoal fleece and heavy boots, late thirties.';
  eq(!!SB.Coverage.carriesWardrobe(p, sh), true,
    'a description carrying a wardrobe is still caught through the marks');
}

console.log('\n— a derived frame is an edit of the frame it came from —');
{
  const R = SB.Refs, Per = SB.Personas, B = SB.Brand;
  const p = SB.Model.newProject();
  const sc = p.scenes[0];
  const a = sc.shots[0];
  const img = function (c) { return SB.Blobs.image(p, 'data:image/jpeg;base64,' + c.repeat(80), 4, 3); };
  a.image = img('Z');
  const b = SB.Model.addShot(p, sc.id, {});
  b.description = 'Reverse of ' + R.mark(a.id, '1A') + '.';

  const sys = B.systemFor(p, b, 'image');
  eq(/THIS FRAME IS DERIVED FROM A SUPPLIED FRAME/.test(sys), true,
    'the request says the still is an edit of the supplied frame');
  /* the house style is a list of things to put INTO the words — the grade, the
     grain, the lens — and the source frame already carries every one of them.
     Sent anyway, the writer restates them and the edit comes back a re-render. */
  eq(/HOUSE STYLE — every prompt/.test(sys), false,
    'and the house style is not sent again: the frame already carries it');
  eq(/THE HOUSE STYLE IS NOT REPEATED HERE/.test(sys), true, 'which is said, not silently done');
  eq(/must not be restated/.test(sys), true,
    'so the fold-in instruction is scoped to what actually changes');

  /* a combined job still writes the video half, which is derived from nothing */
  eq(/HOUSE STYLE — every prompt/.test(B.systemFor(p, b, 'both')), true,
    'a combined image+video job keeps the house style');
  eq(/THIS FRAME IS DERIVED/.test(B.systemFor(p, b, 'video')), false,
    'and a video-only job is not derived from a still at all');

  /* an ordinary shot is untouched by any of it */
  eq(/THIS FRAME IS DERIVED/.test(B.systemFor(p, a, 'image')), false,
    'a shot that riffs on nothing gets none of this');
  eq(/HOUSE STYLE — every prompt/.test(B.systemFor(p, a, 'image')), true,
    'and keeps its house style');
}

console.log('\n— what is fed is always what the prompt accounts for —');
{
  const R = SB.Refs, Per = SB.Personas;
  const p = SB.Model.newProject();
  const sc = p.scenes[0];
  const a = sc.shots[0];
  const img = function (c) { return SB.Blobs.image(p, 'data:image/jpeg;base64,' + c.repeat(80), 4, 3); };
  a.image = img('Z');
  const b = SB.Model.addShot(p, sc.id, {});
  b.description = 'Reverse of ' + R.mark(a.id, '1A') + '.';

  /* nobody is cast: the block used to bail, so four files went in against a
     prompt that mentioned none of them */
  eq(Per.forShot(p, b).length, 0, 'nothing is cast on this card');
  const blk = Per.block(p, b, null, 'image');
  eq(/image 1 = 1A/.test(blk), true, 'the mapping is written anyway, because an image is fed');
  eq(/THE SOURCE FRAME/.test(blk), true, 'and the source is declared');
  eq(/the person in image/.test(blk), false,
    'without the per-subject wording, which is about faces, not whole frames');

  /* a subject marked but never cast is numbered — so it has to be described */
  const her = Per.add(p, { name: 'Colleague', description: 'Rust-orange jacket.' });
  Per.setImage(her, img('B'), 'front');
  b.description += ' ' + R.mark(her.id, 'Colleague') + ' turns.';
  const blk2 = Per.block(p, b, null, 'image');
  eq(/image 2 = Colleague \(front\)/.test(blk2), true, 'she is in the mapping');
  eq(/Rust-orange jacket/.test(blk2), true,
    'and described above it, though she was never cast');
  eq(/the person in image/.test(blk2), true,
    'and now there is a subject, the per-model wording comes back');

  /* every numbered image has an entry, which is what the block claims */
  const nums = R.images(p, b).map(function (e) { return e.n; });
  eq(nums, [1, 2], 'the feed and the mapping are the same two images');
}

console.log('\n— a reference that feeds nothing still says so —');
{
  const R = SB.Refs;
  const p = SB.Model.newProject();
  const sc = p.scenes[0];
  const a = sc.shots[0];
  const b = SB.Model.addShot(p, sc.id, {});
  b.description = 'Reverse of ' + R.mark(a.id, '1A') + '.';
  SB.Model.deleteShot(p, a.id);

  const f = R.feed(p, b);
  eq(f.length, 1, 'a mark whose shot is gone is still in the feed');
  eq(f[0].kind, 'dead', 'as a dead entry');
  eq(f[0].images.length, 0, 'feeding nothing');
  eq(R.images(p, b).length, 0, 'so it is in no image set');
  eq(/is gone/.test(f[0].why), true, 'and saying why');

  /* swapping two cards can leave one pointing at itself */
  const c = SB.Model.addShot(p, sc.id, {});
  c.description = 'Reverse of ' + R.mark(c.id, '1B') + '.';
  eq(R.feed(p, c).length, 0,
    'a card referencing its own frame is not fed to itself');
}

console.log('\n— serials: a number never moves and is never reused —');
{
  const R = SB.Renders;
  const p = SB.Model.newProject();
  eq(p.renderSeq, 0, 'a new board has handed out no numbers');

  const a = R.claim(p), b = R.claim(p);
  eq([a, b], [1, 2], 'they come out in order');
  eq(R.pad(a), '0001', 'and read as four digits on disk');
  eq(R.pad(137), '0137', 'padded to the same width');
  eq(R.fileName(7, 'png'), '0007.png', 'which is the whole filename');

  /* the number is the thing that never has to be renamed, so it must never
     come back around: a file already dragged into an editor keeps meaning
     what it meant */
  p.renderSeq = 9;
  eq(R.claim(p), 10, 'the counter carries on from wherever it was');
  const before = p.renderSeq;
  SB.Model.migrate(p);
  eq(p.renderSeq >= before, true, 'and migration never winds it back');
}

console.log('\n— the counter survives a file written by an older build —');
{
  const p = SB.Model.newProject();
  const sc = p.scenes[0];
  /* a board saved with renders, whose counter was lost or never written */
  sc.shots[0].render = { serial: 12, ext: 'png', bytes: 4, at: 1 };
  const s2 = SB.Model.addShot(p, sc.id, {});
  s2.render = { serial: 40, ext: 'jpg', bytes: 4, at: 1 };
  const per = SB.Personas.add(p, { name: 'Ops lead' });
  per.images = [{ ref: 'x', w: 4, h: 3, label: '', render: { serial: 77, ext: 'png' } }];
  p.renderSeq = 0;

  SB.Model.migrate(p);
  eq(p.renderSeq, 77, 'the counter is raised past every serial already in the file');
  eq(SB.Renders.claim(p), 78, 'so nothing already on disk can be overwritten');
}

console.log('\n— a render rides with the picture, not with the card —');
{
  const p = SB.Model.newProject();
  const sc = p.scenes[0];
  const a = sc.shots[0];
  const b = SB.Model.addShot(p, sc.id, {});
  a.description = 'first';
  a.render = { serial: 3, ext: 'png', bytes: 9, at: 1 };
  b.description = 'second';

  /* swapping two cards moves the content between them — the render has to go
     with it, or 0003.png would be left describing the wrong shot and the file
     would have to be rewritten on disk */
  SB.Model.swapShotContent(p, a.id, b.id);
  eq(a.description, 'second', 'the descriptions swap');
  eq(!!b.render && b.render.serial === 3, true, 'and the render goes with its picture');
  eq(a.render, null, 'leaving the other card with none');
}

console.log('\n— a filename is only ever one of ours —');
{
  const R = SB.Renders;
  eq(R.extOf({ type: 'image/png' }), 'png', 'the type decides the extension');
  eq(R.extOf({ type: 'image/jpeg' }), 'jpg', 'jpeg is written jpg');
  eq(R.extOf({ type: '', name: 'shot.WEBP' }), 'webp', 'falling back to the name');
  eq(R.extOf({ type: 'text/plain', name: 'x' }), 'png', 'and to png when it is neither');
  eq(R.extOf(null), 'png', 'never undefined');

  eq(R.fileName(7, 'webp'), '0007.webp', 'a serial names the file it exports as');
  eq(R.videoExt({ type: 'video/quicktime' }), 'mov', 'a quicktime clip is named mov');
  eq(R.videoExt({ type: '' }), 'mp4', 'and anything unrecognised is still nameable');
}

console.log('\n— a serial is claimed once, by a still or a clip —');
{
  const p = SB.Model.newProject();
  const sh = p.scenes[0].shots[0];
  sh.render = { ref: 'r', serial: 4, ext: 'webp' };
  sh.video = { ref: 'v', serial: 9, ext: 'mp4' };
  delete p.renderSeq;
  SB.Model.migrate(p);
  eq(p.renderSeq, 9, 'the counter is rebuilt from clips as well as stills');

  const p2 = SB.Model.newProject();
  p2.scenes[0].shots[0].video = { ref: 'v', serial: 'seven', ext: 'mp4' };
  SB.Model.migrate(p2);
  eq(p2.scenes[0].shots[0].video, null, 'a clip serial that is not a number is not a serial');
}

console.log('\n— the pictures are in the file, so the file is the whole board —');
{
  const R = SB.Renders;
  const p = SB.Model.newProject();
  const sh = p.scenes[0].shots[0];
  const orig = 'data:image/webp;base64,' + 'Q'.repeat(4000);
  const clip = 'data:video/mp4;base64,' + 'V'.repeat(8000);

  sh.image = SB.Blobs.image(p, 'data:image/jpeg;base64,' + 'p'.repeat(400), 854, 480);
  sh.render = { ref: SB.Blobs.put(p, orig), serial: 1, ext: 'webp', w: 1184, h: 672, bytes: 3000 };
  sh.video = { ref: SB.Blobs.put(p, clip), serial: 2, ext: 'mp4', bytes: 6000 };

  eq(R.has(p, sh.render), true, 'the original is in this file');
  eq(R.dataUrl(p, sh.render), orig, 'and comes back out whole');
  eq(R.isLegacy(sh.render), false, 'it is not one of the folder-era records');
  eq(R.isLegacy({ serial: 9, ext: 'png' }), true, 'while a folder-era record says so');
  eq(R.has(p, { serial: 9, ext: 'png' }), false, 'and admits it holds nothing');

  /* the sweep that decides what gc() deletes runs on every structural change,
     so an original it does not know about is an original deleted the next time
     a card moves — silently, with the proxy left behind looking fine */
  SB.Blobs.gc(p);
  eq(R.has(p, sh.render), true, 'a structural change does not eat the original');
  eq(R.has(p, sh.video), true, 'nor the clip');

  const w = R.weigh(p);
  eq(w.originals.n, 1, 'and the board can say what it is carrying');
  eq(w.clips.n, 1, 'clips counted apart from stills, being the heavy ones');
  eq(w.clips.bytes > w.proxies.bytes, true, 'which is the whole reason to count them');
  eq(w.unused, 0, 'with nothing unaccounted for');

  const her = SB.Personas.add(p, { name: 'Mara' });
  SB.Personas.setImage(her,
    SB.Blobs.image(p, 'data:image/jpeg;base64,' + 'z'.repeat(200), 4, 3), '',
    { ref: SB.Blobs.put(p, 'data:image/webp;base64,' + 'R'.repeat(2000)), serial: 3, ext: 'webp' });
  SB.Blobs.gc(p);
  eq(R.weigh(p).originals.n, 2, 'a reference frame keeps its original the same way');
}

console.log('\n— a serial is a whole number or it is not a serial —');
{
  const p = SB.Model.newProject();
  const sc = p.scenes[0];
  const a = sc.shots[0];
  const b = SB.Model.addShot(p, sc.id, {});
  const c = SB.Model.addShot(p, sc.id, {});
  a.render = { serial: 'abc', ext: 'png' };      // padded to 0000 and collided
  b.render = { serial: 3.7, ext: 'png' };
  c.render = { serial: -2, ext: 'png' };
  const d = SB.Model.addShot(p, sc.id, {});
  d.render = { serial: '12', ext: 'png' };       // a number written as text is still a number

  SB.Model.migrate(p);
  eq(a.render, null, 'a serial that is not a number is not kept');
  eq(b.render, null, 'nor a fraction — it cannot name a file');
  eq(c.render, null, 'nor a negative one');
  eq(d.render.serial, 12, 'a numeric string is read as the number it is');
  eq(p.renderSeq, 12, 'and only real serials raise the counter');
}

console.log('\n— a picture that could not be filed does not spend a number —');
{
  const R = SB.Renders;
  const p = SB.Model.newProject();
  p.renderSeq = 4;
  const serial = R.claim(p);
  eq(serial, 5, 'the number is taken to write under');
  /* keep() hands it back when the write fails and it is still the last out —
     a counter that climbs on failures makes the folder read as if pictures are
     missing that were never there */
  eq(p.renderSeq, 5, 'while the write is in flight it is spent');
}

console.log('\n— an extension we can actually name a file with —');
{
  const R = SB.Renders;
  eq(R.extOf({ type: 'image/svg+xml' }), 'svg', 'an svg is written as one');
  eq(R.extOf({ type: 'image/x-icon' }), 'ico', 'and an icon too');
  eq(R.extOf({ type: 'image/webp' }), 'webp', 'webp is passed through');
  eq(R.extOf({ type: 'image/png' }), 'png', 'and png');
}

console.log('\n— a name is a name in any script —');
{
  const R = SB.Renders;
  eq(R.slug('Ops lead'), 'Ops-lead', 'spaces become dashes');
  eq(R.slug('Операторская'), 'Операторская', 'Cyrillic survives');
  eq(R.slug('技術者'), '技術者', 'and so does Japanese');
  eq(R.slug('!!!'), '', 'punctuation alone leaves nothing, and the caller falls back');
  eq(R.slug('../escape'), 'escape', 'a path traversal cannot survive it');
}

console.log('\n— a prompt goes stale when anything it feeds changes —');
{
  const Per = SB.Personas, R = SB.Refs;
  const p = SB.Model.newProject();
  const sc = p.scenes[0];
  const a = sc.shots[0];
  const b = SB.Model.addShot(p, sc.id, {});
  const img = function (c) { return SB.Blobs.image(p, 'data:image/jpeg;base64,' + c.repeat(80), 4, 3); };

  const her = Per.add(p, { name: 'Mara', description: 'Navy depot fleece.' });
  const booth = Per.add(p, { kind: 'place', name: 'The booth', description: 'Glass, one lamp.' });
  Per.setImage(her, img('A'));
  Per.setImage(booth, img('B'));
  a.image = img('Z');
  a.render = { serial: 1, ext: 'png', bytes: 9, at: 1000 };
  /* stamps in the past, so "written at 5000" means written after all of it */
  her.updatedAt = 1000;
  booth.updatedAt = 1000;

  /* b riffs off a, and marks a subject it never casts */
  b.description = 'Reverse of ' + R.mark(a.id, '1A') + ' — ' + R.mark(booth.id, 'The booth') + ' behind.';
  b.personaIds = [her.id];
  const written = 5000;

  eq(Per.staleFor(p, b, written), false, 'a prompt written after everything is not stale');

  /* the cast is the case that always worked */
  her.updatedAt = 6000;
  eq(Per.staleFor(p, b, written), true, 'editing somebody cast on the card makes it stale');
  her.updatedAt = 1000;
  eq(Per.staleFor(p, b, written), false, 'and back');

  /* ...and the two it used to miss */
  booth.updatedAt = 7000;
  eq(Per.staleFor(p, b, written), true,
    'editing a subject the card MARKS but never cast makes it stale too');
  booth.updatedAt = 1000;

  a.render = { serial: 1, ext: 'png', bytes: 9, at: 8000 };
  eq(Per.staleFor(p, b, written), true,
    'and re-rendering the frame this shot is derived from — the prompt describes a picture ' +
    'that no longer exists');
}

console.log('\n— a riff inherits the frame, not the cast —');
{
  const Per = SB.Personas, R = SB.Refs;
  const p = SB.Model.newProject();
  const sc = p.scenes[0];
  const a = sc.shots[0];
  const her = Per.add(p, { name: 'Mara', description: 'Fleece.' });
  a.personaIds = [her.id];
  Per.setEnters(a, her.id, true);

  /* what the riff button builds */
  const made = SB.Model.addShot(p, sc.id, { type: a.type, color: a.color });
  made.description = R.mark(a.id, '1A') + ' — ';

  eq((made.personaIds || []).length, 0,
    'the cast is not dragged across: the source frame already holds them');
  eq((made.castEnters || []).length, 0,
    'and never the arrival marks — a riff is the shot AFTER its source, so ' +
    'anyone arriving has arrived');
}

console.log('\n— the arrival nudge is about people —');
{
  const Per = SB.Personas;
  const p = SB.Model.newProject();
  const sh = p.scenes[0].shots[0];
  /* the commonest insert phrasing there is */
  eq(Per.readsAsArrival('The scanner on the desk. A hand comes into frame and picks it up.'),
    false, 'a hand coming into frame is not somebody arriving');
  eq(Per.readsAsArrival('Mara walks into frame behind him.'), true,
    'while somebody walking into frame still is');
  eq(Per.readsAsArrival('Dev steps into the bay.'), true, 'and stepping into a place');
}

console.log('\n— a dead reference can be taken out —');
{
  const R = SB.Refs, Per = SB.Personas;
  const p = SB.Model.newProject();
  const sh = p.scenes[0].shots[0];
  const thing = Per.add(p, { kind: 'thing', name: 'Scanner' });
  sh.description = 'She turns the ' + R.mark(thing.id, 'Scanner') + ' over.';
  Per.remove(p, thing.id);

  eq(R.parse(p, sh.description)[0].dead, true, 'the mark outlives what it pointed at');
  sh.description = R.unmark(p, sh.description, thing.id);
  eq(sh.description, 'She turns the Scanner over.',
    'and taking it out leaves the name it was showing, as ordinary prose');
  eq(R.parse(p, sh.description).length, 0, 'with no mark left behind');
}

console.log('\n— a name the writer wrote in prose is still found —');
{
  const R = SB.Refs, Per = SB.Personas;
  const p = SB.Model.newProject();
  const sh = p.scenes[0].shots[0];
  Per.add(p, { kind: 'thing', name: 'Industrial Scanner' });
  /* the shot generator writes prose, and prose does not capitalise mid-sentence */
  sh.description = 'She picks up the industrial scanner and turns it over.';
  const loose = R.unlinked(p, sh.description);
  eq(loose.length, 1, 'a lower-case mention of a subject is found');
  eq(R.parse(p, R.linkAll(p, sh.description)).length, 1, 'and can be linked');
}

console.log('\n— the house style does not put a grade on a reference frame —');
{
  const B = SB.Brand;
  eq(/EXEMPT FROM THE HOUSE STYLE/.test(B.REFERENCE_RIDER), true,
    'a reference frame is told it is exempt');
  eq(/no focal length, no f-number/.test(B.REFERENCE_RIDER), true,
    'in the specific terms the house style uses');
}

console.log('\n— a description is prose, not a prompt —');
{
  const C = SB.Coverage;
  eq(C.deprompt('Mara turns the scanner over. Capture RAW, muted professional grade.'),
    'Mara turns the scanner over.',
    'a finishing instruction is not part of what happens');
  eq(C.deprompt('Mara holds the scanner. The shallow depth of field keeps her face sharp.'),
    'Mara holds the scanner.',
    'nor is a sentence whose subject is the look');
  eq(C.deprompt('Dev checks his phone under the sodium light of the roller door.'),
    'Dev checks his phone under the sodium light of the roller door.',
    'while light that is part of the scene stays');
  eq(C.deprompt('The shallow depth of field keeps her face sharp.'),
    'The shallow depth of field keeps her face sharp.',
    'and the only sentence there is is never taken away');
}

console.log('\n— images are stored once, under a hash —');
{
  const B = SB.Blobs;
  const p = SB.Model.newProject();
  const jpg = 'data:image/jpeg;base64,' + 'A'.repeat(20000);
  const png = 'data:image/png;base64,' + 'B'.repeat(5000);

  const r1 = B.put(p, jpg);
  const r2 = B.put(p, jpg);
  eq(r1, r2, 'the same picture gets the same reference');
  eq(Object.keys(B.map(p)).length, 1, 'and is stored only once');
  eq(B.get(p, r1), jpg, 'the bytes come back');
  const r3 = B.put(p, png);
  eq(r3 === r1, false, 'different pictures get different references');

  // a collision must never silently swap one picture for another
  const fake = B.hash(jpg);
  B.map(p)[fake] = 'data:image/jpeg;base64,SOMETHINGELSE';
  const r4 = B.put(p, jpg);
  eq(r4 !== fake && B.get(p, r4) === jpg, true, 'a hash clash stores separately, never overwrites');

  eq(B.src(p, { ref: r4 }), jpg, 'src resolves a reference');
  eq(B.src(p, { data: jpg }), jpg, 'src still resolves an old inline image');
  eq(B.src(p, null), '', 'src copes with nothing');
}

console.log('\n— old boards migrate, and versions stop duplicating frames —');
{
  const B = SB.Blobs;
  const frame = 'data:image/jpeg;base64,' + 'A'.repeat(50000);
  const ink = 'data:image/png;base64,' + 'B'.repeat(9000);

  /* a v1-shaped file: images inline everywhere, including inside the version */
  const old = SB.Model.newProject();
  old.scenes[0].shots = [];
  const s1 = SB.Model.addShot(old, old.scenes[0].id, {});
  s1.image = { data: frame, w: 854, h: 480 };
  s1.annotation = ink;
  old.personas = [{ id: 'p1', name: 'Lead', image: { data: frame, w: 854, h: 480 } }];
  old.versions = [{
    n: 1, name: 'v1', createdAt: 1,
    snapshot: {
      master: SB.Doc.make(''), versionNumber: 1, versionName: 'v1',
      scenes: [{
        id: 'sc', heading: '', description: '',
        shots: [{ id: 'x', image: { data: frame, w: 854, h: 480 }, annotation: ink }]
      }]
    }
  }];
  const inlineTotal = JSON.stringify(old).length;

  const p = SB.Model.migrate(old);
  eq(!!(p.scenes[0].shots[0].image.ref), true, 'shot frames become references');
  eq(!!(p.scenes[0].shots[0].annotation.ref), true, 'ink becomes a reference');
  eq(!!SB.Personas.hero(p.personas[0]).ref, true, 'persona references migrate too');
  eq(p.personas[0].images, undefined,
    'and the list field is gone — one reference lives on `image`, as it did before the list');
  eq(p.personas[0].kind, 'person', 'a persona written before there were kinds is a person');
  eq(!!(p.versions[0].snapshot.scenes[0].shots[0].image.ref), true, 'so do frozen versions');
  eq(Object.keys(p.blobs).length, 2,
    'four copies of two pictures collapse to two stored blobs');
  eq(B.src(p, p.scenes[0].shots[0].image), frame, 'and the picture still resolves');
  eq(p.versions[0].snapshot.scenes[0].shots[0].image.ref, p.scenes[0].shots[0].image.ref,
    'the version points at the same blob as the live board');

  const after = JSON.stringify(p).length;
  eq(after < inlineTotal * 0.6, true,
    'the file shrinks (was ' + inlineTotal + ', now ' + after + ')');

  /* cutting a version now costs references, not copies */
  const before = JSON.stringify(p).length;
  p.versions.push({ n: 2, name: 'v2', createdAt: 2, snapshot: { scenes: SB.clone(p.scenes) } });
  const grew = JSON.stringify(p).length - before;
  eq(grew < 2000, true, 'a new version adds ' + grew + ' bytes, not another 50 KB');

  /* nothing collectable while a version still points at it */
  const kept = Object.keys(p.blobs).length;
  p.scenes[0].shots[0].image = null;
  B.gc(p);
  eq(Object.keys(p.blobs).length, kept, 'a frame a version still uses is not collected');

  /* but an unreferenced one goes */
  const junk = B.put(p, 'data:image/jpeg;base64,ZZZZ');
  eq(B.has(p, junk), true, 'stored');
  B.gc(p);
  eq(B.has(p, junk), false, 'an image nothing points at is collected');
}

console.log('\n— breaking one long scene into several —');
{
  /* what a Premiere import looks like: every cut in one scene */
  const p = SB.Model.newProject();
  const sc = p.scenes[0];
  sc.heading = 'Sequence';
  sc.shots = [];
  const ids = [];
  for (let i = 0; i < 6; i++) {
    const s = SB.Model.addShot(p, sc.id, { type: 'Wide' });
    s.description = 'cut ' + (i + 1);
    ids.push(s.id);
  }
  eq(p.scenes.length, 1, 'it arrives as one scene');

  const made = SB.Model.splitSceneAt(p, sc.id, 3);
  eq(!!made, true, 'a break between two cards makes a scene');
  eq(p.scenes.length, 2, 'there are now two');
  eq(p.scenes[0].shots.length, 3, 'the cards before the break stay put');
  eq(p.scenes[1].shots.length, 3, 'the ones after it move across');
  eq(p.scenes[1].shots[0].description, 'cut 4', 'starting with the card you broke at');
  eq(SB.Model.findShot(p, ids[3]).code, '2A', 'and it renumbers');
  eq(SB.Model.findShot(p, ids[2]).code, '1C', 'on both sides');

  eq(SB.Model.splitSceneAt(p, sc.id, 0), null, 'breaking before the first card does nothing');
  eq(SB.Model.splitSceneAt(p, sc.id, 3), null, 'nor does breaking past the last');
  eq(p.scenes.length, 2, 'so no empty scenes appear');

  /* the same again from a selection */
  const picked = [p.scenes[1].shots[1].id, p.scenes[1].shots[2].id];
  const s2 = SB.Model.sceneFromShots(p, picked);
  eq(!!s2, true, 'a group of cards can become a scene');
  eq(s2.shots.length, 2, 'holding just those cards');
  eq(SB.Model.findShot(p, picked[0]).code, '3A', 'renumbered where they landed');
  eq(p.scenes[1].shots.length, 1, 'and taken out of the scene they came from');

  /* selection order follows the board, not the order they were clicked */
  const p2 = SB.Model.newProject();
  p2.scenes[0].shots = [];
  const a = SB.Model.addShot(p2, p2.scenes[0].id, {});
  const b = SB.Model.addShot(p2, p2.scenes[0].id, {});
  const c = SB.Model.addShot(p2, p2.scenes[0].id, {});
  a.description = 'one'; b.description = 'two'; c.description = 'three';
  const s3 = SB.Model.sceneFromShots(p2, [c.id, a.id]);
  eq(s3.shots.map(s => s.description), ['one', 'three'],
    'cards keep board order however they were picked');
}

console.log('\n— moving several cards at once —');
{
  const p = SB.Model.newProject();
  const one = p.scenes[0];
  one.heading = 'One';
  one.shots = [];
  const two = SB.Model.addScene(p);
  two.heading = 'Two';
  const ids = [];
  for (let i = 0; i < 4; i++) {
    const s = SB.Model.addShot(p, one.id, {});
    s.description = 'shot ' + (i + 1);
    ids.push(s.id);
  }

  SB.Model.moveShots(p, [ids[0], ids[2]], two.id, 0);
  eq(two.shots.map(s => s.description), ['shot 1', 'shot 3'],
    'a group moves to another scene in board order');
  eq(one.shots.map(s => s.description), ['shot 2', 'shot 4'], 'and leaves the rest behind');

  SB.Model.moveShots(p, two.shots.map(s => s.id), one.id, 1);
  eq(one.shots.map(s => s.description), ['shot 2', 'shot 1', 'shot 3', 'shot 4'],
    'a group can be dropped into the middle of another scene');

  /* moving within a scene must not double-count the ones removed before the drop */
  SB.Model.moveShots(p, [one.shots[0].id, one.shots[1].id], one.id, 4);
  eq(one.shots.map(s => s.description), ['shot 3', 'shot 4', 'shot 2', 'shot 1'],
    'moving a group down inside its own scene lands where it was dropped');
}

console.log('\n— swapping two shots keeps the dialogue in place —');
{
  const p = projectWith('Wide of the office. Then a close-up of the laptop.');
  const sc = p.scenes[0];
  sc.shots = [];
  const a = SB.Model.addShot(p, sc.id, { type: 'Wide', link: { from: 0, to: 19 } });
  const b = SB.Model.addShot(p, sc.id, { type: 'Close-up', link: { from: 20, to: 50 } });
  a.description = 'Open-plan office.';
  b.description = 'Hands on a laptop.';
  a.color = '#3b82f6'; b.color = '#dc2626';
  a.image = SB.Blobs.image(p, 'data:image/jpeg;base64,AAAA', 4, 3);
  b.image = SB.Blobs.image(p, 'data:image/jpeg;base64,BBBB', 4, 3);
  a.personaIds = ['p1']; b.personaIds = [];
  a.comments = [{ id: 'c1', text: 'too dark', at: 1 }];
  SB.Fields.find(p, 'artDirection').enabled = true;
  SB.Fields.set(a, 'artDirection', 'Warm practicals.');
  a.noShot = false; b.noShot = true;

  const r = SB.Model.swapShotContent(p, a.id, b.id);
  eq(r, { a: '1A', b: '1B' }, 'the swap reports which two cards');

  eq(win(p, a), 'Wide of the office.', 'the first card keeps its dialogue');
  eq(win(p, b), 'Then a close-up of the laptop.', 'and so does the second');
  eq([a.link.from, a.link.to], [0, 19], 'the anchors themselves did not move');

  eq(a.description, 'Hands on a laptop.', 'descriptions traded places');
  eq(b.description, 'Open-plan office.', 'both ways');
  eq(a.type, 'Close-up', 'shot type follows the picture');
  eq(a.color, '#dc2626', 'so does the card colour');
  eq(SB.Blobs.src(p, a.image), 'data:image/jpeg;base64,BBBB', 'so does the frame');
  eq(b.personaIds, ['p1'], 'so does the cast');
  eq(b.comments.length, 1, 'so do the comments about that picture');
  eq(SB.Fields.value(b, 'artDirection'), 'Warm practicals.', 'so do the card fields');

  eq(a.noShot, false, '“no shot” stays with the script fragment, not the picture');
  eq(b.noShot, true, 'on both cards');

  eq(SB.Model.findShot(p, a.id).code, '1A', 'nothing reordered — the codes are unchanged');
  eq(SB.Model.findShot(p, b.id).code, '1B', 'for either card');

  SB.Model.swapShotContent(p, a.id, b.id);
  eq(a.description, 'Open-plan office.', 'swapping again puts everything back');
  eq(win(p, a), 'Wide of the office.', 'with the dialogue still where it was');

  eq(SB.Model.swapShotContent(p, a.id, a.id), null, 'a card cannot swap with itself');
  eq(SB.Model.swapShotContent(p, a.id, 'nope'), null, 'an unknown card is refused');

  /* across scenes, and with a freestanding card */
  const sc2 = SB.Model.addScene(p);
  const c = SB.Model.addShot(p, sc2.id, { type: 'Insert' });
  c.description = 'A hand on a door.';
  SB.Model.swapShotContent(p, a.id, c.id);
  eq(a.description, 'A hand on a door.', 'shots in different scenes can swap');
  eq(win(p, a), 'Wide of the office.', 'the linked card keeps its dialogue');
  eq(c.link, null, 'and the freestanding card stays freestanding');
  eq(win(p, c), '', 'with its own empty text');
}

console.log('\n— a model added to the app reaches existing boards —');
{
  const fresh = SB.Model.newProject();
  eq(fresh.settings.models.some(m => m.name === 'Flux 3' && m.kind === 'video'), true,
    'Flux 3 ships as a video model');

  /* a board made before Flux 3 existed */
  const old = SB.Model.newProject();
  old.settings.models = old.settings.models.filter(m => m.name !== 'Flux 3');
  delete old.settings.modelSeeds;
  const migrated = SB.Model.migrate(old);
  eq(migrated.settings.models.some(m => m.name === 'Flux 3'), true,
    'an existing board is offered it once');

  /* and a model deliberately removed stays removed */
  migrated.settings.models = migrated.settings.models.filter(m => m.name !== 'Flux 3');
  const again = SB.Model.migrate(migrated);
  eq(again.settings.models.some(m => m.name === 'Flux 3'), false,
    'deleting it afterwards sticks');
  eq(again.settings.models.some(m => m.name === 'Kling'), true,
    'the models it keeps are untouched');
}

console.log('\n— boards saved by older builds still open —');
{
  /* The exact shape the very first build wrote: images inline on the shot,
     annotation as a bare data URL, a single activeModelId, no personas, no
     brand, no card fields, no script comments, no blob store. */
  const frame = 'data:image/jpeg;base64,' + 'A'.repeat(2000);
  const ink = 'data:image/png;base64,' + 'B'.repeat(500);
  const v1 = {
    fileVersion: 1,
    id: 'prj_old', name: 'Last autumn’s board',
    createdAt: 1700000000000, updatedAt: 1700000000000,
    master: { text: 'Wide of the office. Then a close-up of the laptop.', marks: { b: [[0, 4]], i: [], u: [] } },
    scenes: [{
      id: 'sc_1', heading: 'Opening', description: 'Client office.',
      shots: [
        {
          id: 'sh_1', type: 'Wide', noShot: false, color: '#454c5c',
          link: { from: 0, to: 19 }, local: null, broken: false,
          description: 'Open-plan office.',
          image: { data: frame, w: 854, h: 480 },
          annotation: ink,
          comments: [{ id: 'cm_1', text: 'Needs more light', at: 1700000001000 }],
          prompts: { m_old: { imagePrompt: 'a room', videoPrompt: 'a push in', modelName: 'Wan' } }
        },
        {
          id: 'sh_2', type: 'Insert', noShot: true, color: '#5b8dff',
          link: null, local: { text: 'hand-written note', marks: { b: [], i: [], u: [] } },
          broken: false, description: '', image: null, annotation: null,
          comments: [], prompts: {}
        }
      ]
    }],
    versionNumber: 2, versionName: 'v2',
    versions: [{
      n: 1, name: 'v1', createdAt: 1700000002000,
      snapshot: {
        master: { text: 'Wide of the office. Then a close-up of the laptop.', marks: { b: [], i: [], u: [] } },
        versionNumber: 1, versionName: 'v1',
        scenes: [{
          id: 'sc_1', heading: 'Opening', description: '',
          shots: [{ id: 'sh_1', type: 'Wide', link: { from: 0, to: 19 }, broken: false,
            description: '', image: { data: frame, w: 854, h: 480 }, annotation: null,
            comments: [{ id: 'cm_0', text: 'from v1', at: 1700000002000 }], prompts: {} }]
        }]
      }
    }],
    settings: {
      shotTypes: ['Wide', 'Insert'],
      models: [{ id: 'm_old', name: 'Wan', kind: 'video', imageTemplate: 'IMG', videoTemplate: 'VID' }],
      activeModelId: 'm_old',
      geminiModel: 'gemini-2.5-flash',
      showImagePrompt: true, showVideoPrompt: true
    }
  };

  const raw = JSON.stringify(v1);
  let p = null, threw = '';
  try { p = SB.Model.migrate(JSON.parse(raw)); } catch (e) { threw = e.message; }
  eq(!!p, true, 'a first-build file opens without throwing' + (threw ? ' (' + threw + ')' : ''));

  eq(p.name, 'Last autumn’s board', 'the name survives');
  eq(p.scenes[0].shots.length, 2, 'the shots survive');
  eq(SB.Model.findShot(p, 'sh_1').code, '1A', 'numbering still works');
  eq(win(p, p.scenes[0].shots[0]), 'Wide of the office.', 'a linked shot still shows its slice');
  eq(win(p, p.scenes[0].shots[1]), 'hand-written note', 'a freestanding shot keeps its own text');
  eq(p.master.marks.b, [[0, 4]], 'bold marks survive');
  eq(p.scenes[0].shots[1].noShot, true, '“no shot” survives');
  eq(p.scenes[0].shots[0].comments[0].text, 'Needs more light', 'card comments survive');
  eq(p.scenes[0].shots[0].prompts.m_old.imagePrompt, 'a room', 'prompts survive, keyed by the same model');

  eq(SB.Blobs.src(p, p.scenes[0].shots[0].image), frame, 'the frame still resolves');
  eq(SB.Blobs.src(p, p.scenes[0].shots[0].annotation), ink, 'the ink overlay still resolves');
  eq(SB.Blobs.src(p, p.versions[0].snapshot.scenes[0].shots[0].image), frame,
    'and so does the frame frozen in v1');
  eq(Object.keys(p.blobs).length, 2, 'the duplicate frame collapsed to one blob');
  eq(p.versions[0].snapshot.scenes[0].shots[0].comments[0].text, 'from v1',
    'the old version keeps its comments');

  eq(p.settings.imageModelId && p.settings.videoModelId ? 'set' : 'missing', 'set',
    'the single active model became an image and a video model');
  eq(p.settings.models[0].referenceTemplate.length > 0, true,
    'the old model gained reference-image wording');
  eq(p.settings.models[0].imageTemplate, 'IMG', 'its own templates are untouched');
  eq(p.settings.geminiModel, 'gemini-2.5-flash', 'a writer model that still exists is left alone');
  eq(p.settings.shotTypes, ['Wide', 'Insert'], 'the shot-type list is untouched');
  eq(SB.Fields.all(p).length, 3, 'card fields are added, switched off');
  eq(SB.Fields.enabled(p).length, 0, 'so nothing changes on the cards');
  eq(p.personas, [], 'personas start empty');
  eq(p.scriptComments, [], 'script comments start empty');
  eq(SB.Brand.brandOf(p).enabled, true, 'the house style is available');

  eq(JSON.parse(raw).scenes[0].shots[0].image.data, frame, 'the file on disk was not mutated');

  /* re-saving and re-opening has to be stable */
  const saved = SB.Store.serialize(p);
  const again = SB.Model.migrate(JSON.parse(saved));
  eq(win(again, again.scenes[0].shots[0]), 'Wide of the office.', 'a re-saved board reopens intact');
  eq(SB.Blobs.src(again, again.scenes[0].shots[0].image), frame, 'with its images');
  eq(Object.keys(again.blobs).length, 2, 'and no blob duplication on the round trip');

  /* an interim file: personas and brand, but before fields and blobs */
  const v3 = JSON.parse(raw);
  v3.personas = [{ id: 'p1', name: 'Lead', description: 'Knit', image: { data: frame, w: 4, h: 3 } }];
  v3.scenes[0].shots[0].personaIds = ['p1'];
  v3.settings.brand = { enabled: true, text: 'OLD 9-frame grid text' };
  delete v3.settings.activeModelId;
  v3.settings.imageModelId = 'm_old';
  v3.settings.videoModelId = 'm_old';
  const p3 = SB.Model.migrate(v3);
  eq(SB.Blobs.src(p3, SB.Personas.hero(p3.personas[0])), frame, 'a persona reference image migrates');
  eq(p3.scenes[0].shots[0].personaIds, ['p1'], 'cast assignments survive');
  eq(SB.Brand.brandOf(p3).text === SB.Brand.DEFAULT, true,
    'an unedited old house style is replaced by the current one');
}

console.log('\n— comments anchored to the script —');
{
  const p = projectWith('Wide of the office. Then a close-up of the laptop.');
  const c = SB.Model.addScriptComment(p, 5, 18, 'Too static — give them something to do.');
  eq(!!c, true, 'a comment is made from a selection');
  eq(c.quote, 'of the office', 'it keeps what it was written about');
  eq(p.master.text.slice(c.from, c.to), 'of the office', 'and points at that text');

  // text inserted before it drags it along
  SB.Model.applyMasterEdit(p, 0, 0, 'SCENE ONE. ', null);
  eq(p.master.text.slice(c.from, c.to), 'of the office', 'an edit before it moves it');

  // typing right at either edge must not swallow into the comment
  SB.Model.applyMasterEdit(p, c.to, c.to, 'XX', null);
  eq(p.master.text.slice(c.from, c.to), 'of the office', 'typing at its end stays outside');
  SB.Model.applyMasterEdit(p, c.from, c.from, 'YY', null);
  eq(p.master.text.slice(c.from, c.to), 'of the office', 'typing at its start stays outside');

  // an edit inside it keeps the comment on the edited phrase
  const inside = c.from + 3;
  SB.Model.applyMasterEdit(p, inside, inside, 'very ', null);
  eq(p.master.text.slice(c.from, c.to), 'of very the office', 'an edit inside grows it');
  eq(c.broken, false, 'still healthy');

  // deleting the phrase orphans the note rather than losing it
  SB.Model.applyMasterEdit(p, c.from, c.to, '', null);
  eq(c.broken, true, 'deleting the text flags the comment');
  eq(SB.Model.scriptComments(p).length, 1, 'the comment itself is kept');
  eq(SB.Model.scriptComments(p)[0].quote, 'of the office', 'so you can still read what it meant');

  // two comments, ordered by position, and coverage for the underline
  const p2 = projectWith('ONE two THREE four');
  const a = SB.Model.addScriptComment(p2, 8, 13, 'louder');
  const b = SB.Model.addScriptComment(p2, 0, 3, 'earlier');
  eq(SB.Model.scriptComments(p2).map(x => x.text).join(','), 'earlier,louder',
    'listed in script order, not the order written');
  eq(Array.from(SB.Model.commentCoverage(p2)).join(''), '111000001111100000',
    'coverage marks exactly the commented characters');
  eq(a.id !== b.id, true, 'each has its own id');

  SB.Model.deleteScriptComment(p2, a.id);
  eq(SB.Model.scriptComments(p2).length, 1, 'a comment can be deleted');

  // a comment on a shot's captured text does not disturb the shot
  const p3 = projectWith('Wide of the office. Close on the laptop.');
  const shot = addLinked(p3, 0, 19);
  SB.Model.addScriptComment(p3, 5, 11, 'note');
  eq(win(p3, shot), 'Wide of the office.', 'the shot window is untouched by a comment');
}

console.log('\n— per-project card fields —');
{
  const F = SB.Fields;
  const p = SB.Model.newProject();
  const shot = p.scenes[0].shots[0];

  eq(F.all(p).map(f => f.id).join(','), 'artDirection,context,sfx', 'ships with the three asked for');
  eq(F.enabled(p).length, 0, 'all off until wanted — cards stay as they were');
  eq(F.placeholder(F.find(p, 'artDirection')), 'ART_DIRECTION', 'built-ins have stable placeholders');
  eq(F.placeholder(F.find(p, 'sfx')), 'SFX', 'including SFX');

  F.find(p, 'artDirection').enabled = true;
  F.set(shot, 'artDirection', 'Warm practicals, no overheads.');
  eq(F.enabled(p).length, 1, 'switching one on shows it');
  eq(F.value(shot, 'artDirection'), 'Warm practicals, no overheads.', 'the text lives on the shot');
  eq(/ART DIRECTION:\nWarm practicals/.test(F.promptBlock(p, shot)), true,
    'and reaches the prompt writer');
  eq(F.placeholders(p, shot).ART_DIRECTION, 'Warm practicals, no overheads.',
    'usable as a template placeholder');

  const custom = F.add(p, 'Client note');
  eq(F.placeholder(custom), 'CLIENT_NOTE', 'a custom field gets a placeholder from its label');
  F.set(shot, custom.id, 'They want the logo visible.');
  eq(F.promptBlock(p, shot).indexOf('CLIENT NOTE:') > 0, true, 'custom fields travel too');

  const p2 = SB.Model.migrate(SB.clone(p));
  eq(p2.settings.fields.length, 4, 'the set is part of the project and survives a round trip');
  eq(F.value(p2.scenes[0].shots[0], 'artDirection'), 'Warm practicals, no overheads.',
    'so do the values');

  F.remove(p, custom.id);
  eq(F.all(p).length, 3, 'a custom field can be removed');
  eq(F.value(shot, custom.id), '', 'and its text goes with it');

  // an old file that predates fields entirely
  const older = SB.Model.newProject();
  delete older.settings.fields;
  SB.Fields.migrate(older);
  eq(older.settings.fields.length, 3, 'older projects gain the built-ins');
}

console.log('\n— the API key never reaches the file —');
{
  const p = SB.Model.newProject();
  p.settings.geminiApiKey = 'AIzaSECRET';   // even if something stashed it there
  const written = JSON.parse(SB.Store.serialize(p));
  eq(written.settings.geminiApiKey, undefined, 'serialize() strips the key from the project file');
  eq(written.master.text, '', 'serialize() keeps the master script');
}

console.log('\n— scene coverage: shot types land on the project list —');
{
  const p = SB.Model.newProject();
  const C = SB.Coverage;
  eq(C.matchType(p, 'Close-up'), 'Close-up', 'an exact type comes back as itself');
  eq(C.matchType(p, 'ECU on the hands'), 'Extreme close-up', 'ECU reads as extreme close-up');
  eq(C.matchType(p, 'OTS'), 'Over the shoulder', 'OTS reads as over the shoulder');
  eq(C.matchType(p, 'establishing wide'), 'Wide', 'an establishing shot is the wide one');
  eq(C.matchType(p, 'macro detail of the label'), 'Extreme close-up', 'macro detail goes tight');
  eq(C.matchType(p, 'something nobody offers'), p.settings.shotTypes[0],
    'an unknown type falls back to the first on the list, never an unselectable value');
}

console.log('\n— descriptions that still carry a wardrobe are found and repaired —');
{
  const C = SB.Coverage;

  eq(C.wardrobeTerms('The courier sets the parcel down and waits.').length, 0,
    'plain action is not mistaken for a character sheet');
  eq(C.wardrobeTerms('A gloved hand pulls the strap tight.').length, 0,
    'one garment is the thing being photographed, not an introduction');
  eq(C.wardrobeTerms('Hands find the label. A courier in a rust-orange jacket and grey boots.').length > 0,
    true, 'two garments together read as an introduction');
  eq(C.wardrobeTerms('The lead, wearing the same coat, steps back.').length > 0, true,
    '"wearing" gives it away on its own');
  eq(C.wardrobeTerms('Late twenties, wiry, at the rack.').length > 0, true,
    'so does an age range');

  /* only a card with cast can be carrying it redundantly */
  const p = SB.Model.newProject();
  const per = SB.Personas.add(p, {
    name: 'Courier',
    description: 'Late twenties, wiry, in a rust-orange weatherproof jacket and scuffed grey boots.'
  });
  const sh = p.scenes[0].shots[0];
  sh.description = 'Hands turn a crumpled label into the light. ' +
    'Late twenties, wiry, in a rust-orange weatherproof jacket and scuffed grey boots.';
  eq(C.carriesWardrobe(p, sh), null, 'with nobody cast, the text is the only record and is left alone');
  sh.personaIds = [per.id];
  eq(!!C.carriesWardrobe(p, sh), true, 'attaching the persona makes the same text redundant');
  eq(C.shotsCarryingWardrobe(p).length, 1, 'and the board-wide sweep finds it');

  /* the stapled tail is an exact copy, so it comes off for free */
  eq(C.stripCast(sh.description, [per]), 'Hands turn a crumpled label into the light.',
    'a tail that is a copy of the persona is lifted straight off');
  eq(C.stripCast('Hands turn a crumpled label into the light.', [per]),
    'Hands turn a crumpled label into the light.',
    'a description that never carried one is untouched');
  eq(C.stripCast('Late twenties, wiry, in a rust-orange jacket.', [per]),
    'Late twenties, wiry, in a rust-orange jacket.',
    'the only sentence is never stripped — that would leave an empty card');
  eq(C.stripCast('The courier waits. Rain runs off the loading door.', [per]),
    'The courier waits. Rain runs off the loading door.',
    'a real closing sentence survives — it is not the persona in disguise');
}

console.log('\n— cleaning: free where it can be, a request only where it must —');
{
  const C = SB.Coverage;
  const p = SB.Model.newProject();
  const per = SB.Personas.add(p, {
    name: 'Courier',
    description: 'Late twenties, wiry, in a rust-orange weatherproof jacket and scuffed grey boots.'
  });
  const sc = p.scenes[0];
  const a = sc.shots[0];
  a.personaIds = [per.id];
  a.description = 'Hands turn a crumpled label into the light. ' +
    'Late twenties, wiry, in a rust-orange weatherproof jacket and scuffed grey boots.';

  let asked = 0;
  SB.Prompts = { raw: () => { asked++; return Promise.resolve({ description: 'unused' }); } };
  SB.Store.getApiKey = () => 'test-key';

  const r1 = await C.cleanWardrobe(p, [a]);
  eq(asked, 0, 'an exact copy costs no request at all');
  eq(r1.stripped, 1, 'it is reported as stripped');
  eq(a.description, 'Hands turn a crumpled label into the light.', 'and the card is repaired');
  eq(C.carriesWardrobe(p, a), null, 'the card no longer reads as carrying a wardrobe');

  /* the persona has since been re-dressed, so the baked copy no longer matches
     anything and only a rewrite can find it */
  const b = SB.Model.addShot(p, sc.id, {});
  b.personaIds = [per.id];
  b.description = 'The lead leans in, wearing a navy fleece over grey trousers, as the screen blinks.';
  asked = 0;
  SB.Prompts = {
    raw: (text) => {
      asked++;
      eq(/no longer describes what anybody LOOKS LIKE/.test(text), true,
        'the rewrite is asked for in so many words');
      eq(/Courier/.test(text), true, 'and the cast on the card is named for it');
      return Promise.resolve({ description: 'Courier leans in as the screen blinks.' });
    }
  };
  const r2 = await C.cleanWardrobe(p, [b]);
  eq(asked, 1, 'a copy that no longer matches costs exactly one request');
  eq(r2.stripped, 0, 'nothing could be stripped for free');
  eq(SB.Refs.plain(p, b.description), 'Courier leans in as the screen blinks.',
    'the rewrite lands on the card');
  /* and it does NOT invent a mark: the writer had left that name as prose, and
     a rewrite is not permission to start feeding a picture nobody asked for */
  eq(SB.Refs.parse(p, b.description).length, 0,
    'a name the writer left as prose stays prose through a rewrite');

  /* a card with nobody on it is never touched, whatever it says */
  const c = SB.Model.addShot(p, sc.id, {});
  c.description = 'A courier in a rust-orange jacket and grey boots waits at the door.';
  asked = 0;
  const r3 = await C.cleanWardrobe(p, [c]);
  eq(r3.cleaned, 0, 'an uncast card is skipped');
  eq(asked, 0, 'and costs nothing');
  eq(/rust-orange/.test(c.description), true, 'its text is left exactly as it was');
}

console.log('\n— the cast block is the live record, and a stale prompt says so —');
{
  const p = SB.Model.newProject();
  const per = SB.Personas.add(p, { name: 'Ops lead', description: 'In a navy zip fleece.' });
  const sh = p.scenes[0].shots[0];
  sh.personaIds = [per.id];

  const b = SB.Personas.block(p, sh, null);
  eq(/navy zip fleece/.test(b), true, 'the block carries the persona description as it reads now');
  eq(/CURRENT and AUTHORITATIVE/.test(b), true,
    'and declares itself authoritative over anything the shot description says about wardrobe');
  eq(/governs what they are DOING/.test(b), true, 'while leaving the action to the description');

  /* editing the persona shows up immediately — nothing snapshots it */
  per.description = 'In a rust-orange weatherproof jacket.';
  eq(/rust-orange/.test(SB.Personas.block(p, sh, null)), true,
    'an edited persona reaches the very next prompt with no regeneration');

  /* but a prompt already stored is a snapshot, and is reported as behind */
  const written = 1000;
  SB.Personas.touch(per);
  eq(SB.Personas.staleFor(p, sh, written), true,
    'a prompt written before the edit is stale');
  eq(SB.Personas.staleFor(p, sh, Date.now() + 5000), false,
    'one written after it is not');
  eq(SB.Personas.staleFor(p, sh, 0), false,
    'a card with no stored prompt is never flagged');

  const virgin = SB.Model.newProject();
  const old = SB.Personas.add(virgin, { name: 'Legacy' });
  old.updatedAt = 0;                       // a board written before the stamp existed
  const vs = virgin.scenes[0].shots[0];
  vs.personaIds = [old.id];
  eq(SB.Personas.staleFor(virgin, vs, written), false,
    'an unstamped persona is unknowable, not stale — no false flags on old boards');
}

console.log('\n— scene coverage: descriptions are prose, not prompts —');
{
  const C = SB.Coverage;
  const plain = 'The ops lead kneels beside the rack and works a fitting loose while the light drops.';
  eq(C.deprompt(plain), plain, 'a plain-English description is left exactly as it is');
  eq(C.deprompt('Hands close around a strap and pull, cinematic lighting, 8k, highly detailed'),
    'Hands close around a strap and pull.',
    'a trailing run of prompt tags is trimmed off');
  eq(C.deprompt('A courier waits in the doorway, breath fogging in the cold'),
    'A courier waits in the doorway, breath fogging in the cold.',
    'a real clause after a comma survives — this trims tags, it does not rewrite sentences');
  eq(C.deprompt('The aisle, seen end to end, empty'), 'The aisle, seen end to end.',
    'a bare two-word modifier at the very end goes');
  eq(C.deprompt(''), '', 'nothing in, nothing out');
}

console.log('\n— scene coverage: generate lands shots on the scene —');
{
  const C = SB.Coverage;
  const canned = {
    cast: [{
      name: 'Courier',
      description: 'Late twenties, wiry, cropped dark hair, in a rust-orange weatherproof jacket and scuffed grey boots.',
      imagePrompt: 'Front-facing reference frame of a courier, plain background, natural light.'
    }],
    shots: [
      { beat: 'arrives at the door', type: 'WS establishing', cast: ['Courier'], description: 'The courier steps up to the loading door.' },
      { beat: 'hands find the label', type: 'ECU', description: 'Fingers turn a crumpled label into the light.' },
      { beat: 'the scan lands', type: 'CU', cast: ['Courier'], description: 'The courier leans in as the scanner blinks green.' }
    ]
  };
  let asked = null;
  SB.Prompts = { raw: (text, schema, system) => { asked = { text, schema, system }; return Promise.resolve(canned); } };
  SB.Store.getApiKey = () => 'test-key';

  const p = SB.Model.newProject();
  const sc = p.scenes[0];
  sc.heading = 'The drop';
  sc.description = 'A courier delivers a package to a warehouse door and gets it signed for.';
  eq(sc.shots.length, 1, 'a new scene starts with one empty card');

  const r = await C.generate(p, sc.id, {});
  eq(sc.shots.length, 3, 'three beats on the scene, not four — the empty starter card was reused');
  eq(sc.shots[0].id, r.ids[0], 'the starter card is the first generated shot');
  eq(sc.shots.map(s => s.type), ['Wide', 'Extreme close-up', 'Close-up'],
    'every returned type landed on the project list');
  eq(sc.shots.every(s => !/rust-orange/.test(s.description)), true,
    'no wardrobe is stapled into the descriptions — they stay plain English');
  eq(p.personas.length, 1, 'the person the scene needed was minted as a persona');
  eq(r.created.map(x => x.name), ['Courier'], 'and handed back so the UI can say so');
  eq(p.personas[0].imagePrompt.length > 0, true, 'with a reference-frame prompt ready to go');
  eq(sc.shots.every(s => (s.personaIds || [])[0] === p.personas[0].id), true,
    'every card carries the persona — including the insert that named nobody');
  eq(/NOT IMAGE PROMPTS/.test(asked.text), true, 'the request forbids prompt-style descriptions');
  eq(r.beats, ['arrives at the door', 'hands find the label', 'the scan lands'],
    'the beats come back for the status line');
  eq(/consecutive beats of ONE continuous moment/.test(asked.text), true,
    'the request asks for consecutive beats');
  eq(asked.text.indexOf(sc.description) > 0, true, 'and it sends the scene description');
  eq(/Extreme close-up/.test(asked.text), true, "and this project's own shot-type list");

  C.undo(p, r.ids, r.personaIds);
  eq(sc.shots.length, 0, 'undo removes exactly what generate created');
  eq(p.personas.length, 0, 'and takes the persona it invented back out with them');
}

console.log('\n— scene coverage: a second run appends, and count is honoured —');
{
  const C = SB.Coverage;
  const two = {
    cast: [{ name: 'Technician', description: 'Thirties, in a navy zip fleece and dark work trousers.' }],
    shots: [
      { beat: 'reaches in', type: 'Insert', cast: ['Technician'], description: 'A cuff brushes the rack rail.' },
      { beat: 'it seats home', type: 'Close-up', description: 'The drive clicks into the bay.' },
      { beat: 'spare beat', type: 'Wide', description: 'The aisle, seen end to end.' }
    ]
  };
  SB.Prompts = { raw: () => Promise.resolve(two) };
  SB.Store.getApiKey = () => 'test-key';

  const p = SB.Model.newProject();
  const sc = p.scenes[0];
  sc.description = 'A technician swaps a failed drive in a server aisle.';
  sc.shots[0].description = 'hand-written card the user already made';

  const r = await C.generate(p, sc.id, { count: 2 });
  eq(r.ids.length, 2, 'a count of 2 returns two shots');
  eq(sc.shots.length, 3, 'they were appended after the authored card, not into it');
  eq(sc.shots[0].description, 'hand-written card the user already made', 'the authored card is untouched');

  /* second run, same board: the name already on the roster is reused, not cloned */
  const before = p.personas.length;
  const sc2 = SB.Model.addScene(p, {});
  sc2.description = 'The technician checks the aisle temperature.';
  const r2 = await C.generate(p, sc2.id, { count: 2 });
  eq(p.personas.length, before, 'a returned name that already exists is reused, not duplicated');
  eq(r2.created.length, 0, 'so nothing is reported as newly cast');
}

console.log('\n— scene coverage: it refuses to guess —');
{
  const C = SB.Coverage;
  SB.Prompts = { raw: () => Promise.resolve({ cast: [], shots: [] }) };
  SB.Store.getApiKey = () => 'test-key';
  const p = SB.Model.newProject();
  const sc = p.scenes[0];

  let msg = '';
  await C.generate(p, sc.id, {}).catch(e => { msg = e.message; });
  eq(/description first/.test(msg), true, 'an empty scene description is refused with a reason');

  sc.description = 'Something happens.';
  msg = '';
  await C.generate(p, sc.id, {}).catch(e => { msg = e.message; });
  eq(/No shots came back/.test(msg), true, 'an empty answer is an error, not a silent no-op');
  eq(sc.shots.length, 1, 'and nothing was added');

  msg = '';
  await C.rewrite(p, sc.id, '').catch(e => { msg = e.message; });
  eq(/came back empty/.test(msg), true, 'an empty rewrite is refused too');

  SB.Store.getApiKey = () => '';
  msg = '';
  await C.generate(p, sc.id, {}).catch(e => { msg = e.message; });
  eq(/API key/.test(msg), true, 'no key is said plainly before any request is made');
}

console.log('\n— scene coverage: rewrite keeps the draft in play —');
{
  const C = SB.Coverage;
  SB.Prompts = {
    raw: (text) => Promise.resolve({
      description: /DRAFT:\ncrappy first pass/.test(text)
        ? 'A courier sets a scuffed parcel on the counter and waits, breath fogging in the cold doorway.'
        : ''
    })
  };
  SB.Store.getApiKey = () => 'test-key';
  const p = SB.Model.newProject();
  const sc = p.scenes[0];
  sc.description = 'crappy first pass';
  const next = await C.rewrite(p, sc.id, '');
  eq(/scuffed parcel/.test(next), true, 'the rewrite comes back');
  eq(sc.description, 'crappy first pass',
    'and rewrite does not write it itself — the caller applies it, so revert stays possible');
}

console.log('\n— Windows line endings never reach a doc —');
{
  /* The DOM cannot hold a \r: the HTML parser folds it into \n on the way in.
   * A doc that keeps one measures longer than the editor can see, and every
   * offset read off a selection comes back short by one per line above it. */
  const p = projectWith('');
  SB.Model.applyMasterEdit(p, 0, 0, 'One.\r\nTwo.\r\nThree.', null);
  eq(p.master.text, 'One.\nTwo.\nThree.', 'a pasted CRLF block is folded to LF');

  const sh = addLinked(p, 10, 15);
  eq(win(p, sh), 'Three', 'so an offset taken off the screen picks the text it points at');

  const local = SB.Model.addShot(p, p.scenes[0].id, { text: 'A.\r\nB.' });
  eq(local.local.text, 'A.\nB.', 'a freestanding card is folded too');
  SB.Model.applyShotEdit(p, local, 5, 5, '\r\nC.');
  eq(local.local.text, 'A.\nB.\nC.', 'and stays folded as it is typed in');

  /* A lone \r is a line break to the parser, not a deletion. */
  const q = projectWith('');
  SB.Model.applyMasterEdit(q, 0, 0, 'Mac.\rClassic.', null);
  eq(q.master.text, 'Mac.\nClassic.', 'a lone CR becomes a line break, keeping its place');
}

console.log('\n— a board saved with the CRs still in it is repaired on open —');
{
  /* Anchors in such a file are already counted against the longer text, so
   * folding has to drag them along or the repair moves everyone's cards. */
  const p = projectWith('');
  p.master.text = 'One.\r\nTwo.\r\nThree.';   // as an older build wrote it out
  const a = addLinked(p, 0, 4);        // "One."
  const b = addLinked(p, 12, 18);      // "Three."
  SB.Model.addScriptComment(p, 6, 10, 'about the second line');
  SB.Doc.addMark(p.master, 'b', 12, 18);
  p.versions.push({ n: 1, name: 'v1', createdAt: 0, snapshot: SB.clone({
    master: p.master, scenes: p.scenes, scriptComments: p.scriptComments
  }) });

  SB.Model.migrate(p);

  eq(p.master.text, 'One.\nTwo.\nThree.', 'the master loses its CRs');
  eq(win(p, a), 'One.', 'a link at the top is untouched');
  eq(win(p, b), 'Three.', 'a link below the folded lines still frames its own text');
  eq(p.master.text.slice(p.scriptComments[0].from, p.scriptComments[0].to), 'Two.',
    'a script comment still quotes the phrase it was left on');
  eq(p.master.marks.b, [[10, 16]], 'and a bold run moves with the text it marks');

  const snap = p.versions[0].snapshot;
  eq(snap.master.text, 'One.\nTwo.\nThree.', 'a frozen version is repaired as well');
  eq(snap.master.text.slice(snap.scenes[0].shots[1].link.from, snap.scenes[0].shots[1].link.to),
    'Three.', 'so restoring it does not bring the drift back');
}

console.log('\n— a scene claims a stretch of script of its own —');
{
  const p = projectWith('ONE two THREE four');
  const sc = p.scenes[0];
  eq(swin(p, sc), null, 'a scene starts claiming nothing at all');
  eq(SB.Model.sceneTied(sc), false, 'and knows it');

  tie(p, 0, 7);
  eq(swin(p, sc), 'ONE two', 'a tie frames the text it points at');
  eq(Array.from(SB.Model.sceneCoverage(p)).slice(0, 9).join(''), '111111100',
    'and those characters read as claimed');
  eq(Math.round(SB.Model.sceneCoverageShare(p) * 100), 39, 'the share is answerable');

  const other = SB.Model.addScene(p);
  eq(swin(p, other), null, 'a scene added beside it claims nothing');
}

console.log('\n— a scene range and a shot range are independent —');
{
  const p = projectWith('ONE two THREE four');
  const sc = p.scenes[0];
  tie(p, 0, 13);                       // "ONE two THREE"
  const sh = addLinked(p, 8, 13);      // "THREE", inside it
  SB.Model.applyMasterEdit(p, 4, 4, 'and ', null);
  eq(swin(p, sc), 'ONE and two THREE', 'an edit inside the claim moves its far edge');
  eq(win(p, sh), 'THREE', 'and carries the shot along without changing it');

  SB.Model.applyMasterEdit(p, 17, 17, '!', null);
  eq(swin(p, sc), 'ONE and two THREE!', 'text typed at the claim’s tail joins the section');
  eq(win(p, sh), 'THREE!', 'the shot ending there grows too — neither contains the other');
}

console.log('\n— typing in a scene’s own box writes through to the master —');
{
  const p = projectWith('ONE two THREE four');
  const sc = p.scenes[0];
  tie(p, 0, 7);
  SB.Model.applySceneEdit(p, sc, 7, 7, '!!');
  eq(p.master.text, 'ONE two!! THREE four', 'the master took the edit');
  eq(swin(p, sc), 'ONE two!!', 'and the claim grew at the edge that was typed at');

  SB.Model.applySceneEdit(p, sc, 0, 0, '» ');
  eq(swin(p, sc), '» ONE two!!', 'typing at its own leading edge grows it too');
}

console.log('\n— deleting the claimed text breaks the tie —');
{
  const p = projectWith('ONE two THREE four');
  const sc = p.scenes[0];
  tie(p, 0, 7);
  SB.Model.applyMasterEdit(p, 0, 7, '', null);
  eq(sc.broken, true, 'the scene is flagged rather than silently emptied');
  eq(Array.from(SB.Model.sceneCoverage(p)).some(Boolean), false,
    'and a broken claim covers nothing');
}

console.log('\n— break link on a scene —');
{
  const p = projectWith('ONE two THREE four');
  const sc = p.scenes[0];
  tie(p, 0, 7);
  SB.Model.breakSceneLink(p, sc);
  eq(sc.link, null, 'the link is gone');
  eq(swin(p, sc), 'ONE two', 'the text stays as the scene’s own');
  SB.Model.applyMasterEdit(p, 0, 3, 'ZERO', null);
  eq(swin(p, sc), 'ONE two', 'and stops following the master');
  eq(Array.from(SB.Model.sceneCoverage(p)).some(Boolean), false,
    'freestanding text claims none of the master, which is what makes the layer honest');

  const at = p.master.text.indexOf('THREE');   // the master moved under us above
  tie(p, at, at + 5);
  eq(sc.local, null, 'tying it again drops the freestanding copy');
  eq(swin(p, sc), 'THREE', 'and frames the new selection');
}

console.log('\n— widen versus replace —');
{
  const p = projectWith('ONE two THREE four');
  tie(p, 0, 3);
  tie(p, 8, 13, true);
  eq([p.scenes[0].link.from, p.scenes[0].link.to], [0, 13],
    'widen keeps what was claimed and stretches over the gap');
  tie(p, 14, 18);
  eq([p.scenes[0].link.from, p.scenes[0].link.to], [14, 18], 'replace swaps it out');

  SB.Model.untieScene(p, p.scenes[0].id);
  eq(swin(p, p.scenes[0]), null, 'untie gives the section back');
  eq(p.scenes[0].shots.length === 0 && p.scenes[0].heading !== undefined, true,
    'and leaves the scene itself alone');
}

console.log('\n— the two coverage layers are counted apart —');
{
  const p = projectWith('ONE two THREE four');
  addLinked(p, 0, 3);
  tie(p, 8, 13);
  const shots = SB.Model.coverage(p), scenes = SB.Model.sceneCoverage(p);
  eq([shots[0], scenes[0]], [1, 0], 'a shot-only stretch counts as shot, not scene');
  eq([shots[8], scenes[8]], [0, 1], 'and a scene-only stretch the other way round');
}

console.log('\n— migrate leaves an older board untied —');
{
  const p = SB.Model.migrate({ master: { text: 'ONE two' }, scenes: [{ heading: 'x' }] });
  eq(p.scenes[0].link, null, 'no claim is invented');
  eq(p.scenes[0].local, null, 'and no empty doc either — untied is a real state');

  const q = SB.Model.migrate({
    master: { text: 'ONE two' },
    scenes: [{ heading: 'x', link: { from: 2, to: 900 } }]
  });
  eq([q.scenes[0].link.from, q.scenes[0].link.to], [2, 7], 'an out-of-range claim is clamped');
}

console.log('\n— a scene claim survives the carriage-return repair —');
{
  const p = projectWith('');
  p.master.text = 'One.\r\nTwo.\r\nThree.';        // as an older build wrote it out
  tie(p, 12, 18);                                  // "Three."
  p.versions.push({ n: 1, name: 'v1', createdAt: 0, snapshot: SB.clone({
    master: p.master, scenes: p.scenes, scriptComments: p.scriptComments
  }) });
  SB.Model.migrate(p);
  eq(swin(p, p.scenes[0]), 'Three.', 'the claim still frames its own words');
  const snap = p.versions[0].snapshot;
  eq(snap.master.text.slice(snap.scenes[0].link.from, snap.scenes[0].link.to), 'Three.',
    'and so does the one frozen in a version');
}

console.log('\n— the AI reads a claimed section —');
{
  const p = projectWith('ONE two THREE four');
  const sc = p.scenes[0];
  eq(SB.Coverage.sceneScript(p, sc), '', 'an untied, shotless scene has no script');
  addLinked(p, 14, 18);
  eq(SB.Coverage.sceneScript(p, sc), 'four', 'with shots it is stitched from their windows');
  tie(p, 0, 7);
  eq(SB.Coverage.sceneScript(p, sc), 'ONE two',
    'but the scene’s own claim is what it covers, and wins');
}

console.log('\n— gathering shots does not delete a scene that claims something —');
{
  const p = projectWith('ONE two THREE four');
  const sc = p.scenes[0];
  const a = SB.Model.addShot(p, sc.id, {});
  tie(p, 0, 7);
  SB.Model.sceneFromShots(p, [a.id]);
  eq(p.scenes.filter(function (s) { return s.id === sc.id; }).length, 1,
    'the emptied source scene stays, because its claim outlives its cards');
}

console.log('\n— the writer runs where the project says it does —');
{
  const p = SB.Model.newProject();
  SB.app = { project: p };
  eq(p.settings.aiProvider, 'gemini', 'a new project writes with Gemini');
  eq(SB.Providers.activeId(), 'gemini', 'and that is what the registry reports');

  /* a board written before the local option existed, and one pointing at
     something that no longer exists, both open as Gemini rather than broken */
  const old = SB.Model.newProject();
  delete old.settings.aiProvider;
  SB.Model.migrate(old);
  eq(old.settings.aiProvider, 'gemini', 'an older board opens as a Gemini board');
  old.settings.aiProvider = 'nonsense';
  SB.Model.migrate(old);
  eq(old.settings.aiProvider, 'gemini', 'an unknown provider falls back rather than failing');

  /* switching is lossless: each side keeps its own model */
  p.settings.geminiModel = 'gemini-3.5-flash';
  SB.Store.setOoba({ url: 'http://127.0.0.1:5000', model: 'mistral-7b' });
  SB.Providers.setActive('ooba');
  eq(SB.Providers.active().model(), 'mistral-7b', 'the local side has its own model');
  SB.Providers.setActive('gemini');
  eq(SB.Providers.active().model(), 'gemini-3.5-flash', 'and the cloud side kept its own');
  eq(SB.Providers.usageKey('ooba', 'mistral-7b'), 'ooba:mistral-7b',
    'the two are counted separately');
}

console.log('\n— each backend gets the body it understands —');
{
  const p = SB.Model.newProject();
  SB.app = { project: p };
  const HINT = ' [hint]';
  const schema = { type: 'OBJECT', properties: { a: { type: 'STRING' } }, required: ['a'] };

  const g = SB.Providers.get('gemini');
  const gb = g.body('gemini-3.7-flash', 'WRITE THIS', { schema, system: 'BE BRIEF', hint: HINT });
  eq(gb.contents[0].parts[0].text, 'WRITE THIS', 'Gemini takes the prompt as a user turn');
  eq(gb.systemInstruction.parts[0].text, 'BE BRIEF', 'with the system prompt beside it');
  eq(gb.generationConfig.responseSchema, schema, 'and a response schema');

  /* Gemma has no JSON mode and no system turn — both fold into the one turn */
  const gm = g.body('gemma-4-31b-it', 'WRITE THIS', { schema, system: 'BE BRIEF', hint: HINT });
  eq(gm.systemInstruction, undefined, 'Gemma is sent no systemInstruction');
  eq(gm.generationConfig.responseSchema, undefined, 'and no schema');
  eq(gm.contents[0].parts[0].text, 'BE BRIEF\n\n----\n\nWRITE THIS [hint]',
    'the system prompt and the JSON wording ride in the user turn');

  const o = SB.Providers.get('ooba');
  SB.Store.setOoba({ url: 'http://127.0.0.1:5000', model: 'mistral-7b' });
  const ob = o.body('mistral-7b', 'WRITE THIS', { schema, system: 'BE BRIEF', hint: HINT });
  eq(ob.messages[0], { role: 'system', content: 'BE BRIEF' }, 'the local server takes a system message');
  eq(ob.messages[1], { role: 'user', content: 'WRITE THIS [hint]' },
    'and the JSON wording, because it has no schema mode');
  eq(ob.model, 'mistral-7b', 'the model name goes along when there is one');
  eq(o.body('', 'X', { hint: '' }).model, undefined,
    'and is left out when the server should just use what is loaded');
  eq(o.supportsSchema, false, 'so the schema path is never taken for it');
}

console.log('\n— replies come back out of two different shapes —');
{
  const g = SB.Providers.get('gemini'), o = SB.Providers.get('ooba');
  eq(g.text({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] }), '{"a":1}',
    'Gemini answers under candidates/content/parts');
  eq(o.text({ choices: [{ message: { content: '{"a":1}' } }] }), '{"a":1}',
    'the local server answers under choices/message/content');
  eq(o.text({ choices: [{ text: '{"a":1}' }] }), '{"a":1}',
    'and older completion-shaped servers still parse');

  let threw = '';
  try { o.text({ choices: [{ finish_reason: 'length' }] }); } catch (e) { threw = e.message; }
  eq(/no text/.test(threw) && /length/.test(threw), true,
    'an empty reply says so, and says why it stopped');

  /* Qwen3 and friends answer in `content` and think in `reasoning`. Empty
     content beside a full reasoning block is a token ceiling, not a dead server. */
  let thought = '';
  try {
    o.text({ choices: [{ finish_reason: 'length', message: { content: '', reasoning: 'okay, the' } }] });
  } catch (e) { thought = e.message; }
  eq(/whole reply thinking/.test(thought), true,
    'a reply that was all thinking says exactly that');
  eq(/num_ctx/.test(thought), true, 'and names the knob that fixes it');

  eq(o.text({ choices: [{ message: { content: '{"a":1}', reasoning: 'pondering' } }] }), '{\"a\":1}',
    'a thinking model that did reach an answer is read normally, reasoning ignored');
}

console.log('\n— the address is taken as typed, however it is typed —');
{
  const B = SB.Providers.baseUrl;
  eq(B('http://127.0.0.1:5000'), 'http://127.0.0.1:5000', 'a plain host:port is left alone');
  eq(B('http://127.0.0.1:5000/'), 'http://127.0.0.1:5000', 'a trailing slash is dropped');
  eq(B('http://127.0.0.1:5000/v1'), 'http://127.0.0.1:5000', 'a pasted /v1 is dropped');
  eq(B('http://127.0.0.1:5000/v1/chat/completions'), 'http://127.0.0.1:5000',
    'and so is the full endpoint someone copied out of the docs');
  eq(B('  http://box:8080/v1/  '), 'http://box:8080', 'whitespace too');
  eq(B(''), 'http://127.0.0.1:5000', 'blank means the default');
  /* Without a scheme fetch() treats it as a path relative to the page and the
     page's own server answers — a 404 that looks like the model server's. */
  eq(B('127.0.0.1:11434'), 'http://127.0.0.1:11434', 'a bare host:port gets a scheme');
  eq(B('localhost:11434/v1'), 'http://localhost:11434', 'and still loses the pasted /v1');
  eq(B('https://box:8443'), 'https://box:8443', 'https is left as it was typed');
  /* Anything after /v1 is the endpoint, not the base. Pasting the models URL —
     the obvious thing to try when the model-list button is what is failing —
     used to build /v1/models/v1/models and 404. */
  eq(B('http://127.0.0.1:11434/v1/models'), 'http://127.0.0.1:11434',
    'a pasted /v1/models is dropped, not doubled');
  eq(B('http://127.0.0.1:11434/v1/completions'), 'http://127.0.0.1:11434',
    'and so is any other /v1 endpoint');
  eq(B('https://host/openai/v1'), 'https://host/openai',
    'a real prefix in front of /v1 survives — only the tail is taken');
  eq(B('https://host/api'), 'https://host/api',
    'a proxy prefix that is not /v1 is left alone; it may be the real base');
}

console.log('\n— a 404 about the model is not a 404 about the address —');
{
  const o = SB.Providers.get('ooba');

  /* Ollama answers 404 on the right endpoint when it does not know the model. */
  const missing = o.error(404, "model 'qwen3' not found", 'qwen3');
  eq(/no model called "qwen3"/.test(missing.message), true,
    'a model-not-found 404 is reported as a model problem');
  eq(/check the port/i.test(missing.message), false,
    'and never sends anyone to restart a server that was answering fine');
  eq(/qwen3:8b/.test(missing.message), true, 'it points out that Ollama names carry a tag');

  const wrongPort = o.error(404, '<html>Not Found</html>', 'qwen3:8b');
  eq(/that address answered, but not on/.test(wrongPort.message), true,
    'a genuine endpoint 404 still says so');

  const noModel = o.error(400, 'model is required', '');
  eq(/has to be told which model/.test(noModel.message), true,
    'a server that requires a model name says which setting fixes it');

  const other = o.error(500, 'boom', 'x');
  eq(/Local model 500/.test(other.message), true, 'anything else is passed through as it was');

  /* "Get model names from server" calls /v1/models. Blaming the completions
     endpoint for its 404 sends people to check a port that was never asked. */
  const listing = o.error(404, '<html>Not Found</html>', null, '/v1/models');
  eq(/not on \/v1\/models/.test(listing.message), true,
    'a 404 from the model listing names the endpoint that was actually called');
  eq(/chat\/completions/.test(listing.message), false,
    'and never mentions one the app did not touch');

  /* a listing call names no model, so it can never be a model-not-found */
  const listingOdd = o.error(404, "model 'x' not found", null, '/v1/models');
  eq(/not on \/v1\/models/.test(listingOdd.message), true,
    'even a model-shaped body on the listing call is read as an endpoint problem');
}

console.log('\n— an https page cannot reach a plain http LAN address —');
{
  const M = SB.Providers.mixedContent;
  eq(M('http://192.168.4.175:11434'), null, 'with no page at all there is nothing to say');

  sandbox.location = { protocol: 'https:', host: 'oldgodsslumber.github.io' };
  const lan = M('http://192.168.4.175:11434');
  eq(typeof lan === 'string', true, 'an https page reaching a LAN address over http is refused');
  eq(/nothing you change on the server can fix it/i.test(lan), true,
    'and it says so, rather than sending anyone to the server');
  eq(/toolbar . Copy/.test(lan) || /Copy\)/.test(lan), true, 'it names the way out');

  /* browsers treat loopback as trustworthy, so the hosted copy CAN reach it */
  eq(M('http://127.0.0.1:11434'), null, '127.0.0.1 is exempt and stays allowed');
  eq(M('http://localhost:11434'), null, 'so is localhost');
  eq(M('https://box.example:11434'), null, 'an https server is fine wherever it lives');

  sandbox.location = { protocol: 'http:', host: 'localhost:8000' };
  eq(M('http://192.168.4.175:11434'), null,
    'served over plain http, the same LAN address is allowed — that is the fix');

  /* the unreachable-server message must not claim what the browser blocked */
  sandbox.location = { protocol: 'https:', host: 'oldgodsslumber.github.io' };
  const err = SB.Providers.localError(new TypeError('Failed to fetch'), 'http://192.168.4.175:11434');
  eq(/https page/.test(err.message), true,
    'a refused scheme is reported as that, not as a server that is down');
  eq(err.localApi, true, 'and still never pops the corporate-proxy dialog');

  delete sandbox.location;
}

console.log('\n— a dead local server is not the corporate proxy —');
{
  /* util.js reads any bare fetch rejection as "blocked by the proxy" and pops
     the AI Studio dialog. For a local server that is the wrong fix entirely. */
  const bare = new TypeError('Failed to fetch');
  eq(SB.netKind(bare), 'blocked', 'an unexplained failure to Google is still read as blocked');
  eq(SB.netKind(SB.Providers.localError(bare)), null,
    'but the same failure to a local server is not');
  eq(/--api/.test(SB.Providers.localError(bare).message), true,
    'and it names the flag that is usually missing');
}

console.log('\n— end to end against a stubbed local server —');
{
  /* The real ask() path, with only the socket replaced: this is what a small
     model actually sends back when there is no schema mode to hold it to the
     format — prose, a fence, and braces inside the string. */
  const seen = {};
  sandbox.fetch = (url, init) => {
    seen.url = url;
    seen.init = init;
    seen.body = JSON.parse(init.body);
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({
        choices: [{ message: { content:
          'Sure! Here is the prompt you asked for:\n\n```json\n' +
          '{"imagePrompt": "a wide shot, {no braces} inside"}\n```\nHope that helps!' } }]
      }))
    });
  };
  vm.runInContext(readFileSync(join(root, 'js/prompts.js'), 'utf8'), sandbox,
    { filename: 'js/prompts.js' });

  const p = SB.Model.newProject();
  SB.app = { project: p, changed() { } };
  p.settings.aiProvider = 'ooba';
  SB.Store.setOoba({ url: 'http://127.0.0.1:5000/v1/', model: 'mistral-7b', key: 'sekrit' });

  await SB.Prompts.raw('WRITE THIS',
    { type: 'OBJECT', properties: { imagePrompt: { type: 'STRING' } }, required: ['imagePrompt'] },
    'BE BRIEF'
  ).then(out => {
    eq(seen.url, 'http://127.0.0.1:5000/v1/chat/completions',
      'the pasted /v1/ was normalised and the endpoint appended');
    eq(seen.init.headers.Authorization, 'Bearer sekrit', 'the key rides as a bearer token');
    eq(seen.body.model, 'mistral-7b', 'the model name is sent');
    eq(seen.body.messages[0].role, 'system', 'the system prompt goes in its own message');
    eq(/JSON object and nothing else/.test(seen.body.messages[1].content), true,
      'and the user turn carries the ask-in-words JSON wording');
    eq(seen.body.generationConfig, undefined, 'no Gemini-shaped fields leak into it');
    eq(out.imagePrompt, 'a wide shot, {no braces} inside',
      'and the JSON is recovered from the prose and the fence around it');
  }).catch(e => {
    fail++;
    console.log('  FAIL end-to-end local call\n       ' + (e && e.message));
  });

  /* the same stub, answering the way a server with nothing loaded does */
  sandbox.fetch = () => Promise.resolve({
    ok: false, status: 500,
    text: () => Promise.resolve(JSON.stringify({ error: { message: 'no model is loaded' } }))
  });
  await SB.Prompts.raw('X', null).then(() => {
    fail++; console.log('  FAIL a 500 should not resolve');
  }).catch(e => {
    eq(/no model is loaded/.test(e.message), true, 'a server with no model says exactly that');
  });

  delete sandbox.fetch;
}

console.log('\n— an edit is counted, so "saved" can mean what it says —');
{
  /* A write finishing while a newer edit waits on the debounce used to clear
     the dirty flag and announce "saved": beforeunload then stopped warning,
     and closing the tab there lost the edits. The counter is what lets the
     write know it is behind. */
  const S = SB.Store.S;
  S.edits = 0;
  S.dirty = false;
  SB.Store.touch();
  eq(S.edits, 1, 'an edit is counted');
  eq(S.dirty, true, 'and marks the board dirty');
  SB.Store.touch();
  eq(S.edits, 2, 'every edit counts, not just the first');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
