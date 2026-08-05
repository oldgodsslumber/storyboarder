/* blobs.js — the project's image store, as the app now writes it.
 *
 * Images no longer sit inline on the shot. The shot holds {ref,w,h} and the
 * base64 lives once in project.blobs, keyed by the hash of its bytes. Two cards
 * showing identical pixels — a repeated title card, a held frame — cost one copy.
 *
 * This must produce byte-identical references to the app's own js/blobs.js, or
 * a frame written here and an identical one added in the app would be stored
 * twice. test-plugin.mjs checks the two implementations against each other.
 */
(function (root, factory) {
  const api = factory();
  root.SBBlobs = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* Data URLs are ASCII, so a byte-wise FNV-1a is fine. Two independent 32-bit
   * rounds plus the length give a key wide enough that a collision is not a
   * practical concern — and put() verifies anyway. */
  function h32(str, seed) {
    let h = seed >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i) & 0xff;
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function hash(s) {
    return h32(s, 2166136261).toString(36) + h32(s, 40389).toString(36) +
      '-' + s.length.toString(36);
  }

  /* Store a data URL, return its reference. Same bytes -> same reference. */
  function put(blobs, dataUrl) {
    if (!dataUrl) return null;
    let key = hash(dataUrl);
    let n = 1;
    while (blobs[key] !== undefined && blobs[key] !== dataUrl) {
      key = hash(dataUrl) + '~' + (++n);
    }
    blobs[key] = dataUrl;
    return key;
  }

  /* Turn a data URL into the record a shot carries. */
  function image(blobs, dataUrl, w, h) {
    const ref = put(blobs, dataUrl);
    return ref ? { ref: ref, w: w || 0, h: h || 0 } : null;
  }

  return { hash: hash, put: put, image: image };
});
