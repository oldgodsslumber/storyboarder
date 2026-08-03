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
  Uint8Array
};
sandbox.window = sandbox;
vm.createContext(sandbox);

for (const f of ['js/util.js', 'js/doc.js', 'js/geminimodels.js', 'js/brand.js',
  'js/personas.js', 'js/model.js']) {
  vm.runInContext(readFileSync(join(root, f), 'utf8'), sandbox, { filename: f });
}
const SB = sandbox.SB;

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + '\n       got ' + a + '\n       want ' + b); }
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

console.log('\n— the API key never reaches the file —');
{
  vm.runInContext(readFileSync(join(root, 'js/store.js'), 'utf8'), sandbox, { filename: 'js/store.js' });
  const p = SB.Model.newProject();
  p.settings.geminiApiKey = 'AIzaSECRET';   // even if something stashed it there
  const written = JSON.parse(SB.Store.serialize(p));
  eq(written.settings.geminiApiKey, undefined, 'serialize() strips the key from the project file');
  eq(written.master.text, '', 'serialize() keeps the master script');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
