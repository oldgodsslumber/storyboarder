/* blobs.js — every image stored once, under the hash of its bytes.
 *
 * Shots, personas and ink hold a short reference; the actual base64 lives in
 * one map on the project. Two things fall out of that:
 *
 *   - A version snapshot used to deep-copy every frame it froze. Now it copies
 *     references, so cutting a version costs almost nothing.
 *   - The same picture used twice — the same reference frame on ten shots — is
 *     stored once.
 *
 * The map lives INSIDE the project file, so a board is still one thing you can
 * hand to someone. When the board goes online the same references become keys
 * in an object store; nothing above this layer has to change.
 */
(function (SB) {
  'use strict';

  /* Data URLs are ASCII, so a byte-wise FNV-1a is fine here. Two independent
   * 32-bit rounds plus the length give a key wide enough that a collision is
   * not a practical concern — and put() verifies anyway, so a collision could
   * never silently swap one picture for another. */
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

  function map(p) { return (p.blobs = p.blobs || {}); }

  /* Bytes are stored a moment before anything points at them — the caller
   * gets the reference back and assigns it on the next tick. gc() running in
   * that gap would collect a picture that was about to be used, which is how
   * an original can vanish and leave a reference pointing at nothing. So a
   * fresh key is held briefly, and the sweep leaves it alone. */
  const fresh = new Map();
  const HOLD = 15000;

  /* Store a data URL, return its reference. Same bytes -> same reference. */
  function put(p, dataUrl, hold) {
    if (!dataUrl) return null;
    const b = map(p);
    let key = hash(dataUrl);
    let n = 1;
    while (b[key] !== undefined && b[key] !== dataUrl) key = hash(dataUrl) + '~' + (++n);
    b[key] = dataUrl;
    /* `hold` is for bytes whose reference is assigned a tick later — an
       original still being handed back to its caller. A proxy is attached to
       its card in the same breath and needs no grace. */
    if (hold) fresh.set(key, Date.now());
    return key;
  }

  function get(p, ref) {
    if (!ref) return '';
    return map(p)[ref] || '';
  }

  /* Accepts the new {ref,w,h}, the old inline {data,w,h}, or a bare data URL,
   * so an older project renders while it is being migrated. */
  function src(p, img) {
    if (!img) return '';
    if (typeof img === 'string') return /^data:/.test(img) ? img : get(p, img);
    if (img.ref) return get(p, img.ref);
    if (img.data) return img.data;
    return '';
  }

  function has(p, ref) { return !!(ref && map(p)[ref] !== undefined); }

  /* Turn a data URL into a stored image record. */
  function image(p, dataUrl, w, h) {
    const ref = put(p, dataUrl);
    return ref ? { ref: ref, w: w || 0, h: h || 0 } : null;
  }

  /* Every reference a project holds — current board AND every frozen version,
   * which is what stops a version's frames being collected. */
  function referenced(p) {
    const seen = {};
    const mark = function (img) {
      if (!img) return;
      if (typeof img === 'string') { seen[img] = 1; return; }
      if (img.ref) seen[img.ref] = 1;
    };
    const walkScenes = function (scenes) {
      (scenes || []).forEach(function (sc) {
        (sc.shots || []).forEach(function (sh) {
          mark(sh.image);
          mark(sh.annotation);
          /* The original and the clip live in this same map now. Leaving them
           * out of the sweep would make gc() delete the full-size copy of
           * every frame on the board — the proxy would survive and nothing
           * would look wrong until somebody tried to feed one to a model. */
          mark(sh.render);
          mark(sh.video);
          /* Every other take. Leaving these out of the sweep would have the
           * next structural change delete the clips somebody deliberately
           * kept -- the exact failure the originals had before them. */
          (sh.videoAlts || []).forEach(mark);
        });
      });
    };
    /* Both shapes, deliberately: this sweep decides what gc() deletes, so a
     * record that has not been through migrate() — a snapshot pasted in by
     * hand, a fixture — must not cost somebody their reference frames. */
    const walkPersonas = function (list) {
      (list || []).forEach(function (per) {
        mark(per.image);
        mark(per.image && per.image.render);
        /* `images` is the pre-migration shape; `retired` is what a board that
         * carried several keeps. Both are still bytes somebody owns — leaving
         * retired out would have the first structural change delete frames the
         * panel is at that moment offering to restore. */
        (per.images || []).forEach(function (x) { mark(x); mark(x && x.render); });
        (per.retired || []).forEach(function (x) { mark(x); mark(x && x.render); });
      });
    };
    walkScenes(p.scenes);
    walkPersonas(p.personas);
    (p.versions || []).forEach(function (v) {
      if (!v.snapshot) return;
      walkScenes(v.snapshot.scenes);
      walkPersonas(v.snapshot.personas);
    });
    return seen;
  }

  /* Drop anything nothing points at any more. Returns bytes reclaimed. */
  function gc(p) {
    const keep = referenced(p);
    const b = map(p);
    const now = Date.now();
    /* stop the held set growing for the life of the session */
    fresh.forEach(function (at, k) { if (now - at > HOLD) fresh.delete(k); });
    let freed = 0;
    Object.keys(b).forEach(function (k) {
      if (keep[k]) return;
      if (fresh.has(k)) return;            // stored moments ago; give it its tick
      freed += (b[k] || '').length;
      delete b[k];
    });
    return freed;
  }

  /* What the store holds vs what it would cost inline — the dedupe saving. */
  function stats(p) {
    const b = map(p);
    let unique = 0, uniqueBytes = 0;
    Object.keys(b).forEach(function (k) { unique++; uniqueBytes += (b[k] || '').length; });

    let refs = 0, inlineBytes = 0;
    const count = function (img) {
      if (!img) return;
      const ref = (typeof img === 'string') ? img : img.ref;
      if (!ref || b[ref] === undefined) return;
      refs++;
      inlineBytes += b[ref].length;
    };
    const scenes = function (list) {
      (list || []).forEach(function (sc) {
        (sc.shots || []).forEach(function (sh) { count(sh.image); count(sh.annotation); });
      });
    };
    const refsOf = function (list) {
      (list || []).forEach(function (per) {
        count(per.image);
        (per.images || []).forEach(count);
      });
    };
    scenes(p.scenes);
    refsOf(p.personas);
    (p.versions || []).forEach(function (v) {
      if (!v.snapshot) return;
      scenes(v.snapshot.scenes);
      refsOf(v.snapshot.personas);
    });

    return {
      unique: unique, uniqueBytes: uniqueBytes,
      refs: refs, inlineBytes: inlineBytes,
      saved: Math.max(0, inlineBytes - uniqueBytes)
    };
  }

  /* Migrate one image-bearing record from the old inline shape. */
  function adopt(p, img) {
    if (!img) return null;
    if (typeof img === 'string') {                 // old annotation: a bare data URL
      return /^data:/.test(img) ? { ref: put(p, img) } : { ref: img };
    }
    if (img.ref) return img;                       // already a reference
    if (img.data) return { ref: put(p, img.data), w: img.w || 0, h: img.h || 0 };
    return null;
  }

  SB.Blobs = {
    hash: hash, put: put, get: get, src: src, has: has, image: image,
    referenced: referenced, gc: gc, stats: stats, adopt: adopt, map: map
  };

})(window.SB);
