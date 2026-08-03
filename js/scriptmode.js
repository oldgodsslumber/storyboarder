/* scriptmode.js — the master script panel: live editing, capture, highlights. */
(function (SB) {
  'use strict';

  let masterEl, editor, capBtn, form, panel;
  let cover = null;          // Uint8Array coverage over master text
  let activeRange = null;    // selected shot's range, drawn with an underline
  let pendingSel = null;     // range captured when the user clicked "Capture shot"

  function P() { return SB.app.project; }

  function init() {
    panel = document.getElementById('scriptPanel');
    masterEl = document.getElementById('masterScript');
    capBtn = document.getElementById('btnCapture');
    form = document.getElementById('captureForm');

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

    document.addEventListener('selectionchange', function () {
      if (document.activeElement !== masterEl) return;
      const s = SB.Editor.getSel(masterEl);
      capBtn.disabled = !(s && s.end > s.start);
    });

    capBtn.addEventListener('click', function () {
      const s = SB.Editor.getSel(masterEl);
      if (!s || s.end <= s.start) return;
      pendingSel = { from: s.start, to: s.end };
      showForm();
    });

    masterEl.addEventListener('paste', function () { /* handled by editor */ });
  }

  function extraClass(i) {
    let c = '';
    if (cover && i < cover.length && cover[i] > 0) c = 'h' + Math.min(3, cover[i]);
    if (activeRange && i >= activeRange.from && i < activeRange.to) c += (c ? ' ' : '') + 'hactive';
    return c;
  }

  function refresh() {
    if (!masterEl || !P()) return;
    cover = SB.Model.coverage(P());
    activeRange = null;
    if (SB.app.selectedShotId) {
      const f = SB.Model.findShot(P(), SB.app.selectedShotId);
      if (f && f.shot.link) activeRange = { from: f.shot.link.from, to: f.shot.link.to };
    }
    editor.render();
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

  /* ---------- capture form ---------- */

  function showForm() {
    const p = P();
    const text = p.master.text.slice(pendingSel.from, pendingSel.to);
    const sceneId = SB.app.selectedSceneId || (p.scenes[p.scenes.length - 1] || {}).id;

    form.innerHTML = '';
    form.classList.remove('hidden');

    const prev = SB.el('div', 'preview', text);
    form.appendChild(prev);

    const r1 = SB.el('div', 'row');
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

    const r3 = SB.el('div', 'row');
    const nsLbl = SB.el('label', null, '');
    nsLbl.style.minWidth = '0';
    const ns = document.createElement('input');
    ns.type = 'checkbox';
    nsLbl.appendChild(ns);
    nsLbl.appendChild(document.createTextNode(' no shot / no storyboard'));
    r3.appendChild(nsLbl);
    form.appendChild(r3);

    const r4 = SB.el('div', 'row');
    r4.appendChild(SB.el('span', 'spacer'));
    const cancel = SB.el('button', 'mini', 'Cancel');
    cancel.onclick = hideForm;
    const done = SB.el('button', 'mini primary', 'Complete');
    done.onclick = function () {
      const sh = SB.Model.addShot(P(), ssel.value, {
        type: tsel.value,
        noShot: ns.checked,
        link: { from: pendingSel.from, to: pendingSel.to }
      });
      hideForm();
      if (sh) {
        SB.app.selectedShotId = sh.id;
        SB.app.changed(true);
        const el = document.querySelector('.card[data-shot="' + sh.id + '"]');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };
    r4.appendChild(cancel); r4.appendChild(done);
    form.appendChild(r4);

    tsel.focus();
  }

  function hideForm() {
    form.classList.add('hidden');
    form.innerHTML = '';
    pendingSel = null;
    capBtn.disabled = true;
  }

  SB.ScriptMode = {
    init: init, refresh: refresh, open: open, close: close, toggle: toggle,
    isOpen: isOpen, scrollTo: scrollTo
  };

})(window.SB);
