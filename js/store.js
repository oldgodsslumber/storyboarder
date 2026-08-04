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
  function idb() {
    return new Promise(function (resolve, reject) {
      let done = false;
      const fail = function (why) { if (!done) { done = true; reject(new Error(why)); } };
      setTimeout(function () { fail('indexeddb timeout'); }, 2000);
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
    if (S.writing) { S.pending = true; return Promise.resolve(); }

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

    return ensurePermission(S.handle, false).then(function (ok) {
      if (!ok) { state('permission needed', 'dirty'); throw new Error('permission'); }
      /* keepExistingData means the swap file starts as a copy of the board, so
       * a write that fails part-way can never leave a 0-byte project file. */
      return S.handle.createWritable({ keepExistingData: true });
    }).then(function (w) {
      return Promise.resolve(w.write({ type: 'write', position: 0, data: text }))
        .then(function () {
          return w.truncate ? w.truncate(text.length) : null;
        })
        .then(function () { return w.close(); })
        .catch(function (e) {
          // leave the original alone rather than committing a half write
          if (w.abort) { try { w.abort(); } catch (x) { } }
          throw e;
        });
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

  function openFile() {
    if (!hasFS) return Promise.reject(new Error('This browser has no File System Access API. Use Chrome or Edge.'));
    return window.showOpenFilePicker({ types: PICKER_TYPES, multiple: false })
      .then(function (hs) { return loadFromHandle(hs[0], true); });
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
    saveNow: function () { debouncedWrite.flush ? debouncedWrite.flush() : null; return writeNow(); },
    saveAs: saveAs,
    open: openFile,
    loadFromHandle: loadFromHandle,
    lastHandle: lastHandle,
    detach: detach,
    getApiKey: getApiKey,
    setApiKey: setApiKey,
    serialize: serialize,
    downloadCopy: downloadCopy,
    storageUsable: storageUsable,
    saveRate: saveRate
  };

})(window.SB);
