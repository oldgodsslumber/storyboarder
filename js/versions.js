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
    return { comments: n, ink: ink };
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
    SB.app.changed(true);
    SB.toast('Now working in ' + p.versionName + ' — comments and ink start clean');
  }

  function restore(v) {
    const p = P();
    if (!confirm('Restore "' + v.name + '"?\n\nThe current state is saved as a version first, so nothing is lost.')) return;
    freeze(p, 'before restoring ' + v.name);
    p.master = SB.clone(v.snapshot.master);
    p.scenes = SB.clone(v.snapshot.scenes);
    p.versionNumber = p.versions.reduce(function (a, x) { return Math.max(a, x.n); }, p.versionNumber) + 1;
    p.versionName = v.name + ' (restored)';
    SB.app.selectedShotId = null;
    SB.app.changed(true);
    SB.toast('Restored ' + v.name);
  }

  function viewComments(v) {
    const body = SB.el('div');
    let any = false;
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
    cur.appendChild(SB.el('span', 'vmeta', c.comments + ' comments · ' + c.ink + ' inked'));
    const nv = SB.el('button', 'mini primary', 'New version…');
    nv.onclick = function () { m.close(); newVersion(); };
    cur.appendChild(nv);
    body.appendChild(cur);

    p.versions.slice().reverse().forEach(function (v) {
      const cc = countComments(v.snapshot);
      const row = SB.el('div', 'ver-row');
      row.appendChild(SB.el('span', 'vname', v.name));
      row.appendChild(SB.el('span', 'vmeta', SB.fmtDate(v.createdAt) + ' · ' +
        cc.comments + ' comments · ' + cc.ink + ' inked'));
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
