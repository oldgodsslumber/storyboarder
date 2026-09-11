/* renders.js — the full-size original, kept inside the file.
 *
 * Everything the board SHOWS is a ≤480p proxy: small enough that a wall of
 * forty cards scrolls, and far too small to feed back into an image model. The
 * original used to be written to a folder on disk that the browser remembered
 * — which worked until the moment this app exists for: handing the board to
 * somebody else. The folder was a fact about one machine, it was never in the
 * file, and whoever opened the board next got a row of serial numbers pointing
 * at nothing, silently, with the 480p copies standing in. It also meant
 * renaming a board orphaned every original it had, because the folder was
 * named after the project.
 *
 * So the original goes in the file, beside the proxy, in the same blob map
 * that already holds every picture once under the hash of its bytes. One file
 * is one board: hand it over and the whole thing arrives.
 *
 *   shot.image   {ref,w,h}                   the ≤480p proxy — what is drawn
 *   shot.render  {ref,serial,ext,w,h,bytes}  the original — what a model is fed
 *   shot.video   {ref,serial,ext,bytes}      the clip, if one was made
 *
 * ---- why it is re-encoded ----
 *
 * A 1184×672 PNG off ImagineArt is about 1 MB; the same pixels as WebP q90 are
 * 63 KB — sixteen times smaller, at a quality still far beyond what this is
 * for (looking at it, and handing it back to a model as a reference). Forty of
 * those is 7 MB of file instead of 73 MB, and 7 MB is a board you can send.
 * Anyone who wants the bytes exactly as they arrived says so in Settings and
 * gets them, at the price on the tin.
 *
 * Clips go in as they arrive — there is no cheap re-encode in a browser —
 * which makes them the one thing here that can make a board heavy. What a
 * board weighs, and what of, is counted on the Originals tab in Settings.
 *
 * ---- why serials outlived the folder ----
 *
 * A serial is claimed the first time an original lands, and never moves or
 * repeats. It is not a filename any more, but it is still the identity: the
 * board shows it beside the shot code, the feed numbering leans on it, and
 * when a picture leaves this app the name it leaves under is built from it. A
 * number that never moves is the one thing every way out can agree on.
 */
(function (SB) {
  'use strict';

  /* Nothing on a storyboard needs more than this, and it is the difference
   * between a board you can send and one you cannot. */
  const CAP = 4096;
  const WEBP_Q = 0.9;

  /* ---------- serials ---------- */

  /* The high-water mark only ever goes up. A number belonging to a deleted
   * shot is never handed out again, so a picture that has already left the app
   * never comes to mean something else. */
  function claim(p) {
    p.renderSeq = (p.renderSeq | 0) + 1;
    return p.renderSeq;
  }

  function pad(n) { return String(n | 0).padStart(4, '0'); }

  function extOf(blobOrName) {
    const t = (blobOrName && blobOrName.type) || '';
    /* the subtype can carry a hyphen or a dot — image/x-icon, image/vnd.… */
    const m = /^image\/([a-z0-9+.-]+)/i.exec(t);
    let e = m ? m[1].toLowerCase() : '';
    if (!e && blobOrName && blobOrName.name) {
      const d = /\.([a-z0-9]+)$/i.exec(blobOrName.name);
      if (d) e = d[1].toLowerCase();
    }
    if (e === 'jpeg') e = 'jpg';
    if (e === 'svg+xml') e = 'svg';
    if (e === 'x-icon' || e === 'vnd.microsoft.icon') e = 'ico';
    return /^[a-z0-9]{2,5}$/.test(e) ? e : 'png';
  }

  function videoExt(blob) {
    const t = (blob && blob.type) || '';
    const m = /^video\/([a-z0-9+.-]+)/i.exec(t);
    let e = m ? m[1].toLowerCase() : '';
    if (e === 'quicktime') e = 'mov';
    if (e === 'x-matroska') e = 'mkv';
    return /^[a-z0-9]{2,5}$/.test(e) ? e : 'mp4';
  }

  /* The name an original leaves under. Nothing writes it here any more —
   * exports do — but it is built in one place so every way out agrees. */
  function fileName(serial, ext) { return pad(serial) + '.' + (ext || 'png'); }

  /* A subject's name, safe to put in a filename, in any script. Nothing here
   * writes files any more, but every way OUT of the app names things after
   * people and shots, so the one rule for it stays in one place. */
  function slug(t) {
    let s = String(t || '');
    /* letters and digits in any script — dropping everything non-ASCII turned
     * a subject named in Cyrillic or Japanese into "ref" */
    try { s = s.replace(/[^\p{L}\p{N}_-]+/gu, '-'); }
    catch (e) { s = s.replace(/[^\w-]+/g, '-'); }
    return s.replace(/^-+|-+$/g, '').slice(0, 40);
  }

  /* A subject's name, safe to put in a filename, in any script. Nothing here
   * writes files any more, but every way OUT of the app names things after
   * people and shots, so the one rule for it stays in one place. */
  function slug(t) {
    let s = String(t || '');
    /* letters and digits in any script — dropping everything non-ASCII turned
     * a subject named in Cyrillic or Japanese into "ref" */
    try { s = s.replace(/[^\p{L}\p{N}_-]+/gu, '-'); }
    catch (e) { s = s.replace(/[^\w-]+/g, '-'); }
    return s.replace(/^-+|-+$/g, '').slice(0, 40);
  }

  /* ---------- bytes in ---------- */

  function toDataUrl(src) {
    if (!src) return Promise.resolve('');
    if (typeof src === 'string') return Promise.resolve(/^data:/.test(src) ? src : '');
    return new Promise(function (res, rej) {
      const r = new FileReader();
      r.onload = function () { res(String(r.result)); };
      r.onerror = function () { rej(new Error('could not read that picture')); };
      r.readAsDataURL(src);
    });
  }

  function load(src) {
    return new Promise(function (res, rej) {
      const img = new Image();
      let url = '';
      const done = function (fn, arg) {
        if (url) URL.revokeObjectURL(url);
        fn(arg);
      };
      img.onload = function () { done(res, img); };
      img.onerror = function () { done(rej, new Error('could not decode that picture')); };
      if (typeof src === 'string') img.src = src;
      else { url = URL.createObjectURL(src); img.src = url; }
    });
  }

  function dataUrlBytes(u) {
    const i = String(u || '').indexOf(',');
    if (i < 0) return 0;
    /* base64 carries three bytes in every four characters, less the padding */
    const n = u.length - i - 1;
    const tail = (u.slice(-2) === '==') ? 2 : (u.slice(-1) === '=' ? 1 : 0);
    return Math.max(0, (n * 3 >> 2) - tail);
  }

  function mimeOf(u) {
    const m = /^data:([^;,]+)/.exec(String(u || ''));
    return m ? m[1] : '';
  }

  function wantsSource(p) {
    return !!(p && p.settings && p.settings.originals === 'source');
  }

  /* Re-encode at native size (capped), then keep whichever is smaller — the
   * re-encode or what arrived. A 30 KB JPEG does not need to become a 60 KB
   * WebP to prove a point. */
  function encode(src, keepSource) {
    return toDataUrl(src).then(function (asIs) {
      if (!asIs) throw new Error('that picture had no bytes');
      return load(asIs).then(function (img) {
        const w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) throw new Error('that picture had no size');
        if (keepSource) return { data: asIs, w: w, h: h, source: true };

        const s = Math.min(1, CAP / w, CAP / h);
        const cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
        const c = document.createElement('canvas');
        c.width = cw; c.height = ch;
        c.getContext('2d').drawImage(img, 0, 0, cw, ch);
        let out = '';
        try { out = c.toDataURL('image/webp', WEBP_Q); } catch (e) { out = ''; }
        /* A browser with no WebP encoder hands back a PNG and says nothing,
         * which would be enormous — take JPEG instead when that happens. */
        if (!/^data:image\/webp/.test(out)) {
          try { out = c.toDataURL('image/jpeg', 0.92); } catch (e) { out = ''; }
        }
        /* A cap that actually bit means the re-encode is the only copy at the
         * size we want, whatever it weighs. */
        const capped = s < 1;
        if (!out || (out.length >= asIs.length && !capped)) {
          return { data: asIs, w: w, h: h, source: true };
        }
        return { data: out, w: cw, h: ch, source: false };
      });
    });
  }

  /* ---------- keeping one ---------- */

  /* Put the original in the file and hand back the record the board stores.
   * `existing` carries a shot's serial across re-renders, so the number beside
   * the shot code does not change when the picture does.
   *
   * Unlike the folder this replaced, there is no way for this to quietly do
   * nothing: if it cannot encode the picture it rejects, and the caller says
   * so out loud. */
  function keep(p, src, existing) {
    return encode(src, wantsSource(p)).then(function (enc) {
      const ref = SB.Blobs.put(p, enc.data);
      if (!ref) return null;
      return {
        ref: ref,
        serial: (existing && existing.serial) || claim(p),
        ext: extOf({ type: mimeOf(enc.data) }),
        w: enc.w, h: enc.h,
        bytes: dataUrlBytes(enc.data),
        source: !!enc.source,
        at: Date.now()
      };
    });
  }

  /* A clip goes in as it arrived: a second lossy pass would not be the clip
   * the model made, and a browser cannot do a cheap one anyway. */
  function keepVideo(p, blob, existing) {
    if (!blob || !blob.size) return Promise.resolve(null);
    return toDataUrl(blob).then(function (data) {
      if (!data) return null;
      const ref = SB.Blobs.put(p, data);
      if (!ref) return null;
      return {
        ref: ref,
        serial: (existing && existing.serial) || claim(p),
        ext: videoExt(blob),
        bytes: blob.size,
        at: Date.now()
      };
    });
  }

  /* ---------- reading one back ---------- */

  function dataUrl(p, rec) {
    if (!p || !rec || !rec.ref) return '';
    return SB.Blobs.get(p, rec.ref) || '';
  }

  /* Does this record point at bytes the file actually holds? False for a board
   * written while originals lived in a folder: those records name a serial and
   * nothing else, and the pictures are wherever that machine's folder was. */
  function has(p, rec) { return !!dataUrl(p, rec); }

  function isLegacy(rec) { return !!(rec && rec.serial && !rec.ref); }

  function blobOf(p, rec) {
    const u = dataUrl(p, rec);
    if (!u) return Promise.resolve(null);
    return fetch(u).then(function (r) { return r.blob(); }).catch(function () { return null; });
  }

  /* Promises, because every caller of these used to be awaiting a file. */
  function file(p, rec) { return blobOf(p, rec); }
  function videoFile(p, rec) { return blobOf(p, rec); }

  /* ---------- what the board weighs ----------
   *
   * With the pictures inside the file, "how big is this board, and what of"
   * stops being a curiosity and becomes the thing you steer by — so it is
   * counted here, by role, instead of being left to a file listing.
   */
  function weigh(p) {
    const out = {
      proxies: { n: 0, bytes: 0 },
      originals: { n: 0, bytes: 0 },
      clips: { n: 0, bytes: 0 },
      ink: { n: 0, bytes: 0 },
      total: 0, unused: 0, legacy: 0
    };
    const b = SB.Blobs.map(p);
    const seen = {};
    const add = function (bucket, ref) {
      if (!ref || seen[ref] || b[ref] === undefined) return;
      seen[ref] = 1;
      out[bucket].n++;
      out[bucket].bytes += b[ref].length;
    };
    const refOf = function (x) { return x && (typeof x === 'string' ? x : x.ref); };
    const eachShot = function (scenes) {
      (scenes || []).forEach(function (sc) {
        (sc.shots || []).forEach(function (sh) {
          add('proxies', refOf(sh.image));
          add('ink', refOf(sh.annotation));
          add('originals', sh.render && sh.render.ref);
          add('clips', sh.video && sh.video.ref);
          if (isLegacy(sh.render)) out.legacy++;
        });
      });
    };
    const eachPersona = function (list) {
      (list || []).forEach(function (per) {
        add('proxies', refOf(per.image));
        (per.images || []).forEach(function (x) {
          add('proxies', refOf(x));
          add('originals', x && x.render && x.render.ref);
          if (isLegacy(x && x.render)) out.legacy++;
        });
      });
    };
    eachShot(p.scenes);
    eachPersona(p.personas);
    (p.versions || []).forEach(function (v) {
      if (!v.snapshot) return;
      eachShot(v.snapshot.scenes);
      eachPersona(v.snapshot.personas);
    });
    let all = 0;
    Object.keys(b).forEach(function (k) { all += (b[k] || '').length; });
    out.total = all;
    out.unused = all - (out.proxies.bytes + out.originals.bytes + out.clips.bytes + out.ink.bytes);
    return out;
  }

  SB.Renders = {
    CAP: CAP,
    claim: claim, pad: pad, fileName: fileName, extOf: extOf, videoExt: videoExt,
    slug: slug,
    slug: slug,
    keep: keep, keepVideo: keepVideo,
    file: file, videoFile: videoFile, dataUrl: dataUrl, has: has, isLegacy: isLegacy,
    weigh: weigh, wantsSource: wantsSource
  };

})(window.SB);
