/* store.js — File System Access persistence + local (non-project) secrets.
 *
 * The project lives in one .storyboard JSON file the user picks once; after
 * that every change is written back to the same handle, debounced. The Gemini
 * API key NEVER goes in that file — it lives in localStorage only.
 */
(function (SB) {
  'use strict';

  const KEY_API = 'sb.geminiApiKey';
  const IDB_NAME = 'storyboarder';
  const IDB_STORE = 'handles';

  const S = {
    handle: null,
    fileName: null,
    dirty: false,
    writing: false,
    lastSaved: 0,
    onState: null,
    getProject: null,  // set by app: () => project
    /* what this session has actually pushed to disk — the numbers a backend
     * would have to carry */
    stats: { writes: 0, bytes: 0, since: Date.now(), lastBytes: 0 }
  };

  const hasFS = typeof window.showSaveFilePicker === 'function';

  function state(txt, cls) {
    if (S.onState) S.onState(txt, cls);
  }

  /* ---------- IndexedDB (remember the last file handle) ---------- */

  /* Remembering the handle is a convenience, never a precondition for saving.
   * IndexedDB is restricted on file:// (which is how this app is normally
   * opened), and a request that neither succeeds nor errors must not be able
   * to wedge anything, so every call is time-boxed. */
  let idbDead = false;      // proven unusable — stop paying the timeout each time

  function idb() {
    if (idbDead) return Promise.reject(new Error('indexeddb unavailable'));
    return new Promise(function (resolve, reject) {
      let done = false;
      const fail = function (why) {
        if (done) return;
        done = true;
        idbDead = true;       // it will not start working later in this session
        reject(new Error(why));
      };
      setTimeout(function () { fail('indexeddb timeout'); }, 1500);
      let r;
      try { r = indexedDB.open(IDB_NAME, 1); }
      catch (e) { fail('indexeddb unavailable'); return; }
      r.onupgradeneeded = function () {
        if (!r.result.objectStoreNames.contains(IDB_STORE)) r.result.createObjectStore(IDB_STORE);
      };
      r.onsuccess = function () { if (!done) { done = true; resolve(r.result); } };
      r.onerror = function () { fail('indexeddb error'); };
      r.onblocked = function () { fail('indexeddb blocked'); };
    });
  }

  function idbPut(k, v) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(v, k);
        tx.oncomplete = function () { res(); };
        tx.onerror = function () { rej(tx.error); };
      });
    }).catch(function () { });
  }

  function idbGet(k) {
    return idb().then(function (db) {
      return new Promise(function (res) {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const rq = tx.objectStore(IDB_STORE).get(k);
        rq.onsuccess = function () { res(rq.result || null); };
        rq.onerror = function () { res(null); };
      });
    }).catch(function () { return null; });
  }

  /* ---------- permissions ---------- */

  function ensurePermission(handle, interactive) {
    if (!handle || !handle.queryPermission) return Promise.resolve(true);
    return handle.queryPermission({ mode: 'readwrite' }).then(function (p) {
      if (p === 'granted') return true;
      if (!interactive) return false;
      return handle.requestPermission({ mode: 'readwrite' }).then(function (q) { return q === 'granted'; });
    });
  }

  /* ---------- write ---------- */

  function serialize(project) {
    // Belt and braces: the API key must never reach the file.
    const copy = SB.clone(project);
    if (copy.settings) delete copy.settings.geminiApiKey;
    copy.updatedAt = Date.now();
    return JSON.stringify(copy);
  }

  function writeNow() {
    const project = S.getProject && S.getProject();
    if (!project) return Promise.resolve();
    if (!S.handle) { state('no file', 'dirty'); return Promise.resolve(); }
    /* Hand back the write already running, so awaiting a save really waits for
     * the bytes to land instead of resolving straight away. */
    if (S.writing) { S.pending = true; return S.inflight || Promise.resolve(); }

    /* Serialising can throw (and once did leave the writing flag stuck on,
     * killing autosave for the rest of the session in silence). */
    let text;
    try {
      text = serialize(project);
    } catch (e) {
      console.error('[storyboarder] could not serialise the project', e);
      saveFailed('the project could not be encoded', e);
      return Promise.resolve();
    }
    if (!text || text.length < 2) {          // never write nothing over a board
      saveFailed('refused to write an empty project', new Error('empty serialisation'));
      return Promise.resolve();
    }

    S.writing = true;
    state('saving…', 'dirty');

    const chain = ensurePermission(S.handle, false).then(function (ok) {
      if (!ok) { state('permission needed', 'dirty'); throw new Error('permission'); }
      /* The swap starts EMPTY and is committed by close(), so there is never a
       * stale tail to trim. The safety against a half write is abort(), which
       * throws the swap away and leaves the board on disk untouched.
       *
       * Do not reintroduce truncate() here: it counts BYTES while a JS string
       * counts CHARACTERS, so on any board containing an em-dash or a smart
       * quote it cut the file short and the next open failed with
       * "Unexpected end of JSON input". */
      return S.handle.createWritable();
    }).then(function (w) {
      const blob = new Blob([text], { type: 'application/json' });
      S.lastBytes = blob.size;
      return Promise.resolve(w.write(blob))
        .then(function () { return w.close(); })
        .catch(function (e) {
          // leave the original alone rather than committing a half write
          if (w.abort) { try { w.abort(); } catch (x) { } }
          throw e;
        });
    }).then(function () {
      return confirmOnDisk(text);
    }).then(function () {
      S.writing = false;
      S.dirty = false;
      S.lastSaved = Date.now();
      S.lastGood = text;                     // the rescue copy
      S.stats.writes++;
      S.stats.lastBytes = (SB.Usage ? SB.Usage.bytes(text) : text.length);
      S.stats.bytes += S.stats.lastBytes;
      state('saved ' + new Date().toLocaleTimeString(), 'saved');
      if (S.onSaved) S.onSaved(S.stats);
      if (S.pending) { S.pending = false; return writeNow(); }
    }).catch(function (e) {
      S.writing = false;
      S.pending = false;
      if (String(e && e.message) === 'permission') return;
      saveFailed('the file could not be written', e);
    }).then(function (r) {
      if (S.inflight === chain) S.inflight = null;
      return r;
    });

    S.inflight = chain;
    return chain;
  }

  /* Read back what we just wrote. A save that reports success and leaves an
   * unopenable file is the worst failure this app has, so it is checked rather
   * than trusted. Cheap: the file is already in the OS cache. */
  function confirmOnDisk(expected) {
    if (!S.handle || !S.handle.getFile) return Promise.resolve();
    return S.handle.getFile().then(function (f) {
      return f.text();
    }).then(function (onDisk) {
      if (onDisk === expected) return;
      const e = new Error('the file on disk does not match what was written (' +
        onDisk.length + ' vs ' + expected.length + ' characters)');
      e.mismatch = true;
      throw e;
    }).catch(function (e) {
      if (e && e.mismatch) throw e;
      /* couldn't re-read it — not proof of a bad write, so let it pass */
    });
  }

  /* A failed save is the one thing in this app the user must not miss. */
  function saveFailed(what, err) {
    S.writing = false;
    state('SAVE FAILED', 'dirty');
    console.error('[storyboarder] save failed —', what, err);
    if (S.onFailure) S.onFailure(what, err);
  }

  const debouncedWrite = SB.debounce(writeNow, 500);

  function touch() {
    S.dirty = true;
    if (S.handle) state('unsaved…', 'dirty');
    debouncedWrite();
  }

  /* ---------- open / save-as ---------- */

  const PICKER_TYPES = [{
    description: 'Storyboard project',
    accept: { 'application/json': ['.storyboard', '.json'] }
  }];

  function saveAs(project) {
    if (!hasFS) return Promise.reject(new Error('This browser has no File System Access API. Use Chrome or Edge.'));
    return window.showSaveFilePicker({
      suggestedName: (project.name || 'storyboard').replace(/[\\/:*?"<>|]+/g, '_') + '.storyboard',
      types: PICKER_TYPES
    }).then(function (h) {
      S.handle = h;
      S.fileName = h.name;
      idbPut('last', h);          // fire and forget — never gate the write on it
      return writeNow();
    }).then(function () {
      return S.fileName;
    });
  }

  /* Just the picker — the caller loads it, so a file that fails to parse can
   * still be identified and offered for repair. */
  function pick() {
    if (!hasFS) return Promise.reject(new Error('This browser has no File System Access API. Use Chrome or Edge.'));
    return window.showOpenFilePicker({ types: PICKER_TYPES, multiple: false })
      .then(function (hs) { return hs[0]; });
  }

  function openFile() {
    return pick().then(function (h) { return loadFromHandle(h, true); });
  }

  function loadFromHandle(handle, interactive) {
    return ensurePermission(handle, interactive).then(function (ok) {
      if (!ok) throw new Error('Permission to the project file was denied.');
      return handle.getFile();
    }).then(function (f) {
      return f.text();
    }).then(function (txt) {
      const p = SB.Model.migrate(JSON.parse(txt));
      S.handle = handle;
      S.fileName = handle.name;
      S.dirty = false;
      idbPut('last', handle);
      state('opened ' + handle.name, 'saved');
      return p;
    });
  }

  function lastHandle() { return idbGet('last'); }

  function detach() {
    S.handle = null;
    S.fileName = null;
    idbPut('last', null);
    state('no file', 'dirty');
  }

  /* ---------- API key (local only) ---------- */

  function getApiKey() { try { return localStorage.getItem(KEY_API) || ''; } catch (e) { return ''; } }
  function setApiKey(v) { try { v ? localStorage.setItem(KEY_API, v) : localStorage.removeItem(KEY_API); } catch (e) { } }

  /* ---------- rescuing a truncated file ---------- */

  /* A project file cut short at the end — an interrupted write, or the
   * byte-vs-character truncate bug that shipped briefly — is still whole up to
   * the point it stops. Keep every top-level property that closed cleanly and
   * shut the object; migrate() fills in whatever was lost after that.
   *
   * Returns the repaired text, or null if there is nothing worth keeping. */
  function repair(text) {
    if (typeof text !== 'string' || text.length < 2) return null;
    let inStr = false, esc = false, lastSafe = -1;
    const stack = [];
    for (let i = 0; i < text.length; i++) {
      const ch = text.charAt(i);
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{' || ch === '[') { stack.push(ch); continue; }
      if (ch === '}' || ch === ']') {
        stack.pop();
        if (stack.length === 1) lastSafe = i;          // a property's value just closed
        continue;
      }
      if (ch === ',' && stack.length === 1) lastSafe = i - 1;  // ...or ended before a comma
    }
    if (lastSafe < 1) return null;
    const patched = text.slice(0, lastSafe + 1) + '}';
    try {
      const obj = JSON.parse(patched);
      if (!obj || !obj.scenes) return null;
      return patched;
    } catch (e) {
      return null;
    }
  }

  /* What a repair would cost, so the user can decide with the facts. */
  function repairReport(text) {
    const fixed = repair(text);
    if (!fixed) return null;
    let obj;
    try { obj = JSON.parse(fixed); } catch (e) { return null; }
    let shots = 0;
    (obj.scenes || []).forEach(function (sc) { shots += (sc.shots || []).length; });
    return {
      text: fixed,
      lost: text.length - fixed.length + 1,
      scenes: (obj.scenes || []).length,
      shots: shots,
      images: Object.keys(obj.blobs || {}).length,
      script: (obj.master && obj.master.text ? obj.master.text.length : 0),
      versions: (obj.versions || []).length,
      settings: !!obj.settings
    };
  }

  /* ---------- escape hatch ---------- */

  /* Always available, even when the file handle is gone or unwritable: hand
   * the project back as a download. */
  function downloadCopy(project, why) {
    let text;
    try { text = serialize(project || (S.getProject && S.getProject())); }
    catch (e) { text = S.lastGood || ''; }
    if (!text) return false;
    const name = ((project && project.name) || 'storyboard')
      .replace(/[\\/:*?"<>|]+/g, '_') + (why ? '-' + why : '') + '.storyboard';
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    return true;
  }

  /* Saves per day at the rate this session has been going. Needs a few
   * minutes of real work before it means anything. */
  function saveRate() {
    const mins = (Date.now() - S.stats.since) / 60000;
    if (S.stats.writes < 3 || mins < 1) return null;
    return { perHour: S.stats.writes / (mins / 60), perDay: (S.stats.writes / (mins / 60)) * 8 };
  }

  /* Does this context have a working IndexedDB? On file:// it hangs rather
   * than failing, so "remember the last project" quietly cannot work there. */
  function storageUsable() {
    return idb().then(function () { return true; }).catch(function () { return false; });
  }

  SB.Store = {
    hasFS: hasFS,
    S: S,
    touch: touch,
    /* Flush any pending debounce, then hand back whatever write is running —
     * awaiting this means the bytes are on disk. */
    saveNow: function () {
      if (debouncedWrite.flush) debouncedWrite.flush();
      return S.inflight || writeNow();
    },
    saveAs: saveAs,
    open: openFile,
    pick: pick,
    loadFromHandle: loadFromHandle,
    lastHandle: lastHandle,
    detach: detach,
    getApiKey: getApiKey,
    setApiKey: setApiKey,
    serialize: serialize,
    downloadCopy: downloadCopy,
    storageUsable: storageUsable,
    saveRate: saveRate,
    repair: repair,
    repairReport: repairReport,
    readHandle: function (handle) {
      return handle.getFile().then(function (f) { return f.text(); });
    }
  };

})(window.SB);
