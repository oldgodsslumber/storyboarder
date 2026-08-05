/* headless UI scenario — injected by test-ui.mjs, not part of the app */
(function () {
  setTimeout(function () {
    const out = [];
    const t = function (name, cond, extra) {
      out.push((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' :: ' + extra));
    };
    try {
      const SB = window.SB, app = SB.app, P = function () { return app.project; };
      const TEXT = 'Wide of the office. Then a close-up of the laptop.';

      SB.Model.applyMasterEdit(P(), 0, 0, TEXT, null);
      app.scriptChanged();
      const master = document.getElementById('masterScript');
      t('master script renders', master.textContent === TEXT, JSON.stringify(master.textContent));

      const scId = P().scenes[0].id;
      const a = SB.Model.addShot(P(), scId, { type: 'Wide', link: { from: 0, to: 19 } });
      const b = SB.Model.addShot(P(), scId, { type: 'Close-up', link: { from: 15, to: 40 } });
      app.changed(true);
      t('cards rendered', document.querySelectorAll('.card').length === 3,
        document.querySelectorAll('.card').length);

      const elA = document.querySelector('.script-box[data-shot="' + a.id + '"]');
      const elB = document.querySelector('.script-box[data-shot="' + b.id + '"]');
      t('shot A window', elA.textContent === 'Wide of the office.', JSON.stringify(elA.textContent));
      t('shot B window', elB.textContent === 'ice. Then a close-up of t', JSON.stringify(elB.textContent));

      t('overlap highlighted', master.querySelectorAll('.h2').length > 0,
        master.innerHTML.slice(0, 200));
      t('single coverage highlighted', master.querySelectorAll('.h1').length > 0, '');

      // type at the trailing edge of shot A (which is interior to shot B)
      elA.focus();
      SB.Editor.setSel(elA, elA.textContent.length, elA.textContent.length);
      elA.dispatchEvent(new InputEvent('beforeinput',
        { inputType: 'insertText', data: '!!', bubbles: true, cancelable: true }));

      t('master took the edit', P().master.text.indexOf('office.!!') === 12, P().master.text);
      t('source shot grew', document.querySelector('.script-box[data-shot="' + a.id + '"]').textContent
        === 'Wide of the office.!!', JSON.stringify(elA.textContent));
      t('overlapping shot updated', document.querySelector('.script-box[data-shot="' + b.id + '"]').textContent
        === 'ice.!! Then a close-up of t', JSON.stringify(elB.textContent));

      // backspace in shot B, away from shot A's range
      elB.focus();
      SB.Editor.setSel(elB, elB.textContent.length, elB.textContent.length);
      elB.dispatchEvent(new InputEvent('beforeinput',
        { inputType: 'deleteContentBackward', bubbles: true, cancelable: true }));
      t('delete propagated', P().master.text.indexOf('close-up of he') > 0, P().master.text);
      t('untouched shot unchanged',
        document.querySelector('.script-box[data-shot="' + a.id + '"]').textContent === 'Wide of the office.!!', '');

      // bold through the shot window
      SB.Editor.setSel(elB, 0, 4);
      elB.dispatchEvent(new InputEvent('beforeinput',
        { inputType: 'formatBold', bubbles: true, cancelable: true }));
      t('bold mark stored on master', P().master.marks.b.length === 1, JSON.stringify(P().master.marks.b));
      t('bold rendered in master', master.querySelector('b') !== null, '');

      // break link
      SB.Model.breakLink(P(), b);
      app.changed(true);
      t('break link keeps text',
        document.querySelector('.script-box[data-shot="' + b.id + '"]').textContent === 'ice.!! Then a close-up of ',
        JSON.stringify(document.querySelector('.script-box[data-shot="' + b.id + '"]').textContent));
      t('freestanding badge', document.querySelector('.card[data-shot="' + b.id + '"] .link-dot.free') !== null, '');

      // no-shot exclusion + pdf
      a.noShot = true;
      app.changed(true);
      const pdfCells = SB.Pdf.cells();
      t('pdf excludes no-shot', pdfCells.every(function (c) { return c.code !== '1B'; }),
        JSON.stringify(pdfCells.map(function (c) { return c.code; })));
      t('pdf html builds', SB.Pdf.html().indexOf('<section class="page">') > 0, '');

      // the PDF sheet actually lays out — measured, not assumed
      (function () {
        var img16 = 'data:image/svg+xml;base64,' + btoa(
          '<svg xmlns="http://www.w3.org/2000/svg" width="854" height="480"><rect width="100%" height="100%" fill="#333"/></svg>');
        var imgTall = 'data:image/svg+xml;base64,' + btoa(
          '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="640"><rect width="100%" height="100%" fill="#333"/></svg>');
        var sc = P().scenes[0];
        sc.shots.forEach(function (sh, i) {
          sh.noShot = false;
          sh.image = SB.Blobs.image(P(), i % 2 ? imgTall : img16, 854, 480);
          sh.description = 'A description long enough to overflow its cell. '.repeat(6);
        });
        while (sc.shots.length < 7) {
          var extra = SB.Model.addShot(P(), sc.id, { type: 'Wide' });
          extra.image = SB.Blobs.image(P(), img16, 854, 480);
          extra.description = 'Another one. '.repeat(20);
        }
        SB.app.changed(true);

        var n = SB.Pdf.cells().length;
        var frame = document.createElement('iframe');
        frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:816px;height:1200px;border:0';
        document.body.appendChild(frame);
        var d = frame.contentDocument;
        d.open(); d.write(SB.Pdf.html()); d.close();

        var pages = d.querySelectorAll('.page');
        t('one sheet per six shots', pages.length === Math.ceil(n / 6),
          pages.length + ' sheets for ' + n + ' shots');

        var overflowing = 0;
        [].forEach.call(pages, function (pg) {
          if (pg.scrollHeight > Math.ceil(pg.getBoundingClientRect().height) + 1) overflowing++;
        });
        t('no sheet overflows onto another page', overflowing === 0, overflowing + ' overflowing');

        var cells = d.querySelectorAll('.cell');
        var badCell = 0, narrow = 0, bigImg = 0;
        [].forEach.call(cells, function (c) {
          var r = c.getBoundingClientRect();
          if (c.scrollHeight > Math.ceil(r.height) + 1) badCell++;
          if (r.width < 300) narrow++;                     // figure's default margin
          var im = c.querySelector('img'), fr = c.querySelector('.frame');
          if (im && fr && im.getBoundingClientRect().height >
            fr.getBoundingClientRect().height + 1) bigImg++;
        });
        t('no cell overflows its box', badCell === 0, badCell + ' of ' + cells.length);
        t('cells fill their column', narrow === 0, narrow + ' too narrow');
        t('no image escapes its frame', bigImg === 0, bigImg + ' oversized');

        var heights = {};
        [].forEach.call(d.querySelectorAll('.frame'), function (f) {
          heights[Math.round(f.getBoundingClientRect().height)] = 1;
        });
        t('every frame is the same height regardless of image shape or text',
          Object.keys(heights).length === 1, JSON.stringify(Object.keys(heights)));

        t('long text is clamped, not spilled',
          d.querySelector('.desc .clip') !== null &&
          getComputedStyle(d.querySelector('.desc .clip')).webkitLineClamp !== 'none',
          getComputedStyle(d.querySelector('.desc .clip')).webkitLineClamp);

        frame.remove();
        sc.shots.forEach(function (sh) { sh.image = null; sh.description = ''; });
        SB.app.changed(true);
      })();

      // prompt boxes stay off the cards until asked for
      t('prompt boxes hidden by default', document.querySelectorAll('.prompt-box').length === 0,
        document.querySelectorAll('.prompt-box').length);
      SB.PromptPanel.open();
      t('prompt panel opens', !document.getElementById('promptPanel').classList.contains('hidden'), '');
      const ppSel = document.querySelectorAll('#promptBody select');
      t('panel has image + video model pickers', ppSel.length >= 2, ppSel.length);
      t('image + video are separate models',
        P().settings.imageModelId !== P().settings.videoModelId,
        P().settings.imageModelId + ' / ' + P().settings.videoModelId);
      const showBoxes = document.querySelectorAll('#promptBody .pp-block')[2]
        .querySelectorAll('input[type=checkbox]');
      showBoxes[0].click(); showBoxes[1].click();
      t('toggling reveals both prompt boxes',
        document.querySelectorAll('.card:not(.noshot) .prompt-box').length ===
        document.querySelectorAll('.card:not(.noshot)').length * 2,
        document.querySelectorAll('.prompt-box').length + ' boxes on ' +
        document.querySelectorAll('.card:not(.noshot)').length + ' cards');
      const titles = Array.prototype.map.call(document.querySelectorAll('.prompt-box .ptitle span'),
        function (s) { return s.textContent; });
      t('each box names its own model',
        titles[0].indexOf(SB.Model.imageModel(P()).name) > 0 &&
        titles[1].indexOf(SB.Model.videoModel(P()).name) > 0, JSON.stringify(titles.slice(0, 2)));
      showBoxes[0].click(); showBoxes[1].click();

      // gemini model picker + free-call counter live in the panel
      const gmSel = document.querySelector('#promptBody .gm-picker select');
      t('gemini model is a dropdown', !!gmSel, 'missing');
      t('dropdown lists current models',
        gmSel.options.length === SB.GeminiModels.LIST.length + 1, gmSel.options.length);
      t('default selected', gmSel.value === SB.GeminiModels.DEFAULT, gmSel.value);
      t('custom escape hatch',
        gmSel.options[gmSel.options.length - 1].value === '__custom', '');
      gmSel.value = 'gemini-2.5-pro';
      gmSel.dispatchEvent(new Event('change', { bubbles: true }));
      t('picking a model sticks', P().settings.geminiModel === 'gemini-2.5-pro',
        P().settings.geminiModel);
      const usage = document.querySelector('#promptBody .pp-usage');
      t('free-call counter shown', /request/.test(usage.textContent), usage.textContent);
      SB.GeminiModels.setLimit('gemini-2.5-pro', 10);
      SB.GeminiModels.bump('gemini-2.5-pro');
      SB.PromptPanel.refreshUsage();
      t('counter tracks a limit', usage.textContent === '1 / 10 today · 9 left', usage.textContent);
      gmSel.value = SB.GeminiModels.DEFAULT;
      gmSel.dispatchEvent(new Event('change', { bubbles: true }));

      SB.PromptPanel.close();

      // personas
      t('no cast row until personas exist',
        document.querySelectorAll('.cast-row').length === 0, '');
      var per1 = SB.Personas.add(P(), { name: 'Ops lead', description: 'Charcoal knit.' });
      var per2 = SB.Personas.add(P(), { name: 'Technician', description: 'Navy work shirt.' });
      per1.image = SB.Blobs.image(P(), 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', 4, 3);
      SB.app.changed(true);
      t('every card gains a cast row',
        document.querySelectorAll('.cast-row').length === document.querySelectorAll('.card').length,
        document.querySelectorAll('.cast-row').length);
      SB.PersonaPanel.open();
      t('persona panel opens', !document.getElementById('personaPanel').classList.contains('hidden'), '');
      t('a card per persona', document.querySelectorAll('#personaBody .persona').length === 2,
        document.querySelectorAll('#personaBody .persona').length);
      t('description and image-prompt fields',
        document.querySelectorAll('#personaBody .persona')[0].querySelectorAll('textarea').length === 2, '');
      t('generate-from-script controls',
        /Generate/.test(document.querySelector('#personaBody .pp-actions').textContent), '');

      var castBtn = document.querySelector('.card .cast-row .cast-edit');
      castBtn.click();
      var castPop = document.querySelector('.cast-pop');
      t('cast picker lists the personas',
        castPop && castPop.querySelectorAll('input[type=checkbox]').length === 2,
        castPop ? castPop.querySelectorAll('input[type=checkbox]').length : 'none');
      castPop.querySelectorAll('input[type=checkbox]')[0].click();
      var firstShot = SB.Model.findShot(P(), document.querySelector('.card').dataset.shot).shot;
      t('casting a persona sticks', (firstShot.personaIds || []).length === 1, firstShot.personaIds);
      t('the chip shows on the card',
        /Ops lead/.test(document.querySelector('.card .cast-row').textContent), '');
      castPop.remove();

      var jobsCast = SB.Prompts.jobsFor(firstShot, SB.Model.imageModel(P()), SB.Model.videoModel(P()),
        { image: true });
      t('cast reaches the prompt request', /CAST/.test(jobsCast[0].system), '');
      t('and carries the wardrobe', /Charcoal knit/.test(jobsCast[0].system), '');
      t('and the reference-image numbering', /image 1 = Ops lead/.test(jobsCast[0].system), '');
      SB.PersonaPanel.close();

      // the house style actually rides along on the request
      var im = SB.Model.imageModel(P()), vm = SB.Model.videoModel(P());
      var jobs = SB.Prompts.jobsFor(P().scenes[0].shots[0], im, vm, { image: true, video: true });
      t('separate models -> two jobs', jobs.length === 2, jobs.length);
      t('image job carries the house style', /HOUSE STYLE/.test(jobs[0].system), '');
      t('image job carries scene context', /SCENE CONTEXT/.test(jobs[0].system), '');
      t('video job gets the motion rules', /MOTION/.test(jobs[1].system), '');
      t('image job does not', !/MOTION/.test(jobs[0].system), '');
      var same = SB.Prompts.jobsFor(P().scenes[0].shots[0], im, im, { image: true, video: true });
      t('one model -> one job with both rulesets',
        same.length === 1 && /MOTION/.test(same[0].system) && /HOUSE STYLE/.test(same[0].system), same.length);
      P().settings.brand.enabled = false;
      var offSys = SB.Prompts.jobsFor(P().scenes[0].shots[0], im, vm, { image: true })[0].system;
      t('switching the house style off drops it from the request',
        offSys.indexOf('HOUSE STYLE') < 0, offSys.slice(0, 40));
      t('but the cast still travels', /CAST/.test(offSys), '');
      P().settings.brand.enabled = true;

      // theme
      SB.Theme.set('light');
      t('light theme applied', document.documentElement.getAttribute('data-theme') === 'light', '');
      const lightBg = getComputedStyle(document.body).backgroundColor;
      SB.Theme.set('dark');
      t('theme actually changes colours',
        getComputedStyle(document.body).backgroundColor !== lightBg, lightBg);

      // colour palette
      document.querySelector('.card .swatch').click();
      const pop = document.querySelector('.pal-pop');
      t('palette popover', pop && pop.children.length === SB.Model.CARD_COLORS.length,
        pop ? pop.children.length : 'none');
      t('palette size is 8-10', SB.Model.CARD_COLORS.length >= 8 && SB.Model.CARD_COLORS.length <= 10,
        SB.Model.CARD_COLORS.length);
      pop.children[3].click();
      t('colour applied', P().scenes[0].shots[0].color === SB.Model.CARD_COLORS[3],
        P().scenes[0].shots[0].color);

      // settings tabs — selected by name, so adding a tab never breaks this
      SB.Settings.open();
      var tab = function (name) {
        var b = Array.prototype.filter.call(document.querySelectorAll('.modal .tab'),
          function (x) { return x.textContent === name; })[0];
        if (b) b.click();
        return !!b;
      };
      t('settings modal', document.querySelectorAll('.modal').length === 1, '');
      t('settings is tabbed', document.querySelectorAll('.modal .tab').length === 5,
        document.querySelectorAll('.modal .tab').length);
      t('templates are not on the first tab',
        document.querySelectorAll('.modal .tab-panel.on textarea').length === 1,
        document.querySelectorAll('.modal .tab-panel.on textarea').length);

      t('there is a card-fields tab', tab('Card fields'), '');
      t('it lists every field with a placeholder',
        document.querySelectorAll('.modal .tab-panel.on .field-row').length ===
        SB.Fields.all(P()).length,
        document.querySelectorAll('.modal .tab-panel.on .field-row').length);
      t('and shows the placeholder to use in a template',
        /\{\{ART_DIRECTION\}\}/.test(document.querySelector('.modal .tab-panel.on').textContent), '');
      var fieldsBefore = SB.Fields.all(P()).length;
      Array.prototype.filter.call(document.querySelectorAll('.modal .tab-panel.on .tb'),
        function (b) { return /Add a field/.test(b.textContent); })[0].click();
      t('a custom field can be added',
        SB.Fields.all(P()).length === fieldsBefore + 1, SB.Fields.all(P()).length);
      Array.prototype.filter.call(document.querySelectorAll('.modal .tab-panel.on .mini.danger'),
        function (b) { return /remove/.test(b.textContent); })[0].click();
      t('and removed again', SB.Fields.all(P()).length === fieldsBefore, SB.Fields.all(P()).length);

      tab('Brand style');
      t('brand tab holds the house style',
        /CONSTRAINTS[\s\S]*STYLE & TONE/.test(
          document.querySelector('.modal .tab-panel.on textarea').value), '');
      t('house style can be switched off',
        document.querySelectorAll('.modal .tab-panel.on input[type=checkbox]').length === 1, '');

      tab('Models & templates');
      t('models tab shows the model list',
        document.querySelectorAll('.modal .tab-panel.on .model-row').length ===
        P().settings.models.length,
        document.querySelectorAll('.modal .tab-panel.on .model-row').length +
        ' rows for ' + P().settings.models.length + ' models');
      t('Flux 3 is among them',
        P().settings.models.some(function (m) { return m.name === 'Flux 3'; }), '');
      t('templates collapsed until opened',
        document.querySelectorAll('.modal .tab-panel.on textarea').length === 0, '');
      tab('API');
      t('api tab has the model dropdown',
        document.querySelectorAll('.modal .tab-panel.on .gm-picker select').length === 1, '');
      t('api tab can refresh from the key',
        /Refresh list/.test(document.querySelector('.modal .tab-panel.on .pp-actions').textContent), '');
      tab('Models & templates');
      document.querySelectorAll('.modal .model-row .mini')[0].click();
      t('templates open per model',
        document.querySelectorAll('.modal .tab-panel.on textarea').length === 3,
        document.querySelectorAll('.modal .tab-panel.on textarea').length);
      document.querySelector('.modal .foot .tb').click();
      SB.Versions.open();
      t('versions modal', document.querySelectorAll('.modal').length === 1, '');
      document.querySelector('.modal .foot .tb').click();

      // drag/move + renumber
      const sc2 = SB.Model.addScene(P());
      SB.Model.moveShot(P(), b.id, sc2.id, 0);
      app.changed(true);
      t('moved shot renumbered', SB.Model.findShot(P(), b.id).code === '2A',
        SB.Model.findShot(P(), b.id).code);
      SB.Model.moveScene(P(), sc2.id, 0);
      app.changed(true);
      t('scene reorder renumbers', SB.Model.findShot(P(), b.id).code === '1A',
        SB.Model.findShot(P(), b.id).code);

      // moving a card between scenes — every target you might aim at
      (function () {
        var p = P();
        p.scenes.forEach(function (s) { s.shots = []; });
        var s1 = p.scenes[0];
        var s2 = SB.Model.addScene(p);
        var s3 = SB.Model.addScene(p);
        SB.Model.addShot(p, s3.id, { type: 'Insert' });
        SB.app.changed(true);

        function drop(fromShotId, toSel, label, targetScene) {
          var src = document.querySelector('.card[data-shot="' + fromShotId + '"] .card-head');
          var dst = document.querySelector(toSel);
          if (!src || !dst) { t(label, false, 'no ' + (src ? toSel : 'source')); return; }
          var dt = new DataTransfer();
          src.dispatchEvent(new DragEvent('dragstart',
            { dataTransfer: dt, bubbles: true, cancelable: true }));
          var over = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true });
          dst.dispatchEvent(over);
          dst.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
          var f = SB.Model.findShot(P(), fromShotId);
          t(label, !!over.defaultPrevented && f && f.scene.id === targetScene.id,
            'accepted=' + over.defaultPrevented + ' landed in ' +
            (f ? (f.scene.heading || f.sceneIdx) : 'nowhere'));
        }

        var c1 = SB.Model.addShot(p, s1.id, { type: 'Wide' });
        SB.app.changed(true);
        drop(c1.id, '.shots[data-scene="' + s2.id + '"]', 'drop on an empty scene’s shot row', s2);

        var c2 = SB.Model.addShot(p, s1.id, { type: 'Wide' });
        SB.app.changed(true);
        drop(c2.id, '.scene-block[data-scene="' + s3.id + '"] .card',
          'drop on a card in another scene', s3);

        var c3 = SB.Model.addShot(p, s1.id, { type: 'Wide' });
        SB.app.changed(true);
        drop(c3.id, '.scene-block[data-scene="' + s2.id + '"] .scene-head',
          'drop on another scene’s heading', s2);

        var c4 = SB.Model.addShot(p, s1.id, { type: 'Wide' });
        SB.app.changed(true);
        drop(c4.id, '.scene-item[data-scene="' + s2.id + '"]',
          'drop on a scene in the left-hand list', s2);

        var c5 = SB.Model.addShot(p, s1.id, { type: 'Wide' });
        SB.app.changed(true);
        drop(c5.id, '.shots[data-scene="' + s3.id + '"] .add-shot',
          'drop on another scene’s + Add shot', s3);

        t('scene drags still reorder scenes', (function () {
          var dt = new DataTransfer();
          var src = document.querySelector('.scene-item[data-scene="' + s3.id + '"]');
          var dst = document.querySelector('.scene-item[data-scene="' + s1.id + '"]');
          src.dispatchEvent(new DragEvent('dragstart',
            { dataTransfer: dt, bubbles: true, cancelable: true }));
          dst.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
          dst.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
          return P().scenes[0].id === s3.id;
        })(), P().scenes.map(function (s) { return s.heading; }).join(','));
      })();

      // per-project card fields
      t('no extra field boxes until switched on',
        document.querySelectorAll('.field-box').length === 0, '');
      SB.Fields.find(P(), 'artDirection').enabled = true;
      SB.Fields.find(P(), 'sfx').enabled = true;
      SB.app.changed(true);
      var cards = document.querySelectorAll('.card').length;
      t('switching two on adds two boxes per card',
        document.querySelectorAll('.field-box').length === cards * 2,
        document.querySelectorAll('.field-box').length + ' on ' + cards + ' cards');
      t('each box is labelled',
        /Art direction/.test(document.querySelector('.card').textContent) &&
        /SFX/.test(document.querySelector('.card').textContent), '');
      var fbox = document.querySelector('.card .field-box[data-field="artDirection"]');
      fbox.value = 'Warm practicals only.';
      fbox.dispatchEvent(new Event('input', { bubbles: true }));
      var firstShot2 = SB.Model.findShot(P(), document.querySelector('.card').dataset.shot).shot;
      t('typing in one stores it on the shot',
        SB.Fields.value(firstShot2, 'artDirection') === 'Warm practicals only.',
        JSON.stringify(firstShot2.fields));
      firstShot2.description = 'A description so the job builds.';
      var fjobs = SB.Prompts.jobsFor(firstShot2, SB.Model.imageModel(P()), null, { image: true });
      t('the field reaches the prompt request',
        /Warm practicals only\./.test(fjobs[0].text), '');
      SB.Fields.find(P(), 'artDirection').enabled = false;
      SB.Fields.find(P(), 'sfx').enabled = false;
      SB.app.changed(true);
      t('switching them off clears the boxes',
        document.querySelectorAll('.field-box').length === 0, '');
      t('but the text is kept', SB.Fields.value(firstShot2, 'artDirection') === 'Warm practicals only.', '');

      // turning a field on must not move the board under you
      (function () {
        const panel = document.getElementById('boardPanel');
        const sc = P().scenes[0];
        while (sc.shots.length < 10) SB.Model.addShot(P(), sc.id, { type: 'Wide' });
        SB.app.changed(true);

        panel.scrollTop = Math.floor(panel.scrollHeight / 2);
        const before = panel.scrollTop;
        t('the board is long enough to scroll', before > 40, 'scrollTop ' + before);

        const cards = document.querySelectorAll('#board .card');
        const top = panel.getBoundingClientRect().top;
        let watched = null;
        for (let i = 0; i < cards.length; i++) {
          if (cards[i].getBoundingClientRect().bottom > top + 4) { watched = cards[i]; break; }
        }
        const id = watched.dataset.shot;
        const wasAt = watched.getBoundingClientRect().top;

        SB.Fields.find(P(), 'artDirection').enabled = true;
        SB.app.changed(true);
        const after = document.querySelector('.card[data-shot="' + id + '"]');
        t('adding a field leaves the card you were looking at where it was',
          !!after && Math.abs(after.getBoundingClientRect().top - wasAt) <= 2,
          after ? (wasAt + ' -> ' + after.getBoundingClientRect().top) : 'card gone');
        t('and the board did not jump to the top', panel.scrollTop > 40, panel.scrollTop);

        const wasAt2 = after.getBoundingClientRect().top;
        SB.Fields.find(P(), 'artDirection').enabled = false;
        SB.app.changed(true);
        const after2 = document.querySelector('.card[data-shot="' + id + '"]');
        t('removing a field does not move it either',
          !!after2 && Math.abs(after2.getBoundingClientRect().top - wasAt2) <= 2,
          after2 ? (wasAt2 + ' -> ' + after2.getBoundingClientRect().top) : 'card gone');

        /* the same protection for anything else that rebuilds the board */
        const wasAt3 = after2.getBoundingClientRect().top;
        P().settings.showImagePrompt = true;
        SB.app.changed(true);
        const after3 = document.querySelector('.card[data-shot="' + id + '"]');
        t('showing the prompt boxes holds your place too',
          !!after3 && Math.abs(after3.getBoundingClientRect().top - wasAt3) <= 2,
          after3 ? (wasAt3 + ' -> ' + after3.getBoundingClientRect().top) : 'card gone');
        P().settings.showImagePrompt = false;
        panel.scrollTop = 0;
        SB.app.changed(true);
      })();

      // card colour covers the whole card
      var cardEl = document.querySelector('.card');
      SB.app.changed(true);
      cardEl = document.querySelector('.card');
      t('the card carries its colour as a variable',
        !!cardEl.style.getPropertyValue('--card-color'), cardEl.style.cssText);
      t('the whole card is tinted, not just an edge',
        getComputedStyle(cardEl).backgroundColor !== getComputedStyle(document.body).backgroundColor,
        getComputedStyle(cardEl).backgroundColor);

      // data tracker
      SB.UsagePanel.refreshBadge();
      var badge = document.getElementById('sizeState');
      t('the top bar shows the board size', /KB|MB|B$/.test(badge.textContent), badge.textContent);
      var m0 = SB.Usage.measure(P());
      var bigJpg = 'data:image/jpeg;base64,' + 'A'.repeat(30000);
      P().scenes[0].shots[0].image = SB.Blobs.image(P(), bigJpg, 8, 6);
      var m1 = SB.Usage.measure(P());
      t('adding a frame is reflected in the measurement', m1.total > m0.total + 29000,
        m1.total - m0.total);
      t('the breakdown adds up to the file', m1.sections.reduce(function (n, s) { return n + s.b; }, 0)
        === m1.total, 'off by ' + (m1.total - m1.sections.reduce(function (n, s) { return n + s.b; }, 0)));
      SB.UsagePanel.open();
      t('the data panel opens', document.querySelectorAll('.usage').length === 1, '');
      t('a segment per section',
        document.querySelectorAll('.usage-seg').length === m1.sections.length,
        document.querySelectorAll('.usage-seg').length + ' vs ' + m1.sections.length);
      t('every section is also written out as text, not colour alone',
        document.querySelectorAll('.usage-table tr').length === m1.sections.length + 1, '');
      t('the Firebase verdict is shown',
        document.querySelectorAll('.usage-check').length === 5, '');
      t('it names the 1 MiB document ceiling',
        /1 MiB/.test(document.querySelector('.usage-checks').textContent), '');
      document.querySelector('.modal .foot .tb.on').click();

      // the same picture on a second shot costs nothing
      var beforeDup = SB.Usage.measure(P()).total;
      P().scenes[0].shots[1].image = SB.Blobs.image(P(), bigJpg, 8, 6);
      var afterDup = SB.Usage.measure(P()).total;
      t('reusing a picture adds almost nothing', afterDup - beforeDup < 200,
        'grew by ' + (afterDup - beforeDup));
      t('and both shots point at the same blob',
        P().scenes[0].shots[0].image.ref === P().scenes[0].shots[1].image.ref, '');
      t('the dedupe saving is reported', SB.Usage.measure(P()).dedupe.saved > 29000,
        SB.Usage.measure(P()).dedupe.saved);
      P().scenes[0].shots[1].image = null;
      SB.app.changed(true);

      // comment mode
      app.commentMode = true;
      SB.Board.render();
      t('comment inputs appear', document.querySelectorAll('.comment-add').length === document.querySelectorAll('.card').length,
        document.querySelectorAll('.comment-add').length);
    } catch (e) {
      out.push('FAIL exception :: ' + (e && e.stack || e));
    }
    document.getElementById('toastRoot').textContent =
      'RESULT>>' + out.join(' | ') + '<<RESULT ERRORS:' + JSON.stringify(window.__err || []);
  }, 400);
})();
