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
  let reported = false;
  function report() {
    if (reported) return;
    reported = true;
    document.getElementById('toastRoot').textContent =
      MARK + '>>' + out.join(' | ') + '<<' + MARK;
  }
  /* If a step never settles, still say how far it got — a silent hang is the
   * hardest kind of failure to diagnose from a DOM dump. */
  setTimeout(function () {
    if (!reported) {
      out.push('FAIL the run never finished — stopped after: ' +
        (out.length ? out[out.length - 1] : 'nothing'));
      report();
    }
  }, 35000);   /* headless runs on virtual time, which races ahead of the work */

  /* a board worth losing — the name and script carry the em-dashes and smart
   * quotes that real boards are full of, because a byte-vs-character bug only
   * shows up on text that is not plain ASCII */
  function seed() {
    const p = P();
    p.name = 'Acme onboarding — “final” cut';
    SB.Model.applyMasterEdit(p, 0, 0,
      'Wide of the office floor — the subject turns to camera. Then a close-up of the “laptop”. ' +
      'Café, naïve, résumé, 日本語, emoji 🎬 — all of it has to survive a round trip.', null);
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

      /* Save as… used to await a handle-remembering write to IndexedDB before
       * writing anything, and on file:// that promise never settles — so the
       * picked file stayed empty. Resolving at all, with content behind it, is
       * the proof; a wall-clock threshold means nothing under virtual time. */
      await SB.Store.saveAs(P());
      t('Save as… writes the file without waiting on IndexedDB',
        window.__disk.data.length > 400, window.__disk.data.length + ' bytes');
      await wait(900);
      const saved = window.__disk.data;
      t('a board saves to its file', saved.length > 400, saved.length);
      t('the saved file parses', (function () {
        try { JSON.parse(saved); return true; } catch (e) { return false; }
      })(), saved.slice(-80));

      /* The regression: a board full of em-dashes and smart quotes has more
         BYTES than characters, and the file must still be complete. */
      const enc = new TextEncoder();
      t('the file is not cut short on non-ASCII text',
        saved === SB.Store.serialize(P()).replace(/"updatedAt":\d+/, saved.match(/"updatedAt":\d+/)[0]),
        'on disk ' + enc.encode(saved).length + ' bytes / ' + saved.length + ' chars');
      const back = JSON.parse(saved);
      t('accents, smart quotes and emoji survive the write',
        back.name === P().name && /🎬/.test(back.master.text) && /日本語/.test(back.master.text),
        JSON.stringify(back.name));
      t('the whole board is there, not a prefix of it',
        back.scenes[0].shots.length === P().scenes[0].shots.length &&
        !!back.settings && !!back.personas,
        JSON.stringify(Object.keys(back)));

      /* ---- the report: change the writer model ---- */
      SB.PromptPanel.open();
      await wait(200);
      const sel = document.querySelector('#promptBody .gm-picker select');
      t('writer dropdown is there', !!sel, 'missing');
      sel.value = 'gemma-4-31b-it';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await SB.Store.saveNow();          // flush, rather than racing the debounce

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
      await SB.Store.saveNow();          // settle anything already queued
      const before = window.__disk.data;
      window.__failWrite = true;
      P().name = 'Acme onboarding v2';
      await SB.Store.saveNow();
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
      t('the failure modal can be dismissed', document.querySelectorAll('.modal').length === 0,
        document.querySelectorAll('.modal').length + ' still open');

      /* ---- and does autosave recover afterwards? ---- */
      window.__failWrite = false;
      P().name = 'Acme onboarding v3';
      SB.Store.touch();
      await SB.Store.saveNow();
      t('a save after a failure completes', true, '');
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
      SB.Store.S.getProject = function () { return null; };
      await SB.Store.saveNow();
      t('a missing project never overwrites the file', window.__disk.data === good, 'file changed');
      SB.Store.S.getProject = function () { return P(); };

      /* ---- an old inline-image file opens, shrinks, and still shows ---- */
      const frame = 'data:image/jpeg;base64,' + 'A'.repeat(50000);
      const legacy = {
        fileVersion: 1, name: 'Old board', master: { text: 'Wide of the office.', marks: {} },
        scenes: [{
          id: 'sc1', heading: 'One', description: '', shots: [
            { id: 's1', type: 'Wide', image: { data: frame, w: 854, h: 480 }, link: { from: 0, to: 19 } },
            { id: 's2', type: 'Close-up', image: { data: frame, w: 854, h: 480 } }
          ]
        }],
        personas: [{ id: 'p1', name: 'Lead', image: { data: frame, w: 854, h: 480 } }],
        versions: [{
          n: 1, name: 'v1', createdAt: 1, snapshot: {
            master: { text: 'Wide of the office.', marks: {} }, versionNumber: 1, versionName: 'v1',
            scenes: [{ id: 'sc1', shots: [{ id: 's1', image: { data: frame, w: 854, h: 480 } }] }]
          }
        }]
      };
      const legacyJson = JSON.stringify(legacy);
      window.__disk.data = legacyJson;
      const opened = await SB.Store.loadFromHandle(window.__handle, false);
      t('an old inline-image board still opens', !!opened && opened.scenes[0].shots.length === 2, '');
      t('its images became references',
        !!(opened.scenes[0].shots[0].image && opened.scenes[0].shots[0].image.ref), '');
      t('four copies of one frame became one blob',
        Object.keys(opened.blobs).length === 1, Object.keys(opened.blobs).length);
      const reserialised = SB.Store.serialize(opened);
      t('and the file shrinks by more than half',
        reserialised.length < legacyJson.length * 0.5,
        legacyJson.length + ' -> ' + reserialised.length);
      t('the picture still resolves for display',
        SB.Blobs.src(opened, opened.scenes[0].shots[0].image) === frame, '');
      t('the frozen version resolves too',
        SB.Blobs.src(opened, opened.versions[0].snapshot.scenes[0].shots[0].image) === frame, '');
      t('a re-opened migrated file is stable',
        (function () {
          const again = SB.Model.migrate(JSON.parse(reserialised));
          return Object.keys(again.blobs).length === 1 &&
            SB.Blobs.src(again, again.scenes[0].shots[0].image) === frame;
        })(), '');

      /* ---- the real Open… flow, on a board written by the first build ---- */
      const oldFrame = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
      window.__disk.data = JSON.stringify({
        fileVersion: 1, id: 'prj_v1', name: 'First build board',
        master: { text: 'Wide of the office. Then a close-up.', marks: { b: [], i: [], u: [] } },
        scenes: [{
          id: 'sc1', heading: 'Opening', description: '',
          shots: [
            { id: 's1', type: 'Wide', link: { from: 0, to: 19 }, broken: false,
              description: 'Open-plan office.', image: { data: oldFrame, w: 4, h: 3 },
              annotation: null, comments: [], prompts: {}, color: '#454c5c' },
            { id: 's2', type: 'Close-up', link: { from: 20, to: 36 }, broken: false,
              description: 'The laptop.', image: null, annotation: null,
              comments: [], prompts: {}, color: '#454c5c' }
          ]
        }],
        versionNumber: 1, versionName: 'v1', versions: [],
        settings: {
          shotTypes: ['Wide', 'Close-up'],
          models: [{ id: 'm1', name: 'Wan', kind: 'video', imageTemplate: 'I', videoTemplate: 'V' }],
          activeModelId: 'm1', geminiModel: 'gemini-2.5-flash',
          showImagePrompt: true, showVideoPrompt: true
        }
      });

      let openErr = '';
      document.getElementById('btnOpen').click();     // the button the user presses
      await wait(700);
      openErr = document.querySelectorAll('.modal h2').length
        ? document.querySelector('.modal h2').textContent : '';
      t('Open… on a first-build board raises no error', !openErr, openErr);
      t('the old board is now the open project', P().name === 'First build board', P().name);
      t('its shots are on screen',
        document.querySelectorAll('.card').length === 2,
        document.querySelectorAll('.card').length);
      t('its script windows still resolve',
        document.querySelector('.card .script-box').textContent === 'Wide of the office.',
        document.querySelector('.card .script-box').textContent);
      t('its image renders from the blob store',
        (document.querySelector('.card .frame img') || {}).src === oldFrame,
        (document.querySelector('.card .frame img') || {}).src);
      t('the file it is connected to is the one that was opened',
        SB.Store.S.fileName === 'board.storyboard', SB.Store.S.fileName);

      /* and editing it writes back to that same file */
      P().name = 'First build board (edited)';
      await SB.Store.saveNow();
      t('editing an old board saves back to its file',
        /First build board \(edited\)/.test(window.__disk.data), window.__disk.data.slice(0, 60));
      t('and the saved file is readable again',
        (function () {
          try { return SB.Model.migrate(JSON.parse(window.__disk.data)).scenes[0].shots.length === 2; }
          catch (e) { return false; }
        })(), '');

      /* ---- a file cut short can be rescued ---- */
      (function () {
        const whole = SB.Store.serialize(P());
        /* exactly the damage the truncate bug did: bytes lopped off the end */
        const cut = whole.slice(0, whole.length - 40);
        t('a truncated board does not parse', (function () {
          try { JSON.parse(cut); return false; } catch (e) { return true; }
        })(), '');
        const r = SB.Store.repairReport(cut);
        t('but it can be repaired', !!r, 'no repair possible');
        if (r) {
          const back = JSON.parse(r.text);
          t('the repair keeps the script', back.master.text === P().master.text, '');
          t('the repair keeps every shot',
            back.scenes[0].shots.length === P().scenes[0].shots.length,
            back.scenes[0].shots.length);
          t('the repair keeps the images',
            Object.keys(back.blobs || {}).length === Object.keys(P().blobs || {}).length, '');
          t('and it migrates into a working project',
            SB.Model.migrate(JSON.parse(r.text)).scenes[0].shots.length ===
            P().scenes[0].shots.length, '');
          t('the report says what was lost', r.lost > 0 && r.shots > 0,
            JSON.stringify({ lost: r.lost, shots: r.shots }));
        }
        /* a file that is genuinely rubbish is not "repaired" into nonsense */
        t('an empty file cannot be repaired', SB.Store.repair('') === null, '');
        t('a non-storyboard JSON file is not accepted',
          SB.Store.repair('{"hello":1,"there":2') === null, '');
        t('a whole file needs no repair, and is unchanged if asked',
          SB.Store.repair(whole) === null || JSON.parse(SB.Store.repair(whole)).scenes.length ===
          P().scenes.length, '');
      })();

      t('no page errors', (window.__err || []).length === 0, JSON.stringify(window.__err));
    } catch (e) {
      out.push('FAIL exception :: ' + (e && e.stack || e));
    }
    report();
  }, 500);
})();
