/* test-plugin.mjs — exercises everything that does not need Premiere:
 * transcript parsing, word→cut assignment, and the .storyboard it builds.
 *
 *   node test-plugin.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const T = require('./lib/transcript.js');
const Board = require('./lib/board.js');
const B64 = require('./lib/b64.js');
const Cuts = require('./lib/cuts.js');
const Host = require('./lib/host.js');
const Blobs = require('./lib/blobs.js');

let pass = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; return; }
  failed++;
  console.log('FAIL: ' + name + (extra ? '\n      ' + extra : ''));
}
function eq(name, got, want) {
  ok(name, got === want, 'got ' + JSON.stringify(got) + '\n      want ' + JSON.stringify(want));
}
function near(name, got, want, tol) {
  ok(name, Math.abs(got - want) <= (tol || 0.001), 'got ' + got + ' want ' + want);
}

/* ---------- clock parsing ---------- */

near('srt comma clock', T.parseClockString('00:00:02,500'), 2.5);
near('vtt dot clock', T.parseClockString('00:01:02.250'), 62.25);
near('short clock', T.parseClockString('01:02.100'), 62.1);
eq('bad clock is null', T.parseClockString('nope'), null);

/* ---------- SRT ---------- */

const SRT = [
  '1',
  '00:00:00,000 --> 00:00:04,000',
  'one two three four',
  '',
  '2',
  '00:00:04,000 --> 00:00:08,000',
  'five six seven eight',
  ''
].join('\n');

const srtWords = T.parse(SRT, 'a.srt');
eq('srt word count', srtWords.length, 8);
eq('srt first word', srtWords[0].text, 'one');
near('srt even spacing', srtWords[1].start, 1.0);
near('srt last word end', srtWords[7].end, 8.0);

/* trailing cue with no blank line after it still lands */
const SRT_NO_TRAILING_BLANK = '1\n00:00:00,000 --> 00:00:01,000\nalpha beta';
eq('srt final cue kept', T.parse(SRT_NO_TRAILING_BLANK, 'b.srt').length, 2);

/* ---------- VTT ---------- */

const VTT = [
  'WEBVTT', '', 'cue-1',
  '00:00:00.000 --> 00:00:02.000',
  'hello <c.yellow>there</c>',
  '', '00:00:02.000 --> 00:00:04.000',
  'again'
].join('\n');

const vttWords = T.parse(VTT, 'a.vtt');
eq('vtt word count', vttWords.length, 3);
eq('vtt strips markup', vttWords[1].text, 'there');
eq('vtt second cue', vttWords[2].text, 'again');

/* ---------- transcript JSON ---------- */

const JSON_SECONDS = JSON.stringify({
  version: 1,
  transcripts: [{
    speaker: 'A',
    segments: [
      { text: 'word', start: 0.5, end: 0.9 },
      { text: 'level', start: 0.9, end: 1.4 },
      { text: 'timing', start: 1.4, end: 2.0 }
    ]
  }]
});
const jw = T.parse(JSON_SECONDS, 't.json');
eq('json word count', jw.length, 3);
eq('json first', jw[0].text, 'word');
near('json time kept as seconds', jw[2].end, 2.0);

/* milliseconds get scaled */
const JSON_MS = JSON.stringify({
  segments: [
    { text: 'a', startTime: 1000, endTime: 2000 },
    { text: 'b', startTime: 2000, endTime: 300000 }
  ]
});
const jms = T.parse(JSON_MS, 't.json');
near('ms scaled to seconds', jms[0].start, 1.0);
near('ms scaled end', jms[1].end, 300.0);

/* ticks get scaled */
const JSON_TICKS = JSON.stringify({
  segments: [
    { text: 'a', start: 0, end: T.TICKS_PER_SECOND },
    { text: 'b', start: T.TICKS_PER_SECOND, end: T.TICKS_PER_SECOND * 4 }
  ]
});
const jt = T.parse(JSON_TICKS, 't.json');
near('ticks scaled', jt[1].end, 4.0);

/* deepest level wins: cue-level and word-level in the same file */
const JSON_NESTED = JSON.stringify({
  cues: [
    {
      text: 'hello world', start: 0, end: 2,
      words: [
        { text: 'hello', start: 0, end: 1 },
        { text: 'world', start: 1, end: 2 }
      ]
    }
  ]
});
const jn = T.parse(JSON_NESTED, 't.json');
eq('nested picks word level', jn.length, 2);
eq('nested first word', jn[0].text, 'hello');

/* ---------- assignment ---------- */

const shots = [
  { start: 0, end: 4, name: 'A.mp4' },
  { start: 4, end: 8, name: 'B.mp4' }
];
const buckets = T.assignWordsToShots(srtWords, shots);
eq('shot 1 gets four words', buckets[0].length, 4);
eq('shot 2 gets four words', buckets[1].length, 4);
eq('shot 2 starts at five', buckets[1][0].text, 'five');

/* a cut mid-sentence splits at the word boundary */
const midCut = [{ start: 0, end: 2, name: '' }, { start: 2, end: 4, name: '' }];
const midBuckets = T.assignWordsToShots(T.parse(SRT, 'a.srt').slice(0, 4), midCut);
eq('mid-cue split left', midBuckets[0].map(w => w.text).join(' '), 'one two');
eq('mid-cue split right', midBuckets[1].map(w => w.text).join(' '), 'three four');

/* words outside every shot are kept, not dropped */
const late = T.assignWordsToShots(srtWords, [{ start: 0, end: 1, name: '' }]);
eq('nothing dropped past the end', late[0].length, 8);
const early = T.assignWordsToShots(
  [{ text: 'pre', start: 0, end: 0.5 }],
  [{ start: 10, end: 12, name: '' }]
);
eq('nothing dropped before the start', early[0].length, 1);

/* ---------- board build ---------- */

const project = Board.build(
  shots.map(s => Object.assign({}, s, { image: null })),
  srtWords,
  { sequenceName: 'Client promo', fps: 24 }
);

eq('one scene only', project.scenes.length, 1);
eq('two cards', project.scenes[0].shots.length, 2);
eq('project name', project.name, 'Client promo');

const master = project.master.text;
const cards = project.scenes[0].shots;
eq('card 1 range', master.slice(cards[0].link.from, cards[0].link.to), 'one two three four');
eq('card 2 range', master.slice(cards[1].link.from, cards[1].link.to), 'five six seven eight');
eq('master joins with a blank line', master, 'one two three four\n\nfive six seven eight');
ok('ranges do not overlap', cards[0].link.to <= cards[1].link.from);
ok('description carries timecode', /Timecode: 00:00:00:00 – 00:00:04:00/.test(cards[0].description),
  cards[0].description);
/* source clip names are noise on a flat export, and the description is what the
 * prompt writer reads — so they are deliberately absent */
ok('description omits the clip name', !/A\.mp4/.test(cards[0].description), cards[0].description);
ok('description omits Clip:', !/Clip:/.test(cards[0].description));
eq('description is timecode and duration only', cards[0].description.split('\n').length, 2);

/* a silent cut gets a freestanding empty box, not a broken link */
const silent = Board.build(
  [{ start: 0, end: 2, name: 'X' }, { start: 2, end: 4, name: 'Y' }],
  [{ text: 'only', start: 0.5, end: 1.0 }],
  { sequenceName: 'S', fps: 30 }
);
eq('silent card has no link', silent.scenes[0].shots[1].link, null);
eq('silent card has empty local doc', silent.scenes[0].shots[1].local.text, '');
eq('spoken card linked', silent.scenes[0].shots[0].link.to, 4);

/* ---------- images live in the blob store, not on the shot ---------- */

const URL_A = 'data:image/jpeg;base64,AA';
const URL_B = 'data:image/jpeg;base64,BB';

const withImg = Board.build(
  [{ start: 0, end: 1, name: 'X', image: { data: URL_A, w: 854, h: 480 } }],
  [{ text: 'hi', start: 0.1, end: 0.2 }],
  { sequenceName: 'S', fps: 30 }
);
const oneCard = withImg.scenes[0].shots[0];
eq('dimensions kept', oneCard.image.w, 854);
eq('height kept', oneCard.image.h, 480);
ok('shot holds a reference, not the bytes', !!oneCard.image.ref && !oneCard.image.data);
eq('bytes live in blobs', withImg.blobs[oneCard.image.ref], URL_A);
eq('reference is the content hash', oneCard.image.ref, Blobs.hash(URL_A));
eq('project carries a blob map', typeof withImg.blobs, 'object');
ok('project carries a personas list', Array.isArray(withImg.personas));

/* identical frames are stored once — a held frame or repeated title card */
const dupes = Board.build(
  [{ start: 0, end: 1, name: 'X', image: { data: URL_A, w: 8, h: 8 } },
   { start: 1, end: 2, name: 'Y', image: { data: URL_A, w: 8, h: 8 } },
   { start: 2, end: 3, name: 'Z', image: { data: URL_B, w: 8, h: 8 } }],
  [{ text: 'a b c', start: 0.1, end: 2.9 }],
  { sequenceName: 'S', fps: 30 }
);
eq('two distinct images stored', Object.keys(dupes.blobs).length, 2);
eq('identical frames share a reference',
  dupes.scenes[0].shots[0].image.ref, dupes.scenes[0].shots[1].image.ref);
ok('different frames do not',
  dupes.scenes[0].shots[2].image.ref !== dupes.scenes[0].shots[0].image.ref);

/* a card with no frame carries no reference and adds no blob */
const noImg = Board.build(
  [{ start: 0, end: 1, name: 'X', image: null }],
  [{ text: 'hi', start: 0.1, end: 0.2 }],
  { sequenceName: 'S', fps: 30 }
);
eq('no image, no record', noImg.scenes[0].shots[0].image, null);
eq('no image, no blobs', Object.keys(noImg.blobs).length, 0);

/* an already-referenced image passes through untouched */
const preRef = Board.build(
  [{ start: 0, end: 1, name: 'X', image: { ref: 'abc-1', w: 4, h: 4 } }],
  [{ text: 'hi', start: 0.1, end: 0.2 }],
  { sequenceName: 'S', fps: 30 }
);
eq('existing ref kept', preRef.scenes[0].shots[0].image.ref, 'abc-1');

/* the fields the current schema expects on every card */
ok('cards carry a fields map', typeof oneCard.fields === 'object' && oneCard.fields !== null);
ok('cards carry a personaIds list', Array.isArray(oneCard.personaIds));
eq('no personas identified from a timeline', oneCard.personaIds.length, 0);

/* blob references are stable and collision-safe */
eq('same bytes, same hash', Blobs.hash(URL_A), Blobs.hash(URL_A));
ok('different bytes, different hash', Blobs.hash(URL_A) !== Blobs.hash(URL_B));
const collide = {};
collide[Blobs.hash(URL_A)] = 'something else entirely';
const forced = Blobs.put(collide, URL_A);
ok('a collision gets its own key', forced !== Blobs.hash(URL_A), forced);
eq('and stores the right bytes', collide[forced], URL_A);
eq('empty input stores nothing', Blobs.put({}, ''), null);
ok('blobs exports a global', globalThis.SBBlobs === Blobs);

/* ---------- shape the app will accept ---------- */

const round = JSON.parse(JSON.stringify(project));
eq('serialises', typeof round.master.text, 'string');
eq('marks present', Array.isArray(round.master.marks.b), true);
eq('file version', round.fileVersion, 1);

/* ---------- errors ---------- */

function throws(name, fn, re) {
  try { fn(); ok(name, false, 'no error thrown'); }
  catch (e) { ok(name, re.test(e.message), e.message); }
}
throws('empty file', () => T.parse('', 'a.srt'), /empty/i);
throws('untimed text', () => T.parse('just a script with no timings', 'a.txt'), /timed cues/i);
throws('bad json', () => T.parse('{nope', 'a.json'), /valid JSON/i);

/* ---------- timecode ---------- */

eq('timecode 24', T.secondsToTimecode(3661.5, 24), '01:01:01:12');
eq('timecode zero', T.secondsToTimecode(0, 30), '00:00:00:00');

/* ---------- cut detection on a stacked timeline ---------- */

const clip = (start, end, name, extra) =>
  Object.assign({ start, end, name: name || '', isAdjustment: false }, extra || {});
const track = (index, name, shots, extra) =>
  Object.assign({ index, name, muted: false, shots }, extra || {});

/* V1 runs unbroken; a full-frame graphic lands on V3 in the middle of it. The
 * picture changes twice even though V1 never cuts. */
const layered = [
  track(0, 'V1', [clip(0, 30, 'interview.mov')]),
  track(2, 'V3', [clip(10, 20, 'chart.png')])
];
const layeredCuts = Cuts.find(layered, { fps: 30, minDuration: 0 });
eq('overlay creates cuts V1 never had', layeredCuts.length, 3);
eq('cut 1 ends at the overlay', layeredCuts[0].end, 10);
eq('cut 2 is the overlay', layeredCuts[1].name, 'chart.png');
eq('cut 2 reports the top track', layeredCuts[1].track, 'V3');
eq('cut 3 returns to the interview', layeredCuts[2].name, 'interview.mov');
eq('composite is flagged', layeredCuts[1].layers.join('+'), 'V1+V3');
eq('single layer not flagged', layeredCuts[0].layers.length, 1);

/* single-track mode ignores everything stacked above */
const singleCuts = Cuts.find(layered, { fps: 30, mode: 'track', trackIndexes: [0] });
eq('track mode follows one track', singleCuts.length, 1);
eq('track mode spans the whole clip', singleCuts[0].end, 30);

/* a scene-detected export: one track, every clip a real cut, some of them fast.
 * Nothing may be dropped for being short — the threshold does not apply here. */
const detected = [track(0, 'V1', [
  clip(0, 3, 'promo.mp4'), clip(3, 3.2, 'promo.mp4'), clip(3.2, 3.5, 'promo.mp4'),
  clip(3.5, 9, 'promo.mp4')
])];
const detectedCuts = Cuts.find(detected, { fps: 30, mode: 'track', trackIndexes: [0] });
eq('every detected cut kept', detectedCuts.length, 4);
eq('fast cut survives', detectedCuts[1].end, 3.2);
eq('detected board is gapless',
  detectedCuts.map(c => c.start + '-' + c.end).join(','), '0-3,3-3.2,3.2-3.5,3.5-9');

/* two tracks cutting on the same frame is one cut, not two */
const sameFrame = [
  track(0, 'V1', [clip(0, 5, 'a'), clip(5, 10, 'b')]),
  track(1, 'V2', [clip(0, 5.0001, 'x'), clip(5.0001, 10, 'y')])
];
eq('simultaneous cuts collapse', Cuts.find(sameFrame, { fps: 30, minDuration: 0 }).length, 2);

/* a lower third flashing up must not become its own card */
const lowerThird = [
  track(0, 'V1', [clip(0, 20, 'wide.mov')]),
  track(4, 'V5', [clip(4, 4.3, 'name-super')])
];
eq('short super merged away', Cuts.find(lowerThird, { fps: 30, minDuration: 0.5 }).length, 1);
eq('short super kept when threshold is off',
  Cuts.find(lowerThird, { fps: 30, minDuration: 0 }).length, 3);

/* a gap on every nominated track is black, not a shot */
const gapped = [track(0, 'V1', [clip(0, 5, 'a'), clip(9, 14, 'b')])];
const gapCuts = Cuts.find(gapped, { fps: 30, minDuration: 0 });
eq('black gap dropped', gapCuts.length, 2);
eq('gap card starts after the hole', gapCuts[1].start, 9);

/* hidden tracks contribute nothing to the picture */
const hidden = [
  track(0, 'V1', [clip(0, 10, 'a')]),
  track(1, 'V2', [clip(3, 6, 'hidden-thing')], { muted: true })
];
eq('muted track ignored', Cuts.find(hidden, { fps: 30, minDuration: 0 }).length, 1);

/* adjustment layers are grades, not shots */
const graded = [
  track(0, 'V1', [clip(0, 10, 'a')]),
  track(1, 'V2', [clip(2, 8, 'grade', { isAdjustment: true })])
];
eq('adjustment layer skipped', Cuts.find(graded, { fps: 30, minDuration: 0 }).length, 1);
eq('adjustment layer counted when asked',
  Cuts.find(graded, { fps: 30, minDuration: 0, ignoreAdjustment: false }).length, 3);

/* unticked tracks are excluded even when they carry picture */
eq('untick excludes a track',
  Cuts.find(layered, { fps: 30, minDuration: 0, trackIndexes: [0] }).length, 1);
eq('nothing ticked yields nothing',
  Cuts.find(layered, { fps: 30, minDuration: 0, trackIndexes: [] }).length, 0);

/* a short opening segment folds forward, since it has nothing behind it */
const shortHead = [track(0, 'V1', [clip(0, 0.2, 'flash'), clip(0.2, 10, 'main')])];
const headCuts = Cuts.find(shortHead, { fps: 30, minDuration: 0.5 });
eq('short head merged forward', headCuts.length, 1);
eq('short head keeps the sequence start', headCuts[0].start, 0);

/* the whole thing still feeds the board */
const messy = Board.build(
  Cuts.find(layered, { fps: 30, minDuration: 0 }).map(s => Object.assign({}, s, { image: null })),
  T.parse('1\n00:00:00,000 --> 00:00:30,000\n' + Array(30).fill('w').join(' ') + '\n', 'm.srt'),
  { sequenceName: 'Messy', fps: 30 }
);
eq('messy timeline builds three cards', messy.scenes[0].shots.length, 3);
ok('no layer noise in description',
  !/Layers:/.test(messy.scenes[0].shots[1].description),
  messy.scenes[0].shots[1].description);
ok('cuts export a global', globalThis.SBCuts === Cuts);

/* ---------- which frame gets grabbed ---------- */

/* Times must land on whole frames. Shot times come back as floating-point
 * seconds, and adding 2/29.97 lands between frame boundaries — Premiere can
 * refuse to render there, which is what an occasional empty card looks like. */
const shot25 = { start: 0, end: 4 };
near('offset lands on a frame', Cuts.grabTime(shot25, 2, 25), 0.08);
eq('offset is a whole frame number', Cuts.grabFrame(shot25, 2, 25), 2);
eq('zero offset grabs the first frame', Cuts.grabFrame(shot25, 0, 25), 0);

/* 29.97 is where the float drift bites */
const ntsc = 30000 / 1001;
const drifting = { start: 100 * (1 / ntsc), end: 200 * (1 / ntsc) };
eq('ntsc start frame recovered', Cuts.grabFrame(drifting, 0, ntsc), 100);
eq('ntsc offset stays whole', Cuts.grabFrame(drifting, 2, ntsc), 102);
ok('ntsc grab time is frame aligned',
  Math.abs(Cuts.grabTime(drifting, 2, ntsc) * ntsc - 102) < 1e-9);

/* a shot shorter than the offset cannot grab past its own last frame */
const tiny = { start: 3, end: 3 + 3 / 30 };            // 3 frames at 30fps
eq('offset clamped to last frame', Cuts.grabFrame(tiny, 10, 30), 92);
eq('one-frame shot grabs its only frame',
  Cuts.grabFrame({ start: 1, end: 1 + 1 / 30 }, 5, 30), 30);

/* fallbacks are distinct frames within the same shot */
const alts = Cuts.grabAlternatives({ start: 0, end: 4 }, 2, 25);
eq('three fallbacks', alts.length, 3);
ok('fallbacks exclude the first choice', alts.every(t => Math.abs(t - 0.08) > 1e-9));
ok('fallbacks stay inside the shot', alts.every(t => t >= 0 && t < 4));
ok('fallbacks are frame aligned', alts.every(t => Math.abs(t * 25 - Math.round(t * 25)) < 1e-9));

/* a one-frame shot has nothing else to offer, and must not repeat itself */
const noAlts = Cuts.grabAlternatives({ start: 1, end: 1 + 1 / 30 }, 0, 30);
eq('no duplicate fallbacks for a one-frame shot', noAlts.length, 0);

/* ---------- regressions ---------- */

/* both module systems get the library — an either/or left UXP with no global */
ok('transcript exports a global', globalThis.SBTranscript === T);
ok('board exports a global', globalThis.SBBoard === Board);
ok('b64 exports a global', globalThis.SBB64 === B64);

/* base64 must match Node byte for byte, including both padding cases */
for (const len of [0, 1, 2, 3, 4, 5, 6, 7, 255, 256, 1000]) {
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = (i * 37 + 11) & 255;
  eq('base64 length ' + len, B64.encode(bytes.buffer), Buffer.from(bytes).toString('base64'));
}

/* SRT with no blank line between cues must not glue the next index onto the text */
const SRT_NO_BLANKS = [
  '1', '00:00:00,000 --> 00:00:02,000', 'alpha beta',
  '2', '00:00:02,000 --> 00:00:04,000', 'gamma delta'
].join('\n');
const noBlanks = T.parse(SRT_NO_BLANKS, 'c.srt');
eq('index not swallowed as a word', noBlanks.map(w => w.text).join(' '), 'alpha beta gamma delta');

/* ...but a cue that genuinely ends in a number keeps it */
const SRT_ENDS_NUMBER = [
  '1', '00:00:00,000 --> 00:00:02,000', 'we shipped in', '1995', ''
].join('\n');
eq('real trailing number kept',
  T.parse(SRT_ENDS_NUMBER, 'd.srt').map(w => w.text).join(' '), 'we shipped in 1995');

/* cues with timings but no text must fail loudly, not hand back an empty array */
throws('timed but wordless', () => T.parse('1\n00:00:00,000 --> 00:00:02,000\n\n', 'e.srt'),
  /no words/i);

/* zero point shifts the displayed timecode but nothing else */
const shifted = Board.build(
  [{ start: 0, end: 4, name: 'A' }],
  [{ text: 'hi', start: 0.5, end: 1 }],
  { sequenceName: 'S', fps: 25, tcOffset: 3600 }
);
ok('zero point shifts timecode',
  /Timecode: 01:00:00:00 – 01:00:04:00/.test(shifted.scenes[0].shots[0].description),
  shifted.scenes[0].shots[0].description);
ok('zero point leaves duration alone',
  /Duration: 4\.00s/.test(shifted.scenes[0].shots[0].description));
ok('no offset still starts at zero',
  /Timecode: 00:00:00:00/.test(project.scenes[0].shots[0].description));

/* ---------- surviving differences between Premiere builds ---------- */

const TICKS = Host.TICKS_PER_SECOND;
const tb = fps => String(Math.round(TICKS / fps));

await (async function hostTests() {
  /* the build that shipped: everything present */
  const modern = {
    getTimebase: async () => tb(25),
    getFrameSize: async () => ({ width: 1920, height: 1080 }),
    getZeroPoint: async () => ({ seconds: 0 })
  };
  let m = await Host.readMetrics(modern, async () => ({}));
  near('modern fps', m.fps, 25);
  eq('modern width', m.width, 1920);
  eq('modern not guessed', m.guessedFps || m.guessedSize, false);

  /* the build that failed: no getVideoFrameRate on settings, no getTimebase.
   * It must still come back with real numbers, not throw. */
  const legacy = { getZeroPoint: async () => ({ seconds: 0 }) };
  const legacySettings = {
    getVideoFrameRect: async () => ({ width: 1280, height: 720 }),
    videoFrameRate: { value: 23.976 }
  };
  m = await Host.readMetrics(legacy, async () => legacySettings);
  near('legacy fps off the property', m.fps, 23.976);
  eq('legacy width off settings', m.width, 1280);
  eq('legacy not guessed', m.guessedFps || m.guessedSize, false);

  /* a settings object that throws on every call must not take the panel down */
  const hostile = { getZeroPoint: async () => { throw new Error('nope'); } };
  const hostileSettings = {
    getVideoFrameRate: () => { throw new Error('not a function here'); },
    getVideoFrameRect: () => { throw new Error('nope'); }
  };
  m = await Host.readMetrics(hostile, async () => hostileSettings);
  eq('hostile falls back to 30', m.fps, 30);
  eq('hostile falls back to 1920', m.width, 1920);
  eq('hostile reports the guess', m.guessedFps, true);
  eq('hostile zero point safe', m.zeroPoint, 0);

  /* getSettings itself missing */
  m = await Host.readMetrics({}, null);
  eq('no settings at all still returns', m.fps, 30);
  eq('no settings flags both guesses', m.guessedFps && m.guessedSize, true);

  /* NTSC rates survive the timebase round trip */
  m = await Host.readMetrics({ getTimebase: async () => tb(29.97) }, null);
  ok('29.97 round trip', Math.abs(m.fps - 29.97) < 0.01, String(m.fps));

  /* a settings object reporting a nonsense rate is not trusted */
  m = await Host.readMetrics({}, async () => ({ videoFrameRate: { value: 0 } }));
  eq('zero fps rejected', m.fps, 30);

  /* zero point is read through whichever accessor exists */
  m = await Host.readMetrics({ getZeroPoint: async () => ({ ticksNumber: TICKS * 3600 }) }, null);
  near('zero point from ticksNumber', m.zeroPoint, 3600, 0.01);
})();

/* TickTime in each of its shapes */
near('seconds accessor', Host.secondsOf({ seconds: 12.5 }), 12.5);
near('ticksNumber accessor', Host.secondsOf({ ticksNumber: TICKS * 2 }), 2);
near('ticks string accessor', Host.secondsOf({ ticks: String(TICKS * 3) }), 3);
near('bare number', Host.secondsOf(4.25), 4.25);
eq('null time', Host.secondsOf(null), null);
eq('unusable time', Host.secondsOf({ nope: 1 }), null);
eq('zero seconds is not treated as missing', Host.secondsOf({ seconds: 0 }), 0);

/* ---------- frame export call conventions ---------- */

const plans = Host.exportPlans('C:/tmp/frames/', 'sb_0001', 'jpg', 854, 480);
eq('five conventions tried', plans.length, 5);
eq('first is name + trailing slash dir', plans[0].filename, 'sb_0001.jpg');
eq('first dir keeps its slash', plans[0].filepath, 'C:/tmp/frames/');
eq('second drops the slash', plans[1].filepath, 'C:/tmp/frames');
eq('third passes a full path as the name', plans[2].filename, 'C:/tmp/frames/sb_0001.jpg');
eq('fourth uses backslashes', plans[3].filepath, 'C:\\tmp\\frames\\');
eq('fifth is a backslash full path', plans[4].filename, 'C:\\tmp\\frames\\sb_0001.jpg');
ok('all match on the basename, not a filename', plans.every(p => p.prefix === 'sb_0001'));
eq('a dir without a trailing slash is normalised',
  Host.exportPlans('C:/tmp', 'x', 'png', 2, 2)[0].filepath, 'C:/tmp/');

/* Adobe's own working sample passes nativePath verbatim, so that goes first */
const rawPlans = Host.exportPlans('C:/tmp/frames/', 'f', 'png', 2, 2, 'C:\\tmp\\frames');
eq('nativePath tried first', rawPlans[0].label, 'name + nativePath');
eq('nativePath passed verbatim', rawPlans[0].filepath, 'C:\\tmp\\frames');
eq('six conventions with a distinct nativePath', rawPlans.length, 6);
eq('no duplicate when nativePath already matches',
  Host.exportPlans('C:/tmp/', 'f', 'png', 2, 2, 'C:/tmp/').length, 5);

/* THE bug: Premiere appends the extension a second time, so the file asked for as
 * sb_0001.jpg lands as sb_0001.jpg.jpg. Matching on the basename is what makes
 * this survivable — an exact-filename match finds nothing and reports success as
 * "no file appeared", which is exactly how it failed in the field. */
eq('doubled extension found',
  Host.matchExported(['sb_0001.jpg.jpg'], 'sb_0001'), 'sb_0001.jpg.jpg');
eq('doubled png found',
  Host.matchExported(['sb_0001.png.png'], 'sb_0001'), 'sb_0001.png.png');
eq('mismatched double found',
  Host.matchExported(['sb_0001.jpg.png'], 'sb_0001'), 'sb_0001.jpg.png');
eq('plain name still found',
  Host.matchExported(['sb_0001.jpg'], 'sb_0001'), 'sb_0001.jpg');
eq('shortest wins when both exist',
  Host.matchExported(['sb_0001.jpg.jpg', 'sb_0001.jpg'], 'sb_0001'), 'sb_0001.jpg');
eq('other frames are not picked up',
  Host.matchExported(['sb_0002.jpg.jpg', 'other.png'], 'sb_0001'), null);
eq('empty folder', Host.matchExported([], 'sb_0001'), null);

/* the extension asked for is not proof of what was written */
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
eq('png sniffed', Host.sniffImageType(png.buffer), 'image/png');
eq('jpeg sniffed', Host.sniffImageType(jpg.buffer), 'image/jpeg');
eq('unknown bytes', Host.sniffImageType(new Uint8Array([1, 2, 3, 4]).buffer), null);
eq('empty buffer', Host.sniffImageType(new ArrayBuffer(0)), null);

await (async function probeTests() {
  const shapes = [{ ext: 'jpg', w: 854, h: 480 }, { ext: 'png', w: 854, h: 480 }];
  const plansFor = s => Host.exportPlans('C:/tmp/', 'f', s.ext, s.w, s.h);

  /* stops at the first convention that works */
  let calls = 0;
  let r = await Host.probeVariants(shapes, plansFor, async () => {
    calls++;
    return calls === 1 ? { ok: true, entry: 'E' } : { ok: false, why: 'no' };
  });
  eq('stops at the first success', calls, 1);
  eq('winner reported', r.plan.label, 'name + dir/');
  eq('no fallback flagged', r.fallback, false);

  /* falls through to a later convention and says so */
  calls = 0;
  r = await Host.probeVariants(shapes, plansFor, async () => {
    calls++;
    return calls === 3 ? { ok: true, entry: 'E' } : { ok: false, why: 'nope' };
  });
  eq('third convention wins', r.plan.label, 'full path as name');
  eq('fallback flagged', r.fallback, true);
  eq('failures recorded', r.tried.length, 2);

  /* falls through to the second shape when every path form fails for the first */
  calls = 0;
  r = await Host.probeVariants(shapes, plansFor, async (p, s) =>
    s.ext === 'png' ? { ok: true, entry: 'E' } : { ok: false, why: 'jpg unsupported' });
  eq('second shape wins', r.shape.ext, 'png');
  eq('all five jpg forms tried first', r.tried.length, 5);

  /* total failure returns every reason, and a throwing attempt is just a failure */
  r = await Host.probeVariants(shapes, plansFor, async () => { throw new Error('boom'); });
  eq('no winner', r.plan, null);
  eq('everything tried', r.tried.length, 10);
  eq('throw captured as a reason', r.tried[0].why, 'boom');
  ok('reasons carry their convention', r.tried[0].plan.label === 'name + dir/');
})();

eq('timebase to fps', Math.round(Host.fpsFromTimebase(tb(30))), 30);
eq('bad timebase', Host.fpsFromTimebase('0'), null);
eq('junk timebase', Host.fpsFromTimebase('banana'), null);
ok('host exports a global', globalThis.SBHost === Host);

console.log(failed ? '\n' + failed + ' failed, ' + pass + ' passed' : pass + ' passed');
process.exit(failed ? 1 : 0);
