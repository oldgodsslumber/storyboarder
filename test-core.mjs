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
  Uint8Array, TextEncoder
};
sandbox.window = sandbox;
vm.createContext(sandbox);

for (const f of ['js/util.js', 'js/doc.js', 'js/blobs.js', 'js/geminimodels.js', 'js/brand.js',
  'js/personas.js', 'js/fields.js', 'js/model.js', 'js/store.js', 'js/usage.js']) {
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
  eq(G.DEFAULT, 'gemini-3.6-flash', 'default is a current model');
  eq(G.LIST.some(m => /image|tts|embedding|live|veo/.test(m.id)), false,
    'no non-text models in the picker');
  eq(G.normalize('gemini-2.0-flash'), G.DEFAULT, 'retired id falls back to the default');
  eq(G.normalize('gemini-flash-latest'), G.DEFAULT, 'retired alias falls back too');
  eq(G.normalize('gemini-2.5-pro'), 'gemini-2.5-pro', 'a live id is left alone');
  eq(G.normalize('some-custom-id'), 'some-custom-id', 'a custom id is left alone');
  eq(G.LIST.some(m => m.id === 'gemma-4-31b-it'), true, 'Gemma 4 31B is offered');
  eq(G.isGemma('gemma-4-31b-it'), true, 'gemma is recognised (it has no JSON mode)');
  eq(G.isGemma('gemini-3.6-flash'), false, 'gemini is not treated as gemma');
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
  eq(/No gender references/i.test(sys), true, 'the no-gender rule is in there');
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

  p.settings.brand.enabled = false;
  eq(B.systemFor(p, b, 'image'), '', 'turning the house style off sends nothing');
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

console.log('\n— gendered language detector —');
{
  const g = SB.Brand.genderedTerms;
  eq(g('The subject leans in, they adjust the lens.'), [], 'neutral copy passes');
  eq(g('He adjusts his cuff while she waits.'), ['he', 'his', 'she'], 'pronouns are caught');
  eq(g('A businessman greets the ladies.'), ['businessman', 'ladies'], 'gendered nouns are caught');
  eq(g('Human hands, a manager mid-thought, therapist listening.'), [],
    'human / manager / therapist are not false positives');
  eq(g('MAN in frame'), ['man'], 'case-insensitive');
  eq(g(''), [], 'empty text is fine');
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
  eq(!!(p.personas[0].image.ref), true, 'persona references migrate too');
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
  eq(SB.Blobs.src(p3, p3.personas[0].image), frame, 'a persona reference image migrates');
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

console.log('\n— data usage tracker —');
{
  const U = SB.Usage;
  eq(U.fmt(512), '512 B', 'bytes');
  eq(U.fmt(2048), '2.0 KB', 'kilobytes');
  eq(U.fmt(5 * 1024 * 1024), '5.00 MB', 'megabytes');
  eq(U.bytes('abc'), 3, 'ascii byte count');
  eq(U.bytes('é'), 2, 'utf-8 is counted in bytes, not characters');
  eq(U.FS_DOC_LIMIT, 1048576, 'the Firestore document ceiling is 1 MiB');

  const p = SB.Model.newProject();
  const sc = p.scenes[0];
  sc.shots = [];
  const a = SB.Model.addShot(p, sc.id, {});
  a.description = 'x'.repeat(500);
  const img = 'data:image/jpeg;base64,' + 'A'.repeat(40000);
  a.image = SB.Blobs.image(p, img, 854, 480);
  a.annotation = { ref: SB.Blobs.put(p, 'data:image/png;base64,' + 'B'.repeat(8000)) };
  SB.Personas.add(p, {
    name: 'Lead',
    image: SB.Blobs.image(p, 'data:image/jpeg;base64,' + 'C'.repeat(40000), 854, 480)
  });

  const m = U.measure(p);
  eq(m.total > 88000, true, 'total measures the real serialised board');
  const sum = m.sections.reduce((n, s) => n + s.b, 0);
  eq(sum, m.total, 'the breakdown adds up to the whole file exactly');
  eq(m.counts.images, 3, 'frames, ink and references are all counted');
  eq(m.sections.map(s => s.key).join(','), 'frames,refs,ink,text',
    'sections keep their fixed order, empty ones dropped');
  eq(m.heaviest[0].b >= m.heaviest[1].b, true, 'heaviest items are sorted');
  eq(m.imageBytes > m.textBytes, true, 'images dominate a board with frames');

  const fb = U.firebase(m, { perDay: 500 });
  eq(fb.checks[0].ok, true, '90 KB fits in one Firestore document');
  eq(fb.checks[3].ok, true, '500 writes/day is inside the free 20,000');

  // a board that has outgrown a document (~40 KB a frame, each one different)
  for (let i = 0; i < 30; i++) {
    const s = SB.Model.addShot(p, sc.id, {});
    s.image = SB.Blobs.image(p, 'data:image/jpeg;base64,' + 'D'.repeat(40000) + i, 854, 480);
  }
  const big = U.measure(p);
  eq(big.total > U.FS_DOC_LIMIT, true, 'a 31-frame board passes 1 MiB');
  const fb2 = U.firebase(big, { perDay: 30000 });
  eq(fb2.checks[0].ok, false, 'and is reported as not fitting a document');
  eq(fb2.checks[1].ok, true, 'while the text-only board still would');
  eq(fb2.checks[3].ok, false, '30,000 writes/day is over the free ceiling');
  eq(/cannot be one document/.test(fb2.checks[0].detail), true, 'and it says so plainly');
}

console.log('\n— the API key never reaches the file —');
{
  const p = SB.Model.newProject();
  p.settings.geminiApiKey = 'AIzaSECRET';   // even if something stashed it there
  const written = JSON.parse(SB.Store.serialize(p));
  eq(written.settings.geminiApiKey, undefined, 'serialize() strips the key from the project file');
  eq(written.master.text, '', 'serialize() keeps the master script');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
