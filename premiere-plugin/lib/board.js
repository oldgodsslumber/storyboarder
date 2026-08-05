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

  /* The description is left empty, deliberately.
   *
   * It is the box the prompt writer reads, and it is where the shot's own
   * description belongs — written by whoever is boarding, not filled with
   * timecodes and file names the machine happened to know. Anything auto-filled
   * here has to be cleared before the box can be used for what it is for.
   */

  /* shots: [{start, end, name, image}]   words: [{text,start,end}]
   * opts:  {sequenceName, fps, sceneHeading}
   */
  function build(shots, words, opts) {
    opts = opts || {};
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
        description: '',
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
