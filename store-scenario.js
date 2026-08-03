/* store-scenario.js — driven by test-store.mjs against the fake disk. */
(function () {
  const out = [];
  const t = function (name, cond, extra) {
    out.push((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' :: ' + extra));
  };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const SB = window.SB;
  const P = () => SB.app.project;

  /* built at runtime so the marker never appears in this file's own source,
     which is visible in the DOM dump the runner reads */
  const MARK = 'RES' + 'ULT';
  function report() {
    document.getElementById('toastRoot').textContent =
      MARK + '>>' + out.join(' | ') + '<<' + MARK;
  }

  /* a board worth losing */
  function seed() {
    const p = P();
    p.name = 'Acme onboarding';
    SB.Model.applyMasterEdit(p, 0, 0,
      'Wide of the office floor. The subject turns to camera. Then a close-up of the laptop.', null);
    const sc = p.scenes[0];
    sc.heading = 'Opening';
    sc.shots = [];
    const a = SB.Model.addShot(p, sc.id, { type: 'Wide', link: { from: 0, to: 30 } });
    const b = SB.Model.addShot(p, sc.id, { type: 'Close-up', link: { from: 31, to: 60 } });
    a.description = 'Open-plan office, morning light.';
    b.description = 'Hands on a laptop.';
    SB.Personas.add(p, { name: 'Ops lead', description: 'Charcoal knit.' });
    SB.app.changed(true);
  }

  setTimeout(async function () {
    try {
      seed();
      /* This page is file://, where IndexedDB hangs instead of failing — the
         exact context the app runs in. Save-as must not depend on it. */
      const t0 = Date.now();
      const remembered = await SB.Store.lastHandle();
      t('lastHandle resolves on file:// instead of hanging forever',
        Date.now() - t0 < 5000 && remembered === null,
        (Date.now() - t0) + 'ms / ' + remembered);

      const t1 = Date.now();
      await SB.Store.saveAs(P());
      t('Save as… writes the file without waiting on IndexedDB',
        Date.now() - t1 < 5000, (Date.now() - t1) + 'ms');
      await wait(900);
      const saved = window.__disk.data;
      t('a board saves to its file', saved.length > 400, saved.length);
      t('the saved file parses', (function () {
        try { JSON.parse(saved); return true; } catch (e) { return false; }
      })(), saved.slice(0, 60));

      /* ---- the report: change the writer model ---- */
      SB.PromptPanel.open();
      await wait(200);
      const sel = document.querySelector('#promptBody .gm-picker select');
      t('writer dropdown is there', !!sel, 'missing');
      sel.value = 'gemma-4-31b-it';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(1200);

      t('model change stuck', P().settings.geminiModel === 'gemma-4-31b-it', P().settings.geminiModel);
      const afterModel = window.__disk.data;
      t('the file still has content after changing the model', afterModel.length > 400, afterModel.length);
      let parsed = null;
      try { parsed = JSON.parse(afterModel); } catch (e) { }
      t('the file still parses after changing the model', !!parsed, afterModel.slice(0, 80));
      t('the board is still in there',
        !!parsed && parsed.scenes && parsed.scenes[0].shots.length === 2,
        parsed ? JSON.stringify(parsed.scenes && parsed.scenes[0] && parsed.scenes[0].shots.length) : 'unparsable');
      t('the master script survived',
        !!parsed && /Wide of the office floor/.test(parsed.master.text), '');
      t('personas survived', !!parsed && parsed.personas && parsed.personas.length === 1,
        parsed ? JSON.stringify(parsed.personas) : '');

      /* ---- can the app read back what it just wrote? ---- */
      let reopened = null, reopenErr = '';
      try { reopened = SB.Model.migrate(JSON.parse(window.__disk.data)); }
      catch (e) { reopenErr = e.message; }
      t('the app can reopen its own file', !!reopened, reopenErr);
      t('reopened board still has its shots',
        !!reopened && reopened.scenes[0].shots.length === 2,
        reopened ? reopened.scenes[0].shots.length : '-');
      t('reopened board keeps the chosen writer model',
        !!reopened && reopened.settings.geminiModel === 'gemma-4-31b-it',
        reopened ? reopened.settings.geminiModel : '-');

      /* ---- what a failed write does to the file ---- */
      const before = window.__disk.data;
      window.__failWrite = true;
      P().name = 'Acme onboarding v2';
      SB.Store.touch();
      await wait(1200);
      t('a failed write does not leave the file empty', window.__disk.data.length > 400,
        'file is now ' + window.__disk.data.length + ' bytes');
      t('a failed write leaves the previous board intact',
        window.__disk.data === before, window.__disk.data.slice(0, 40));
      t('a failed write is reported, not swallowed',
        document.querySelectorAll('.modal').length === 1 &&
        /Save failed/.test(document.querySelector('.modal h2').textContent),
        document.querySelectorAll('.modal').length);
      t('and it offers a rescue copy',
        /Download a copy/.test(document.querySelector('.modal .foot').textContent), '');
      document.querySelectorAll('.modal .foot .tb')[2].click();   // dismiss

      /* ---- and does autosave recover afterwards? ---- */
      window.__failWrite = false;
      P().name = 'Acme onboarding v3';
      SB.Store.touch();
      await wait(1200);
      t('autosave still works after a failed write',
        /v3/.test(window.__disk.data), window.__disk.data.slice(0, 60));

      /* ---- a corrupt file must not look like "no file" ---- */
      window.__disk.data = '';
      let loadErr = '';
      try { await SB.Store.loadFromHandle(window.__handle, false); }
      catch (e) { loadErr = e.message || String(e); }
      t('opening an empty file reports an error', !!loadErr, 'it resolved silently');

      /* ---- an unwritable board can still be rescued ---- */
      let dl = null;
      const realClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { dl = this.download; };
      SB.Store.downloadCopy(P(), 'rescue');
      HTMLAnchorElement.prototype.click = realClick;
      t('a copy can always be downloaded', /rescue\.storyboard$/.test(dl || ''), dl);

      /* ---- refuse to write a nonsense project over a real one ---- */
      const good = window.__disk.data;
      const realSerialize = SB.Store.serialize;
      SB.Store.S.getProject = function () { return null; };
      SB.Store.touch();
      await wait(900);
      t('a missing project never overwrites the file', window.__disk.data === good, 'file changed');
      SB.Store.S.getProject = function () { return P(); };

      t('no page errors', (window.__err || []).length === 0, JSON.stringify(window.__err));
    } catch (e) {
      out.push('FAIL exception :: ' + (e && e.stack || e));
    }
    report();
  }, 500);
})();
