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

for (const f of ['js/util.js', 'js/doc.js', 'js/geminimodels.js', 'js/model.js']) {
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
