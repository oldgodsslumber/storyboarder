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
    getProject: null   // set by app: () => project
  };

  const hasFS = typeof window.showSaveFilePicker === 'function';

  function state(txt, cls) {
    if (S.onState) S.onState(txt, cls);
  }

  /* ---------- IndexedDB (remember the last file handle) ---------- */

  function idb() {
    return new Promise(function (resolve, reject) {
      const r = indexedDB.open(IDB_NAME, 1);
      r.onupgradeneeded = function () {
        if (!r.result.objectStoreNames.contains(IDB_STORE)) r.result.createObjectStore(IDB_STORE);
      };
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
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
    S.writing = true;
    state('saving…', 'dirty');
    const text = serialize(project);
    return ensurePermission(S.handle, false).then(function (ok) {
      if (!ok) { state('permission needed', 'dirty'); throw new Error('permission'); }
      return S.handle.createWritable();
    }).then(function (w) {
      return w.write(text).then(function () { return w.close(); });
    }).then(function () {
      S.writing = false;
      S.dirty = false;
      S.lastSaved = Date.now();
      state('saved ' + new Date().toLocaleTimeString(), 'saved');
      if (S.pending) { S.pending = false; return writeNow(); }
    }).catch(function (e) {
      S.writing = false;
      if (String(e && e.message) !== 'permission') {
        state('save failed', 'dirty');
        console.error('[storyboarder] save failed', e);
      }
    });
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
      return idbPut('last', h);
    }).then(function () {
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
    serialize: serialize
  };

})(window.SB);
