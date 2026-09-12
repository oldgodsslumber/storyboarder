/* versions.js — whole-project versions. Comments and ink freeze with the
 * version they were made in and do NOT carry forward into the new one.
 */
(function (SB) {
  'use strict';

  function P() { return SB.app.project; }

  function core(p) {
    return {
      master: SB.clone(p.master),
      scenes: SB.clone(p.scenes),
      /* The cast, the locations and the objects freeze with the version too.
       * Without them a snapshot held cards naming subjects it did not carry:
       * delete one afterwards and its reference frames were collected as
       * orphans, so restoring that version brought back cards whose cast had
       * quietly evaporated. Frames are stored by content hash, so a subject
       * appearing in ten versions still costs its bytes once. */
      personas: SB.clone(p.personas || []),
      scriptComments: SB.clone(p.scriptComments || []),
      versionNumber: p.versionNumber,
      versionName: p.versionName
    };
  }

  function freeze(p, note) {
    p.versions.push({
      n: p.versionNumber,
      name: p.versionName + (note ? ' — ' + note : ''),
      createdAt: Date.now(),
      snapshot: core(p)
    });
  }

  function countComments(snap) {
    let n = 0, ink = 0;
    (snap.scenes || []).forEach(function (sc) {
      sc.shots.forEach(function (sh) {
        n += (sh.comments || []).length;
        if (sh.annotation) ink++;
      });
    });
    return { comments: n, ink: ink, script: (snap.scriptComments || []).length };
  }

  function newVersion() {
    const p = P();
    const suggested = 'v' + (p.versionNumber + 1);
    const name = prompt('Name for the new version:', suggested);
    if (name === null) return;
    freeze(p, null);
    p.versionNumber = p.versionNumber + 1;
    p.versionName = (name || '').trim() || suggested;
    // fresh start: comments and drawings stay with the version they were made in
    SB.Model.eachShot(p, function (sh) { sh.comments = []; sh.annotation = null; });
    p.scriptComments = [];
    SB.app.changed(true);
    SB.toast('Now working in ' + p.versionName + ' — comments and ink start clean');
  }

  function restore(v) {
    const p = P();
    if (!confirm('Restore "' + v.name + '"?\n\nThe current state is saved as a version first, so nothing is lost.')) return;
    /* A restore replaces p.scenes with cloned snapshot scenes, so every shot
       object a running generation was started against stops being the shot
       that is in the board. It is found again by id when it lands, but a card
       the snapshot does not have cannot take a clip at all. */
    if (!SB.app.confirmLeavingJobs('Restoring a version')) return;
    freeze(p, 'before restoring ' + v.name);
    p.master = SB.clone(v.snapshot.master);
    p.scenes = SB.clone(v.snapshot.scenes);
    /* The snapshot's cast wins for the cards it belongs to — that is what
     * restoring means — but anything created since is kept rather than thrown
     * away. It simply arrives unused, sitting in the library where it was. */
    const was = SB.clone(v.snapshot.personas || []);
    const ids = {};
    was.forEach(function (x) { ids[x.id] = 1; });
    p.personas = was.concat((p.personas || []).filter(function (x) { return !ids[x.id]; }));
    p.scriptComments = SB.clone(v.snapshot.scriptComments || []);
    p.versionNumber = p.versions.reduce(function (a, x) { return Math.max(a, x.n); }, p.versionNumber) + 1;
    p.versionName = v.name + ' (restored)';
    /* The undo stack holds snapshots of the script we just replaced — a Ctrl+Z
     * after a restore would paste the old master text back under the restored
     * cards' link ranges. */
    SB.History.reset();
    SB.app.selectedShotId = null;
    SB.app.selection = [];
    SB.app.changed(true);
    /* A snapshot from before the cast froze with versions can name subjects
     * that are simply gone. Restoring used to drop them off the cards in
     * silence; counted here, the loss is at least visible. */
    let lost = 0;
    SB.Model.eachShot(p, function (sh) {
      (sh.personaIds || []).forEach(function (id) {
        if (!SB.Personas.find(p, id)) lost++;
      });
    });
    SB.toast('Restored ' + v.name +
      (lost ? ' — ' + lost + ' cast entr' + (lost === 1 ? 'y' : 'ies') +
        ' could not be found and are not on the cards' : ''), !!lost);
  }

  function viewComments(v) {
    const body = SB.el('div');
    let any = false;

    const notes = v.snapshot.scriptComments || [];
    if (notes.length) {
      any = true;
      const h = SB.el('div', 'ver-row');
      h.appendChild(SB.el('b', null, 'On the script'));
      body.appendChild(h);
      notes.forEach(function (c) {
        const r = SB.el('div', 'comment');
        r.appendChild(SB.el('span', 'when', SB.fmtDate(c.at)));
        const txt = SB.el('span', 'txt');
        txt.appendChild(SB.el('div', 'note-quote', '“' + (c.quote || '') + '”'));
        txt.appendChild(document.createTextNode(c.text));
        r.appendChild(txt);
        body.appendChild(r);
      });
    }
    (v.snapshot.scenes || []).forEach(function (sc, si) {
      sc.shots.forEach(function (sh, sj) {
        if (!(sh.comments || []).length && !sh.annotation) return;
        any = true;
        const h = SB.el('div', 'ver-row');
        h.appendChild(SB.el('b', null, SB.Model.code(si, sj) + ' · ' + (sc.heading || '')));
        if (sh.annotation) h.appendChild(SB.el('span', 'vmeta', ' (has ink)'));
        body.appendChild(h);
        (sh.comments || []).forEach(function (cm) {
          const r = SB.el('div', 'comment');
          r.appendChild(SB.el('span', 'when', SB.fmtDate(cm.at)));
          r.appendChild(SB.el('span', 'txt', cm.text));
          body.appendChild(r);
        });
      });
    });
    if (!any) body.appendChild(SB.el('div', 'vmeta', 'No comments or drawings in this version.'));
    SB.modal({ title: 'Comments in ' + v.name, body: body, buttons: [{ label: 'Close', primary: true }] });
  }

  function open() {
    const p = P();
    const body = SB.el('div');

    const cur = SB.el('div', 'ver-row current');
    const c = countComments(p);
    cur.appendChild(SB.el('span', 'vname', p.versionName + '  (working)'));
    cur.appendChild(SB.el('span', 'vmeta', c.comments + ' card · ' + c.script + ' script · ' + c.ink + ' inked'));
    const nv = SB.el('button', 'mini primary', 'New version…');
    nv.onclick = function () { m.close(); newVersion(); };
    cur.appendChild(nv);
    body.appendChild(cur);

    p.versions.slice().reverse().forEach(function (v) {
      const cc = countComments(v.snapshot);
      const row = SB.el('div', 'ver-row');
      row.appendChild(SB.el('span', 'vname', v.name));
      row.appendChild(SB.el('span', 'vmeta', SB.fmtDate(v.createdAt) + ' · ' +
        cc.comments + ' card · ' + cc.script + ' script · ' + cc.ink + ' inked'));
      const bc = SB.el('button', 'mini', 'comments');
      bc.onclick = function () { viewComments(v); };
      const br = SB.el('button', 'mini', 'restore');
      br.onclick = function () { m.close(); restore(v); };
      row.appendChild(bc); row.appendChild(br);
      body.appendChild(row);
    });

    if (!p.versions.length) body.appendChild(SB.el('div', 'vmeta', 'No earlier versions yet.'));

    const m = SB.modal({
      title: 'Versions', width: '560px', body: body,
      buttons: [{ label: 'Close', primary: true }]
    });
  }

  SB.Versions = { open: open, newVersion: newVersion };

})(window.SB);
