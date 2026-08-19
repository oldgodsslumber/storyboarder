/* headless UI scenario — injected by test-ui.mjs, not part of the app */
(function () {
  setTimeout(async function () {
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

      // the PDF sheets actually lay out — measured, not assumed, for every preset
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
        sc.description = 'The opening scene, described.';
        // a second scene, so scene banners and scene page breaks have something to do
        var sc2 = SB.Model.addScene(P());
        sc2.heading = 'Scene two — the rooftop';
        sc2.description = 'A long scene description that has to fit inside its band. '.repeat(4);
        for (var k = 0; k < 3; k++) {
          var s2 = SB.Model.addShot(P(), sc2.id, { type: 'Close' });
          s2.image = SB.Blobs.image(P(), img16, 854, 480);
          s2.description = 'Rooftop beat. '.repeat(12);
        }
        // give two cards different colours so the accent ink has something to differ on
        sc.shots[0].color = SB.Model.CARD_COLORS[1];
        sc2.shots[0].color = SB.Model.CARD_COLORS[7];
        SB.app.changed(true);

        var MM = 96 / 25.4;

        /* Render a sheet document offscreen at the preset's true size and hand
         * back its document. `silent` keeps it from calling window.print(). */
        function render(o) {
          var info = SB.Pdf.layout(o);
          var wide = info.preset.orient === 'landscape';
          var frame = document.createElement('iframe');
          frame.style.cssText = 'position:fixed;left:-10000px;top:0;border:0;width:' +
            Math.round((wide ? 255 : 186) * MM + 80) + 'px;height:' +
            Math.round((wide ? 186 : 251) * MM + 200) + 'px';
          document.body.appendChild(frame);
          var d = frame.contentDocument;
          o.silent = true;
          d.open(); d.write(SB.Pdf.html(o)); d.close();
          return { doc: d, frame: frame, info: info };
        }

        /* The geometry guarantees, checked per sheet rather than per document:
         * a card must not overflow its own box, must fill its share of the
         * width, must contain its image, and every frame on one sheet must
         * agree on a height whatever shape the picture or length the text. */
        function measure(name, r, opts) {
          opts = opts || {};
          var d = r.doc, pr = r.info.preset;
          var pages = d.querySelectorAll('.page');
          var overflowing = 0;
          [].forEach.call(pages, function (pg) {
            if (pg.scrollHeight > Math.ceil(pg.getBoundingClientRect().height) + 1) overflowing++;
          });
          t(name + ': no sheet overflows onto another page', overflowing === 0,
            overflowing + ' of ' + pages.length + ' overflowing');

          var pageW = (pr.orient === 'landscape' ? 255 : 186) * MM;
          var want = (pageW - 5 * MM * (pr.cols - 1)) / pr.cols;
          var cells = d.querySelectorAll('.cell');
          var badCell = 0, narrow = 0, bigImg = 0;
          [].forEach.call(cells, function (c) {
            var rect = c.getBoundingClientRect();
            if (c.scrollHeight > Math.ceil(rect.height) + 1) badCell++;
            if (rect.width < want - 4) narrow++;             // figure's default margin
            var im = c.querySelector('img'), fr = c.querySelector('.frame');
            if (im && fr && im.getBoundingClientRect().height >
              fr.getBoundingClientRect().height + 1) bigImg++;
          });
          t(name + ': no cell overflows its box', badCell === 0, badCell + ' of ' + cells.length);
          t(name + ': cells fill their column', narrow === 0,
            narrow + ' narrower than ' + Math.round(want) + 'px');
          t(name + ': no image escapes its frame', bigImg === 0, bigImg + ' oversized');

          /* A 'fill' frame is elastic on purpose — it takes whatever the words
           * leave — so only the fixed-frame presets owe a uniform height. */
          if (pr.frame !== 'fill') {
            var uneven = 0;
            [].forEach.call(pages, function (pg) {
              var hs = {};
              [].forEach.call(pg.querySelectorAll('.frame'), function (f) {
                hs[Math.round(f.getBoundingClientRect().height)] = 1;
              });
              if (Object.keys(hs).length > 1) uneven++;
            });
            t(name + ': every frame on a sheet is the same height', uneven === 0,
              uneven + ' uneven sheets');
          }
          if (opts.after) opts.after(d, r.info);
          r.frame.remove();
        }

        var n = SB.Pdf.cells().length;
        SB.Pdf.PRESETS.forEach(function (pr) {
          var r = render({ preset: pr.id });
          var perPage = pr.cols * pr.rows;
          t(pr.id + ': one sheet per ' + perPage + ' cards',
            r.doc.querySelectorAll('.page').length === Math.ceil(n / perPage),
            r.doc.querySelectorAll('.page').length + ' sheets for ' + n + ' cards');
          t(pr.id + ': asks the print dialog for ' + pr.orient,
            SB.Pdf.html({ preset: pr.id, silent: true }).indexOf('size:' + pr.orient) > 0, '');
          measure(pr.id, r, {
            after: function (d) {
              if (!pr.desc) return;                          // 0 means print the lot
              var clip = d.querySelector('.desc .clip');
              t(pr.id + ': long text is clamped, not spilled',
                clip !== null && getComputedStyle(clip).webkitLineClamp !== 'none',
                clip ? getComputedStyle(clip).webkitLineClamp : 'no .desc');
            }
          });
        });

        // scene page breaks: a sheet may never mix two scenes
        (function () {
          var r = render({ preset: 'sheet6', scenePageBreak: true });
          var codes = SB.Pdf.cells();
          var mixed = 0;
          [].forEach.call(r.doc.querySelectorAll('.page'), function (pg) {
            var scenes = {};
            [].forEach.call(pg.querySelectorAll('.cell .code'), function (el) {
              var c = codes.filter(function (x) { return x.code === el.textContent; })[0];
              if (c) scenes[c.sceneIdx] = 1;
            });
            if (Object.keys(scenes).length > 1) mixed++;
          });
          t('scene page break: no sheet mixes two scenes', mixed === 0, mixed + ' mixed sheets');
          measure('scene page break', r);
        })();

        // scene banners: one per scene, and the sheet still fits
        (function () {
          var r = render({ preset: 'sheet6', sceneBanner: true });
          var bands = r.doc.querySelectorAll('.banner');
          t('scene banner: one band per scene', bands.length === P().scenes.length,
            bands.length + ' bands for ' + P().scenes.length + ' scenes');
          t('scene banner: carries the scene description',
            bands.length > 0 && bands[0].querySelector('.bd') !== null, '');
          measure('scene banner', r);
        })();

        // a 1-up sheet has no room for a band beside a card, so it gets its own
        (function () {
          var r = render({ preset: 'show1', sceneBanner: true });
          var lone = 0;
          [].forEach.call(r.doc.querySelectorAll('.page'), function (pg) {
            if (pg.querySelector('.banner') && !pg.querySelector('.cell')) lone++;
          });
          t('1-up banner becomes its own title sheet', lone === P().scenes.length,
            lone + ' title sheets');
          measure('1-up banner', r);
        })();

        // every content box can be switched off, and the card still fills its space
        (function () {
          var r = render({
            preset: 'sheet6', showType: false, showScript: false,
            showDesc: false, showSceneHeading: false, footer: false
          });
          var d = r.doc;
          t('toggles off: no script box', d.querySelector('.script') === null, '');
          t('toggles off: no description box', d.querySelector('.desc') === null, '');
          t('toggles off: no shot type', d.querySelector('.type') === null, '');
          t('toggles off: no footer', d.querySelector('footer') === null, '');
          t('toggles off: the code still prints', d.querySelector('.code') !== null, '');
          measure('toggles off', r);

          // with description off the script must take the leftover height
          var r2 = render({ preset: 'sheet6', showDesc: false });
          var grown = r2.doc.querySelector('.script.grow');
          t('script takes the leftover height when description is off', grown !== null, '');
          measure('description off', r2);
        })();

        // card colour reaches the paper, and two colours read differently
        (function () {
          var on = render({ preset: 'sheet6', color: 'accent' });
          var stripes = on.doc.querySelectorAll('.cell .stripe');
          var seen = {};
          [].forEach.call(stripes, function (s) { seen[s.style.background] = 1; });
          t('accent ink: every card carries its colour', stripes.length > 0,
            stripes.length + ' stripes');
          t('accent ink: different card colours print differently',
            Object.keys(seen).length > 1, JSON.stringify(Object.keys(seen)));
          t('accent ink: the border is tinted, not raw',
            on.doc.querySelector('.cell').style.borderColor !== '', '');
          on.frame.remove();

          var off = render({ preset: 'sheet6', color: 'off' });
          t('plain ink: no colour reaches the sheet',
            off.doc.querySelector('.stripe') === null &&
            off.doc.querySelector('.cell').style.borderColor === '', '');
          off.frame.remove();
        })();

        // the options a board prints with survive a save/load round trip
        (function () {
          P().settings.export.preset = 'wide6';
          P().settings.export.sceneBanner = true;
          var back = SB.Model.migrate(JSON.parse(JSON.stringify(P())));
          t('export options survive a round trip',
            back.settings.export.preset === 'wide6' && back.settings.export.sceneBanner === true,
            JSON.stringify(back.settings.export));
          // and an older file with no export block gets the defaults
          var older = JSON.parse(JSON.stringify(P()));
          delete older.settings.export;
          var fixed = SB.Model.migrate(older);
          t('a file with no export block gets the defaults',
            fixed.settings.export.preset === 'sheet6' && fixed.settings.export.footer === true,
            JSON.stringify(fixed.settings.export));
          P().settings.export = SB.Model.defaultExport();
        })();

        SB.Model.deleteScene(P(), sc2.id);
        sc.shots.forEach(function (sh) { sh.image = null; sh.description = ''; });
        SB.app.changed(true);
      })();

      // the export dialog drives the real sheet and remembers what was chosen
      (function () {
        document.getElementById('btnPdf').click();
        var back = document.querySelector('.modal-back');
        t('the PDF button opens the export dialog', back !== null, '');
        var sel = back.querySelector('.xp-left select');
        t('the dialog offers every preset',
          sel && sel.options.length === SB.Pdf.PRESETS.length,
          sel ? sel.options.length : 'no picker');
        var boxes = back.querySelectorAll('.xp-left .pp-toggle input');
        t('the dialog opens showing what the board already prints',
          boxes.length === 7 && [].every.call(boxes, function (b, i) {
            return b.checked === (i < 4 || i === 6);      // the two scene options start off
          }),
          [].map.call(boxes, function (b) { return b.checked; }).join(','));
        var pv = back.querySelector('.xp-frame');
        t('the dialog previews an actual sheet',
          pv.contentDocument.querySelector('.page') !== null, '');
        /* the preview must never reach for the print dialog */
        t('previewing does not start a print',
          pv.contentDocument.documentElement.innerHTML.indexOf('window.print') < 0, '');

        sel.value = 'wide3';
        sel.onchange();
        t('the preview follows the preset',
          pv.contentDocument.querySelector('.grid').style.length === 0 &&
          getComputedStyle(pv.contentDocument.querySelector('.grid')).gridTemplateColumns
            .split(' ').length === 3,
          getComputedStyle(pv.contentDocument.querySelector('.grid')).gridTemplateColumns);
        t('the sheet count is reported',
          /\d+ shots? → \d+ sheets?/.test(back.querySelector('.xp-count').textContent),
          back.querySelector('.xp-count').textContent);

        // Cancel has to leave the project exactly as it was
        var was = JSON.stringify(P().settings.export);
        [].filter.call(back.querySelectorAll('.foot .tb'), function (b) {
          return b.textContent === 'Cancel';
        })[0].click();
        t('Cancel discards the choices', JSON.stringify(P().settings.export) === was,
          JSON.stringify(P().settings.export));
        t('Cancel closes the dialog', document.querySelector('.modal-back') === null, '');

        // Export commits them, and hands them to the sheet
        var realExport = SB.Pdf.exportPdf, handed = null;
        SB.Pdf.exportPdf = function (o) { handed = o; };
        document.getElementById('btnPdf').click();
        var back2 = document.querySelector('.modal-back');
        back2.querySelector('.xp-left select').value = 'notes4';
        back2.querySelector('.xp-left select').onchange();
        [].filter.call(back2.querySelectorAll('.foot .tb'), function (b) {
          return b.textContent === 'Export';
        })[0].click();
        SB.Pdf.exportPdf = realExport;
        t('Export remembers the layout on the board', P().settings.export.preset === 'notes4',
          P().settings.export.preset);
        t('Export prints with what was chosen', handed && handed.preset === 'notes4',
          JSON.stringify(handed));
        t('nothing but the options is stored', handed && handed.silent === undefined,
          JSON.stringify(handed));
        P().settings.export = SB.Model.defaultExport();
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
      /* The tab edits a draft — the project only changes on Save, so Cancel
       * cannot leave a field renamed or a card's text deleted behind it. */
      var rows = function () {
        return document.querySelectorAll('.modal .tab-panel.on .field-row').length;
      };
      var fieldsBefore = SB.Fields.all(P()).length;
      var rowsBefore = rows();
      Array.prototype.filter.call(document.querySelectorAll('.modal .tab-panel.on .tb'),
        function (b) { return /Add a field/.test(b.textContent); })[0].click();
      t('a custom field can be added', rows() === rowsBefore + 1, rows());
      t('but the project is untouched until Save',
        SB.Fields.all(P()).length === fieldsBefore, SB.Fields.all(P()).length);
      Array.prototype.filter.call(document.querySelectorAll('.modal .tab-panel.on .mini.danger'),
        function (b) { return /remove/.test(b.textContent); })[0].click();
      t('and removed again', rows() === rowsBefore, rows());

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

      // selecting several cards, and carving a scene out of them
      (function () {
        const p = P();
        p.scenes.forEach(function (s) { s.shots = []; });
        while (p.scenes.length > 1) p.scenes.pop();
        const sc = p.scenes[0];
        sc.heading = 'Sequence';
        const ids = [];
        for (let i = 0; i < 6; i++) {
          const s = SB.Model.addShot(p, sc.id, { type: 'Wide' });
          s.description = 'cut ' + (i + 1);
          ids.push(s.id);
        }
        SB.app.changed(true);

        const cardOf = function (id) { return document.querySelector('.card[data-shot="' + id + '"]'); };
        const down = function (id, opts) {
          cardOf(id).querySelector('.frame')
            .dispatchEvent(new MouseEvent('mousedown', Object.assign({ bubbles: true }, opts || {})));
        };

        down(ids[1]);
        t('clicking a card selects just it', SB.Board.selection().join() === ids[1],
          SB.Board.selection().join());

        down(ids[3], { ctrlKey: true });
        t('ctrl-click adds to the selection',
          SB.Board.selection().length === 2 && SB.Board.selection().indexOf(ids[3]) >= 0,
          SB.Board.selection().join());
        down(ids[3], { ctrlKey: true });
        t('ctrl-clicking again removes it', SB.Board.selection().length === 1,
          SB.Board.selection().join());

        down(ids[4], { shiftKey: true });
        t('shift-click takes the run between them',
          SB.Board.selection().length === 4 &&
          SB.Board.selection()[0] === ids[1] && SB.Board.selection()[3] === ids[4],
          SB.Board.selection().length + ' picked');
        t('every one of them is marked on the board',
          document.querySelectorAll('.card.sel').length === 4,
          document.querySelectorAll('.card.sel').length);
        t('a bar appears with what you can do to them',
          !document.getElementById('selBar').classList.contains('hidden') &&
          /4 shots selected/.test(document.getElementById('selBar').textContent),
          document.getElementById('selBar').textContent.slice(0, 40));

        /* colour the lot at once */
        const before = SB.Model.findShot(P(), ids[1]).shot.color;
        Array.prototype.filter.call(document.querySelectorAll('#selBar .mini'),
          function (b) { return /Colour/.test(b.textContent); })[0].click();
        document.querySelector('.pal-pop button:nth-child(5)').click();
        t('the whole selection can be coloured in one go',
          SB.Board.selection().every(function (id) {
            return SB.Model.findShot(P(), id).shot.color !== before;
          }), 'still ' + before);

        /* and become their own scene */
        Array.prototype.filter.call(document.querySelectorAll('#selBar .mini'),
          function (b) { return /New scene from these/.test(b.textContent); })[0].click();
        t('a selection can become a scene of its own', P().scenes.length === 2,
          P().scenes.length + ' scenes');
        t('holding exactly those cards', P().scenes[1].shots.length === 4,
          P().scenes[1].shots.length);

        SB.Board.clearSelection();
        t('the bar goes away when nothing is selected',
          document.getElementById('selBar').classList.contains('hidden'), '');

        /* the break between two cards */
        const breaks = document.querySelectorAll('.scene-block[data-scene="' +
          P().scenes[1].id + '"] .scene-break');
        t('there is a break between each pair of cards', breaks.length === 3, breaks.length);
        breaks[1].click();
        t('clicking one starts a new scene there', P().scenes.length === 3, P().scenes.length);
        t('with the cards from that point on',
          P().scenes[2].shots.length === 2 && P().scenes[1].shots.length === 2,
          P().scenes.map(function (s) { return s.shots.length; }).join('/'));
        t('and everything renumbers',
          SB.Model.findShot(P(), P().scenes[2].shots[0].id).code === '3A',
          SB.Model.findShot(P(), P().scenes[2].shots[0].id).code);

        /* dragging one of a group takes the group */
        const wasFirst = P().scenes[0].shots.length;
        down(P().scenes[1].shots[0].id);
        down(P().scenes[1].shots[1].id, { ctrlKey: true });
        const dt = new DataTransfer();
        cardOf(P().scenes[1].shots[0].id).querySelector('.card-head')
          .dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true, cancelable: true }));
        const target = document.querySelector('.shots[data-scene="' + P().scenes[0].id + '"]');
        target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
        target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
        t('dragging one of a selected group moves them all',
          P().scenes[0].shots.length === wasFirst + 2,
          P().scenes.map(function (s) { return s.shots.length; }).join('/') +
          ' (first scene had ' + wasFirst + ')');
        SB.Board.clearSelection();
      })();

      // swapping two shots without moving the dialogue
      (function () {
        const p = P();
        p.scenes.forEach(function (s) { s.shots = []; });
        SB.Model.applyMasterEdit(p, 0, p.master.text.length,
          'Wide of the office. Then a close-up of the laptop.', null);
        const sc = p.scenes[0];
        const a = SB.Model.addShot(p, sc.id, { type: 'Wide', link: { from: 0, to: 19 } });
        const b = SB.Model.addShot(p, sc.id, { type: 'Close-up', link: { from: 20, to: 50 } });
        a.description = 'FIRST picture';
        b.description = 'SECOND picture';
        SB.app.changed(true);

        /* the two-click route: ⇄ on one card, then click the other */
        const swapBtn = Array.prototype.filter.call(
          document.querySelectorAll('.card[data-shot="' + a.id + '"] .ch-actions .mini'),
          function (x) { return x.textContent === '⇄'; })[0];
        t('every card offers a swap button', !!swapBtn, 'missing');
        swapBtn.click();
        t('it arms the swap', SB.Board.swapArmed() === a.id, SB.Board.swapArmed());
        t('and the other cards show they can be picked',
          document.querySelectorAll('.card.swap-pick').length ===
          document.querySelectorAll('.card').length - 1,
          document.querySelectorAll('.card.swap-pick').length);
        document.querySelector('.card[data-shot="' + b.id + '"] .frame').click();
        t('clicking another card swaps the pictures',
          a.description === 'SECOND picture' && b.description === 'FIRST picture',
          a.description + ' / ' + b.description);
        t('and the dialogue stayed on its own card',
          document.querySelector('.script-box[data-shot="' + a.id + '"]').textContent ===
          'Wide of the office.',
          document.querySelector('.script-box[data-shot="' + a.id + '"]').textContent);
        t('the swap disarms afterwards', SB.Board.swapArmed() === null, SB.Board.swapArmed());

        /* ⇄ on one card then ⇄ on the other — the way it reads, and the way
           it was actually being used */
        const btnOf = function (id) {
          return Array.prototype.filter.call(
            document.querySelectorAll('.card[data-shot="' + id + '"] .ch-actions .mini'),
            function (x) { return x.textContent === '⇄'; })[0];
        };
        let wasA = a.description, wasB = b.description;
        btnOf(a.id).click();
        t('arming shows on the other cards’ buttons too',
          btnOf(b.id).classList.contains('danger'), btnOf(b.id).className);
        btnOf(b.id).click();
        t('pressing ⇄ on the second card completes the swap',
          a.description === wasB && b.description === wasA,
          a.description + ' / ' + b.description);
        t('and the dialogue still did not move',
          document.querySelector('.script-box[data-shot="' + a.id + '"]').textContent ===
          'Wide of the office.', '');
        t('nothing is left armed', SB.Board.swapArmed() === null, SB.Board.swapArmed());

        /* picking the second card by its description box, not its frame */
        wasA = a.description; wasB = b.description;
        btnOf(a.id).click();
        document.querySelector('.card[data-shot="' + b.id + '"] .desc-box').click();
        t('clicking a text box on the second card also completes it',
          a.description === wasB && b.description === wasA,
          a.description + ' / ' + b.description);

        /* Esc gets you out */
        swapBtn.click();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        t('Escape cancels an armed swap', SB.Board.swapArmed() === null, SB.Board.swapArmed());

        /* the fast route: alt-drag one card onto another */
        const dt = new DataTransfer();
        const head = document.querySelector('.card[data-shot="' + a.id + '"] .card-head');
        head.dispatchEvent(new DragEvent('dragstart',
          { dataTransfer: dt, bubbles: true, cancelable: true }));
        const target = document.querySelector('.card[data-shot="' + b.id + '"]');
        target.dispatchEvent(new DragEvent('dragover',
          { dataTransfer: dt, altKey: true, bubbles: true, cancelable: true }));
        t('alt-dragging marks the target as a swap',
          target.classList.contains('swap-target') && !target.classList.contains('drag-over'), '');
        target.dispatchEvent(new DragEvent('drop',
          { dataTransfer: dt, altKey: true, bubbles: true, cancelable: true }));
        t('alt-drop swaps the pictures back',
          a.description === 'FIRST picture' && b.description === 'SECOND picture',
          a.description + ' / ' + b.description);
        t('without reordering anything',
          SB.Model.findShot(P(), a.id).code === '1A', SB.Model.findShot(P(), a.id).code);

        /* a plain drag still moves the card, dialogue and all */
        const dt2 = new DataTransfer();
        document.querySelector('.card[data-shot="' + a.id + '"] .card-head')
          .dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt2, bubbles: true, cancelable: true }));
        const t2 = document.querySelector('.card[data-shot="' + b.id + '"]');
        t2.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt2, bubbles: true, cancelable: true }));
        t('a plain drag is still a move, not a swap',
          t2.classList.contains('drag-over') && !t2.classList.contains('swap-target'), '');
        const tr = t2.getBoundingClientRect();
        t2.dispatchEvent(new DragEvent('drop', {
          dataTransfer: dt2, bubbles: true, cancelable: true,
          clientX: tr.left + tr.width - 4      // the right half means "after this one"
        }));
        t('and it reorders the cards',
          SB.Model.findShot(P(), a.id).code === '1B', SB.Model.findShot(P(), a.id).code);
        t('taking the dialogue with it',
          document.querySelector('.script-box[data-shot="' + a.id + '"]').textContent ===
          'Wide of the office.', '');
      })();

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

        /* Hiding is the harder direction: the board gets shorter, so the
         * scroller clamps and a naive correction lands somewhere else. */
        function holds(label, mutate) {
          const cards2 = document.querySelectorAll('#board .card');
          const top2 = panel.getBoundingClientRect().top;
          let w = null;
          for (let i = 0; i < cards2.length; i++) {
            if (cards2[i].getBoundingClientRect().bottom > top2 + 4) { w = cards2[i]; break; }
          }
          const wid = w.dataset.shot, at = w.getBoundingClientRect().top;
          const room = panel.scrollHeight - panel.clientHeight - panel.scrollTop;
          mutate();
          SB.app.changed(true);
          const nowEl = document.querySelector('.card[data-shot="' + wid + '"]');
          const moved = nowEl ? Math.abs(nowEl.getBoundingClientRect().top - at) : 9999;
          /* if the board shrank past what the scroller can hold, the best it can
             do is bottom out — allow that, but only that */
          t(label, !!nowEl && (moved <= 2 || panel.scrollTop >= panel.scrollHeight - panel.clientHeight - 2),
            'moved ' + moved + 'px (room below was ' + Math.round(room) + ')');
        }

        panel.scrollTop = Math.floor(panel.scrollHeight / 2);
        holds('hiding the image→video prompt holds your place', function () {
          P().settings.showVideoPrompt = false;
        });
        panel.scrollTop = Math.floor(panel.scrollHeight / 2);
        holds('showing the image→video prompt holds your place', function () {
          P().settings.showVideoPrompt = true;
        });
        panel.scrollTop = Math.floor(panel.scrollHeight / 2);
        holds('hiding both prompt boxes at once holds your place', function () {
          P().settings.showImagePrompt = false;
          P().settings.showVideoPrompt = false;
        });

        /* the card being typed in is "the one you were on", wherever it sits */
        P().settings.showVideoPrompt = true;
        SB.app.changed(true);
        panel.scrollTop = Math.floor(panel.scrollHeight / 2);
        (function () {
          const pr = panel.getBoundingClientRect();
          const vis = [];
          document.querySelectorAll('#board .card').forEach(function (c) {
            const r = c.getBoundingClientRect();
            if (r.bottom > pr.top + 4 && r.top < pr.bottom) vis.push(c);
          });
          const target = vis[Math.min(1, vis.length - 1)];   // not the topmost one
          const tid = target.dataset.shot;
          const box = target.querySelector('.desc-box');
          box.focus();
          const was = target.getBoundingClientRect().top;
          P().settings.showVideoPrompt = false;
          SB.app.changed(true);
          const el = document.querySelector('.card[data-shot="' + tid + '"]');
          const r2 = el.getBoundingClientRect();
          t('the card you are typing in is the one held still',
            Math.abs(r2.top - was) <= 2, was + ' -> ' + r2.top);
          t('and it is still on screen',
            r2.bottom > pr.top && r2.top < pr.bottom, JSON.stringify({ top: r2.top, panel: pr.top }));
        })();

        /* even bottomed out, where the scroller cannot give the space back */
        P().settings.showVideoPrompt = true;
        SB.app.changed(true);
        panel.scrollTop = panel.scrollHeight;
        (function () {
          const pr = panel.getBoundingClientRect();
          let last = null;
          document.querySelectorAll('#board .card').forEach(function (c) {
            const r = c.getBoundingClientRect();
            if (r.bottom > pr.top + 4 && r.top < pr.bottom) last = c;
          });
          const lid = last.dataset.shot;
          P().settings.showVideoPrompt = false;
          SB.app.changed(true);
          const el = document.querySelector('.card[data-shot="' + lid + '"]');
          const r2 = el.getBoundingClientRect();
          t('a card at the very bottom stays on screen when the board shrinks',
            r2.bottom > pr.top && r2.top < pr.bottom,
            JSON.stringify({ top: Math.round(r2.top), bottom: Math.round(r2.bottom) }));
        })();

        P().settings.showImagePrompt = false;
        P().settings.showVideoPrompt = false;
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

      // generate shots + rewrite, driven through the actual scene buttons
      {
        const settle = function () { return new Promise(function (r) { setTimeout(r, 30); }); };
        SB.Store.getApiKey = function () { return 'test-key'; };
        const sc = SB.Model.addScene(P());
        sc.heading = 'The drop';
        sc.description = 'A courier delivers a package to a warehouse door.';
        app.changed(true);

        const sel = '.scene-block[data-scene="' + sc.id + '"] ';
        const bGen = Array.prototype.filter.call(document.querySelectorAll(sel + '.sc-ai .mini'),
          function (b) { return /Generate/.test(b.textContent); })[0];
        t('generate button sits under the scene description', !!bGen, '');

        SB.Prompts.raw = function () {
          return Promise.resolve({
            subject: 'A courier in a rust-orange weatherproof jacket.',
            shots: [
              { beat: 'arrives', type: 'WS', description: 'The courier reaches the loading door.' },
              { beat: 'the label', type: 'ECU', description: 'Fingers turn a crumpled label to the light.' },
              { beat: 'signed for', type: 'CU', description: 'A rust-orange sleeve as the screen blinks green.' }
            ]
          });
        };
        bGen.click();
        await settle();
        t('three shots landed on the scene', sc.shots.length === 3, sc.shots.length);
        t('their types came from the project list',
          sc.shots.map(function (s) { return s.type; }).join(',') === 'Wide,Extreme close-up,Close-up',
          sc.shots.map(function (s) { return s.type; }).join(','));
        t('the subject reaches every description',
          sc.shots.every(function (s) { return /rust-orange/.test(s.description); }),
          JSON.stringify(sc.shots.map(function (s) { return s.description; })));
        t('the row reports what it did',
          /3 shots added/.test(document.querySelector(sel + '.sc-ai-status').textContent),
          document.querySelector(sel + '.sc-ai-status').textContent);

        const bUndo = Array.prototype.filter.call(document.querySelectorAll(sel + '.sc-ai .mini'),
          function (b) { return b.textContent === 'undo'; })[0];
        t('undo is offered after generating', bUndo && !bUndo.classList.contains('hidden'), '');
        bUndo.click();
        await settle();
        t('undo takes the generated shots back off', sc.shots.length === 0, sc.shots.length);

        // rewrite, then revert
        SB.Prompts.raw = function () {
          return Promise.resolve({ description: 'A courier sets a scuffed parcel on the counter, breath fogging.' });
        };
        const bRw = Array.prototype.filter.call(document.querySelectorAll(sel + '.sc-ai .mini'),
          function (b) { return /Rewrite/.test(b.textContent); })[0];
        bRw.click();
        await settle();
        t('rewrite replaces the description',
          /scuffed parcel/.test(sc.description), sc.description);
        t('and the textarea shows it',
          /scuffed parcel/.test(document.querySelector(sel + 'textarea.sh-desc').value), '');
        const bRev = Array.prototype.filter.call(document.querySelectorAll(sel + '.sc-ai .mini'),
          function (b) { return b.textContent === 'revert'; })[0];
        t('revert is offered', bRev && !bRev.classList.contains('hidden'), '');
        bRev.click();
        t('revert puts the draft back',
          sc.description === 'A courier delivers a package to a warehouse door.',
          sc.description);

        // blocked network: the dialog, then the same button's work resumed
        SB.Prompts.raw = function () { return Promise.reject(new TypeError('Failed to fetch')); };
        const bGen2 = Array.prototype.filter.call(document.querySelectorAll(sel + '.sc-ai .mini'),
          function (b) { return /Generate/.test(b.textContent); })[0];
        bGen2.click();
        await settle();
        const link = document.querySelector('.blocked-link');
        t('a blocked call opens the way out', !!link, '');
        t('the link goes to AI Studio in a new tab',
          !!link && link.getAttribute('href') === 'https://aistudio.google.com/' &&
          link.getAttribute('target') === '_blank',
          link && link.getAttribute('href') + ' ' + link.getAttribute('target'));
        t('the scene row points at the dialog',
          /blocked/.test(document.querySelector(sel + '.sc-ai-status').textContent),
          document.querySelector(sel + '.sc-ai-status').textContent);

        SB.Prompts.raw = function () {
          return Promise.resolve({
            subject: 'A courier in a rust-orange weatherproof jacket.',
            shots: [
              { beat: 'arrives', type: 'WS', description: 'The courier reaches the door.' },
              { beat: 'signed for', type: 'CU', description: 'A rust-orange sleeve, screen green.' }
            ]
          });
        };
        Array.prototype.filter.call(document.querySelectorAll('.modal .foot .tb'),
          function (b) { return b.textContent === 'Try again'; })[0].click();
        await settle();
        t('try again boards the scene it failed on', sc.shots.length === 2, sc.shots.length);
        t('and the dialog is gone', !document.querySelector('.blocked-link'), '');

        SB.Model.deleteScene(P(), sc.id);
        app.changed(true);
      }

      // Settings -> API says how to get a key in the first place
      {
        SB.Settings.open('api');
        const steps = document.querySelectorAll('.modal .setup-steps li');
        t('the API tab explains how to get a key', steps.length === 5, steps.length);
        const first = document.querySelector('.modal .setup-steps a');
        t('step one links to AI Studio in a new tab',
          !!first && first.getAttribute('href') === 'https://aistudio.google.com/' &&
          first.getAttribute('target') === '_blank',
          first && first.getAttribute('href'));
        t('the accept step is tied to the blocked dialog by name',
          /being blocked/.test(steps[1].textContent), steps[1] && steps[1].textContent);
        t('and the key field is still there under it',
          !!document.querySelector('.modal input[type=password]'), '');
        Array.prototype.filter.call(document.querySelectorAll('.modal .foot .tb'),
          function (b) { return b.textContent === 'Cancel'; })[0].click();
      }

      /* Pasting from Word or a transcript brings Windows CRs in with the text.
       * The DOM cannot hold one — the parser folds it to \n — so a doc keeping
       * CRs is longer than what is on screen, and a shot captured from the
       * script came back shifted one character per line above the selection. */
      (function () {
        const master = document.getElementById('masterScript');
        SB.Model.applyMasterEdit(P(), 0, P().master.text.length, '', null);
        app.scriptChanged();
        master.focus();
        SB.Editor.setSel(master, 0, 0);   // the paste handler needs a caret to land on
        master.dispatchEvent(new InputEvent('beforeinput', {
          inputType: 'insertFromPaste', bubbles: true, cancelable: true,
          dataTransfer: (function () {
            const dt = new DataTransfer();
            dt.setData('text/plain', 'Line one.\r\nLine two.\r\nTHE TARGET here.');
            return dt;
          })()
        }));
        app.scriptChanged();

        t('a CRLF paste lands in the script',
          /THE TARGET here\.$/.test(P().master.text), JSON.stringify(P().master.text));
        t('and measures the same as what is on screen',
          P().master.text.length === master.textContent.length,
          P().master.text.length + ' vs ' + master.textContent.length);

        const want = 'THE TARGET';
        const at = master.textContent.indexOf(want);
        master.focus();
        SB.Editor.setSel(master, at, at + want.length);
        const sel = SB.Editor.getSel(master);
        t('and a selection in it points at the text it covers',
          P().master.text.slice(sel.start, sel.end) === want,
          JSON.stringify(P().master.text.slice(sel.start, sel.end)));

        /* headless never focuses the panel, so selectionchange latches nothing;
           the button's handler reads the live selection anyway */
        const cap = document.getElementById('btnCapture');
        cap.disabled = false;
        cap.click();
        Array.prototype.filter.call(document.querySelectorAll('#captureForm button'),
          function (b) { return /Complete/.test(b.textContent); })[0].click();
        let made = null;
        SB.Model.eachShot(P(), function (sh) { if (sh.link) made = sh; });
        const box = made && document.querySelector('.script-box[data-shot="' + made.id + '"]');
        t('so the captured card carries the phrase that was selected',
          box && box.textContent === want, box ? JSON.stringify(box.textContent) : 'no card');
      })();

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
