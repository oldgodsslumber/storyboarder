/* test-write.mjs — the .storyboard writer against a fake UXP file entry that
 * misbehaves the way the real one does: writing nothing, stopping part way,
 * or refusing binary. What a Premiere export produced before this existed was
 * a file that opened as "Unexpected end of JSON input".
 *
 *   node test-write.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const W = require('./lib/writejson.js');
const Board = require('./lib/board.js');

let pass = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); return; }
  failed++;
  console.log('  FAIL ' + name + (extra ? '  :: ' + extra : ''));
}

const formats = { binary: 'binary', utf8: 'utf8' };

/* A UXP-ish file. `limit` caps how many bytes a single write actually keeps;
 * `rejectBinary` makes binary writes no-ops, as a fussy host would. */
function fakeEntry(opts) {
  opts = opts || {};
  const self = {
    data: new Uint8Array(0),
    writes: 0,
    async write(payload, o) {
      self.writes++;
      o = o || {};
      let bytes;
      if (typeof payload === 'string') {
        bytes = W.utf8(payload);
        if (opts.rejectText) return;
      } else {
        bytes = payload;
        if (opts.rejectBinary) return;             // resolves, writes nothing
      }
      if (opts.limit != null && bytes.length > opts.limit) {
        bytes = bytes.slice(0, opts.limit);        // stops part way, no error
      }
      if (o.append && self.data.length) {
        const merged = new Uint8Array(self.data.length + bytes.length);
        merged.set(self.data, 0);
        merged.set(bytes, self.data.length);
        self.data = merged;
      } else {
        self.data = bytes;
      }
    },
    async read() { return self.data; }
  };
  return self;
}

/* a realistic export: 30 cards, a frame on each */
function sampleProject(n) {
  const frame = 'data:image/jpeg;base64,' + 'A'.repeat(30000);
  const shots = [];
  const words = [];
  for (let i = 0; i < n; i++) {
    shots.push({ start: i * 2, end: i * 2 + 2, name: 'clip', image: frame + i });
    words.push({ text: 'word' + i, start: i * 2 + 0.2, end: i * 2 + 0.8 });
  }
  return Board.build(shots, words, { sequenceName: 'Seq', fps: 30, sceneHeading: 'One' });
}

const project = sampleProject(30);
const size = W.utf8(JSON.stringify(project)).length;
console.log('  (sample export is ' + Math.round(size / 1024) + ' KB)');

/* ---------- the happy path ---------- */
{
  const f = fakeEntry();
  const r = await W.writeJson(f, project, formats);
  ok('a healthy write goes in one attempt', r.attempts === 1, 'attempts=' + r.attempts);
  ok('and the file parses', (() => {
    try { return !!JSON.parse(W.decode(f.data)).scenes; } catch (e) { return false; }
  })());
  ok('every byte is there', r.bytes === size, r.bytes + ' vs ' + size);
}

/* ---------- the reported bug: a write that keeps nothing ---------- */
{
  const f = fakeEntry({ rejectBinary: true, rejectText: false });
  const r = await W.writeJson(f, project, formats);
  ok('a write that silently keeps nothing is caught and recovered',
    r.bytes === size, JSON.stringify(r));
  ok('the recovered file parses', (() => {
    try { return !!JSON.parse(W.decode(f.data)).scenes; } catch (e) { return false; }
  })());
}

/* ---------- a write that stops part way ---------- */
{
  const f = fakeEntry({ limit: Math.floor(size / 3) });   // a write keeps only a third
  const r = await W.writeJson(f, project, formats);
  ok('a truncated write is detected and rewritten in chunks',
    r.bytes === size && r.attempts >= 2, JSON.stringify(r));
  ok('the chunked file parses whole', (() => {
    try {
      const p = JSON.parse(W.decode(f.data));
      return p.scenes[0].shots.length === 30;
    } catch (e) { return false; }
  })());
}

/* ---------- nothing works: fail loudly, do not claim success ---------- */
{
  const f = fakeEntry({ rejectBinary: true, rejectText: true });
  let msg = '';
  try { await W.writeJson(f, project, formats); }
  catch (e) { msg = e.message; }
  ok('a file that cannot be written raises an error', !!msg, 'it returned quietly');
  ok('and the error says what to try', /local drive|fewer frames/.test(msg), msg);
}

/* ---------- verify() on its own ---------- */
{
  const f = fakeEntry();
  await f.write(W.utf8('{"scenes":[]}'), { format: 'binary' });
  const good = await W.verify(f, formats, 13);
  ok('verify accepts a whole storyboard', good.ok === true, JSON.stringify(good));

  const g = fakeEntry();
  await g.write(W.utf8('{"scenes":[{"sh'), { format: 'binary' });
  const bad = await W.verify(g, formats, 999);
  ok('verify rejects a half-written file', bad.ok === false && /incomplete/.test(bad.why), bad.why);

  const h = fakeEntry();
  const empty = await W.verify(h, formats, 999);
  ok('verify rejects an empty file', empty.ok === false && /empty/.test(empty.why), empty.why);

  const j = fakeEntry();
  await j.write(W.utf8('{"hello":1}'), { format: 'binary' });
  const wrong = await W.verify(j, formats, 11);
  ok('verify rejects valid JSON that is not a storyboard',
    wrong.ok === false && /not a storyboard/.test(wrong.why), wrong.why);
}

/* ---------- non-ASCII survives the round trip ---------- */
{
  const f = fakeEntry();
  const p = sampleProject(1);
  p.name = 'Séquence — “final” ✓';
  p.scenes[0].description = 'Imported from “Séq” — one card per cut.';
  await W.writeJson(f, p, formats);
  const back = JSON.parse(W.decode(f.data));
  ok('accented and smart-quoted text comes back intact',
    back.name === p.name && back.scenes[0].description === p.scenes[0].description,
    back.name);
}

console.log('\n' + pass + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
