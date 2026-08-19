/* scriptmode.js — the master script panel: live editing, capture, highlights. */
(function (SB) {
  'use strict';

  let masterEl, editor, capBtn, form, panel;
  let noteBtn, noteForm, noteListEl;
  let cover = null;          // Uint8Array shot coverage over master text
  let scov = null;           // Uint8Array scene coverage — the loose layer
  let notes = null;          // Uint8Array comment coverage
  let sceneRange = null;     // selected scene's claim, drawn brighter
  let activeRange = null;    // selected shot's range, drawn with an underline
  let activeNote = null;     // the note being looked at
  let pendingSel = null;     // range captured when the user clicked "Capture shot"
  let lastSel = null;        // last real selection made in the master script

  function P() { return SB.app.project; }

  function init() {
    panel = document.getElementById('scriptPanel');
    masterEl = document.getElementById('masterScript');
    capBtn = document.getElementById('btnCapture');
    form = document.getElementById('captureForm');
    noteBtn = document.getElementById('btnScriptNote');
    noteForm = document.getElementById('noteForm');
    noteListEl = document.getElementById('noteList');

    noteBtn.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
    noteBtn.addEventListener('click', function () {
      const live = SB.Editor.getSel(masterEl);
      const s = (live && live.end > live.start) ? { from: live.start, to: live.end } : lastSel;
      if (!s || s.to <= s.from) {
        SB.toast('Select the part of the script you want to comment on', true);
        return;
      }
      showNoteForm(s);
    });

    /* clicking a commented phrase in the script opens that note */
    masterEl.addEventListener('click', function (ev) {
      if (!SB.app.commentMode) return;
      const sel = SB.Editor.getSel(masterEl);
      if (!sel || sel.end !== sel.start) return;
      const hit = SB.Model.scriptComments(P()).filter(function (c) {
        return !c.broken && sel.start >= c.from && sel.start < c.to;
      })[0];
      if (hit) selectNote(hit.id);
    });

    editor = SB.Editor.attach(masterEl, {
      get: function () {
        const p = P();
        return p ? { doc: p.master, from: 0, to: p.master.text.length } : null;
      },
      edit: function (s, e, t) { SB.Model.applyMasterEdit(P(), s, e, t, null); },
      toggle: function (type, s, e) { SB.Doc.toggleMark(P().master, type, s, e); },
      after: function () { SB.app.scriptChanged(); },
      extra: extraClass
    });

    /* Remember the last real selection made in the master. Chrome drops the
     * DOM selection the moment focus moves, so without latching it the button
     * stayed lit after you clicked a card and then Capture did nothing. */
    document.addEventListener('selectionchange', function () {
      if (document.activeElement !== masterEl) return;
      const s = SB.Editor.getSel(masterEl);
      lastSel = (s && s.end > s.start) ? { from: s.start, to: s.end } : null;
      syncCaptureBtn();
    });

    /* don't let the button steal focus — keeps the selection visible too */
    capBtn.addEventListener('mousedown', function (ev) { ev.preventDefault(); });

    capBtn.addEventListener('click', function () {
      const live = SB.Editor.getSel(masterEl);
      const s = (live && live.end > live.start) ? { from: live.start, to: live.end } : lastSel;
      if (!s || s.to <= s.from) {
        SB.toast('Select some script text first', true);
        syncCaptureBtn();
        return;
      }
      pendingSel = { from: s.from, to: s.to };
      showForm();
    });

    /* clicking a dead part of the panel should land you in the script */
    panel.addEventListener('mousedown', function (ev) {
      if (ev.target === panel || ev.target.classList.contains('script-hint')) {
        ev.preventDefault();
        masterEl.focus();
      }
    });
  }

  function syncCaptureBtn() {
    if (!capBtn) return;
    const ok = !!(lastSel && lastSel.to > lastSel.from &&
      lastSel.to <= (P() ? P().master.text.length : 0));
    capBtn.disabled = !ok;
    capBtn.title = ok
      ? 'Make a shot from the selected text, or tie it to a scene'
      : 'Select some text in the script first';
    if (noteBtn) {
      noteBtn.classList.toggle('hidden', !SB.app.commentMode);
      noteBtn.disabled = !ok;
      noteBtn.title = ok
        ? 'Comment on the selected text'
        : 'Select some text in the script first';
    }
  }

  /* Any edit moves the text under a remembered selection — drop it. */
  function invalidateSelection() {
    if (document.activeElement === masterEl) return;   // still live, selectionchange owns it
    lastSel = null;
    syncCaptureBtn();
  }

  /* Shots are a background wash, scenes are a rule above the line, notes are an
   * underline — so a phrase that is all three still reads as all three. */
  function extraClass(i) {
    let c = '';
    if (cover && i < cover.length && cover[i] > 0) c = 'h' + Math.min(3, cover[i]);
    if (scov && i < scov.length && scov[i] > 0) {
      const on = sceneRange && i >= sceneRange.from && i < sceneRange.to;
      c += (c ? ' ' : '') + (on ? 'scov scov-on' : 'scov');
    }
    if (activeRange && i >= activeRange.from && i < activeRange.to) c += (c ? ' ' : '') + 'hactive';
    if (notes && i < notes.length && notes[i] > 0) c += (c ? ' ' : '') + 'cmt';
    if (activeNote && i >= activeNote.from && i < activeNote.to) c += (c ? ' ' : '') + 'cmt-on';
    return c;
  }

  function refresh() {
    if (!masterEl || !P()) return;
    cover = SB.Model.coverage(P());
    scov = SB.Model.sceneCoverage(P());
    notes = SB.Model.commentCoverage(P());
    sceneRange = null;
    if (SB.app.selectedSceneId) {
      const fs = SB.Model.findScene(P(), SB.app.selectedSceneId);
      if (fs && fs.scene.link && !fs.scene.broken) {
        sceneRange = { from: fs.scene.link.from, to: fs.scene.link.to };
      }
    }
    activeRange = null;
    if (SB.app.selectedShotId) {
      const f = SB.Model.findShot(P(), SB.app.selectedShotId);
      if (f && f.shot.link) activeRange = { from: f.shot.link.from, to: f.shot.link.to };
    }
    if (activeNote) {
      activeNote = SB.Model.scriptComments(P()).filter(function (c) {
        return c.id === activeNote.id;
      })[0] || null;
    }
    editor.render();
    renderNotes();
    syncCoverage();
    syncCaptureBtn();
  }

  /* "Have I covered it all yet?" answered rather than counted by eye. */
  function syncCoverage() {
    const el = document.getElementById('scriptCoverage');
    if (!el) return;
    const share = SB.Model.sceneCoverageShare(P());
    el.textContent = P().master.text.length
      ? 'Scenes claim ' + Math.round(share * 100) + '% of the script.'
      : '';
  }

  function open() {
    panel.classList.remove('hidden');
    document.getElementById('btnScript').classList.add('on');
    refresh();
  }
  function close() {
    panel.classList.add('hidden');
    document.getElementById('btnScript').classList.remove('on');
  }
  function toggle() { panel.classList.contains('hidden') ? open() : close(); }
  function isOpen() { return !panel.classList.contains('hidden'); }

  function scrollTo(shot) {
    const el = masterEl.querySelector('.hactive');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function scrollToScene() {
    refresh();
    const el = masterEl.querySelector('.scov-on');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ---------- capture form ---------- */

  function showForm() {
    const p = P();
    const text = p.master.text.slice(pendingSel.from, pendingSel.to);
    const sceneId = SB.app.selectedSceneId || (p.scenes[p.scenes.length - 1] || {}).id;

    form.innerHTML = '';
    form.classList.remove('hidden');

    const prev = SB.el('div', 'preview', text);
    form.appendChild(prev);

    /* A selection can become a shot — a picture on a fragment — or a scene's
     * claim on a whole section, which is the looser, earlier way in: you know
     * roughly where this stretch belongs long before you know the shots. */
    let mode = 'shot';
    const r0 = SB.el('div', 'row cap-mode');
    r0.appendChild(SB.el('label', null, 'Make'));
    const bShot = SB.el('button', 'mini on', 'a shot');
    bShot.dataset.mode = 'shot';
    bShot.title = 'A card anchored to exactly this text';
    const bScene = SB.el('button', 'mini', 'a scene section');
    bScene.dataset.mode = 'scene';
    bScene.title = 'Mark this stretch as covered by a scene — independent of any shots in it';
    [bShot, bScene].forEach(function (b) {
      b.onclick = function () {
        mode = b.dataset.mode;
        bShot.classList.toggle('on', mode === 'shot');
        bScene.classList.toggle('on', mode === 'scene');
        applyMode();
      };
      r0.appendChild(b);
    });
    form.appendChild(r0);

    const r1 = SB.el('div', 'row row-type');
    r1.appendChild(SB.el('label', null, 'Shot type'));
    const tsel = document.createElement('select');
    p.settings.shotTypes.forEach(function (t) {
      const o = document.createElement('option'); o.value = t; o.textContent = t; tsel.appendChild(o);
    });
    r1.appendChild(tsel);
    form.appendChild(r1);

    const r2 = SB.el('div', 'row');
    r2.appendChild(SB.el('label', null, 'Scene'));
    const ssel = document.createElement('select');
    p.scenes.forEach(function (sc, i) {
      const o = document.createElement('option');
      o.value = sc.id;
      o.textContent = (i + 1) + '. ' + (sc.heading || 'untitled');
      if (sc.id === sceneId) o.selected = true;
      ssel.appendChild(o);
    });
    r2.appendChild(ssel);
    form.appendChild(r2);

    const r3 = SB.el('div', 'row row-noshot');
    const nsLbl = SB.el('label', null, '');
    nsLbl.style.minWidth = '0';
    const ns = document.createElement('input');
    ns.type = 'checkbox';
    nsLbl.appendChild(ns);
    nsLbl.appendChild(document.createTextNode(' no shot / no storyboard'));
    r3.appendChild(nsLbl);
    form.appendChild(r3);

    const note = SB.el('div', 'cap-note hidden');
    form.appendChild(note);

    const r4 = SB.el('div', 'row');
    r4.appendChild(SB.el('span', 'spacer'));
    const cancel = SB.el('button', 'mini', 'Cancel');
    cancel.dataset.act = 'cancel';
    cancel.onclick = hideForm;
    const extend = SB.el('button', 'mini hidden', 'Widen');
    extend.dataset.act = 'widen';
    extend.title = 'Keep what this scene already claims and stretch it to cover both';
    const done = SB.el('button', 'mini primary', 'Complete');
    done.dataset.act = 'complete';

    /* What the chosen scene is holding right now decides what the buttons can
     * honestly offer. */
    function chosenScene() {
      const f = SB.Model.findScene(P(), ssel.value);
      return f ? f.scene : null;
    }

    function applyMode() {
      const scene = mode === 'scene';
      r1.classList.toggle('hidden', scene);
      r3.classList.toggle('hidden', scene);
      const sc = scene ? chosenScene() : null;
      const linked = !!(sc && sc.link && !sc.broken);
      extend.classList.toggle('hidden', !linked);
      done.textContent = !scene ? 'Complete' : (linked ? 'Replace' : 'Tie to scene');
      note.classList.toggle('hidden', !scene || !sc || !(linked || sc.local));
      if (!scene || !sc) return;
      if (linked) {
        const gap = pendingSel.from > sc.link.to ? pendingSel.from - sc.link.to
          : (sc.link.from > pendingSel.to ? sc.link.from - pendingSel.to : 0);
        note.textContent = 'This scene already claims ' + (sc.link.to - sc.link.from) +
          ' characters. Widen keeps both' +
          (gap ? ', and takes in the ' + gap + ' characters between them' : '') +
          '; Replace swaps in the selection.';
      } else if (sc.local) {
        note.textContent = 'This scene’s script was unlinked from the master. Tying it here ' +
          'replaces ' + sc.local.text.length + ' characters of its own text.';
      }
    }
    ssel.onchange = applyMode;

    function tie(widen) {
      const sc = chosenScene();
      if (sc && !sc.link && sc.local && (sc.local.text || '').trim() &&
        !confirm('Replace this scene’s own script text with the selection?')) return;
      const tied = SB.Model.tieScene(P(), ssel.value, pendingSel.from, pendingSel.to, widen);
      hideForm();
      if (!tied) return;
      SB.app.selectedSceneId = tied.id;
      SB.app.changed(true);
      refresh();
      const el = document.querySelector('.scene-block[data-scene="' + tied.id + '"]');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      SB.toast('Scene claims ' + (tied.link.to - tied.link.from) + ' characters of script');
    }
    extend.onclick = function () { tie(true); };

    done.onclick = function () {
      if (mode === 'scene') { tie(false); return; }
      const sh = SB.Model.addShot(P(), ssel.value, {
        type: tsel.value,
        noShot: ns.checked,
        link: { from: pendingSel.from, to: pendingSel.to }
      });
      hideForm();
      if (sh) {
        SB.app.selectedShotId = sh.id;
        SB.app.changed(true);
        /* changed() rebuilds the board but not the master editor, so without
         * this the new wash does not show until the next script edit. */
        refresh();
        const el = document.querySelector('.card[data-shot="' + sh.id + '"]');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };
    r4.appendChild(cancel); r4.appendChild(extend); r4.appendChild(done);
    form.appendChild(r4);
    applyMode();

    tsel.focus();
  }

  /* ---------- notes on the script ---------- */

  function showNoteForm(range) {
    const p = P();
    noteForm.innerHTML = '';
    noteForm.classList.remove('hidden');

    noteForm.appendChild(SB.el('div', 'preview', p.master.text.slice(range.from, range.to)));

    const ta = document.createElement('textarea');
    ta.className = 'note-input';
    ta.rows = 3;
    ta.placeholder = 'What needs saying about this line?';
    noteForm.appendChild(ta);

    const row = SB.el('div', 'row');
    row.appendChild(SB.el('span', 'spacer'));
    const cancel = SB.el('button', 'mini', 'Cancel');
    cancel.onclick = hideNoteForm;
    const add = SB.el('button', 'mini primary', 'Add comment');
    function submit() {
      const txt = ta.value.trim();
      if (!txt) { ta.focus(); return; }
      const c = SB.Model.addScriptComment(P(), range.from, range.to, txt);
      hideNoteForm();
      lastSel = null;
      if (c) {
        activeNote = c;
        SB.app.changed(false);
        refresh();
        SB.toast('Comment added to the script');
      }
    }
    add.onclick = submit;
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
      if (e.key === 'Escape') { e.preventDefault(); hideNoteForm(); }
    });
    row.appendChild(cancel);
    row.appendChild(add);
    noteForm.appendChild(row);
    ta.focus();
  }

  function hideNoteForm() {
    noteForm.classList.add('hidden');
    noteForm.innerHTML = '';
    syncCaptureBtn();
  }

  function selectNote(id) {
    const c = SB.Model.scriptComments(P()).filter(function (x) { return x.id === id; })[0];
    activeNote = c || null;
    refresh();
    const row = noteListEl.querySelector('.note[data-id="' + id + '"]');
    if (row) row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const span = masterEl.querySelector('.cmt-on');
    if (span) span.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function renderNotes() {
    if (!noteListEl) return;
    const list = SB.Model.scriptComments(P());
    const show = SB.app.commentMode || list.length > 0;
    noteListEl.classList.toggle('hidden', !show);
    if (!show) { noteListEl.innerHTML = ''; return; }

    noteListEl.innerHTML = '';
    const head = SB.el('div', 'note-head');
    head.appendChild(SB.el('span', null, 'Script comments' + (list.length ? ' (' + list.length + ')' : '')));
    noteListEl.appendChild(head);

    if (!list.length) {
      noteListEl.appendChild(SB.el('div', 'note-empty',
        'Select any part of the script and press + Comment.'));
      return;
    }

    list.forEach(function (c) {
      const row = SB.el('div', 'note' +
        (activeNote && activeNote.id === c.id ? ' on' : '') + (c.broken ? ' broken' : ''));
      row.dataset.id = c.id;

      const quote = SB.el('div', 'note-quote',
        c.broken ? '“' + c.quote + '” — this text is gone from the script'
          : '“' + P().master.text.slice(c.from, c.to) + '”');
      row.appendChild(quote);
      row.appendChild(SB.el('div', 'note-text', c.text));

      const foot = SB.el('div', 'note-foot');
      foot.appendChild(SB.el('span', 'note-when', SB.fmtDate(c.at)));
      const del = SB.el('button', 'mini danger', '✕');
      del.title = 'Delete this comment';
      del.onclick = function (ev) {
        ev.stopPropagation();
        SB.Model.deleteScriptComment(P(), c.id);
        if (activeNote && activeNote.id === c.id) activeNote = null;
        SB.app.changed(false);
        refresh();
      };
      foot.appendChild(del);
      row.appendChild(foot);

      row.onclick = function () { selectNote(c.id); };
      noteListEl.appendChild(row);
    });
  }

  function hideForm() {
    form.classList.add('hidden');
    form.innerHTML = '';
    pendingSel = null;
    lastSel = null;
    syncCaptureBtn();
  }

  SB.ScriptMode = {
    init: init, refresh: refresh, open: open, close: close, toggle: toggle,
    isOpen: isOpen, scrollTo: scrollTo, scrollToScene: scrollToScene,
    invalidateSelection: invalidateSelection, syncCaptureBtn: syncCaptureBtn,
    lastSelection: function () { return lastSel; },
    selectNote: selectNote, showNoteForm: showNoteForm
  };

})(window.SB);
