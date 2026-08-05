/* b64.js — ArrayBuffer → base64.
 *
 * UXP has no Buffer, and btoa is not dependable across hosts, so this is done by
 * hand. It lives in its own file purely so the tests can check it against
 * Node's Buffer — a padding mistake here would corrupt every frame silently
 * rather than failing loudly.
 */
(function (root, factory) {
  const api = factory();
  root.SBB64 = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  function encode(arrayBuffer) {
    const b = new Uint8Array(arrayBuffer);
    let out = '';
    let i = 0;
    for (; i + 2 < b.length; i += 3) {
      const n = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
      out += CHARS[(n >> 18) & 63] + CHARS[(n >> 12) & 63] +
        CHARS[(n >> 6) & 63] + CHARS[n & 63];
    }
    const rem = b.length - i;
    if (rem === 1) {
      const n = b[i] << 16;
      out += CHARS[(n >> 18) & 63] + CHARS[(n >> 12) & 63] + '==';
    } else if (rem === 2) {
      const n = (b[i] << 16) | (b[i + 1] << 8);
      out += CHARS[(n >> 18) & 63] + CHARS[(n >> 12) & 63] + CHARS[(n >> 6) & 63] + '=';
    }
    return out;
  }

  return { encode: encode };
});
