/* app.js — boot + wiring. */
(function (SB) {
  'use strict';

  const app = SB.app = {
    project: null,
    selectedShotId: null,
    selectedSceneId: null,
    commentMode: false,
    pendingHandle: null
  };

  /* Any change at all. structural = the card layout must be rebuilt. */
  app.changed = function (structural) {
    if (structural) {
      SB.Board.render();
      renderChrome();
    } else {
      SB.Board.renderSceneList();
    }
    SB.Store.touch();
  };

  /* A change to shared script text: refresh every window onto the master. */
  app.scriptChanged = function () {
    SB.Board.renderScriptWindows();
    SB.ScriptMode.refresh();
    SB.ScriptMode.invalidateSelection();
    SB.Store.touch();
  };

  function renderChrome() {
    const p = app.project;
    document.getElementById('projName').value = p.name || '';
    document.getElementById('verLabel').textContent = p.versionName || ('v' + p.versionNumber);
  }

  function setProject(p) {
    app.project = p;
    SB.History.reset();
    app.selectedShotId = null;
    app.selectedSceneId = p.scenes[0] ? p.scenes[0].id : null;
    SB.Board.render();
    renderChrome();
    SB.ScriptMode.refresh();
    SB.PromptPanel.refresh();
    SB.PersonaPanel.refresh();
  }

  /* ---------------- boot ---------------- */

  function boot() {
    if (!SB.Store.hasFS) {
      SB.toast('This app needs Chrome or Edge (File System Access API) to autosave.', true);
    }
    SB.ScriptMode.init();
    SB.PromptPanel.init();
    SB.PersonaPanel.init();
    SB.Store.S.getProject = function () { return app.project; };
    SB.Store.S.onState = function (txt, cls) {
      const el = document.getElementById('saveState');
      el.textContent = txt;
      el.className = 'save-state ' + (cls || '');
    };

    setProject(SB.Model.newProject());
    wire();

    SB.Store.lastHandle().then(function (h) {
      if (!h) return;
      return h.queryPermission({ mode: 'readwrite' }).then(function (perm) {
        if (perm === 'granted') {
          return SB.Store.loadFromHandle(h, false).then(setProject);
        }
        app.pendingHandle = h;
        const el = document.getElementById('saveState');
        el.textContent = 'reopen ' + h.name;
        el.className = 'save-state dirty';
        el.style.cursor = 'pointer';
        el.title = 'Click to reopen the last project';
      });
    }).catch(function () { });
  }

  function wire() {
    const $ = function (id) { return document.getElementById(id); };

    $('projName').addEventListener('input', function () {
      app.project.name = this.value; SB.Store.touch();
    });

    $('saveState').addEventListener('click', function () {
      if (!app.pendingHandle) return;
      const h = app.pendingHandle;
      app.pendingHandle = null;
      this.style.cursor = '';
      SB.Store.loadFromHandle(h, true).then(setProject)
        .catch(function (e) { SB.toast(e.message, true); });
    });

    $('btnNew').addEventListener('click', function () {
      if (!confirm('Start a new project? The current one is already saved to its file.')) return;
      SB.Store.detach();
      setProject(SB.Model.newProject());
    });

    $('btnOpen').addEventListener('click', function () {
      SB.Store.open().then(setProject).catch(function (e) {
        if (e && e.name === 'AbortError') return;
        SB.toast(e.message || String(e), true);
      });
    });

    $('btnSaveAs').addEventListener('click', function () {
      SB.Store.saveAs(app.project).then(function (n) { SB.toast('Autosaving to ' + n); })
        .catch(function (e) {
          if (e && e.name === 'AbortError') return;
          SB.toast(e.message || String(e), true);
        });
    });

    $('btnScript').addEventListener('click', function () { SB.ScriptMode.toggle(); });

    $('btnUndo').addEventListener('mousedown', function (e) { e.preventDefault(); });
    $('btnUndo').addEventListener('click', function () {
      if (!SB.History.undo()) SB.toast('Nothing to undo');
    });
    $('btnRedo').addEventListener('mousedown', function (e) { e.preventDefault(); });
    $('btnRedo').addEventListener('click', function () {
      if (!SB.History.redo()) SB.toast('Nothing to redo');
    });

    $('btnComment').addEventListener('click', function () {
      app.commentMode = !app.commentMode;
      this.classList.toggle('on', app.commentMode);
      document.body.classList.toggle('comment-mode', app.commentMode);
      SB.Board.render();
    });

    $('btnPersonas').addEventListener('click', function () { SB.PersonaPanel.toggle(); });

    $('btnPrompts').addEventListener('click', function () { SB.PromptPanel.toggle(); });

    $('btnTheme').addEventListener('click', function () { SB.Theme.toggle(); });

    $('btnVersions').addEventListener('click', function () { SB.Versions.open(); });
    $('btnPdf').addEventListener('click', function () { SB.Pdf.exportPdf(); });
    $('btnSettings').addEventListener('click', function () { SB.Settings.open(); });

    $('btnAddScene').addEventListener('click', function () {
      const sc = SB.Model.addScene(app.project);
      app.selectedSceneId = sc.id;
      app.changed(true);
    });

    /* paste an image straight onto the selected card (text pastes are left alone) */
    document.addEventListener('paste', function (ev) {
      const cd = ev.clipboardData;
      const file = cd && Array.prototype.filter.call(cd.items || [], function (i) {
        return i.kind === 'file' && /^image\//.test(i.type);
      })[0];
      if (!file) return;
      if (!app.selectedShotId) { SB.toast('Select a card first, then paste', true); return; }
      const f = SB.Model.findShot(app.project, app.selectedShotId);
      if (!f) return;
      ev.preventDefault();
      const blob = file.getAsFile();
      if (blob) SB.Board.setImage(f.shot, blob);
    });

    document.addEventListener('keydown', function (ev) {
      if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return;
      const k = ev.key.toLowerCase();
      if (k === 's') {
        ev.preventDefault();
        SB.Store.saveNow();
        return;
      }
      /* undo/redo also works when focus isn't in a script box */
      const t = ev.target;
      if (t && t.isContentEditable) return;          // the editor handles its own
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (k === 'z' || k === 'y') {
        ev.preventDefault();
        const redo = (k === 'y') || ev.shiftKey;
        if (!(redo ? SB.History.redo() : SB.History.undo())) {
          SB.toast(redo ? 'Nothing to redo' : 'Nothing to undo');
        }
      }
    });

    window.addEventListener('beforeunload', function (e) {
      if (SB.Store.S.dirty) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})(window.SB);
