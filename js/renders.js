/* renders.js — where the full-size pictures live.
 *
 * Everything on a board is a ≤480p proxy: small enough that a whole project is
 * one portable file, and far too small to feed back into an image model. Until
 * now the original was simply dropped on the floor — a 4K render became an
 * 854×480 JPEG at quality 0.82 and the bytes were gone. So the loop the app is
 * for (render it, then use it as the reference for the next shot) could not
 * actually be closed with the app's own copies.
 *
 * So: one folder, chosen once, with a subfolder per project, holding the
 * originals.
 *
 *   <root>/<project name>/0007.png          the current render
 *   <root>/<project name>/_versions/…       what it replaced
 *   <root>/<project name>/_feed/1C/…        a reference set, written on demand
 *
 * ---- why serials ----
 *
 * A file named for its shot code has to be renamed every time the board
 * renumbers, which is a permutation across the whole folder, which is a
 * two-phase rename that can half-fail against a file some other program has
 * open. A serial never moves. It is claimed the first time a picture lands, it
 * is never reused, and it rides with the picture — so swapping two cards moves
 * the record and touches no file at all.
 *
 * The number means nothing on its own, and that is fine: the board shows it
 * beside the shot code, and the board is always there.
 *
 * The folder is never required. Every proxy is in the .storyboard, so a board
 * with no folder connected — or opened on another machine, or in a browser
 * without the File System Access API — behaves exactly as it always did.
 */
(function (SB) {
  'use strict';

  const KEY_ROOT = 'rendersRoot';
  const VERSIONS = '_versions';
  const FEED = '_feed';

  const hasFS = typeof window.showDirectoryPicker === 'function';

  let root = null;            // the chosen root, once it is known
  let looking = null;         // the in-flight lookup, so two callers share one
  let looked = false;         // ...and whether it has ever finished
  let denied = false;         // permission refused this session; stop asking

  function P() { return SB.app.project; }

  /* ---------- the root ---------- */

  /* Two images dropped together both land here in the same tick. Marking the
   * lookup done before it finished handed the second one a null root, and its
   * original was thrown away with nothing said — so the in-flight promise is
   * shared instead. */
  function remember() {
    if (looked) return Promise.resolve(root);
    if (looking) return looking;
    looking = SB.Store.idbGet(KEY_ROOT).then(function (h) {
      root = h || null;
      looked = true;
      looking = null;
      return root;
    }).catch(function () {
      looked = true;
      looking = null;
      return null;
    });
    return looking;
  }

  /* Is a folder remembered at all, whatever its permission says? Settings needs
   * this to tell "never chosen" from "chosen, but Chrome wants a click". */
  function isRemembered() {
    return remember().then(function (h) { return !!h; });
  }

  /* Chrome will not hand back a persisted handle's permission without a user
   * gesture, so `interactive` says whether we are inside one. */
  /* Chrome hands a persisted handle back in the "prompt" state after a
   * restart, so a folder that is remembered perfectly well is unusable until
   * somebody asks — and nothing did. Every call that can only happen inside a
   * user gesture (dropping a picture, clicking copy image set) asks; a refused
   * request latches, so it is asked once and then left alone. */
  function ready(interactive) {
    if (!hasFS) return Promise.resolve(null);
    return remember().then(function (h) {
      if (!h) return null;
      if (denied) return null;
      return SB.Store.ensurePermission(h, !!interactive).then(function (ok) {
        if (ok) { denied = false; return h; }
        if (interactive) denied = true;    // asked, and told no
        return null;
      }).catch(function () { return null; });
    });
  }

  /* A fresh choice clears the refusal — it is a new answer to the question. */
  function connect() {
    if (!hasFS) {
      return Promise.reject(new Error('This browser has no directory access. Use Chrome or Edge.'));
    }
    return window.showDirectoryPicker({ id: 'sb-renders', mode: 'readwrite' })
      .then(function (h) {
        root = h;
        looked = true;
        looking = null;
        denied = false;
        return SB.Store.idbPut(KEY_ROOT, h).then(function () { return h; });
      });
  }

  function disconnect() {
    root = null;
    looked = true;
    looking = null;
    denied = false;
    return SB.Store.idbPut(KEY_ROOT, null);
  }

  function rootName() { return root ? root.name : ''; }
  function isConnected() { return !!root; }

  /* ---------- the project's own folder ---------- */

  /* A folder name a filesystem will actually accept. Windows is the strict one:
   * no \ / : * ? " < > |, no trailing dot or space, and a handful of reserved
   * device names that cannot be used even with an extension. */
  const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  function folderName(p) {
    let n = String((p && p.name) || 'Untitled project')
      /* control characters are illegal too, and invisible in a project name */
      .replace(/[\u0000-\u001f\u007f]+/g, '')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .trim()
      /* cut BEFORE stripping the tail: clamping afterwards could put a dot or
       * a space back on the end, which Windows will not accept, and the whole
       * folder then silently failed to open */
      .slice(0, 100)
      .replace(/[\s.]+$/, '')
      .trim();
    if (!n) n = 'Untitled project';
    /* reserved with an extension is reserved too: CON.txt is refused as well */
    if (RESERVED.test(n.replace(/\..*$/, ''))) n = n + '_';
    return n;
  }

  function folder(p, create, interactive) {
    return ready(interactive).then(function (h) {
      if (!h) return null;
      return h.getDirectoryHandle(folderName(p), { create: create !== false })
        .catch(function () { return null; });
    });
  }

  function sub(dir, name) {
    if (!dir) return Promise.resolve(null);
    return dir.getDirectoryHandle(name, { create: true }).catch(function () { return null; });
  }

  /* ---------- serials ---------- */

  /* The high-water mark only ever goes up. A number belonging to a deleted shot
   * is never handed out again, so a file that has already left the app — dragged
   * into an editor, sent to somebody — never comes to mean something else. */
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

  function fileName(serial, ext) { return pad(serial) + '.' + (ext || 'png'); }

  /* ---------- writing ---------- */

  function toBlob(src) {
    if (!src) return Promise.resolve(null);
    if (typeof src !== 'string') return Promise.resolve(src);
    if (!/^data:/.test(src)) return Promise.resolve(null);
    return fetch(src).then(function (r) { return r.blob(); }).catch(function () { return null; });
  }

  function writeFile(dir, name, blob) {
    return dir.getFileHandle(name, { create: true }).then(function (fh) {
      return fh.createWritable().then(function (w) {
        return w.write(blob).then(function () { return w.close(); });
      });
    });
  }

  /* Move whatever is under this name into _versions before it is replaced. A
   * render you have already used somewhere is not the app's to destroy. */
  function archive(dir, name) {
    return dir.getFileHandle(name).then(function (fh) {
      return fh.getFile().then(function (f) {
        return sub(dir, VERSIONS).then(function (vd) {
          if (!vd) return null;
          /* to the millisecond: stamped to the second, two takes inside one
             second produced the same name and the second overwrote the first —
             destroying exactly the version this exists to keep */
          const stamp = new Date(f.lastModified || Date.now()).toISOString()
            .replace(/[:T]/g, '-').replace(/[.Z]/g, '');
          const dot = name.lastIndexOf('.');
          const base = (dot > 0 ? name.slice(0, dot) : name) + '__' + stamp;
          const ext = dot > 0 ? name.slice(dot) : '';
          /* and if even that collides, keep going rather than overwrite */
          const free = function (n) {
            const kept = base + (n ? '_' + n : '') + ext;
            return vd.getFileHandle(kept).then(function () {
              return n > 20 ? kept : free(n + 1);
            }, function () { return kept; });
          };
          return free(0).then(function (kept) {
            return writeFile(vd, kept, f).then(function () {
              return dir.removeEntry(name).catch(function () { });
            });
          });
        });
      });
    }).catch(function () { /* nothing there to keep */ });
  }

  /* Put the original bytes away and hand back the record the board stores.
   * Resolves to null whenever there is no folder — the caller keeps its proxy
   * either way, so nothing downstream has to care. */
  function keep(p, src, existing) {
    if (!hasFS) return Promise.resolve(null);
    return folder(p, true, true).then(function (dir) {
      if (!dir) return null;
      return toBlob(src).then(function (blob) {
        if (!blob || !blob.size) return null;
        const ext = extOf(blob);
        const serial = (existing && existing.serial) || claim(p);
        const name = fileName(serial, ext);
        /* an earlier take under this serial, and any take under another
           extension, both step aside */
        const fresh = !(existing && existing.serial);
        const older = (existing && existing.ext && existing.ext !== ext)
          ? archive(dir, fileName(serial, existing.ext)) : Promise.resolve();
        return older.then(function () { return archive(dir, name); })
          .then(function () { return writeFile(dir, name, blob); })
          .then(function () {
            return { serial: serial, ext: ext, bytes: blob.size, at: Date.now() };
          })
          .catch(function () {
            /* nothing was written, so give the number back if it is still the
               last one out — it is only ever a high-water mark, but a counter
               that climbs on failures makes the folder read as if pictures are
               missing */
            if (fresh && p.renderSeq === serial) p.renderSeq = serial - 1;
            return null;
          });
      });
    }).catch(function () { return null; });
  }

  /* ---------- reading ---------- */

  function file(p, rec) {
    if (!rec || !rec.serial) return Promise.resolve(null);
    return folder(p, false).then(function (dir) {
      if (!dir) return null;
      return dir.getFileHandle(fileName(rec.serial, rec.ext))
        .then(function (fh) { return fh.getFile(); })
        .catch(function () { return null; });
    });
  }

  function has(p, rec) {
    return file(p, rec).then(function (f) { return !!f; });
  }

  /* ---------- the feed ----------
   *
   * The reference set for one shot, written out at the moment it is asked for
   * and resolved through ids — so what you drag is correct whatever any file
   * happens to be called. Position first, because the order is the promise the
   * prompt's mapping makes; then the serial, which is the identity; then a
   * label, which is for the eye.
   *
   *   _feed/1C/1_0002_1B.png  2_0007_Colleague-front.png
   *
   * Full-size where the folder has it, the board's proxy where it does not, so
   * the set is always complete and never silently short.
   */
  function slug(t) {
    let s = String(t || '');
    /* letters and digits in any script — dropping everything non-ASCII turned a
     * subject named in Cyrillic or Japanese into "ref" */
    try { s = s.replace(/[^\p{L}\p{N}_-]+/gu, '-'); }
    catch (e) { s = s.replace(/[^\w-]+/g, '-'); }
    return s.replace(/^-+|-+$/g, '').slice(0, 40);
  }

  /* Empty it first: a set left over from a previous run, with an entry since
   * removed, is worse than no set at all — you would feed a picture the prompt
   * no longer accounts for. */
  function clear(dir) {
    const names = [];
    if (!dir.values) return Promise.resolve();
    return (async function () {
      for await (const h of dir.values()) names.push(h.name);
    })().then(function () {
      return Promise.all(names.map(function (n) {
        return dir.removeEntry(n, { recursive: true }).catch(function () { });
      }));
    }).catch(function () { });
  }

  function writeFeed(p, shot, code, entries) {
    if (!hasFS) return Promise.resolve(null);
    return folder(p).then(function (dir) {
      if (!dir) return null;
      return sub(dir, FEED).then(function (fd) {
        if (!fd) return null;
        return sub(fd, slug(code) || 'shot').then(function (od) {
          if (!od) return null;
          return clear(od).then(function () {
            let wrote = 0, full = 0;
            const missing = [];
            const step = function (i) {
              if (i >= entries.length) {
                return {
                  dir: od, wrote: wrote, full: full, total: entries.length,
                  missing: missing,
                  path: folderName(p) + '/' + FEED + '/' + slug(code)
                };
              }
              const e = entries[i];
              const name = e.n + '_' + (e.render ? pad(e.render.serial) + '_' : '') +
                (slug(e.label) || 'ref') + (e.role ? '_' + slug(e.role) : '');
              /* the original if there is one, the proxy if there is not */
              return file(p, e.render).then(function (f) {
                if (f) {
                  return writeFile(od, name + '.' + (e.render.ext || 'png'), f)
                    .then(function () { full++; wrote++; });
                }
                const src = SB.Blobs.src(p, e.img);
                if (!src) { missing.push(e.n); return null; }
                return toBlob(src).then(function (b) {
                  if (!b) { missing.push(e.n); return null; }
                  return writeFile(od, name + '.jpg', b).then(function () { wrote++; });
                });
              }).catch(function () { missing.push(e.n); })
                /* Counting every entry whether or not anything reached the disk
                   reported a complete set while leaving a hole in the numbering
                   — so image 2 on disk was what the prompt calls image 3, and
                   nothing said so. */
                .then(function () { return step(i + 1); });
            };
            return step(0);
          });
        });
      });
    }).catch(function () { return null; });
  }

  SB.Renders = {
    hasFS: hasFS,
    connect: connect, disconnect: disconnect, ready: ready,
    isConnected: isConnected, isRemembered: isRemembered,
    rootName: rootName, folderName: folderName,
    folder: folder, sub: sub, writeFile: writeFile,
    claim: claim, pad: pad, fileName: fileName, extOf: extOf,
    keep: keep, file: file, has: has, writeFeed: writeFeed, slug: slug,
    VERSIONS: VERSIONS, FEED: FEED
  };

})(window.SB);
