/* board.js — assemble a .storyboard project from timed shots + timed words.
 *
 * The output is deliberately minimal: Storyboarder's own SB.Model.migrate()
 * fills in ids, settings, models and the rest on open, so this file only has to
 * get the two things migrate cannot invent right — the master script text and
 * each shot's anchored range into it.
 *
 * Everything lands in a single scene, by design.
 */
(function (root, factory) {
  // Global first: UXP defines require but cannot resolve a relative path, so
  // probing require() ahead of the global would throw inside Premiere.
  const req = function (path, name) {
    return root[name] || (typeof require === 'function' ? require(path) : null);
  };
  const dep = req('./transcript.js', 'SBTranscript');
  const blobs = req('./blobs.js', 'SBBlobs');
  if (!dep) throw new Error('board.js: load lib/transcript.js first');
  if (!blobs) throw new Error('board.js: load lib/blobs.js first');
  const api = factory(dep, blobs);
  root.SBBoard = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (T, Blobs) {
  'use strict';

  const FILE_VERSION = 1;
  const SHOT_GAP = '\n\n';

  function doc(text) {
    return { text: text || '', marks: { b: [], i: [], u: [] } };
  }

  function wordsToText(words) {
    return words.map(function (w) { return w.text; }).join(' ').trim();
  }

  /* Timecode and duration only. Source clip names are deliberately left out: on a
   * scene-detected export every card names the same flat file, so it is pure
   * noise — and the description is what the prompt writer reads.
   *
   * tcOffset = the sequence zero point. Clip times are zero-based, but a sequence
   * that starts at 01:00:00:00 displays everything shifted by an hour, and the
   * description has to match what the timeline shows. Frame grabs stay zero-based.
   */
  function describeShot(shot, fps, tcOffset) {
    return 'Timecode: ' + T.secondsToTimecode(shot.start + tcOffset, fps) +
      ' – ' + T.secondsToTimecode(shot.end + tcOffset, fps) + '\n' +
      'Duration: ' + (shot.end - shot.start).toFixed(2) + 's';
  }

  /* shots: [{start, end, name, image}]   words: [{text,start,end}]
   * opts:  {sequenceName, fps, sceneHeading}
   */
  function build(shots, words, opts) {
    opts = opts || {};
    const fps = opts.fps || 30;
    const tcOffset = opts.tcOffset || 0;
    const buckets = T.assignWordsToShots(words, shots);
    const blobs = {};

    let master = '';
    const outShots = shots.map(function (shot, i) {
      const text = wordsToText(buckets[i]);
      // shot.image arrives as {data,w,h}; the file wants {ref,w,h} into blobs
      const img = shot.image && shot.image.data
        ? Blobs.image(blobs, shot.image.data, shot.image.w, shot.image.h)
        : (shot.image && shot.image.ref ? shot.image : null);
      const card = {
        type: '',
        noShot: false,
        broken: false,
        description: describeShot(shot, fps, tcOffset),
        fields: {},                     // per-project extra text boxes
        personaIds: [],                 // nobody identified from a timeline
        image: img,
        annotation: null,
        comments: [],
        prompts: {}
      };

      if (text) {
        if (master) master += SHOT_GAP;
        const from = master.length;
        master += text;
        card.link = { from: from, to: master.length };
        card.local = null;
      } else {
        // no dialogue under this cut — a freestanding empty box, not a broken link
        card.link = null;
        card.local = doc('');
      }
      return card;
    });

    return {
      fileVersion: FILE_VERSION,
      name: opts.sequenceName || 'Sequence storyboard',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      master: doc(master),
      blobs: blobs,                     // every frame, stored once under its hash
      personas: [],
      scenes: [{
        heading: opts.sceneHeading || (opts.sequenceName || 'Scene one'),
        description: 'Imported from the Premiere sequence “' +
          (opts.sequenceName || 'untitled') + '” — one card per cut.',
        shots: outShots
      }],
      versionNumber: 1,
      versionName: 'v1',
      versions: []
    };
  }

  return { build: build, FILE_VERSION: FILE_VERSION };
});
