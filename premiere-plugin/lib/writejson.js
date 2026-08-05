/* writejson.js — write the .storyboard file and prove it landed whole.
 *
 * A sequence export is megabytes of JSON: every frame is base64 inside it. A
 * single UXP `entry.write(bigString)` can come back resolved having written
 * nothing at all, or having stopped part way — and the only symptom is
 * Storyboarder saying "Unexpected end of JSON input" when you open it, long
 * after the export looked like it succeeded.
 *
 * So: write the bytes, read them back, parse them. If that fails, write again
 * in chunks. If THAT fails, say so loudly instead of leaving a broken file
 * with a cheerful log line above it.
 */
(function (root, factory) {
  const api = factory();
  root.SBWriteJson = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CHUNK = 512 * 1024;      // bytes per append when the single write fails

  function utf8(str) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(str);
    /* UXP has TextEncoder; this is only here so the logic is testable anywhere */
    const out = [];
    for (let i = 0; i < str.length; i++) {
      let c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 63)); }
      else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
    }
    return new Uint8Array(out);
  }

  function decode(buf) {
    if (typeof buf === 'string') return buf;
    if (typeof TextDecoder === 'function') return new TextDecoder().decode(buf);
    let s = '';
    const b = new Uint8Array(buf);
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return s;
  }

  /* Read the file back and make sure it is the document we meant to write. */
  async function verify(entry, formats, expectedBytes) {
    let raw;
    try {
      raw = await entry.read({ format: formats.binary });
    } catch (e) {
      return { ok: false, why: 'could not read the file back: ' + (e && e.message || e) };
    }
    const text = decode(raw);
    const got = text.length ? utf8(text).length : 0;
    if (!text.length) return { ok: false, why: 'the file is empty', bytes: 0 };
    let parsed = null;
    try { parsed = JSON.parse(text); } catch (e) {
      return {
        ok: false,
        bytes: got,
        why: 'the file is incomplete — ' + got + ' of ' + expectedBytes + ' bytes'
      };
    }
    if (!parsed || !parsed.scenes) {
      return { ok: false, bytes: got, why: 'the file parsed but is not a storyboard' };
    }
    return { ok: true, bytes: got };
  }

  /* Write in pieces, appending, for the case where one big write will not go.
   * The piece size is taken from how much the host actually kept last time —
   * chunking at 512 KB is no use against a host that stops at 2 KB. */
  async function writeChunks(entry, formats, bytes, kept) {
    const step = Math.max(512, Math.min(CHUNK, kept || CHUNK));
    await entry.write('', { format: formats.utf8 });          // truncate
    for (let at = 0; at < bytes.length; at += step) {
      const slice = bytes.slice(at, Math.min(at + step, bytes.length));
      await entry.write(slice, { format: formats.binary, append: at > 0 });
    }
  }

  /* Returns { bytes, attempts }. Throws with something actionable if the file
   * cannot be made whole. */
  async function writeJson(entry, obj, formats, log) {
    const text = JSON.stringify(obj);
    const bytes = utf8(text);
    const say = log || function () { };

    /* 1. the straightforward write, as binary — the text path is the one that
     *    silently truncates on large payloads */
    await entry.write(bytes, { format: formats.binary });
    let check = await verify(entry, formats, bytes.length);
    if (check.ok) return { bytes: check.bytes, attempts: 1 };

    say('The file did not land whole (' + check.why + '). Writing it in pieces…', 'warn');

    /* 2. chunked append, sized to what the host kept */
    await writeChunks(entry, formats, bytes, check.bytes);
    check = await verify(entry, formats, bytes.length);
    if (check.ok) return { bytes: check.bytes, attempts: 2 };

    /* 3. plain text, in case binary is what this host dislikes */
    say('Still not whole (' + check.why + '). One more try as text…', 'warn');
    await entry.write(text, { format: formats.utf8 });
    check = await verify(entry, formats, bytes.length);
    if (check.ok) return { bytes: check.bytes, attempts: 3 };

    throw new Error(
      'The .storyboard file could not be written completely — ' + check.why + '. ' +
      'Nothing was left half-written that Storyboarder would open; try a folder on a ' +
      'local drive, or export fewer frames.');
  }

  return { writeJson: writeJson, verify: verify, utf8: utf8, decode: decode, CHUNK: CHUNK };
});
