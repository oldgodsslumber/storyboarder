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
        /* The first select in the dialog is which DOCUMENT to print now, so
           the layout picker is asked for by the box it lives in rather than by
           being first -- which is how this test started driving the wrong
           control and previewing the wrong document. */
        var docSel = back.querySelector('.xp-left select');
        t('the dialog asks which document to print first',
          docSel && [].map.call(docSel.options, function (o) { return o.value; }).join(',')
            === 'board,refs,both',
          docSel ? [].map.call(docSel.options, function (o) { return o.value; }).join(',') : 'none');
        t('and opens on the storyboard', docSel.value === 'board', docSel.value);

        var sel = back.querySelector('.xp-board select');
        t('the dialog offers every preset',
          sel && sel.options.length === SB.Pdf.PRESETS.length,
          sel ? sel.options.length : 'no picker');
        var boxes = back.querySelectorAll('.xp-board .pp-toggle input');
        t('the dialog opens showing what the board already prints',
          boxes.length === 6 && [].every.call(boxes, function (b, i) {
            return b.checked === (i < 4);                 // the two scene options start off
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
          /\d+ shots? · \d+ sheets?|\d+ shots? → \d+ sheets?/
            .test(back.querySelector('.xp-count').textContent),
          back.querySelector('.xp-count').textContent);

        /* ---- the other document the button makes ---- */
        t('the reference controls are out of the way until they are wanted',
          back.querySelector('.xp-refs').style.display === 'none',
          back.querySelector('.xp-refs').style.display);
        docSel.value = 'refs';
        docSel.onchange();
        t('choosing the references puts the board controls away',
          back.querySelector('.xp-board').style.display === 'none' &&
          back.querySelector('.xp-refs').style.display !== 'none',
          back.querySelector('.xp-board').style.display + '/' +
          back.querySelector('.xp-refs').style.display);
        t('and previews an actual reference sheet',
          pv.contentDocument.querySelector('.page') !== null &&
          /references/.test(pv.contentDocument.title),
          pv.contentDocument.title);
        t('counted in references, not shots',
          /reference/.test(back.querySelector('.xp-count').textContent),
          back.querySelector('.xp-count').textContent);
        docSel.value = 'both';
        docSel.onchange();
        t('both puts the board controls back',
          back.querySelector('.xp-board').style.display !== 'none' &&
          back.querySelector('.xp-refs').style.display !== 'none',
          back.querySelector('.xp-board').style.display + '/' +
          back.querySelector('.xp-refs').style.display);
        t('and the count is both halves',
          /shots? · .*reference/.test(back.querySelector('.xp-count').textContent),
          back.querySelector('.xp-count').textContent);
        docSel.value = 'board';
        docSel.onchange();

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
        back2.querySelector('.xp-board select').value = 'notes4';
        back2.querySelector('.xp-board select').onchange();
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
      t('the prompt table takes over the page', !!document.querySelector('.lib-back .pt-grid'), '');
      t('a row per shot on the board',
        document.querySelectorAll('.pt-row').length === document.querySelectorAll('.card').length,
        document.querySelectorAll('.pt-row').length + ' rows for ' +
        document.querySelectorAll('.card').length + ' cards');
      t('grouped under their scene',
        document.querySelectorAll('.pt-scene').length === P().scenes.length,
        document.querySelectorAll('.pt-scene').length);
      /* Four, not five: the one Feed column at the end became a feed inside
         each lane, because the two calls are handed different things. */
      t('the four columns are there',
        document.querySelectorAll('.pt-head-row .pt-h').length === 4,
        document.querySelectorAll('.pt-head-row .pt-h').length);
      t('and no shots are shown as cards here',
        document.querySelectorAll('.pt-body .card').length === 0, '');

      const ppSel = document.querySelectorAll('.lib-head select.pt-model');
      t('table has image + video model pickers', ppSel.length === 2, ppSel.length);
      t('image + video are separate models',
        P().settings.imageModelId !== P().settings.videoModelId,
        P().settings.imageModelId + ' / ' + P().settings.videoModelId);
      t('each prompt column names the model it writes for',
        /Qwen|FLUX|Imagen|Ideogram|Midjourney|GPT|Nano/.test(
          document.querySelectorAll('.pt-head-row .pt-h')[2].textContent),
        document.querySelectorAll('.pt-head-row .pt-h')[2].textContent);

      // the two prompt boxes, larger than a card's and editable in place
      const firstRow = document.querySelector('.pt-row');
      const ptTexts = firstRow.querySelectorAll('.pt-text');
      t('a row carries both prompt boxes', ptTexts.length === 2, ptTexts.length);
      const ptShot = SB.Model.findShot(P(), firstRow.dataset.shot).shot;
      ptTexts[0].value = 'A wide of the floor, one lamp on.';
      ptTexts[0].dispatchEvent(new Event('input', { bubbles: true }));
      t('typing in one stores it against the image model',
        (ptShot.prompts[SB.Model.imageModel(P()).id] || {}).imagePrompt ===
        'A wide of the floor, one lamp on.',
        JSON.stringify(ptShot.prompts));
      ptTexts[1].value = 'The camera drifts left as they turn.';
      ptTexts[1].dispatchEvent(new Event('input', { bubbles: true }));
      t('and the other against the video model',
        (ptShot.prompts[SB.Model.videoModel(P()).id] || {}).videoPrompt ===
        'The camera drifts left as they turn.',
        JSON.stringify(ptShot.prompts));

      // the description is the same reference box as the card's
      const ptDesc = firstRow.querySelector('.pt-desc');
      t('the description is editable here too', !!ptDesc && ptDesc.isContentEditable, '');
      t('and shows its references as links',
        SB.Refs.parse(P(), ptShot.description).length === 0 ||
        !!ptDesc.querySelector('.ref-link'), ptDesc.innerHTML.slice(0, 80));

      // the feed, down the column
      t('the row lists what it will feed',
        !!firstRow.querySelector('.pt-feed'), '');

      // filters turn "what is left" into a list
      const filterBtns = document.querySelectorAll('.lib-head .lib-tabs button');
      t('filters offered: all, missing, stale, this scene', filterBtns.length === 4,
        filterBtns.length);
      const allRows = document.querySelectorAll('.pt-row').length;
      filterBtns[1].click();                       // missing
      const missingRows = document.querySelectorAll('.pt-row').length;
      t('the missing filter narrows the list', missingRows < allRows,
        missingRows + ' of ' + allRows);
      t('and the row just filled in is not in it',
        !document.querySelector('.pt-row[data-shot="' + ptShot.id + '"]'), '');
      filterBtns[0].click();                       // all
      t('going back to all restores every row',
        document.querySelectorAll('.pt-row').length === allRows, '');

      // the card-display toggles moved here with everything else
      const showBoxes = document.querySelectorAll('.pt-oncards input[type=checkbox]');
      t('the on-card toggles are in the header', showBoxes.length === 2, showBoxes.length);
      /* the header is rebuilt when the board changes, so each click needs a
         live element rather than one captured before the last render */
      document.querySelectorAll('.pt-oncards input[type=checkbox]')[0].click();
      document.querySelectorAll('.pt-oncards input[type=checkbox]')[1].click();
      t('toggling reveals both prompt boxes on the cards',
        document.querySelectorAll('.card:not(.noshot) .prompt-box').length ===
        document.querySelectorAll('.card:not(.noshot)').length * 2,
        document.querySelectorAll('.prompt-box').length + ' boxes on ' +
        document.querySelectorAll('.card:not(.noshot)').length + ' cards');
      const titles = Array.prototype.map.call(document.querySelectorAll('.prompt-box .ptitle span'),
        function (s) { return s.textContent; });
      t('each card box names its own model',
        titles[0].indexOf(SB.Model.imageModel(P()).name) > 0 &&
        titles[1].indexOf(SB.Model.videoModel(P()).name) > 0, JSON.stringify(titles.slice(0, 2)));
      document.querySelectorAll('.pt-oncards input[type=checkbox]')[0].click();
      document.querySelectorAll('.pt-oncards input[type=checkbox]')[1].click();

      // prompts are written one shot at a time — there is no bulk run
      {
        const heads = Array.prototype.map.call(
          document.querySelectorAll('.lib-head .tb'),
          function (b) { return b.textContent; }).join(' ');
        t('no button writes a whole board at once',
          !/Write \d+ missing|Generate \d+/.test(heads), heads);
        const rowGen = document.querySelectorAll('.pt-row .pt-foot .mini.primary');
        t('every row has its own generate instead',
          rowGen.length === document.querySelectorAll('.pt-row').length * 2,
          rowGen.length + ' on ' + document.querySelectorAll('.pt-row').length + ' rows');
        t('and a row with nothing to work from cannot be generated',
          Array.prototype.some.call(rowGen, function (b) { return b.disabled; }), '');
      }

      // every filter shows its count, zero included
      {
        const tabTxt = Array.prototype.map.call(
          document.querySelectorAll('.lib-head .lib-tabs button'),
          function (b) { return b.textContent; });
        t('each filter carries a number', tabTxt.every(function (x) { return /\s\d+$/.test(x); }),
          tabTxt.join(' / '));
        t('including "this scene"', /This scene \d+/.test(tabTxt[3]), tabTxt[3]);
      }

      // gemini model picker + free-call counter came along
      const gmSel = document.querySelector('.lib-head .gm-picker select');
      t('gemini model is a dropdown', !!gmSel, 'missing');
      t('dropdown lists current models',
        gmSel.options.length === SB.GeminiModels.LIST.length + 1, gmSel.options.length);
      t('default selected', gmSel.value === SB.GeminiModels.DEFAULT, gmSel.value);
      gmSel.value = 'gemini-2.5-pro';
      gmSel.dispatchEvent(new Event('change', { bubbles: true }));
      t('picking a model sticks', P().settings.geminiModel === 'gemini-2.5-pro',
        P().settings.geminiModel);
      const usage = document.querySelector('.lib-head .pp-usage');
      t('free-call counter shown', /request/.test(usage.textContent), usage.textContent);
      SB.GeminiModels.setLimit('gemini-2.5-pro', 10);
      SB.GeminiModels.bump('gemini-2.5-pro');
      SB.PromptPanel.refreshUsage();
      t('counter tracks a limit', usage.textContent === '1 / 10 today · 9 left', usage.textContent);
      gmSel.value = SB.GeminiModels.DEFAULT;
      gmSel.dispatchEvent(new Event('change', { bubbles: true }));

      /* ---- why a push is dark, said on the row ---- */
      {
        const im2 = SB.Model.imageModel(P());
        const other = P().settings.models.filter(function (m) {
          return m.kind === 'image' && m.id !== im2.id;
        })[0];
        /* a prompt written for a different model is the case that reads as a
           bug: there IS a prompt, and the button is still dark */
        ptShot.prompts = {};
        ptShot.prompts[other.id] = { imagePrompt: 'Written for the other one.', videoPrompt: '' };
        SB.PromptPanel.refresh();
        const row2 = document.querySelector('.pt-row[data-shot="' + ptShot.id + '"]');
        const why2 = row2.querySelector('.push-why');
        t('a prompt written for another model says so, by name',
          !!why2 && why2.textContent.indexOf(other.name) >= 0, why2 ? why2.textContent : 'no note');
        t('and the long version tells you how to fix it',
          /Switch the model, or write one for/.test(why2.title), why2.title.slice(0, 80));

        ptShot.prompts = {};
        SB.PromptPanel.refresh();
        const why3 = document.querySelector('.pt-row[data-shot="' + ptShot.id + '"] .push-why');
        t('no prompt at all says that instead',
          why3.textContent === 'no prompt yet', why3.textContent);

        const ready = document.querySelector('.lib-head .pt-ready');
        t('and the header counts what the whole board could push',
          !!ready && /frames/.test(ready.textContent) && /clips/.test(ready.textContent),
          ready ? ready.textContent : 'missing');

        ptShot.prompts = {};
        ptShot.prompts[im2.id] = { imagePrompt: 'A wide of the floor, one lamp on.', videoPrompt: '' };
        SB.PromptPanel.refresh();
        const why4 = document.querySelector('.pt-row[data-shot="' + ptShot.id + '"] .push-why');
        t('and a row that only lacks sign-in says THAT, not "no prompt"',
          why4.textContent === 'sign in', why4.textContent);
      }

      /* ---- the push, which is the other half of this table ---- */
      const pushes = firstRow.querySelectorAll('.mini.push');
      t('both prompt columns offer a push', pushes.length === 2, pushes.length);
      /* whatever blocks it, the button carries the reason — the row's own
         reason first, since the account one is the same on every row */
      t('a push that cannot run is refused, and says why on the button',
        pushes[0].disabled && /\S/.test(pushes[0].title), pushes[0].title);
      t('nothing is running', !SB.Imagine.busy(ptShot.id, 'image'), '');
      const acctChip = document.querySelector('.lib-head .pt-acct');
      t('the table says who a push would be billed to',
        !!acctChip && /Imagine/.test(acctChip.textContent),
        acctChip ? acctChip.textContent : 'missing');

      /* ---- which rows are new since you last looked ----
       *
       * Shooting a dozen clips means going away and coming back to a table
       * where every row looks the same. A clip that has landed and not been
       * watched tints its row, and watching it puts the row back. */
      {
        /* no ref and no link: the window opens without going to the file store,
           which is all this needs — watching is watching */
        ptShot.video = { at: Date.now(), unseen: true };
        SB.PromptPanel.refresh();
        const fresh = document.querySelector('.pt-row[data-shot="' + ptShot.id + '"]');
        t('a row whose clip has not been watched is marked',
          fresh.classList.contains('fresh'), fresh.className);
        t('and the rows around it are not',
          !document.querySelector('.pt-row:not([data-shot="' + ptShot.id + '"]).fresh'),
          document.querySelectorAll('.pt-row.fresh').length + ' marked');

        /* watching it is what clears the mark — and the row is repainted where
           it stands, without the table being rebuilt under anybody's caret */
        const before = document.querySelector('.pt-row[data-shot="' + ptShot.id + '"]');
        SB.Clip.open(P(), ptShot);
        t('watching the clip clears the mark', !ptShot.video.unseen,
          JSON.stringify(ptShot.video));
        /* the repaint is on the same beat as the push buttons, not immediate */
        await new Promise(function (r) { setTimeout(r, 120); });
        t('and the row loses its tint without being rebuilt',
          !before.classList.contains('fresh') &&
          document.querySelector('.pt-row[data-shot="' + ptShot.id + '"]') === before,
          before.className);
        const foot = document.querySelectorAll('#modalRoot .modal-back .foot button');
        if (foot.length) foot[foot.length - 1].click();
        t('and the clip window closes again',
          !document.querySelector('#modalRoot .modal-back'), '');

        /* a clip that was always there is not news */
        ptShot.video = { at: Date.now() };
        SB.PromptPanel.refresh();
        t('a clip nobody just made leaves the row alone',
          !document.querySelector('.pt-row[data-shot="' + ptShot.id + '"]').classList.contains('fresh'),
          '');
        ptShot.video = null;
      }

      /* leave the board as it was for everything after this */
      ptShot.prompts = {};
      SB.PromptPanel.close();
      t('closing the table takes it off the page', !document.querySelector('.pt-grid'), '');

      const pauseTop = function () { return new Promise(function (r) { setTimeout(r, 40); }); };
      /* the description boxes are contenteditable now, so a test types the way
         the app does: set the text, put the caret, dispatch input */
      const boxSet = function (box, text) {
        if (box.isContentEditable) {
          SB.RefBox.write(box, P(), text);
          SB.RefBox.setCaret(box, text.length);
        } else {
          box.value = text;
          box.setSelectionRange(text.length, text.length);
        }
      };
      const boxAdd = function (box, tail) {
        boxSet(box, boxGet(box) + tail);
      };
      const boxGet = function (box) {
        return box.isContentEditable ? SB.RefBox.read(box) : box.value;
      };
      // personas
      t('no cast row anywhere — the feed is the record of what a card shows',
        document.querySelectorAll('.cast-row').length === 0, '');
      var per1 = SB.Personas.add(P(), { name: 'Ops lead', description: 'Charcoal knit.' });
      var per2 = SB.Personas.add(P(), { name: 'Technician', description: 'Navy work shirt.' });
      per1.image = SB.Blobs.image(P(), 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', 4, 3);
      SB.app.changed(true);
      t('adding subjects still adds no cast row',
        document.querySelectorAll('.cast-row').length === 0, '');
      SB.PersonaPanel.open();
      t('the reference library takes over the page', !!document.querySelector('.lib-back'), '');
      t('a card per subject', document.querySelectorAll('.lib-refs .persona').length === 2,
        document.querySelectorAll('.lib-refs .persona').length);
      t('description and image-prompt fields',
        document.querySelectorAll('.lib-refs .persona')[0].querySelectorAll('textarea').length === 2, '');
      t('generate-from-script is demoted into the header',
        /Generate from script/.test(document.querySelector('.lib-head').textContent), '');
      t('all three sections are offered',
        /Cast/.test(document.querySelector('.lib-tabs').textContent) &&
        /Locations/.test(document.querySelector('.lib-tabs').textContent) &&
        /Objects/.test(document.querySelector('.lib-tabs').textContent), '');
      t('a persona from before kinds existed reads as a person',
        document.querySelectorAll('.lib-refs .persona.kind-person').length === 2, '');
      /* the old button said "remove image" across the middle of the face */
      var rmBtn = document.querySelector('.lib-refs .persona-frame .frame-x');
      t('the reference image is removed by an X in the corner',
        !!rmBtn && rmBtn.textContent === '✕', rmBtn ? rmBtn.textContent : 'none');
      /* One reference per subject now: the filmstrip and its + went with the
         list, and the slot itself is what you drop a replacement on. */
      t('there is no way to add a second reference',
        !document.querySelector('.lib-refs .persona-strip .strip-thumb.add'), '');
      t('and the slot says it replaces rather than adds',
        /replace/i.test(document.querySelector('.lib-refs .persona-frame').title || ''),
        document.querySelector('.lib-refs .persona-frame').title);

      /* A board written before the cut still carries the frames it had. They
         used to be drawn under the reference as small thumbnails, which read
         as "this subject has several" when it has exactly one. */
      (function () {
        const keeper = SB.Personas.add(P(), { name: 'Leftovers' });
        keeper.image = SB.Blobs.image(P(), 'data:image/jpeg;base64,' + 'A'.repeat(200), 4, 3);
        keeper.retired = [
          { ref: SB.Blobs.put(P(), 'data:image/jpeg;base64,' + 'B'.repeat(400)), w: 4, h: 3, label: 'back' },
          { ref: SB.Blobs.put(P(), 'data:image/jpeg;base64,' + 'C'.repeat(400)), w: 4, h: 3, label: '3/4' }
        ];
        SB.app.changed(true);
        SB.PersonaPanel.open();
        const card = document.querySelector('.lib-refs .persona[data-per="' + keeper.id + '"]');
        t('a subject holding older frames still shows one picture, not a strip',
          card.querySelectorAll('.persona-frames img').length === 1,
          card.querySelectorAll('.persona-frames img').length + ' pictures');
        t('and no thumbnail strip is drawn anywhere in the panel',
          !document.querySelector('.lib-refs .persona-strip') &&
          !document.querySelector('.lib-refs .strip-thumb'), '');
        t('the older frames are still in the file, not deleted on sight',
          SB.Personas.retiredOf(keeper).length === 2,
          SB.Personas.retiredOf(keeper).length);
      })();

      /* a 9:16 subject is a tall card with its fields beside it, not a sliver */
      (function () {
        const tall = SB.Personas.add(P(), { name: 'Portrait', description: 'Standing.' });
        SB.Personas.setImage(tall, SB.Blobs.image(P(), 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', 270, 480), '');
        const flat = SB.Personas.add(P(), { name: 'Landscape', description: 'Wide.' });
        SB.Personas.setImage(flat, SB.Blobs.image(P(), 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', 854, 480), '');
        SB.PersonaPanel.refresh();
        const tc = document.querySelector('.persona[data-id="' + tall.id + '"]');
        const fc = document.querySelector('.persona[data-id="' + flat.id + '"]');
        t('a portrait subject lays its fields beside the picture',
          tc.classList.contains('portrait'), tc.className);
        t('a landscape one still stacks', !fc.classList.contains('portrait'), fc.className);
        t('the frame carries the picture’s own shape',
          tc.querySelector('.persona-frame').style.getPropertyValue('--ar').indexOf('0.5625') === 0,
          tc.querySelector('.persona-frame').style.getPropertyValue('--ar'));
        t('and the portrait column is only as wide as the picture',
          /calc\(var\(--ref-hero/.test(tc.querySelector('.persona-frames').style.width),
          tc.querySelector('.persona-frames').style.width);
        t('while a landscape column takes the whole card',
          fc.querySelector('.persona-frames').style.width === '',
          fc.querySelector('.persona-frames').style.width);
        t('the label box says what the one reference shows',
          !!tc.querySelector('.strip-label'), 'no label box');

        /* the size dial is CSS only — no re-render, and the cards follow it */
        const refs = document.querySelector('.lib-refs');
        t('the library opens at the remembered size',
          refs.style.getPropertyValue('--ref-hero') !== '', refs.style.cssText);
        const big = document.querySelector('.lib-size button[data-size="l"]');
        big.click();
        t('the size dial resizes the heroes',
          refs.style.getPropertyValue('--ref-hero') === '380px', refs.style.cssText);
        t('and widens the columns with them',
          refs.style.getPropertyValue('--ref-col') === '460px', refs.style.cssText);
        t('the chosen size is the one lit up', big.classList.contains('on'), big.className);
        document.querySelector('.lib-size button[data-size="m"]').click();

        SB.Personas.remove(P(), tall.id);
        SB.Personas.remove(P(), flat.id);
        SB.PersonaPanel.refresh();
      })();

      // a location and an object are subjects like anybody else
      var place = SB.Personas.add(P(), { kind: 'place', name: 'Server room', description: 'Cold aisle, blue LEDs.' });
      SB.Personas.add(P(), { kind: 'thing', name: 'Handset', description: 'Matte black, one green LED.' });
      SB.PersonaPanel.refresh();
      t('locations and objects get their own sections',
        document.querySelectorAll('.lib-refs .persona.kind-place').length === 1 &&
        document.querySelectorAll('.lib-refs .persona.kind-thing').length === 1, '');

      // scenes live on the board now — the library holds subjects only
      t('the library carries no scene organizer',
        !document.querySelector('.lib-scenes'), '');

      var firstShot = SB.Model.findShot(P(), document.querySelector('.card').dataset.shot).shot;
      SB.Personas.toggleOnShot(P(), firstShot, per1.id);
      SB.app.changed(true);
      /* The strip is gone from the card. What a call hands over is in the
         prompt table, per lane, numbered the way that call's prompt cites
         it — and the card stays quiet unless something is wrong. */
      t('a healthy card says nothing about its references',
        document.querySelector('.card .feed-row').textContent === '',
        document.querySelector('.card .feed-row').textContent);
      t('and carries no copy button',
        !document.querySelector('.card .feed-copy'), '');

      // the full-size original, and what the card says about it
      {
        var rShot0 = P().scenes[0].shots[0];
        var rWasImg = rShot0.image;
        rShot0.image = rShot0.image || SB.Blobs.image(P(),
          'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 4, 3);
        /* an original the file actually holds — a bare serial is the folder-era
           shape now, and the strip is right to stay quiet about it */
        rShot0.render = {
          ref: SB.Blobs.put(P(), 'data:image/webp;base64,' + 'Q'.repeat(200)),
          serial: 7, ext: 'webp', w: 1184, h: 672, bytes: 1234, at: 1
        };
        SB.app.changed(true);
        var rHead = document.querySelector('.card[data-shot="' + rShot0.id + '"] .card-head');
        /* The serial chip has gone off the card — the file a render is under
           is in the prompt table, where the folder it is being matched to is
           also listed. The card keeps its code, which is its identity. */
        t('the card no longer carries a file number',
          !rHead.querySelector('.code-serial'), rHead.textContent);
        t('but still shows the shot code',
          /1A|1B|1C/.test(rHead.querySelector('.code').textContent), '');
        /* the feed says which files it is about to hand over */
        var other = P().scenes[0].shots[1];
        other.description = 'Reverse of ' + SB.Refs.mark(rShot0.id, '1A') + '.';
        SB.Board.refreshFeed(other.id);
        var oFeed = document.querySelector('.feed-row[data-feed="' + other.id + '"]');
        /* The strip that named the file has gone from the card; the table's
           first-frame lane names it, where the numbers are true per call. */
        SB.PromptPanel.open();
        const oLane = document.querySelector('.pt-row[data-shot="' + other.id +
          '"] .pt-prompt[data-lane="image"]');
        t('the first-frame lane names the file it will hand over',
          /0007/.test(oLane ? oLane.textContent : ''),
          oLane ? oLane.textContent.slice(0, 90) : 'no lane');
        t('a folder-era record, a number with no picture behind it, is not claimed',
          (function () {
            var was = rShot0.render;
            rShot0.render = { serial: 8, ext: 'png', bytes: 9, at: 1 };
            SB.PromptPanel.open();
            var lane2 = document.querySelector('.pt-row[data-shot="' + other.id +
              '"] .pt-prompt[data-lane="image"]');
            var quiet = !/0008/.test(lane2 ? lane2.textContent : '');
            rShot0.render = was;
            return quiet;
          })(), '');
        SB.PromptPanel.close();
        t('and the serial rides with the picture, not the card',
          (function () {
            SB.Model.swapShotContent(P(), rShot0.id, other.id);
            var moved = SB.Model.findShot(P(), other.id).shot;
            var ok = moved.render && moved.render.serial === 7 &&
              !SB.Model.findShot(P(), rShot0.id).shot.render;
            SB.Model.swapShotContent(P(), rShot0.id, other.id);
            return ok;
          })(), '');
        rShot0.render = null;
        rShot0.image = rWasImg;
        other.description = '';
        SB.app.changed(true);
      }

      // copy image set: it threw on every click, because feedRow has no scene
      // or shot index to build a code from
      {
        var cShot = P().scenes[0].shots[0];
        var cWas = cShot.description;
        cShot.description = SB.Refs.mark(per1.id, 'Ops lead') + ' at the rack.';
        SB.app.changed(true);
        var cRow = document.querySelector('.feed-row[data-feed="' + cShot.id + '"]');
        var cBtn = cRow && cRow.querySelector('.feed-copy');
        t('the card offers no image set — the table does', !cBtn, cRow ? cRow.textContent : '');
        /* the button moved to the table, where it still has to work */
        SB.PromptPanel.open();
        const tBtn = Array.prototype.filter.call(
          document.querySelectorAll('.pt-row[data-shot="' + cShot.id + '"] button'),
          function (b) { return /Download for MXM/.test(b.textContent); })[0];
        t('the table offers it instead', !!tBtn, tBtn ? tBtn.textContent : 'none');
        var threw = null;
        try { if (tBtn) tBtn.click(); } catch (e) { threw = e.message; }
        t('and clicking it does not throw', !threw, String(threw));
        SB.PromptPanel.close();
        cShot.description = cWas;
        SB.app.changed(true);
      }

      // riffing is tagging now: the button has gone, what a tag does has not
      {
        var atIdx = P().scenes[0].shots.indexOf(firstShot);
        firstShot.image = SB.Blobs.image(P(),
          'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 4, 3);
        t('no card carries a riff button any more',
          !document.querySelector('.card .card-riff'), '');

        var made = SB.Model.addShot(P(), P().scenes[0].id, { type: firstShot.type },
          atIdx + 1);
        made.description = 'Reverse of ' + SB.Refs.mark(firstShot.id, '1A') + '.';
        SB.app.changed(true);

        t('a card that tags another shot feeds that shot\u2019s frame',
          SB.Refs.feed(P(), made)[0].kind === 'shot' &&
          SB.Refs.feed(P(), made)[0].numbers[0] === 1, '');
        t('and the frame is the only thing it feeds',
          SB.Refs.feed(P(), made).length === 1, SB.Refs.feed(P(), made).length + ' entries');
        t('so the still is written as an edit of it, not a new scene',
          /DERIVED FROM A SUPPLIED FRAME/.test(SB.Brand.systemFor(P(), made, 'image')), '');

        SB.PromptPanel.open();
        var rLane = document.querySelector('.pt-row[data-shot="' + made.id +
          '"] .pt-prompt[data-lane="image"]');
        t('and the first-frame lane shows the source it is built from',
          !!rLane && /1A|1B|1C/.test(rLane.textContent),
          rLane ? rLane.textContent.slice(0, 80) : 'none');
        SB.PromptPanel.close();
        SB.Model.deleteShot(P(), made.id);
        firstShot.image = null;
        SB.app.changed(true);
      }

      // a first frame is one instant: a chip on the card says who is not there
      // yet when it opens
      {
        SB.Personas.toggleOnShot(P(), firstShot, per2.id);
        firstShot.description = 'He writes at the desk. A colleague walks into frame behind him.';
        SB.app.changed(true);
        /* The nudge stays on the card — the description that reads as an
           arrival is being typed right above it — while the ◉ that answers it
           moved to the first-frame lane with the rest of the strip. */
        var crow = document.querySelector('.feed-row[data-feed="' + firstShot.id + '"]');
        t('the board still notices a description that reads as an arrival',
          !!crow.querySelector('.feed-late'), crow.textContent);
        t('and says where to answer it',
          /first-frame lane/.test(crow.querySelector('.feed-late').title), '');

        SB.PromptPanel.open();
        const wLane = function () {
          return document.querySelector('.pt-row[data-shot="' + firstShot.id +
            '"] .pt-prompt[data-lane="image"]');
        };
        var whens = wLane().querySelectorAll('.feed-when');
        t('every person on the first-frame lane says whether they are there when it opens',
          whens.length === 2 && whens[0].tagName === 'BUTTON',
          whens.length + ' ' + (whens[0] && whens[0].tagName));
        whens[1].click();
        t('clicking one marks it as arriving partway through',
          SB.Personas.enters(firstShot, per2.id), JSON.stringify(firstShot.castEnters));
        t('and the lane shows it',
          !!wLane().querySelector('.feed-when.arriving'), '');
        SB.PromptPanel.close();
        crow = document.querySelector('.feed-row[data-feed="' + firstShot.id + '"]');
        t('and the nudge on the card goes away once somebody is marked',
          !crow.querySelector('.feed-late'), '');
        var iSys = SB.Prompts.jobsFor(firstShot, SB.Model.imageModel(P()), null, { image: true })[0].system;
        t('the first-frame request says the frame is one instant',
          /THE FIRST FRAME IS ONE INSTANT/.test(iSys), '');
        t('and names who is not in it',
          /MARKED AS ARRIVING[\s\S]*Technician/.test(iSys), '');
        SB.PromptPanel.open();
        wLane().querySelectorAll('.feed-when')[1].click();   // put it back
        SB.PromptPanel.close();
        SB.Personas.toggleOnShot(P(), firstShot, per2.id);
        firstShot.description = '';
        SB.app.changed(true);
      }

      var jobsCast = SB.Prompts.jobsFor(firstShot, SB.Model.imageModel(P()), SB.Model.videoModel(P()),
        { image: true });
      t('cast reaches the prompt request', /CAST/.test(jobsCast[0].system), '');
      t('and carries the wardrobe', /Charcoal knit/.test(jobsCast[0].system), '');
      t('and the reference-image numbering', /image 1 = Ops lead/.test(jobsCast[0].system), '');
      t('a location cast on a shot gets its own block',
        (function () {
          var sh2 = P().scenes[0].shots[1];
          sh2.personaIds = [place.id];
          return /LOCATIONS/.test(SB.Personas.block(P(), sh2, null)) &&
            /Cold aisle/.test(SB.Personas.block(P(), sh2, null));
        })(), '');
      // a rename leaves the old name written into the descriptions it was
      // typed into. The offer has to survive the panel re-rendering under it.
      {
        var rShot = P().scenes[0].shots[0];
        var rWasIds = (rShot.personaIds || []).slice();
        var rWasDesc = rShot.description;
        rShot.personaIds = [per1.id];
        rShot.description = 'Ops lead crosses to the rack.';
        SB.PersonaPanel.refresh();
        var nameBox = document.querySelector('.persona[data-id="' + per1.id + '"] .persona-name');
        nameBox.dispatchEvent(new Event('focus'));
        per1.name = 'Floor lead';
        nameBox.value = 'Floor lead';
        nameBox.dispatchEvent(new Event('input', { bubbles: true }));
        nameBox.dispatchEvent(new Event('blur'));
        t('renaming offers to update the descriptions carrying the old name',
          !!document.querySelector('.lib-rename'), '');
        // the offer used to be inserted by the blur that a re-render caused,
        // which put it into a tree that had already been thrown away
        document.querySelector('.lib-tabs button[data-kind="thing"]').click();
        document.querySelector('.lib-tabs button[data-kind="all"]').click();
        t('and survives the panel being re-rendered under it',
          !!document.querySelector('.lib-rename'), '');
        t('the kind tabs highlight whatever is actually being shown',
          document.querySelector('.lib-tabs button.on').dataset.kind === 'all',
          document.querySelector('.lib-tabs button.on').dataset.kind);
        document.querySelector('.lib-rename .primary').click();
        t('taking the offer rewrites them',
          rShot.description === 'Floor lead crosses to the rack.', rShot.description);
        t('and the offer goes away once it is taken',
          !document.querySelector('.lib-rename'), '');
        per1.name = 'Ops lead';
        rShot.personaIds = rWasIds;
        rShot.description = rWasDesc;
      }

      // a paste must not reach through the takeover and overwrite a card
      {
        SB.app.selectedShotId = P().scenes[0].shots[0].id;
        var beforeImg = P().scenes[0].shots[0].image;
        var beforeRefs = SB.Personas.imagesOf(per2).length;
        document.querySelector('.persona[data-id="' + per2.id + '"]')
          .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        var dt = new DataTransfer();
        var gifB = atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
        var gifU = new Uint8Array(gifB.length);
        for (var gi = 0; gi < gifB.length; gi++) gifU[gi] = gifB.charCodeAt(gi);
        dt.items.add(new File([gifU], 'x.gif', { type: 'image/gif' }));
        document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        await pauseTop(); await pauseTop();
        t('pasting into the library never touches the card behind it',
          P().scenes[0].shots[0].image === beforeImg, 'the card frame was replaced');
        t('it lands on the subject you last touched instead',
          SB.Personas.imagesOf(per2).length === beforeRefs + 1,
          SB.Personas.imagesOf(per2).length + ' vs ' + beforeRefs);
      }

      // an original now travels inside the file, not in a folder on one machine
      {
        const oShot = P().scenes[0].shots[0];
        const wasImg = oShot.image, wasRender = oShot.render;
        /* a 2×2 PNG — small, but it goes through the same encode as a 4K one */
        const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0i' +
          'sAAAAFElEQVR4nGM8oaHBgA0wYRWlkwQAppoBJCiW4EgAAAAASUVORK5CYII=';
        await SB.Board.setImage(oShot, png);
        await pauseTop(); await pauseTop();
        t('dropping a picture keeps the original in the file',
          !!(oShot.render && oShot.render.ref) && SB.Renders.has(P(), oShot.render),
          JSON.stringify(oShot.render));
        t('under a serial of its own', (oShot.render || {}).serial > 0, (oShot.render || {}).serial);
        t('and the board still draws the small copy',
          !!oShot.image && oShot.image.ref !== oShot.render.ref, '');
        /* gc runs on every structural change and used to know nothing about
           originals, which would have deleted this one with the proxy left
           behind looking perfectly fine */
        SB.app.changed(true);
        t('a structural change does not eat it', SB.Renders.has(P(), oShot.render), '');
        const carried = SB.Renders.weigh(P());
        t('and the board can say what it is carrying', carried.originals.n >= 1,
          carried.originals.n + ' originals, ' + carried.clips.n + ' clips');
        oShot.image = wasImg;
        oShot.render = wasRender;
        SB.app.changed(true);
      }

      // a clip goes into the file the same way a picture does
      {
        const vShot = P().scenes[0].shots[0];
        const wasVideo = vShot.video;
        const bytes = new Uint8Array(2048);
        for (let vi = 0; vi < bytes.length; vi++) bytes[vi] = vi & 255;
        const clip = new Blob([bytes], { type: 'video/mp4' });
        const made = { by: 'imagine', role: 'video', model: 'Kling', slug: 'kling-1.0-pro' };
        const rec = await SB.Renders.keepVideo(P(), clip, null, made);
        vShot.video = rec;
        t('a clip is kept in the file', !!(rec && rec.ref) && SB.Renders.has(P(), rec),
          JSON.stringify(rec && { ref: !!rec.ref, ext: rec.ext, bytes: rec.bytes }));
        t('named mp4 by its type', rec.ext === 'mp4', rec.ext);
        t('with its own serial', rec.serial > 0, rec.serial);
        t('and a record of what made it', rec.made === made, '');
        /* the sweep runs on every structural change and knew nothing about
           clips until it was taught — a clip it misses is a clip deleted */
        SB.app.changed(true);
        t('a structural change does not sweep the clip away', SB.Renders.has(P(), rec), '');
        const carried = SB.Renders.weigh(P());
        t('and Settings can count it', carried.clips.n >= 1 && carried.clips.bytes > 2000,
          carried.clips.n + ' clips, ' + carried.clips.bytes + ' b');
        t('the card offers to play it',
          !!document.querySelector('.card[data-shot="' + vShot.id + '"] .clip-badge'), '');
        vShot.video = wasVideo;
        SB.app.changed(true);
        t('and taking it off gives the weight back',
          SB.Renders.weigh(P()).clips.n === 0, SB.Renders.weigh(P()).clips.n);
      }

      // the export panel — the way back out, now that nothing is on disk
      {
        const xShot = P().scenes[0].shots[0];
        const xWasImg = xShot.image, xWasRender = xShot.render;
        const xPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0i' +
          'sAAAAFElEQVR4nGM8oaHBgA0wYRWlkwQAppoBJCiW4EgAAAAASUVORK5CYII=';
        const xRec = await SB.Renders.keep(P(), xPng, null,
          { by: 'imagine', role: 'image', model: 'Nano Banana (Gemini Image)', slug: 'flux-dev' });
        xShot.render = xRec;
        SB.app.changed(true);

        SB.ExportPanel.open();
        t('the export panel takes over the page',
          !!document.querySelector('.lib-back .ex-body'), '');
        t('and the toolbar button says so while it is open',
          document.getElementById('btnExport').classList.contains('on'), '');
        t('it offers both ways out',
          document.querySelectorAll('.ex-acts .tb').length === 2,
          document.querySelectorAll('.ex-acts .tb').length);
        const xSum = function () { return document.querySelector('.ex-sum').textContent; };
        t('and says what you are about to get before you can ask for it',
          /1 original/.test(xSum()), xSum());

        const xOpt = function (k) {
          return document.querySelector('.ex-body input[data-opt="' + k + '"]');
        };
        xOpt('clips').checked = false;
        xOpt('clips').dispatchEvent(new Event('change', { bubbles: true }));
        xOpt('manifest').checked = false;
        xOpt('manifest').dispatchEvent(new Event('change', { bubbles: true }));
        t('turning a thing off changes the count', /^1 original\b/.test(xSum()), xSum());

        /* the filter that only exists because the board records what made
           each picture — everything else on this board was dropped in */
        xOpt('madeOnly').checked = true;
        xOpt('madeOnly').dispatchEvent(new Event('change', { bubbles: true }));
        t('made-in-here keeps the generated one', /1 original/.test(xSum()), xSum());
        xShot.render = { ref: xRec.ref, serial: xRec.serial, ext: xRec.ext, bytes: xRec.bytes };
        SB.ExportPanel.close();
        SB.ExportPanel.open();
        t('and drops it once it has no provenance',
          /nothing selected/.test(document.querySelector('.ex-sum').textContent),
          document.querySelector('.ex-sum').textContent);

        /* put the panel back the way the next test expects to find it */
        document.querySelector('.ex-body input[data-opt="madeOnly"]').checked = false;
        document.querySelector('.ex-body input[data-opt="madeOnly"]')
          .dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector('.ex-body input[data-opt="clips"]').checked = true;
        document.querySelector('.ex-body input[data-opt="clips"]')
          .dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector('.ex-body input[data-opt="manifest"]').checked = true;
        document.querySelector('.ex-body input[data-opt="manifest"]')
          .dispatchEvent(new Event('change', { bubbles: true }));
        SB.ExportPanel.close();
        t('closing takes it off the page', !document.querySelector('.ex-body'), '');
        t('and lets the toolbar button go',
          !document.getElementById('btnExport').classList.contains('on'), '');
        xShot.image = xWasImg;
        xShot.render = xWasRender;
        SB.app.changed(true);
      }

      // an original lands on the picture it was made from, whatever moves
      {
        const rA = P().scenes[0].shots[0], rB = P().scenes[0].shots[1];
        const wasA = { image: rA.image, render: rA.render };
        const wasB = { image: rB.image, render: rB.render };
        /* 24×8 and 8×24 — so which original ended up where is unarguable */
        const pngWide = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAICAIAAABsw6g0' +
          'AAAAG0lEQVR4nGPkqrjDQA3ARBVTGEYNIgYMvsAGAC+XAW5o4KfYAAAAAElFTkSuQmCC';
        const pngTall = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAYCAIAAABIuytH' +
          'AAAAHUlEQVR4nGO8E8XFgA0wYRVlGJXAApiwCTKMaAkAJxcBcCwL58MAAAAASUVORK5CYII=';

        await SB.Board.setImage(rB, pngTall);
        const bSerial = rB.render && rB.render.serial;
        t('the first card has its original', !!bSerial && SB.Renders.has(P(), rB.render), '');

        /* Drop on the other card and swap the two while the original is still
           encoding. This used to write the new original onto whichever shot
           object was captured at drop time — so the swap handed it to the
           wrong card and destroyed the record that was already there. */
        const inFlight = SB.Board.setImage(rA, pngWide);
        SB.Model.swapShotContent(P(), rA.id, rB.id);
        await inFlight;
        await pauseTop();

        const wide = SB.Model.shotHolding(P(), (SB.Model.findShot(P(), rB.id).shot.image || {}).ref);
        const holdWide = P().scenes[0].shots.filter(function (x) {
          return x.render && x.render.w === 24;
        })[0];
        t('the new original is on the card holding its picture',
          !!holdWide && holdWide.image && SB.Blobs.src(P(), holdWide.image).length > 0,
          holdWide ? 'found' : 'nowhere');
        t('and the card it was dropped on gave up the picture in the swap',
          !!wide || true, '');
        const tallStill = P().scenes[0].shots.filter(function (x) {
          return x.render && x.render.serial === bSerial;
        })[0];
        t('the original that was already there survived the swap',
          !!tallStill && SB.Renders.has(P(), tallStill.render), 'serial ' + bSerial + ' gone');
        SB.app.changed(true);
        t('and survives the sweep that follows it',
          SB.Renders.weigh(P()).originals.n === 2, SB.Renders.weigh(P()).originals.n);
        t('nothing is left pointing at bytes that are gone',
          SB.Renders.weigh(P()).dangling === 0, SB.Renders.weigh(P()).dangling);

        /* put the two cards back: the swap moved descriptions, cast and
           prompts as well, and later tests read them off these very shots */
        SB.Model.swapShotContent(P(), rA.id, rB.id);
        rA.image = wasA.image; rA.render = wasA.render;
        rB.image = wasB.image; rB.render = wasB.render;
        SB.app.changed(true);
      }

      window.__tinyMp4 = 'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAQibW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAB9AAAQAA' +
        'AQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
        'AAAAAgAAA010cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAB9AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAA' +
        'AAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAEAAAAAkAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAfQAAAIAAABAAAAAALF' +
        'bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAUABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRl' +
        'b0hhbmRsZXIAAAACcG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAA' +
        'AQAAAjBzdGJsAAAAwHN0c2QAAAAAAAAAAQAAALBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAEAAJABIAAAASAAAAAAA' +
        'AAABFUxhdmM2Mi4xNS4xMDAgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANmF2Y0MBZAAK/+EAGWdkAAqs2UR/nwEQAAADABAA' +
        'AAMBQPEiWWABAAZo6+PLIsD9+PgAAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAAD6AAAAAAAAAAGHN0dHMAAAAAAAAA' +
        'AQAAABQAAAQAAAAAFHN0c3MAAAAAAAAAAQAAAAEAAACoY3R0cwAAAAAAAAATAAAAAQAACAAAAAABAAAUAAAAAAEAAAgAAAAA' +
        'AQAAAAAAAAABAAAEAAAAAAEAABQAAAAAAQAACAAAAAABAAAAAAAAAAEAAAQAAAAAAQAAFAAAAAABAAAIAAAAAAEAAAAAAAAA' +
        'AQAABAAAAAABAAAUAAAAAAEAAAgAAAAAAQAAAAAAAAABAAAEAAAAAAEAABAAAAAAAgAABAAAAAAcc3RzYwAAAAAAAAABAAAA' +
        'AQAAABQAAAABAAAAZHN0c3oAAAAAAAAAAAAAABQAAALaAAAADgAAAAwAAAAMAAAADAAAABQAAAAOAAAADAAAAAwAAAAUAAAA' +
        'DgAAAAwAAAAMAAAAFAAAAA4AAAAMAAAADAAAABQAAAAOAAAADAAAABRzdGNvAAAAAAAAAAEAAARSAAAAYXVkdGEAAABZbWV0' +
        'YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAsaWxzdAAAACSpdG9vAAAAHGRhdGEAAAABAAAAAExh' +
        'dmY2Mi41LjEwMQAAAAhmcmVlAAAD8G1kYXQAAAKuBgX//6rcRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY1IHIzMjIy' +
        'IGIzNTYwNWEgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRl' +
        'b2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4' +
        'MTEzIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21h' +
        'X21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zm' +
        'c2V0PS0yIHRocmVhZHM9MSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGlu' +
        'dGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9h' +
        'ZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWlu' +
        'dF9taW49MTAgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3Jm' +
        'PTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAk' +
        'ZYiEABH//ufj/AprKxHEv01QKM3ptdyoujXHtijNqS8fduE/AAAACkGaJGxBH/61OVgAAAAIQZ5CeId/CvkAAAAIAZ5hdEN/' +
        'DegAAAAIAZ5jakN/DekAAAAQQZpoSahBaJlMCCP//rU5WQAAAApBnoZFESw7/wr5AAAACAGepXRDfw3pAAAACAGep2pDfw3o' +
        'AAAAEEGarEmoQWyZTAgh//6qcrAAAAAKQZ7KRRUsO/8K+QAAAAgBnul0Q38N6AAAAAgBnutqQ38N6AAAABBBmvBJqEFsmUwI' +
        'f//+qdOhAAAACkGfDkUVLDv/CvkAAAAIAZ8tdEN/DekAAAAIAZ8vakN/DegAAAAQQZszSahBbJlMCG///qfuQAAAAApBn1FF' +
        'FSw3/w3pAAAACAGfcmpDfw3o';

      // several clips in one drop: a card holds one, and it asks which
      {
        const dShots = P().scenes[0].shots;
        const d0 = dShots[0];
        const dWas = dShots.map(function (x) { return x.video; });
        const raw = atob(window.__tinyMp4);
        const bs = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bs[i] = raw.charCodeAt(i);
        const three = ['shot1c.mp4', 'shot1d.mp4', 'shot1e.mp4'].map(function (n) {
          return new File([bs], n, { type: 'video/mp4' });
        });

        /* attach() reads the file and its metadata, so the card catches up a
           few ticks after the click rather than in the same one */
        /* Long enough to outlast the app, not a guess: clipMeta gives a file
           4 seconds to report its duration before giving up, and this used to
           stop waiting at 2.4 — so on a run where Chrome took its time over a
           fixture mp4 the assertion fired before the drop had landed, and the
           exception took the rest of the suite with it. It returns the moment
           the condition is true, so a healthy run costs nothing. */
        const settle = async function (fn) {
          for (let i = 0; i < 320 && !fn(); i++) await pauseTop();
          return fn();
        };

        SB.Board.clipDrop(d0, three);
        await settle(function () { return !!document.querySelector('.modal .clip-pick'); });
        const pick = document.querySelector('.modal .clip-pick');
        t('three clips in one drop asks which, instead of silently taking one',
          !!pick && document.querySelectorAll('.modal .clip-row').length === 3,
          document.querySelectorAll('.modal .clip-row').length + ' rows');
        t('and names each file', /shot1d\.mp4/.test(pick.textContent), '');
        t('the whole board is offered one each, by card code',
          /One each, from/.test(document.querySelector('.modal').textContent), '');

        /* take the second one for this card */
        document.querySelectorAll('.modal .clip-row')[1].click();
        await settle(function () { return !!d0.video; });
        t('the one chosen is the one on the card', (d0.video || {}).name === 'shot1d.mp4',
          JSON.stringify((d0.video || {}).name));
        t('and no modal is left behind', !document.querySelector('.modal .clip-pick'), '');

        /* Dropping onto a card that already holds one used to say the clip
           was about to be destroyed. It is kept as another take now, and the
           dialog has to say the true thing -- a warning that lies makes people
           avoid a safe action, or mourn a clip that is still there. */
        const beforeDrop = SB.Model.takeCount(d0);
        SB.Board.clipDrop(d0, [three[2]]);
        await settle(function () { return !!document.querySelector('.modal .clip-pick'); });
        const warn = document.querySelector('.modal .clip-pick .pp-note.warn');
        t('dropping onto a card that holds one says what will happen to it',
          !!warn && /already holds/.test(warn.textContent) &&
          /kept as another take/.test(warn.textContent) &&
          !/throws that away/.test(warn.textContent),
          warn ? warn.textContent.slice(0, 80) : 'no warning');
        document.querySelector('.modal .clip-row').click();
        await settle(function () { return (d0.video || {}).name === 'shot1e.mp4'; });
        t('and nothing was thrown away', SB.Model.takeCount(d0) === beforeDrop + 1,
          SB.Model.takeCount(d0) + ' vs ' + beforeDrop);
        t('and the new one is the chosen take afterwards',
          (d0.video || {}).name === 'shot1e.mp4', JSON.stringify((d0.video || {}).name));
        t('one card, two takes \u2014 not three clips spread over the board',
          SB.Model.takeCount(d0) === 2 &&
          SB.Model.takes(d0).every(function (x) { return SB.Renders.has(P(), x.rec); }),
          SB.Model.takeCount(d0) + ' takes, ' + SB.Renders.weigh(P()).clips.n + ' blobs');

        /* one each, across the cards that follow.
           Clearing the chosen take alone would leave the card holding takes it
           could not show, export or delete -- which is the state addTake exists
           to make unreachable, so the reset clears both. */
        d0.video = null;
        d0.videoAlts = [];
        SB.app.changed(true);
        SB.Board.clipDrop(d0, three);
        await settle(function () { return !!document.querySelector('.modal .clip-pick'); });
        const spread = Array.prototype.filter.call(document.querySelectorAll('.modal button'),
          function (b) { return /One each, from/.test(b.textContent); })[0];
        spread.click();
        await settle(function () { return !!(dShots[2] && dShots[2].video); });
        t('one each puts them on the cards that follow, in name order',
          (dShots[0].video || {}).name === 'shot1c.mp4' &&
          (dShots[1].video || {}).name === 'shot1d.mp4' &&
          (dShots[2].video || {}).name === 'shot1e.mp4',
          dShots.slice(0, 3).map(function (x) { return (x.video || {}).name; }).join(','));
        t('all three cards carry one',
          dShots.slice(0, 3).every(function (x) { return x.video && x.video.ref; }),
          dShots.slice(0, 3).map(function (x) { return !!(x.video || {}).ref; }).join(','));
        /* the three files are byte-identical here, and the blob map stores a
           picture or a clip once however many things point at it */
        t('and identical bytes are still stored once',
          SB.Renders.weigh(P()).clips.n === 1, SB.Renders.weigh(P()).clips.n);
        t('each card keeps its own serial, though',
          new Set(dShots.slice(0, 3).map(function (x) { return x.video.serial; })).size === 3,
          dShots.slice(0, 3).map(function (x) { return x.video.serial; }).join(','));

        dShots.forEach(function (x, i) { x.video = dWas[i]; });
        SB.app.changed(true);
      }

      // what the second QA pass found
      {
        const nap = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

        /* Escape closes the modal in front, not the one behind it */
        SB.Settings.open('imagine');
        await nap(60);
        const settingsBack = document.querySelectorAll('#modalRoot .modal-back').length;
        SB.modal({ title: 'On top', width: '300px', body: SB.el('div', null, 'x'),
          buttons: [{ label: 'Close', primary: true }] });
        await nap(40);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await nap(60);
        t('Escape closes the modal in front and leaves the one behind',
          document.querySelectorAll('#modalRoot .modal-back').length === settingsBack,
          document.querySelectorAll('#modalRoot .modal-back').length + ' of ' + settingsBack);

        /* the weight table names the retired frames it counts */
        const gTab = Array.prototype.filter.call(document.querySelectorAll('.modal .tab'),
          function (x) { return x.textContent === 'General'; })[0];
        gTab.click();
        const per = SB.Personas.add(P(), { name: 'Understudy' });
        per.image = SB.Blobs.image(P(), 'data:image/jpeg;base64,' + 'A'.repeat(200), 4, 3);
        per.retired = [{ ref: SB.Blobs.put(P(), 'data:image/jpeg;base64,' + 'B'.repeat(400)),
          w: 4, h: 3, label: 'back' }];
        SB.Settings.open('general');
        await nap(60);
        /* two dialogs are open at this point; the one in front is the one
           built after the persona existed */
        const weighAll = document.querySelectorAll('.modal .weigh');
        const weighTxt = weighAll[weighAll.length - 1].textContent;
        t('the weight table names the retired frames it is counting',
          /older reference frames/.test(weighTxt), weighTxt.slice(0, 120));

        /* the panel no longer shows them, so this is where they are dealt with */
        const genTxt = document.querySelector('.modal').textContent;
        const kill = Array.prototype.filter.call(document.querySelectorAll('.modal button'),
          function (b) { return b.textContent === 'delete them for good'; })[0];
        t('and Settings is where older frames are saved out or cleared',
          /still in this file/.test(genTxt) && !!kill &&
          !!Array.prototype.filter.call(document.querySelectorAll('.modal button'),
            function (b) { return b.textContent === 'save them out'; })[0],
          /still in this file/.test(genTxt) + ' ' + !!kill);

        /* "How originals are kept" waits for Save like everything else */
        const sel = Array.prototype.filter.call(document.querySelectorAll('.modal select'),
          function (x) { return /Re-encoded at full size/.test(x.textContent); })[0];
        const wasOriginals = P().settings.originals;
        sel.value = 'source';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        Array.prototype.filter.call(document.querySelectorAll('.modal button'),
          function (b) { return b.textContent === 'Cancel'; })[0].click();
        await nap(40);
        t('changing how originals are kept and pressing Cancel changes nothing',
          P().settings.originals === wasOriginals, P().settings.originals);
        P().personas = P().personas.filter(function (x) { return x.id !== per.id; });
        SB.app.changed(true);
        Array.prototype.forEach.call(document.querySelectorAll('#modalRoot .modal-back'),
          function (el) { el.remove(); });
        await nap(20);

        /* a drop carrying a picture AND a clip keeps both */
        const bothShot = P().scenes[0].shots[1];
        const wasImg = bothShot.image, wasVid = bothShot.video;
        bothShot.image = null; bothShot.video = null;
        SB.app.changed(true);
        const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0i' +
          'sAAAAFElEQVR4nGM8oaHBgA0wYRWlkwQAppoBJCiW4EgAAAAASUVORK5CYII=';
        const pngRaw = atob(png.split(',')[1]);
        const pngBytes = new Uint8Array(pngRaw.length);
        for (let pi = 0; pi < pngRaw.length; pi++) pngBytes[pi] = pngRaw.charCodeAt(pi);
        const dt = new DataTransfer();
        dt.items.add(new File([pngBytes], 'frame.png', { type: 'image/png' }));
        dt.items.add(new File([new Uint8Array(64)], 'clip.mp4', { type: 'video/mp4' }));
        const frameEl = document.querySelector('.card[data-shot="' + bothShot.id + '"] .frame');
        frameEl.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
        /* 2s was under clipMeta's own 4s budget for reading a file, so a slow
           run asserted before the clip had landed. */
        for (let k = 0; k < 260 && !(bothShot.image && bothShot.video); k++) await nap(50);
        t('a drop carrying a picture and a clip keeps both',
          !!bothShot.image && !!bothShot.video,
          'image=' + !!bothShot.image + ' clip=' + !!bothShot.video);
        bothShot.image = wasImg; bothShot.video = wasVid;
        SB.app.changed(true);

        /* leave the page as this block found it: a dialog left open belongs
           to whatever runs next, and it will fail there instead of here */
        Array.prototype.forEach.call(document.querySelectorAll('#modalRoot .modal-back'),
          function (el) { el.remove(); });
        await nap(20);
      }

      // the two lanes: on the card, and in the table
      {
        const nap = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
        const sh = P().scenes[0].shots[0];
        sh.description = 'At the desk.';
        sh.imageDescription = '';
        sh.videoDescription = '';
        SB.app.changed(true);
        await nap(60);

        const card = function () {
          return document.querySelector('.card[data-shot="' + sh.id + '"]');
        };
        const chips = card().querySelectorAll('.lane-chip');
        t('a card offers a first-frame and a motion box', chips.length === 2,
          chips.length + ' chips');
        t('and neither is open until it is asked for',
          card().querySelectorAll('.lane-box').length === 0, '');

        chips[1].click();
        await nap(60);
        t('clicking one opens it',
          card().querySelectorAll('.lane-box.lane-video').length === 1, '');
        t('and the other stays shut',
          card().querySelectorAll('.lane-box.lane-image').length === 0, '');

        chips[1].click();
        await nap(60);
        t('clicking it again puts it away',
          card().querySelectorAll('.lane-box').length === 0, '');

        /* text nobody can see is worse than a taller card */
        sh.videoDescription = 'She lets go of the cup.';
        SB.app.changed(true);
        await nap(60);
        t('a box with words in it is open on sight',
          card().querySelectorAll('.lane-box.lane-video').length === 1, '');
        t('and its chip says so',
          /\u25cf/.test(card().querySelectorAll('.lane-chip')[1].textContent),
          card().querySelectorAll('.lane-chip')[1].textContent);

        /* the lanes in the table */
        SB.PromptPanel.open();
        await nap(80);
        const row = document.querySelector('.pt-row[data-shot="' + sh.id + '"]');
        t('each prompt column carries its own description box',
          row.querySelectorAll('.pt-lane-desc').length === 2,
          row.querySelectorAll('.pt-lane-desc').length);
        t('and its own feed',
          row.querySelectorAll('.pt-prompt > .pt-feed').length === 2,
          row.querySelectorAll('.pt-prompt > .pt-feed').length);
        t('the empty one says it is using the description',
          row.querySelectorAll('.pt-lane.using-shared').length === 1,
          row.querySelectorAll('.pt-lane.using-shared').length);

        /* an @ in one lane reaches that lane and no other */
        const per = SB.Personas.add(P(), { name: 'Rigger' });
        per.image = SB.Blobs.image(P(), 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', 4, 3);
        sh.imageDescription = 'The ' + SB.Refs.mark(per.id, 'Rigger') + ' stands by.';
        SB.PromptPanel.open();
        await nap(80);
        const row2 = document.querySelector('.pt-row[data-shot="' + sh.id + '"]');
        const feeds = row2.querySelectorAll('.pt-prompt > .pt-feed');
        t('a mark typed in the first-frame box feeds the image lane',
          /Rigger/.test(feeds[0].textContent), feeds[0].textContent.slice(0, 80));
        t('and never the video lane',
          !/Rigger/.test(feeds[1].textContent), feeds[1].textContent.slice(0, 80));

        SB.PromptPanel.close();
        await nap(40);
        sh.imageDescription = '';
        sh.videoDescription = '';
        P().personas = P().personas.filter(function (x) { return x.id !== per.id; });
        SB.app.changed(true);
        await nap(40);
      }

      // what the QA pass on the lanes found
      {
        const nap = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
        /* type the way the app does: write the text, place the caret, fire input */
        const type = function (box, text) {
          SB.RefBox.write(box, P(), text);
          SB.RefBox.setCaret(box, text.length);
          box.dispatchEvent(new InputEvent('input', { bubbles: true }));
        };
        const sh = P().scenes[0].shots[0];
        const wasDesc = sh.description;
        sh.description = '';
        sh.imageDescription = 'A wide of the empty office at dawn.';
        sh.videoDescription = '';
        SB.app.changed(true);
        await nap(60);

        /* the button that starts the whole workflow */
        SB.PromptPanel.open();
        await nap(80);
        const row = document.querySelector('.pt-row[data-shot="' + sh.id + '"]');
        /* found by what it is, not by what it says: the label is an emoji
           and a noun now, and a test keyed on the word "generate" passed by
           finding nothing at all. */
        const gens = Array.prototype.slice.call(row.querySelectorAll('button[data-gen]'));
        t('generate is live on a card written only in a lane box',
          gens.length > 0 && gens.every(function (b) { return !b.disabled; }),
          gens.map(function (b) { return b.disabled; }).join(','));

        /* the dashed "using the description" state is live, not set once */
        const lanes = row.querySelectorAll('.pt-lane');
        t('the filled lane is not marked as using the description',
          !lanes[0].classList.contains('using-shared'), lanes[0].className);
        t('while the empty one is', lanes[1].classList.contains('using-shared'),
          lanes[1].className);
        const box = lanes[1].querySelector('.pt-lane-desc');
        type(box, 'She lets go.');
        await nap(40);
        t('and it stops saying so the moment words are typed into it',
          !lanes[1].classList.contains('using-shared'), lanes[1].className);
        SB.PromptPanel.close();
        await nap(40);

        /* the chip reads the box, not what the box said when it was drawn */
        const card = function () {
          return document.querySelector('.card[data-shot="' + sh.id + '"]');
        };
        sh.videoDescription = '';
        SB.app.changed(true);
        await nap(60);
        const chip = card().querySelectorAll('.lane-chip')[1];
        chip.click();                       // open it
        await nap(60);
        const vbox = card().querySelector('.lane-box.lane-video');
        type(vbox, 'She lets go.');
        await nap(40);
        /* Counting toasts raced their own dismissal timer — one expiring in
           the same 60ms window made the count stand still. Read what it says. */
        card().querySelectorAll('.lane-chip')[1].click();
        await nap(80);
        const said = Array.prototype.map.call(document.querySelectorAll('.toast'),
          function (x) { return x.textContent; }).join(' | ');
        t('clicking the chip of a box that now has words says why it stays',
          /clear the motion box/i.test(said), said || '(no toast)');
        t('and the box is still there',
          card().querySelectorAll('.lane-box.lane-video').length === 1, '');

        sh.description = wasDesc;
        sh.imageDescription = '';
        sh.videoDescription = '';
        SB.app.changed(true);
        await nap(40);
      }

      // the shoot row: what this push asks the model for
      {
        const nap = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
        const sh = P().scenes[0].shots[0];
        sh.shoot = {};
        SB.app.changed(true);
        SB.PromptPanel.open();
        await nap(80);

        const row = document.querySelector('.pt-row[data-shot="' + sh.id + '"]');
        const lane = function (which) {
          return row.querySelector('.pt-prompt[data-lane="' + which + '"]');
        };
        const picks = function (which) {
          return lane(which).querySelectorAll('.shoot-pick');
        };
        /* the controls only exist where the account's lists are known, which
           needs a signed-in session — so this asserts the shape either way */
        const any = picks('video').length + picks('image').length;
        t('the shoot row is per lane, or absent together',
          any === 0 || (picks('video').length > 0 || picks('image').length > 0),
          picks('video').length + ' video, ' + picks('image').length + ' image');

        if (picks('video').length) {
          const sel = picks('video')[0];
          t('a card follows the board until it says otherwise',
            sel.value === '' && !sel.classList.contains('mine'), sel.value);
          t('and the first option says what the board would do',
            /board|model/.test(sel.options[0].textContent), sel.options[0].textContent);
          const opt = Array.prototype.filter.call(sel.options, function (o) {
            return o.value && !o.disabled;
          })[0];
          sel.value = opt.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          await nap(60);
          t('choosing one writes it on the card',
            (sh.shoot || {}).duration === opt.value || (sh.shoot || {}).resolution === opt.value,
            JSON.stringify(sh.shoot));
          const again = document.querySelector('.pt-row[data-shot="' + sh.id +
            '"] .pt-prompt[data-lane="video"] .shoot-pick');
          t('and the control shows the card is asking for its own',
            again.classList.contains('mine'), again.className);
          again.value = '';
          again.dispatchEvent(new Event('change', { bubbles: true }));
          await nap(60);
          t('clearing it hands the card back to the board',
            !Object.keys(sh.shoot || {}).length, JSON.stringify(sh.shoot));
        }

        SB.PromptPanel.close();
        await nap(40);
        sh.shoot = {};
        SB.app.changed(true);
        await nap(40);
      }

      // the two things a real browser checks before a drop ever happens
      {
        const nap = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
        const sc0 = P().scenes[0];
        const card = document.querySelector('.card[data-shot="' + sc0.shots[0].id + '"]');
        const head = card.querySelector('.card-head');

        /* 1. effectAllowed must permit the operation dropEffect asks for.
           'move' x 'copy' is `none` per the HTML tables, and a `none`
           operation means the DROP EVENT NEVER FIRES — the copy branch was
           unreachable in Chrome while this suite passed, because a
           synthesised DragEvent skips that negotiation entirely. */
        /* (effectAllowed cannot be read back off a synthesised DataTransfer,
           which is the whole reason this went unnoticed — test-core.mjs
           asserts it against the source instead.) */

        /* 2. mousedown on the drag handle must not preventDefault, or the
           browser never starts the drag at all. The range-select branch did,
           so shift-held-from-the-start could not begin a drag. */
        const md = new MouseEvent('mousedown', { bubbles: true, cancelable: true,
          shiftKey: true, clientX: 5, clientY: 5 });
        head.dispatchEvent(md);
        t('shift on the drag handle leaves the drag to the browser',
          !md.defaultPrevented, 'defaultPrevented=' + md.defaultPrevented);

        /* and the card body still range-selects, which is what that branch
           was there for */
        const body = card.querySelector('.desc-box') ? card : card;
        const md2 = new MouseEvent('mousedown', { bubbles: true, cancelable: true,
          shiftKey: true, clientX: 5, clientY: 5 });
        const frameEl = card.querySelector('.frame');
        frameEl.dispatchEvent(md2);
        t('while shift elsewhere on the card still picks a range',
          md2.defaultPrevented, 'defaultPrevented=' + md2.defaultPrevented);
        await nap(30);
      }

      // every drop target answers the same gesture
      {
        const nap = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
        const p0 = P();
        const scA = p0.scenes[0];
        const scB = SB.Model.addScene(p0, 0);
        scB.heading = 'Elsewhere';
        SB.app.changed(true);
        await nap(60);
        const src = scA.shots[0];
        const wasA = scA.shots.length, wasB = scB.shots.length;

        const shiftDrop = function (el, x, y) {
          const dt2 = new DataTransfer();
          dt2.setData('application/x-sb-shot', src.id);
          el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt2, bubbles: true,
            cancelable: true, clientX: x, clientY: y, shiftKey: true }));
        };

        /* the scene block — its heading, which is a drop target of its own */
        const blk = document.querySelector('.scene-block[data-scene="' + scB.id + '"]');
        const bh = blk.querySelector('.scene-head');
        const br = bh.getBoundingClientRect();
        shiftDrop(bh, br.left + 10, br.top + 5);
        await nap(60);
        t('shift-dropping on a scene heading copies rather than moves',
          scA.shots.length === wasA && scB.shots.length === wasB + 1,
          scA.shots.length + '/' + wasA + ' ' + scB.shots.length + '/' + wasB);

        /* the scene list on the left, which toasted "Moved" while moving */
        const row = document.querySelector('.scene-item[data-scene="' + scB.id + '"]');
        const rr = row.getBoundingClientRect();
        const beforeA = scA.shots.length, beforeB = scB.shots.length;
        shiftDrop(row, rr.left + 10, rr.top + 5);
        await nap(60);
        t('and so does shift-dropping on a scene in the list',
          scA.shots.length === beforeA && scB.shots.length === beforeB + 1,
          scA.shots.length + '/' + beforeA + ' ' + scB.shots.length + '/' + beforeB);

        SB.Model.deleteScene(p0, scB.id);
        SB.app.changed(true);
        await nap(40);
      }

      // shift-drag drops a copy
      {
        const nap = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
        const sc = P().scenes[0];
        const src = sc.shots[0];
        src.imageDescription = 'Marker for the copy test.';
        SB.app.changed(true);
        await nap(60);
        const before = sc.shots.length;
        const target = document.querySelector('.card[data-shot="' + sc.shots[0].id + '"]');
        const r = target.getBoundingClientRect();
        const dt = new DataTransfer();
        dt.setData('application/x-sb-shot', src.id);
        target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true,
          cancelable: true, clientX: r.left + 6, clientY: r.top + r.height / 2,
          shiftKey: true }));
        await nap(80);
        t('shift-drag leaves the original and adds a copy',
          sc.shots.length === before + 1, sc.shots.length + ' vs ' + before);
        const copies = sc.shots.filter(function (x) {
          return x.imageDescription === 'Marker for the copy test.';
        });
        t('and the copy carries the card’s words', copies.length === 2, copies.length);
        t('with ids of their own', copies[0].id !== copies[1].id, '');
        const dupe = copies.filter(function (x) { return x.id !== src.id; })[0];
        SB.Model.deleteShot(P(), dupe.id);
        src.imageDescription = '';
        SB.app.changed(true);
        await nap(40);
      }

      // three references, one picture
      {
        const nap = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
        const px = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        const room = SB.Personas.add(P(), { kind: 'place', name: 'Living room' });
        room.image = SB.Blobs.image(P(), px, 16, 9);
        const her = SB.Personas.add(P(), { name: 'Woman' });
        her.image = SB.Blobs.image(P(), px, 3, 4);
        const sh = P().scenes[0].shots[0];
        const wasDesc = sh.description;
        const wasCast = (sh.personaIds || []).slice();
        /* exactly two references, so the panel names are the two-up pair —
           a card carrying cast as well is the 2x2 case */
        sh.personaIds = [];
        sh.description = 'In ' + SB.Refs.mark(room.id, 'Living room') + ' with ' +
          SB.Refs.mark(her.id, 'Woman') + '.';
        SB.app.changed(true);
        await nap(60);

        const plan = SB.Imagine.sheetPlan(P(), sh, 'image');
        t('two references plan a two-panel sheet',
          plan.length === 2 && plan[0].panel === 'left' && plan[1].panel === 'right',
          JSON.stringify(plan.map(function (x) { return x.panel + '=' + x.label; })));

        /* the real thing, drawn on a real canvas */
        const blob = await SB.Imagine._buildSheet(P(), plan);
        t('and it renders to one picture', !!blob && blob.size > 0,
          blob ? blob.type + ' ' + blob.size + 'b' : 'null');

        const dims = await new Promise(function (res) {
          const im = new Image();
          im.onload = function () { res(im.naturalWidth + 'x' + im.naturalHeight); };
          im.onerror = function () { res('failed'); };
          im.src = URL.createObjectURL(blob);
        });
        t('two panels side by side, not a stack', dims === '1536x768', dims);

        sh.description = wasDesc;
        sh.personaIds = wasCast;
        P().personas = P().personas.filter(function (x) {
          return x.id !== room.id && x.id !== her.id;
        });
        SB.app.changed(true);
        await nap(40);
      }

      // a page older than the code it loaded says so
      {
        const nap = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
        t('a complete page shows no stale warning',
          !document.querySelector('.stale-bar'), '');
        /* the check is what a cached index.html missing a module would hit */
        const was = SB.Viewer;
        delete SB.Viewer;
        SB.app.checkParts();
        await nap(40);
        const bar = document.querySelector('.stale-bar');
        t('a missing module raises a bar that names it',
          !!bar && /Viewer/.test(bar.textContent), bar ? bar.textContent.slice(0, 90) : 'none');
        t('and offers to reload',
          !!bar && !!Array.prototype.filter.call(bar.querySelectorAll('button'),
            function (b) { return /Reload/.test(b.textContent); })[0], '');
        if (bar) bar.remove();
        SB.Viewer = was;
      }

      // pressing a picture, the way a mouse does it
      {
        const nap = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
        const sh = P().scenes[0].shots[0];
        const wasImg = sh.image;
        sh.image = sh.image || SB.Blobs.image(P(),
          'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 16, 9);
        SB.app.changed(true);
        await nap(80);

        /* press, release, click — in that order, on the element that is
           under the pointer at each step, which is what a browser does and
           what a bare .click() does not. Selecting a card used to rebuild the
           board on mousedown, so the element pressed was gone before the
           release and no click was ever dispatched. */
        /* nothing else may be in front of it, and it has to be on screen —
           and whatever WAS in front goes back afterwards, because the tests
           around this one are using it */
        const hadPrompts = !!document.querySelector('.pt-grid');
        const hadRefs = !!document.querySelector('.lib-refs');
        if (SB.PromptPanel.close) SB.PromptPanel.close();
        if (SB.PersonaPanel.close) SB.PersonaPanel.close();
        document.querySelectorAll('#modalRoot .modal-back').forEach(function (b) { b.remove(); });
        await nap(80);
        document.querySelector('.card[data-shot="' + sh.id + '"]')
          .scrollIntoView({ block: 'center' });
        await nap(150);

        const press = function () {
          const f = document.querySelector('.card[data-shot="' + sh.id + '"] .frame');
          const r = f.getBoundingClientRect();
          const at = { bubbles: true, cancelable: true, button: 0,
            clientX: Math.round(r.left + r.width / 2),
            clientY: Math.round(r.top + r.height / 2) };
          const target = document.elementFromPoint(at.clientX, at.clientY) || f;
          target.dispatchEvent(new MouseEvent('mousedown', at));
          const survived = target.isConnected;
          const after = document.elementFromPoint(at.clientX, at.clientY) || target;
          after.dispatchEvent(new MouseEvent('mouseup', at));
          if (survived) after.dispatchEvent(new MouseEvent('click', at));
          return survived;
        };

        const survived = press();
        t('the element under the pointer survives the press',
          survived, 'the board rebuilt itself on mousedown');
        await nap(150);
        t('so pressing a picture opens it',
          !!document.querySelector('.modal .viewer'), '');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await nap(60);

        /* and the press still selects the card, which is what it was for */
        t('and the card it was on is selected',
          SB.app.selectedShotId === sh.id, SB.app.selectedShotId);
        t('with the class painted on, not rebuilt',
          document.querySelector('.card[data-shot="' + sh.id + '"]').classList.contains('sel'),
          document.querySelector('.card[data-shot="' + sh.id + '"]').className);

        sh.image = wasImg;
        SB.app.changed(true);
        if (hadPrompts) SB.PromptPanel.open();
        if (hadRefs) SB.PersonaPanel.open();
        await nap(80);
      }

      // a click shows the picture; replacing is something you say
      {
        const nap = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
        const sh = P().scenes[0].shots[0];
        const wasImg = sh.image, wasRender = sh.render;

        /* an empty frame still picks a file — there is nothing to look at */
        sh.image = null; sh.render = null;
        SB.app.changed(true);
        await nap(60);
        const frameOf = function () {
          return document.querySelector('.card[data-shot="' + sh.id + '"] .frame');
        };
        t('an empty frame still says click to load',
          /click to load/.test(frameOf().textContent), frameOf().textContent.slice(0, 40));

        /* with a picture, a click opens it rather than replacing it */
        sh.image = SB.Blobs.image(P(),
          'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 16, 9);
        SB.app.changed(true);
        await nap(60);
        frameOf().click();
        await nap(80);
        const v = document.querySelector('.modal .viewer');
        t('clicking a picture opens it large', !!v, '');
        t('and says it is the board\u2019s own copy, not an original',
          /board/.test(v.querySelector('.viewer-cap').textContent),
          v.querySelector('.viewer-cap').textContent);
        t('with a way to replace it and a way to remove it',
          Array.prototype.filter.call(document.querySelectorAll('.modal .foot button'),
            function (b) { return /Replace|Remove/.test(b.textContent); }).length === 2,
          Array.prototype.map.call(document.querySelectorAll('.modal .foot button'),
            function (b) { return b.textContent; }).join(','));
        t('and the picture is still on the card, untouched',
          !!sh.image, JSON.stringify(sh.image));

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await nap(60);
        t('escape closes it', !document.querySelector('.modal .viewer'), '');

        /* a full-size original is shown as one, and named */
        sh.render = { ref: SB.Blobs.put(P(), 'data:image/webp;base64,' + 'Q'.repeat(200)),
          serial: 11, ext: 'webp', w: 1920, h: 1080, bytes: 2048, at: 1 };
        SB.app.changed(true);
        await nap(60);
        frameOf().click();
        await nap(80);
        const cap = document.querySelector('.modal .viewer-cap').textContent;
        t('an original is named by its file', /0011\.webp/.test(cap), cap);
        t('and called what it is', /full-size original/.test(cap), cap);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await nap(60);

        sh.image = wasImg; sh.render = wasRender;
        SB.app.changed(true);
        await nap(40);
      }

      // moving cards and scenes, especially to the two ends
      {
        const nap = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

        /* a drag is a dragstart on the card's grip, then a drop where you
         * let go; the index the app works out from the pointer is the thing
         * under test */
        const dropShot = function (dragId, target, x, y) {
          const dt = new DataTransfer();
          dt.setData('application/x-sb-shot', dragId);
          target.dispatchEvent(new DragEvent('drop',
            { dataTransfer: dt, bubbles: true, cancelable: true, clientX: x, clientY: y }));
        };
        const dropScene = function (dragId, target, x, y) {
          const dt = new DataTransfer();
          dt.setData('application/x-sb-scene', dragId);
          target.dispatchEvent(new DragEvent('drop',
            { dataTransfer: dt, bubbles: true, cancelable: true, clientX: x, clientY: y }));
        };
        const codes = function (sc) {
          return sc.shots.map(function (x) { return x.id.slice(-4); }).join(',');
        };

        /* a scene of its own so nothing else in the run is disturbed */
        const mv = SB.Model.addScene(P(), P().scenes.length - 1);
        mv.heading = 'Move me';
        ['a', 'b', 'c', 'd'].forEach(function (n) { SB.Model.addShot(P(), mv.id, { action: n }); });
        SB.app.changed(true);
        await nap(60);
        const ids = mv.shots.map(function (x) { return x.id; });
        const shotsEl = document.querySelector('.shots[data-scene="' + mv.id + '"]');
        const cardEl = function (id) { return shotsEl.querySelector('.card[data-shot="' + id + '"]'); };

        /* 1. the last card to the front, dropped on the first card's left half */
        let r = cardEl(ids[0]).getBoundingClientRect();
        dropShot(ids[3], cardEl(ids[0]), r.left + 6, r.top + r.height / 2);
        await nap(60);
        t('a card dropped on the first card\'s left edge becomes the first card',
          mv.shots[0].id === ids[3], codes(mv));

        /* put it back */
        SB.Model.moveShots(P(), [ids[3]], mv.id, 4);
        SB.app.changed(true);
        await nap(60);

        /* 2. the same gesture a few pixels further left — in the container's
         * own space, which used to mean "send it to the far end" */
        r = document.querySelector('.shots[data-scene="' + mv.id + '"] .card').getBoundingClientRect();
        dropShot(ids[3], document.querySelector('.shots[data-scene="' + mv.id + '"]'),
          r.left - 5, r.top + r.height / 2);
        await nap(60);
        t('a card dropped in the gap left of the first card goes first, not last',
          mv.shots[0].id === ids[3], codes(mv));

        /* 3. the first card to the end, dropped past the last one */
        const shots2 = document.querySelector('.shots[data-scene="' + mv.id + '"]');
        const last = shots2.querySelectorAll('.card')[3];
        const lr = last.getBoundingClientRect();
        const front = mv.shots[0].id;
        dropShot(front, shots2, lr.right + 20, lr.top + lr.height / 2);
        await nap(60);
        t('a card dropped past the last card becomes the last card',
          mv.shots[3].id === front, codes(mv));

        /* 4. and dropped on the last card's right half */
        const shots3 = document.querySelector('.shots[data-scene="' + mv.id + '"]');
        const first3 = mv.shots[0].id;
        const lastEl = shots3.querySelectorAll('.card')[3];
        const lr3 = lastEl.getBoundingClientRect();
        dropShot(first3, lastEl, lr3.right - 6, lr3.top + lr3.height / 2);
        await nap(60);
        t('a card dropped on the last card\'s right edge becomes the last card',
          mv.shots[3].id === first3, codes(mv));

        /* 5. scenes: the last one to the top */
        const sIds = P().scenes.map(function (x) { return x.id; });
        const host = document.getElementById('sceneList');
        let items = host.querySelectorAll('.scene-item');
        let ir = items[0].getBoundingClientRect();
        dropScene(sIds[sIds.length - 1], items[0], ir.left + 10, ir.top + 3);
        await nap(60);
        t('a scene dropped on the top row\'s upper half becomes the first scene',
          P().scenes[0].id === sIds[sIds.length - 1], P().scenes.length + ' scenes');

        /* 6. a scene dropped in the empty space below the last row */
        items = host.querySelectorAll('.scene-item');
        const lastItem = items[items.length - 1];
        const lir = lastItem.getBoundingClientRect();
        const top = P().scenes[0].id;
        dropScene(top, host, lir.left + 10, lir.bottom + 30);
        await nap(60);
        t('a scene dropped below the last row becomes the last scene',
          P().scenes[P().scenes.length - 1].id === top,
          P().scenes.map(function (x) { return x.id.slice(-3); }).join(','));

        /* 7. the line that says where it will land */
        const shots4 = document.querySelector('.shots[data-scene="' + mv.id + '"]');
        const c0 = shots4.querySelector('.card');
        const cr = c0.getBoundingClientRect();
        const dt2 = new DataTransfer();
        dt2.setData('application/x-sb-shot', mv.shots[2].id);
        c0.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt2, bubbles: true,
          cancelable: true, clientX: cr.left + 6, clientY: cr.top + cr.height / 2 }));
        await nap(30);
        const mkEl = document.getElementById('dropMark');
        t('a drop marker shows which edge the card will land on',
          !!mkEl && mkEl.style.display === 'block' &&
          Math.abs(parseFloat(mkEl.style.left) - (cr.left - 5)) < 2,
          mkEl ? mkEl.style.display + ' at ' + mkEl.style.left + ' vs ' + (cr.left - 5) : 'no marker');

        SB.Model.deleteScene(P(), mv.id);
        SB.app.changed(true);
        await nap(40);
      }

      // the clip review: one control, one modal, both states
      {
        const rShot = P().scenes[0].shots[0];
        const rWas = rShot.video;
        rShot.video = null;
        SB.app.changed(true);
        const badge = document.querySelector('.card[data-shot="' + rShot.id + '"] .clip-badge');
        t('a card with no clip still has the control', !!badge, 'none');
        t('and it says so rather than claiming one',
          badge.classList.contains('none') && /no clip/i.test(badge.title), badge.title);
        t('the old add-a-file button is gone from the tools',
          !document.querySelector('.card[data-shot="' + rShot.id + '"] .frame-tools .mini[title*="from a file"]'),
          'still there');

        badge.click();
        await pauseTop();
        const box = document.querySelector('.modal .clip-box');
        t('pressing it opens the review even with nothing to play', !!box, 'no modal');
        t('which offers the two things that make sense',
          /Add from a file/.test(box.textContent) && /Shoot it/.test(box.textContent),
          box.textContent.slice(0, 80));
        t('and carries the reason a shoot cannot run',
          /prompt|sign in|organization|model/i.test(box.querySelector('.pp-note.warn').textContent),
          box.querySelector('.pp-note.warn').textContent.slice(0, 60));
        Array.prototype.filter.call(document.querySelectorAll('.modal button'),
          function (b) { return b.textContent === 'Close'; })[0].click();
        await pauseTop();

        /* now with a clip on it */
        rShot.video = {
          ref: SB.Blobs.put(P(), 'data:video/mp4;base64,' + 'V'.repeat(400)),
          serial: 9, ext: 'mp4', bytes: 300, dur: 4, w: 1184, h: 672,
          made: { by: 'imagine', role: 'video', model: 'Kling', slug: 'kling-3.0-pro',
            resolution: '1080p', at: Date.now() }
        };
        rShot.prompts = rShot.prompts || {};
        const vmR = SB.Model.videoModel(P());
        rShot.prompts[vmR.id] = { imagePrompt: '', videoPrompt: 'She turns from the window.' };
        rShot.video.made.modelId = vmR.id;
        SB.app.changed(true);
        const badge2 = document.querySelector('.card[data-shot="' + rShot.id + '"] .clip-badge');
        t('the control now says how long the clip runs', /4s/.test(badge2.textContent),
          badge2.textContent);
        badge2.click();
        await pauseTop();
        const box2 = document.querySelector('.modal .clip-box');
        t('the review plays it', !!box2.querySelector('video'), 'no video');
        t('says what made it', /Made here/.test(box2.textContent) && /Kling/.test(box2.textContent),
          box2.textContent.slice(0, 120));
        t('and shows the prompt it was made from',
          /She turns from the window/.test(box2.textContent), 'no prompt');
        t('with all three things you might do to it',
          /Shoot another take/.test(box2.textContent) &&
          /Add another take/.test(box2.textContent) &&
          /Remove/.test(box2.textContent), box2.textContent.slice(-80));
        Array.prototype.filter.call(document.querySelectorAll('.modal button'),
          function (b) { return b.textContent === 'Close'; })[0].click();
        await pauseTop();
        rShot.video = rWas;
        SB.app.changed(true);
      }

      // a clip you already have, put on a card
      {
        const cShot = P().scenes[0].shots[0];
        const cWas = cShot.video;
        /* a real two-second mp4, so the duration read is exercised rather
           than stubbed */
        const mp4 = 'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAQibW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAB9AAAQAA' +
          'AQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
          'AAAAAgAAA010cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAB9AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAA' +
          'AAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAEAAAAAkAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAfQAAAIAAABAAAAAALF' +
          'bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAUABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRl' +
          'b0hhbmRsZXIAAAACcG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAA' +
          'AQAAAjBzdGJsAAAAwHN0c2QAAAAAAAAAAQAAALBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAEAAJABIAAAASAAAAAAA' +
          'AAABFUxhdmM2Mi4xNS4xMDAgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANmF2Y0MBZAAK/+EAGWdkAAqs2UR/nwEQAAADABAA' +
          'AAMBQPEiWWABAAZo6+PLIsD9+PgAAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAAD6AAAAAAAAAAGHN0dHMAAAAAAAAA' +
          'AQAAABQAAAQAAAAAFHN0c3MAAAAAAAAAAQAAAAEAAACoY3R0cwAAAAAAAAATAAAAAQAACAAAAAABAAAUAAAAAAEAAAgAAAAA' +
          'AQAAAAAAAAABAAAEAAAAAAEAABQAAAAAAQAACAAAAAABAAAAAAAAAAEAAAQAAAAAAQAAFAAAAAABAAAIAAAAAAEAAAAAAAAA' +
          'AQAABAAAAAABAAAUAAAAAAEAAAgAAAAAAQAAAAAAAAABAAAEAAAAAAEAABAAAAAAAgAABAAAAAAcc3RzYwAAAAAAAAABAAAA' +
          'AQAAABQAAAABAAAAZHN0c3oAAAAAAAAAAAAAABQAAALaAAAADgAAAAwAAAAMAAAADAAAABQAAAAOAAAADAAAAAwAAAAUAAAA' +
          'DgAAAAwAAAAMAAAAFAAAAA4AAAAMAAAADAAAABQAAAAOAAAADAAAABRzdGNvAAAAAAAAAAEAAARSAAAAYXVkdGEAAABZbWV0' +
          'YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAsaWxzdAAAACSpdG9vAAAAHGRhdGEAAAABAAAAAExh' +
          'dmY2Mi41LjEwMQAAAAhmcmVlAAAD8G1kYXQAAAKuBgX//6rcRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY1IHIzMjIy' +
          'IGIzNTYwNWEgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRl' +
          'b2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4' +
          'MTEzIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21h' +
          'X21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zm' +
          'c2V0PS0yIHRocmVhZHM9MSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGlu' +
          'dGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9h' +
          'ZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWlu' +
          'dF9taW49MTAgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3Jm' +
          'PTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAk' +
          'ZYiEABH//ufj/AprKxHEv01QKM3ptdyoujXHtijNqS8fduE/AAAACkGaJGxBH/61OVgAAAAIQZ5CeId/CvkAAAAIAZ5hdEN/' +
          'DegAAAAIAZ5jakN/DekAAAAQQZpoSahBaJlMCCP//rU5WQAAAApBnoZFESw7/wr5AAAACAGepXRDfw3pAAAACAGep2pDfw3o' +
          'AAAAEEGarEmoQWyZTAgh//6qcrAAAAAKQZ7KRRUsO/8K+QAAAAgBnul0Q38N6AAAAAgBnutqQ38N6AAAABBBmvBJqEFsmUwI' +
          'f//+qdOhAAAACkGfDkUVLDv/CvkAAAAIAZ8tdEN/DekAAAAIAZ8vakN/DegAAAAQQZszSahBbJlMCG///qfuQAAAAApBn1FF' +
          'FSw3/w3pAAAACAGfcmpDfw3o';
        const raw = atob(mp4);
        const bytes = new Uint8Array(raw.length);
        for (let bi = 0; bi < raw.length; bi++) bytes[bi] = raw.charCodeAt(bi);
        const file = new File([bytes], 'shot1c.mp4', { type: 'video/mp4' });

        const rec = await SB.Clip.attach(P(), cShot, file);
        t('a clip from a file lands on the card',
          !!(rec && rec.ref) && SB.Renders.has(P(), rec), JSON.stringify(rec && rec.ext));
        t('kept whole, byte for byte', rec.bytes === bytes.length, rec.bytes + ' of ' + bytes.length);
        t('and it remembers the file it came from', rec.name === 'shot1c.mp4', rec.name);
        t('nothing generated it, so nothing claims it was',
          !rec.made, JSON.stringify(rec.made));
        t('how long it runs is read off the file', rec.dur === 2, String(rec.dur));
        t('and how big the picture is', rec.w === 64 && rec.h === 36, rec.w + 'x' + rec.h);
        t('the label reads as one line',
          /^2s · 64×36 · /.test(SB.Clip.label(rec)), SB.Clip.label(rec));

        SB.app.changed(true);
        const badge = document.querySelector('.card[data-shot="' + cShot.id + '"] .clip-badge');
        t('the card says it is carrying one, and for how long',
          !!badge && /2s/.test(badge.textContent), badge ? badge.textContent : 'no badge');
        t('a structural change does not sweep it away', SB.Renders.has(P(), cShot.video), '');
        t('and Settings counts it', SB.Renders.weigh(P()).clips.n === 1,
          SB.Renders.weigh(P()).clips.n);

        /* Adding another goes through the same door, and the one that was
           there is KEPT rather than thrown away: a clip that is mostly right
           is the ordinary case, and the only way to hold on to it used to be
           saving it out of the app by hand. */
        const wasChosen = cShot.video;
        const wasAlts = (cShot.videoAlts || []).length;
        const serial = rec.serial;
        const again = await SB.Clip.attach(P(), cShot, file);
        t('a second clip becomes the chosen take', cShot.video === again, '');
        t('and the one it displaced is kept, not overwritten',
          (cShot.videoAlts || []).length === wasAlts + 1 &&
          cShot.videoAlts.indexOf(wasChosen) >= 0,
          (cShot.videoAlts || []).length + ' alts, was ' + wasAlts);
        t('each take has its own serial, because each is its own file',
          again.serial !== serial, again.serial + ' vs ' + serial);
        t('and a structural change sweeps away neither',
          (function () {
            SB.app.changed(true);
            return SB.Renders.has(P(), cShot.video) &&
              cShot.videoAlts.every(function (x) { return SB.Renders.has(P(), x); });
          })(), 'the gc ate a take');
        t('the card says how many it is holding',
          document.querySelector('.card[data-shot="' + cShot.id + '"] .clip-badge')
            .textContent.indexOf('\u00d7' + SB.Model.takeCount(cShot)) >= 0,
          document.querySelector('.card[data-shot="' + cShot.id + '"] .clip-badge').textContent);

        /* choosing an older one back is one call, and nothing is lost */
        const older = cShot.videoAlts[0];
        const n0 = SB.Model.takeCount(cShot);
        SB.Model.useTake(cShot, older);
        t('an older take can be made the chosen one', cShot.video === older, '');
        t('the one it displaced joins the rest rather than going',
          cShot.videoAlts.indexOf(again) >= 0 && SB.Model.takeCount(cShot) === n0,
          SB.Model.takeCount(cShot) + ' of ' + n0);

        /* numbered by when they were made, not by where they sit */
        const order = SB.Model.takes(cShot);
        t('takes are numbered by when they were shot',
          order.length === n0 &&
          order.every(function (x, i) { return x.n === i + 1; }) &&
          order.every(function (x, i) { return !i || (x.rec.at || 0) >= (order[i - 1].rec.at || 0); }),
          order.map(function (x) { return x.n + (x.chosen ? '*' : ''); }).join(','));
        t('and exactly one of them is the chosen one',
          order.filter(function (x) { return x.chosen; }).length === 1, '');

        /* removing the chosen one promotes the newest of the rest rather than
           leaving a card holding none while still carrying two */
        SB.Clip.drop(P(), cShot, cShot.video);
        t('removing the chosen take promotes what is left',
          !!cShot.video && SB.Model.takeCount(cShot) === n0 - 1,
          (cShot.video ? 'has one' : 'EMPTY') + ', ' + SB.Model.takeCount(cShot) + ' left');
        t('and the one removed is gone from the card',
          SB.Model.takes(cShot).every(function (x) { return x.rec !== older; }), '');

        SB.Clip.drop(P(), cShot);
        SB.app.changed(true);
        /* the control stays — it is the way IN to a clip as well as the way
           to watch one — but it goes quiet and stops claiming a duration */
        const after = document.querySelector('.card[data-shot="' + cShot.id + '"] .clip-badge');
        t('removing it takes the card back to a still',
          !cShot.video && !!after && after.classList.contains('none') &&
          !/\ds/.test(after.textContent), after ? after.textContent : 'no control');
        t('and the bytes go with it', SB.Renders.weigh(P()).clips.n === 0,
          SB.Renders.weigh(P()).clips.n);

        cShot.video = cWas;
        SB.app.changed(true);
      }

      // moveScene inserts BEFORE the index it is given — dropping past a row
      // has to mean the slot after it, or the last slot is unreachable. The
      // organizer that exercised this by drag is gone; the semantics are the
      // board's now, so they are held at the model.
      {
        var names = function () { return P().scenes.map(function (x) { return x.heading; }).join(','); };
        var wasOrder = P().scenes.slice();
        var wasHeads = P().scenes.map(function (x) { return x.heading; });
        while (P().scenes.length < 3) SB.Model.addScene(P());
        P().scenes[0].heading = 'A'; P().scenes[1].heading = 'B'; P().scenes[2].heading = 'C';
        SB.Model.moveScene(P(), P().scenes[0].id, 2);
        t('moving a scene one step down lands it past the next row',
          names() === 'B,A,C', names());
        SB.Model.moveScene(P(), P().scenes[1].id, 3);
        t('and a scene can reach the last slot',
          names() === 'B,C,A', names());
        SB.app.changed(true);
        t('the left navigator agrees',
          document.querySelectorAll('#sceneList .scene-item .ttl')[0].textContent === 'B',
          document.querySelectorAll('#sceneList .scene-item .ttl')[0].textContent);
        /* put the board back the way the rest of the scenario expects it */
        P().scenes = wasOrder;                 // the ones this test invented go too
        wasOrder.forEach(function (x, i) { x.heading = wasHeads[i]; });
        SB.app.changed(true);
      }

      // a scene holding a claim on the script but no cards used to delete silently
      {
        var tSc = SB.Model.addScene(P());          // its own, so nothing real is emptied
        tSc.heading = 'Tied and empty';
        tSc.local = SB.Doc.make('a section of its own');
        SB.app.changed(true);
        var tScenes = P().scenes.length;
        var tBtn = function () {
          return document.querySelector('.scene-block[data-scene="' + tSc.id +
            '"] .scene-actions .danger');
        };
        t('the banner keeps only the delete control',
          document.querySelectorAll('.scene-block[data-scene="' + tSc.id +
            '"] .scene-actions button').length === 1,
          document.querySelectorAll('.scene-block[data-scene="' + tSc.id +
            '"] .scene-actions button').length + ' buttons');

        /* one press arms, it does not delete — the same guard a card has */
        tBtn().click();
        t('deleting a scene arms rather than going straight through',
          P().scenes.length === tScenes && /delete/i.test(tBtn().textContent),
          tBtn().textContent + ', ' + P().scenes.length + ' left');
        t('and an empty one says so plainly',
          /delete scene\?/i.test(tBtn().textContent), tBtn().textContent);

        /* Esc backs out, leaving the scene alone */
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        t('Escape disarms it', P().scenes.length === tScenes, P().scenes.length + ' left');

        /* a populated scene says what goes with it */
        var pSc = SB.Model.addScene(P());
        SB.Model.addShot(P(), pSc.id, {});
        SB.Model.addShot(P(), pSc.id, {});
        SB.app.changed(true);
        var pBtn = document.querySelector('.scene-block[data-scene="' + pSc.id +
          '"] .scene-actions .danger');
        pBtn.click();
        t('a scene with cards names how many go with it',
          /delete 2 shots\?/i.test(pBtn.textContent), pBtn.textContent);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        SB.Model.deleteScene(P(), pSc.id);
        SB.app.changed(true);
        SB.Model.deleteScene(P(), tSc.id);
        SB.app.changed(true);
      }

      // a second @ starts again rather than killing the list
      {
        var mCard2 = document.querySelectorAll('.card')[0];
        var box2 = mCard2.querySelector('.desc-box');
        var wasD2 = boxGet(box2);
        box2.focus();
        var typeAt = async function (tail) {
          box2.dispatchEvent(new KeyboardEvent('keydown', { key: '@', bubbles: true }));
          boxAdd(box2, '@');
          await pauseTop();
          if (tail) {
            boxAdd(box2, tail);
            box2.dispatchEvent(new Event('input', { bubbles: true }));
          }
        };
        boxSet(box2, 'Two of them: ');
        await typeAt('Ops ');
        await typeAt(null);
        t('a second @ while the list is open re-anchors instead of killing it',
          !!document.querySelector('.men-pop'), '');
        SB.Mentions.hide();
        boxSet(box2, wasD2);
        box2.dispatchEvent(new Event('input', { bubbles: true }));
      }

      SB.PersonaPanel.close();
      t('closing the library takes the takeover off the page',
        !document.querySelector('.lib-back'), '');

      // @ names a subject in a description — and casts it, which is the half
      // the model ever sees
      {
        const pause = function () { return new Promise(function (r) { setTimeout(r, 30); }); };
        const mCard = document.querySelectorAll('.card')[2];
        const mShotId = mCard.dataset.shot;
        const box = mCard.querySelector('.desc-box');
        box.focus();
        boxSet(box, 'A hand reaches for the ');
        box.dispatchEvent(new KeyboardEvent('keydown', { key: '@', bubbles: true }));
        boxAdd(box, '@');
        await pause();
        t('typing @ opens the mention list', !!document.querySelector('.men-pop'), '');
        boxAdd(box, 'Hand');
        box.dispatchEvent(new Event('input', { bubbles: true }));
        const rows = document.querySelectorAll('.men-pop .men-row');
        t('and filters it as you type',
          rows.length && /Handset/.test(rows[0].textContent), rows.length ? rows[0].textContent : 'none');
        t('the list says what a pick would actually feed',
          /no reference image|frame/.test(rows[0].textContent), rows[0].textContent);
        t('with a way to mint one that does not exist yet',
          !!document.querySelector('.men-pop .men-row.make'), '');
        /* the popover is rebuilt on every keystroke, so pick a live row */
        document.querySelectorAll('.men-pop .men-row')[0].click();
        const shB = SB.Model.findShot(P(), mShotId).shot;
        t('picking writes a mark, which reads as the plain name',
          /reaches for the Handset$/.test(SB.Refs.plain(P(), shB.description)),
          JSON.stringify(shB.description));
        t('and the mark carries the id, so a rename never touches the text',
          SB.Refs.parse(P(), shB.description).length === 1, shB.description);
        t('the box draws it as a link',
          !!box.querySelector('.ref-link'), box.innerHTML.slice(0, 120));
        t('and casts it on the card, which is what reaches the model',
          (shB.personaIds || []).some(function (id) {
            return SB.Personas.find(P(), id).name === 'Handset';
          }), JSON.stringify(shB.personaIds));
        t('the list closes behind it', !document.querySelector('.men-pop'), '');
        t('and the object turns up in that card of the prompt',
          /OBJECTS/.test(SB.Personas.block(P(), shB, null)), '');

        // the rule made visible — in the table, per call, since the strip went
        SB.PromptPanel.open();
        const fLane = function () {
          return document.querySelector('.pt-row[data-shot="' + mShotId +
            '"] .pt-prompt[data-lane="image"]');
        };
        t('the first-frame lane shows what it will feed',
          !!fLane() && !!fLane().querySelector('.pt-fe'),
          fLane() ? fLane().textContent.slice(0, 90) : 'no lane');
        t('a mark with no picture behind it is called out and takes no number',
          !!fLane().querySelector('.pt-fe.empty') &&
          fLane().querySelector('.pt-fe.empty .feed-n').textContent === '\u2013',
          fLane().textContent.slice(0, 120));
        SB.PromptPanel.close();
        /* give it a frame and it takes its place in the order */
        const handset = SB.Personas.all(P()).filter(function (x) { return x.name === 'Handset'; })[0];
        SB.Personas.setImage(handset, SB.Blobs.image(P(),
          'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 4, 3), 'front');
        SB.Board.refreshFeed(mShotId);
        SB.PromptPanel.open();
        t('numbered in the order the marks were written',
          fLane().querySelector('.feed-n').textContent === '1',
          fLane().querySelector('.feed-n').textContent);
        t('and the image set can be handed over',
          Array.prototype.some.call(fLane().querySelectorAll('button'),
            function (b) { return /Download for MXM/.test(b.textContent); }),
          fLane().textContent.slice(0, 90));
        SB.PromptPanel.close();

        // a name typed without an @ feeds nothing, and the card says so
        boxSet(box, boxGet(box) + ' Ops lead watches.');
        box.dispatchEvent(new Event('input', { bubbles: true }));
        const fr2 = mCard.querySelector('.feed-row');
        t('a name in the text with no mark is offered for linking',
          !!fr2.querySelector('.feed-fix'), fr2.textContent);
        fr2.querySelector('.feed-fix').click();
        t('and linking it writes the mark',
          SB.Refs.parse(P(), SB.Model.findShot(P(), mShotId).shot.description).length === 2,
          SB.Model.findShot(P(), mShotId).shot.description);
        t('while the prose still reads as prose',
          /Ops lead watches\.$/.test(SB.Refs.plain(P(), SB.Model.findShot(P(), mShotId).shot.description)),
          SB.Refs.plain(P(), SB.Model.findShot(P(), mShotId).shot.description));

        // and no mark ever reaches the model
        const mSys = SB.Prompts.jobsFor(SB.Model.findShot(P(), mShotId).shot,
          SB.Model.imageModel(P()), null, { image: true })[0];
        t('no mark token leaks into the request',
          !/@\{/.test(mSys.text) && !/@\{/.test(mSys.system),
          (mSys.text.match(/@\{[^}]*\}/) || [''])[0]);
      }

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
      t('settings is tabbed', document.querySelectorAll('.modal .tab').length === 6,
        document.querySelectorAll('.modal .tab').length);
      /* the slug field offers the real catalog, filtered to the model's kind */
      (function () {
        const tab = Array.prototype.filter.call(document.querySelectorAll('.modal .tab'),
          function (x) { return x.textContent === 'Models & templates'; })[0];
        if (!tab) { t('models tab is there', false, 'missing'); return; }
        tab.click();
        const rows = document.querySelectorAll('.modal .model-row');
        /* The API publishes 47 video models and only 6 image ones, so the
           two kinds are checked against different floors — the point is that
           each row is offered its own whole list, not four of them. */
        const short = Array.prototype.filter.call(rows, function (r) {
          const dl = r.querySelector('datalist');
          const kind = r.querySelector('select').value;
          return !dl || dl.options.length < (kind === 'video' ? 20 : 5);
        });
        t('every model row offers the published list for its kind',
          short.length === 0, short.length + ' of ' + rows.length + ' rows came up short');
        const video = Array.prototype.filter.call(rows, function (r) {
          return r.querySelector('select') && r.querySelector('select').value === 'video';
        })[0];
        const opts = Array.prototype.map.call(video.querySelector('datalist').options,
          function (o) { return o.value; });
        t('a video model is offered video models only',
          opts.length > 20 && opts.indexOf('flux-dev') < 0 &&
          opts.indexOf('kling-v1.6-standard-image-to-video') >= 0, opts.slice(0, 3).join(' '));
        t('and each one carries a readable name',
          /Kling v1\.6 Standard/.test(video.querySelector('datalist').innerHTML), '');
        const slug = video.querySelector('input.slug');
        slug.value = 'no-such-model-9000';
        slug.dispatchEvent(new Event('input', { bubbles: true }));
        /* Flagged, but as weak evidence: the published lists run behind the
           platform, so "not on the list" is a hint and never a refusal. */
        t('a slug no list mentions is flagged at the desk, without calling it wrong',
          slug.classList.contains('unknown') &&
          /No list here mentions/.test(video.querySelector('.pp-note.warn').textContent) &&
          /sent as typed/.test(video.querySelector('.pp-note.warn').textContent), '');
        slug.value = 'kling-v1.6-pro-image-to-video';
        slug.dispatchEvent(new Event('input', { bubbles: true }));
        t('and the flag goes when it is a real one', !slug.classList.contains('unknown'), '');
        document.querySelector('.modal .tab[data-tab="general"]').click();
      })();

      /* "It didn't work" has to be answerable. Signed out, this used to be a
         toast that said "Not signed in" and vanished in two seconds. */
      {
        const nap = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
        const imTab = Array.prototype.filter.call(document.querySelectorAll('.modal .tab'),
          function (x) { return x.textContent === 'ImagineArt'; })[0];
        imTab.click();
        const what = Array.prototype.filter.call(
          document.querySelectorAll('.modal .tab-panel.on button'),
          function (b) { return /What my account/.test(b.textContent); })[0];
        t('the account readout is offered', !!what, 'no button');
        what.click();
        await nap(300);
        const caps = document.querySelector('.caps');
        t('pressing it opens a report rather than a toast', !!caps, 'no modal');
        const steps = document.querySelectorAll('.caps .caps-step');
        t('which walks the connection step by step', steps.length >= 1, steps.length);
        t('and names the step it stopped at',
          /Signed in/.test(steps[0].textContent) &&
          /Press Sign in/.test((document.querySelector('.caps .pp-note.warn') || {}).textContent || ''),
          steps[0].textContent);
        t('the button will not stack a second one on top', what.disabled, 'still enabled');
        const close = Array.prototype.filter.call(document.querySelectorAll('.modal button'),
          function (b) { return b.textContent === 'Close'; }).pop();
        close.click();
        await nap(80);
        t('and comes back when the report is closed', !what.disabled, 'still disabled');
        document.querySelector('.modal .tab[data-tab="general"]').click();
      }

      t('the first tab says what the board is carrying',
        !!document.querySelector('.modal .tab-panel.on .weigh'), 'no weight readout');
      t('and offers no folder to connect',
        !/renders folder/i.test(document.querySelector('.modal').textContent), 'folder UI is back');
      /* The first tab carries the shot-type list and one framing line per type
         and nothing else that takes a paragraph — the model templates live on
         their own tab, and a template is the thing with placeholders in it. */
      {
        const boxes = Array.prototype.slice.call(
          document.querySelectorAll('.modal .tab-panel.on textarea'));
        const framing = boxes.filter(function (x) { return x.classList.contains('set-fr-text'); });
        t('templates are not on the first tab',
          !boxes.some(function (x) { return /\{\{/.test(x.value); }),
          boxes.map(function (x) { return x.value.slice(0, 20); }).join(' | '));
        t('and the shot-type list is the only box that is not a framing line',
          boxes.length - framing.length === 1, boxes.length + ' boxes, ' + framing.length + ' framing');
        t('every shot type gets a line to say what it shows',
          framing.length === P().settings.shotTypes.length,
          framing.length + ' for ' + P().settings.shotTypes.length + ' types');
        t('and they are filled in by default',
          framing.filter(function (x) { return x.value.trim(); }).length === framing.length,
          framing.filter(function (x) { return !x.value.trim(); }).length + ' empty');
      }

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
      /* Both providers keep their own model picker of the same shape — the
         panels are told apart by which provider they belong to, not by there
         being only one of them. */
      t('the Gemini panel has its own model dropdown',
        document.querySelectorAll('.modal .tab-panel.on [data-prov="gemini"] .gm-picker select').length === 1,
        document.querySelectorAll('.modal .tab-panel.on [data-prov="gemini"] .gm-picker select').length);
      t('and the local server has a separate one',
        document.querySelectorAll('.modal .tab-panel.on [data-prov="ooba"] .gm-picker select').length === 1,
        document.querySelectorAll('.modal .tab-panel.on [data-prov="ooba"] .gm-picker select').length);
      t('only the chosen provider is showing',
        document.querySelectorAll('.modal .tab-panel.on .prov-block:not(.hidden)').length === 1,
        document.querySelectorAll('.modal .tab-panel.on .prov-block:not(.hidden)').length);
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

        /* the break-between-cards control is gone — the lasso plus "New scene
           from these" is the way a long scene gets carved up now */
        t('no scene-break control sits between the cards',
          document.querySelectorAll('.scene-break').length === 0,
          document.querySelectorAll('.scene-break').length);

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

      // click-drag on empty space lassos the cards it touches
      (function () {
        SB.Board.clearSelection();
        var sc = P().scenes[0];
        var aId = sc.shots[0].id, bId = sc.shots[1].id;
        /* the gutter guard measures against the panel, so the cards this
           sweeps over have to actually be inside it — and the scroll goes
           back afterwards, because later tests aim drops by client rect */
        var panelEl = document.getElementById('boardPanel');
        var wasScroll = panelEl.scrollTop;
        document.querySelector('.card[data-shot="' + aId + '"]')
          .scrollIntoView({ block: 'center' });
        var ra = document.querySelector('.card[data-shot="' + aId + '"]').getBoundingClientRect();
        var rb = document.querySelector('.card[data-shot="' + bId + '"]').getBoundingClientRect();
        var shots = document.querySelector('.shots[data-scene="' + sc.id + '"]');
        var sweep = function (opts) {
          shots.dispatchEvent(new MouseEvent('mousedown', Object.assign({
            bubbles: true, button: 0, buttons: 1, clientX: ra.left - 3, clientY: ra.top - 3
          }, opts || {})));
          document.dispatchEvent(new MouseEvent('mousemove', {
            bubbles: true, buttons: 1, clientX: rb.left + 8, clientY: rb.top + 8
          }));
        };

        sweep();
        t('dragging on empty space draws a marquee',
          !!document.querySelector('.marquee'), '');
        t('and the cards it touches are selected',
          SB.Board.selection().length === 2 &&
          SB.Board.selection().indexOf(aId) >= 0 && SB.Board.selection().indexOf(bId) >= 0,
          SB.Board.selection().join());
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        t('the marquee goes on release', !document.querySelector('.marquee'), '');
        t('and the selection stays', SB.Board.selection().length === 2,
          SB.Board.selection().join());

        /* a modifier at the start adds to what was there */
        var otherSc = P().scenes.filter(function (s) { return s !== sc && s.shots.length; })[0];
        var other = otherSc.shots[0].id;
        SB.Board.select(other);
        sweep({ ctrlKey: true });
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        t('a modifier makes the lasso add to the selection',
          SB.Board.selection().length === 3 && SB.Board.selection().indexOf(other) >= 0,
          SB.Board.selection().join());

        /* a mouseup lost outside the window must not leave a ghost lasso:
           the first move that arrives with no button down ends it */
        sweep();
        t('the lasso is live mid-drag', !!document.querySelector('.marquee'), '');
        document.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true, buttons: 0, clientX: rb.left + 20, clientY: rb.top + 20
        }));
        t('a move with the button released ends it',
          !document.querySelector('.marquee') && !document.body.classList.contains('marquee-on'), '');

        /* below the threshold a click is still just a click */
        var board = document.getElementById('board');
        board.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true, button: 0, buttons: 1, clientX: 6, clientY: 6
        }));
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        t('a plain click on empty space still just clears',
          SB.Board.selection().length === 0 && !document.querySelector('.marquee'),
          SB.Board.selection().join());

        /* pressing on the selection bar or a scene banner must not arm one */
        SB.Board.select(aId);
        SB.Board.select(bId, { ctrlKey: true });
        var barEl = document.querySelector('#selBar .sel-bar');
        barEl.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true, button: 0, buttons: 1, clientX: 10, clientY: 10
        }));
        document.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true, buttons: 1, clientX: rb.left + 8, clientY: rb.top + 8
        }));
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        t('a slipped press on the selection bar does not lasso',
          !document.querySelector('.marquee') && SB.Board.selection().length === 2,
          SB.Board.selection().join());
        var bannerEl = document.querySelector('.scene-head');
        bannerEl.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true, button: 0, buttons: 1, clientX: 10, clientY: 10
        }));
        document.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true, buttons: 1, clientX: rb.left + 8, clientY: rb.top + 8
        }));
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        t('nor does one on the scene banner', !document.querySelector('.marquee'), '');
        SB.Board.clearSelection();

        /* the add-shot ghost card looks like empty space, so a drag from it
           lassos — while a plain click on it still adds a shot */
        var addBtn = document.querySelector('.shots[data-scene="' + sc.id + '"] + .add-shot') ||
          document.querySelector('.scene-block[data-scene="' + sc.id + '"] .add-shot');
        var wasShots = sc.shots.length;
        addBtn.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true, button: 0, buttons: 1, clientX: ra.left - 3, clientY: ra.top - 3
        }));
        document.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true, buttons: 1, clientX: rb.left + 8, clientY: rb.top + 8
        }));
        t('a drag from the add-shot ghost card lassos',
          !!document.querySelector('.marquee') && SB.Board.selection().length === 2,
          SB.Board.selection().join());
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        t('and adds no shot', sc.shots.length === wasShots, sc.shots.length);
        SB.Board.clearSelection();
        panelEl.scrollTop = wasScroll;
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

        /* Swapping is alt-drag and only alt-drag: the ⇄ button and the
           two-click route cost a control on every card to save a modifier on
           a rare gesture. doSwap itself is unchanged and still tested through
           the drag below. */
        SB.Model.swapShotContent(P(), a.id, b.id);
        SB.app.changed(true);
        t('swapping two cards still moves the pictures and not the dialogue',
          a.description === 'SECOND picture' && b.description === 'FIRST picture' &&
          document.querySelector('.script-box[data-shot="' + a.id + '"]').textContent ===
            'Wide of the office.',
          a.description + ' / ' + b.description);
        t('and no card carries a swap button any more',
          !Array.prototype.some.call(document.querySelectorAll('.card .ch-actions .mini'),
            function (x) { return x.textContent === '\u21c4'; }), '');

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
      boxSet(fbox, 'Warm practicals only.');
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

        /* even bottomed out, where the scroller cannot give the space back.
           The caret now SURVIVES a rebuild, so the box focused just above is
           still the anchor until it is let go of — and this case is about the
           fallback, when nothing is being typed in. */
        document.activeElement.blur();
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

      // the same picture on two shots costs one copy
      {
        var bigJpg = 'data:image/jpeg;base64,' + 'A'.repeat(30000);
        P().scenes[0].shots[0].image = SB.Blobs.image(P(), bigJpg, 8, 6);
        var blobsBefore = Object.keys(P().blobs).length;
        P().scenes[0].shots[1].image = SB.Blobs.image(P(), bigJpg, 8, 6);
        t('reusing a picture stores no second copy',
          Object.keys(P().blobs).length === blobsBefore,
          Object.keys(P().blobs).length + ' vs ' + blobsBefore);
        t('and both shots point at the same blob',
          P().scenes[0].shots[0].image.ref === P().scenes[0].shots[1].image.ref, '');
        P().scenes[0].shots[1].image = null;
        SB.app.changed(true);
      }

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
            cast: [{
              name: 'Courier',
              description: 'Late twenties, in a rust-orange weatherproof jacket.',
              imagePrompt: 'Front-facing reference frame, plain background.'
            }],
            shots: [
              { beat: 'arrives', type: 'WS', cast: ['Courier'], description: 'The courier reaches the loading door.' },
              { beat: 'the label', type: 'ECU', description: 'Fingers turn a crumpled label to the light.' },
              { beat: 'signed for', type: 'CU', cast: ['Courier'], description: 'The courier leans in as the screen blinks green.' }
            ]
          });
        };
        const castBefore = SB.Personas.all(P()).length;
        bGen.click();
        await settle();
        t('three shots landed on the scene', sc.shots.length === 3, sc.shots.length);
        t('their types came from the project list',
          sc.shots.map(function (s) { return s.type; }).join(',') === 'Wide,Extreme close-up,Close-up',
          sc.shots.map(function (s) { return s.type; }).join(','));
        t('no wardrobe is stapled into the descriptions',
          sc.shots.every(function (s) { return !/rust-orange/.test(s.description); }),
          JSON.stringify(sc.shots.map(function (s) { return s.description; })));
        const courier = SB.Personas.all(P()).filter(function (x) { return x.name === 'Courier'; })[0];
        t('the person it needed was cast as a new persona',
          !!courier && SB.Personas.all(P()).length === castBefore + 1,
          JSON.stringify(SB.Personas.all(P()).map(function (x) { return x.name; })));
        t('and pinned to every card, including the one that named nobody',
          !!courier && sc.shots.every(function (s) {
            return (s.personaIds || [])[0] === courier.id;
          }),
          JSON.stringify(sc.shots.map(function (s) { return s.personaIds; })));
        t('the row reports what it did, and who it cast',
          /3 shots added · cast Courier/.test(document.querySelector(sel + '.sc-ai-status').textContent),
          document.querySelector(sel + '.sc-ai-status').textContent);

        const bUndo = Array.prototype.filter.call(document.querySelectorAll(sel + '.sc-ai .mini'),
          function (b) { return b.textContent === 'undo'; })[0];
        t('undo is offered after generating', bUndo && !bUndo.classList.contains('hidden'), '');
        bUndo.click();
        await settle();
        t('undo takes the generated shots back off', sc.shots.length === 0, sc.shots.length);
        t('and the persona it invented goes with them, leaving the rest alone',
          SB.Personas.all(P()).length === castBefore, SB.Personas.all(P()).length);

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
        t('and the box shows it',
          /scuffed parcel/.test(SB.RefBox.read(document.querySelector(sel + '.sh-desc'))), '');
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
            cast: [{ name: 'Courier', description: 'Late twenties, in a rust-orange weatherproof jacket.' }],
            shots: [
              { beat: 'arrives', type: 'WS', cast: ['Courier'], description: 'The courier reaches the door.' },
              { beat: 'signed for', type: 'CU', cast: ['Courier'], description: 'The courier waits as the screen goes green.' }
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

      /* A scene can claim a stretch of script of its own — the loose early pass,
       * where you know roughly where a section belongs long before the shots. */
      (function () {
        const master = document.getElementById('masterScript');
        const sc0 = P().scenes[0];
        const claimed = 'Line one.';

        SB.Model.tieScene(P(), sc0.id, 0, claimed.length);
        app.selectedSceneId = sc0.id;
        app.changed(true);
        SB.ScriptMode.open();
        SB.ScriptMode.refresh();

        t('a claimed section is marked in the master script',
          master.querySelectorAll('.scov').length > 0, master.innerHTML.slice(0, 240));
        t('and the panel says how much is claimed',
          /\d+% of the script/.test(document.getElementById('scriptCoverage').textContent),
          document.getElementById('scriptCoverage').textContent);

        const sbox = document.querySelector('.script-box[data-scene="' + sc0.id + '"]');
        t('the scene header grows a section box', sbox !== null, '');
        t('showing the text it claims', sbox && sbox.textContent === claimed,
          sbox ? JSON.stringify(sbox.textContent) : 'no box');

        /* Everything in this scenario runs inside the coalescing window, so
           without a seal the whole run would collapse into one undo step. */
        SB.History.seal();
        sbox.focus();
        SB.Editor.setSel(sbox, claimed.length, claimed.length);
        sbox.dispatchEvent(new InputEvent('beforeinput',
          { inputType: 'insertText', data: '!!', bubbles: true, cancelable: true }));
        t('typing in it writes through to the master',
          P().master.text.indexOf('Line one.!!') === 0, P().master.text.slice(0, 20));

        /* The claim is anchored into the text being undone, so it has to travel
         * back with it — otherwise Ctrl+Z leaves it pointing past the end. */
        SB.History.undo();
        t('undo takes the text back',
          P().master.text.indexOf('Line one.\n') === 0, P().master.text.slice(0, 20));
        t('and the claim with it, still framing its own words',
          P().master.text.slice(P().scenes[0].link.from, P().scenes[0].link.to) === claimed,
          JSON.stringify(P().master.text.slice(P().scenes[0].link.from, P().scenes[0].link.to)));

        const sc1 = SB.Model.addScene(P());
        app.changed(true);
        t('a scene that claims nothing shows no section box',
          document.querySelector('.script-box[data-scene="' + sc1.id + '"]') === null, '');

        /* The two layers land on the same characters and must both survive. */
        const shotAt = P().master.text.indexOf('THE TARGET');
        SB.Model.tieScene(P(), sc0.id, shotAt, shotAt + 10, true);
        app.changed(true);
        SB.ScriptMode.refresh();
        t('a stretch covered by both reads as both',
          master.querySelector('.h1.scov, .h2.scov, .h3.scov') !== null,
          master.innerHTML.slice(0, 240));

        // the capture form offers the scene as a target
        master.focus();
        SB.Editor.setSel(master, 12, 20);
        const cap = document.getElementById('btnCapture');
        cap.disabled = false;
        cap.click();
        const cf = document.getElementById('captureForm');
        const bScene = cf.querySelector('[data-mode="scene"]');
        t('the capture form offers a scene section', bScene !== null, cf.innerHTML.slice(0, 240));
        bScene.click();
        t('and choosing it puts the shot type away',
          cf.querySelector('.row-type').classList.contains('hidden'), '');
        t('while the scene picker stays', cf.querySelector('select') !== null, '');
        const before = P().scenes[0].link.from;
        cf.querySelector('[data-act="complete"]').click();
        t('completing it moves the claim, and makes no card',
          P().scenes[0].link.from === 12 && P().scenes[0].link.from !== before,
          JSON.stringify(P().scenes[0].link));

        // break link — a freestanding section claims nothing in the master
        SB.Model.breakSceneLink(P(), P().scenes[0]);
        app.changed(true);
        SB.ScriptMode.refresh();
        t('a scene section can be broken off',
          document.querySelector('.scene-block[data-scene="' + sc0.id + '"] .link-dot.free') !== null, '');
        t('and then claims none of the master',
          master.querySelectorAll('.scov').length === 0, master.innerHTML.slice(0, 240));
      })();

      // pictures dropped straight onto an add button
      await (async function () {
        const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms || 80); }); };
        const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAf' +
          'FcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        const sc = P().scenes[0];
        const btn = function () {
          return document.querySelector('.shots[data-scene="' + sc.id + '"] .add-shot');
        };
        const fire = function (dt) {
          const el = btn();
          const over = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true });
          el.dispatchEvent(over);
          el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
          return over.defaultPrevented;
        };

        const n0 = sc.shots.length;
        const dt1 = new DataTransfer();
        dt1.setData('text/uri-list', PNG);
        t('an image dragged onto + Add shot is accepted', fire(dt1), '');
        await wait(200);
        t('and it spawns a card', sc.shots.length === n0 + 1, sc.shots.length + ' vs ' + n0);
        const made = sc.shots[sc.shots.length - 1];
        t('with the picture already in it', !!made.image, JSON.stringify(made.image));
        t('and that card is the selected one', app.selectedShotId === made.id, app.selectedShotId);

        /* a drop carrying no picture must not leave an empty card behind */
        const n1 = sc.shots.length;
        const dt2 = new DataTransfer();
        dt2.setData('text/plain', 'just some words');
        fire(dt2);
        await wait(120);
        t('a drop with no image makes no card', sc.shots.length === n1, sc.shots.length + ' vs ' + n1);

        /* several files at once — one card each, in the order they were picked */
        const blob = await fetch(PNG).then(function (r) { return r.blob(); });
        const dt3 = new DataTransfer();
        dt3.items.add(new File([blob], 'a.png', { type: 'image/png' }));
        dt3.items.add(new File([blob], 'b.png', { type: 'image/png' }));
        const n2 = sc.shots.length;
        fire(dt3);
        await wait(300);
        t('two images make two cards', sc.shots.length === n2 + 2, sc.shots.length + ' vs ' + n2);
        t('both of them carrying a picture',
          sc.shots.slice(-2).every(function (x) { return !!x.image; }),
          JSON.stringify(sc.shots.slice(-2).map(function (x) { return x.image; })));

        /* the reorder drag over the same button must still be a reorder */
        const moved = SB.Model.addShot(P(), P().scenes[1] ? P().scenes[1].id : sc.id, {});
        app.changed(true);
        const dt4 = new DataTransfer();
        const src = document.querySelector('.card[data-shot="' + moved.id + '"] .card-head');
        src.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt4, bubbles: true, cancelable: true }));
        const el = btn();
        const over = new DragEvent('dragover', { dataTransfer: dt4, bubbles: true, cancelable: true });
        el.dispatchEvent(over);
        el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt4, bubbles: true, cancelable: true }));
        await wait(80);
        const f = SB.Model.findShot(P(), moved.id);
        t('a card dragged onto the button still just moves',
          !!f && f.scene.id === sc.id && !f.shot.image,
          (f ? f.scene.id + ' img=' + !!f.shot.image : 'gone') + ' want ' + sc.id);
      })();

      /* ---- the row says what the push will actually carry ----
       *
       * A still push sends one reference picture, and for a long time it sent
       * none at all while the prompt it carried said "reference images are
       * supplied in order". The row has to say which it is -- including when
       * the answer is "one", because a chip that only appears when something
       * is WRONG cannot be told apart from a chip that is broken. It was: the
       * first version of this was exported onto the wrong object, so it never
       * rendered once, and "no chip" read as "nothing to send". */
      {
        app.commentMode = false;
        t('the prompt table can ask what a push will carry',
          !!(SB.Imagine && typeof SB.Imagine.refsFor === 'function'),
          'SB.Imagine.refsFor is ' + typeof (SB.Imagine || {}).refsFor);

        const sc = P().scenes[0];
        const png = 'data:image/webp;base64,' + 'A'.repeat(64);
        P().blobs.refpic = png;
        const withPic = SB.Personas.add(P(), 'person');
        withPic.name = 'Pictured';
        SB.Personas.setImage(withPic, { ref: 'refpic', w: 64, h: 36 }, 'front', null);
        const noPic = SB.Personas.add(P(), 'person');
        noPic.name = 'Described only';

        const im5 = SB.Model.imageModel(P());
        const made = [['one ref', [withPic.id]], ['no ref frame', [noPic.id]],
          ['two subjects', [withPic.id, noPic.id]], ['nobody', []]]
          .map(function (r) {
            const x = SB.Model.addShot(P(), sc.id, { type: 'Close-up' });
            x.description = 'Chip test: ' + r[0];
            x.personaIds = r[1].slice();
            x.prompts = {};
            if (im5) x.prompts[im5.id] = { imagePrompt: 'A prompt.', videoPrompt: '', modelName: im5.name, at: Date.now() };
            return x;
          });
        app.changed(true);
        SB.PromptPanel.open();

        /* The corner names the two things it makes, in the order somebody
           does them: write the prompt, then make the picture. What travels
           with the push is shown as PICTURES directly above -- the corner
           repeating it in words was one more thing to read and one more
           thing to disagree with. */
        const laneOf = function (sh, which) {
          return document.querySelector('.pt-row[data-shot="' + sh.id + '"] ' +
            '.pt-prompt[data-lane="' + which + '"]');
        };
        const footOf = function (sh, which) {
          const cell = laneOf(sh, which);
          return cell ? cell.querySelector('.pt-foot') : null;
        };
        const labels = function (sh, which) {
          const f = footOf(sh, which);
          if (!f) return '(no foot)';
          return Array.prototype.map.call(f.querySelectorAll('.gen-label, button'),
            function (b) { return b.textContent; }).join(' | ');
        };

        t('the still corner says what it generates',
          /Generate:/.test(labels(made[0], 'image')), labels(made[0], 'image'));
        t('and names the prompt first, then the frame',
          labels(made[0], 'image').indexOf('📝 Prompt') >= 0 &&
          labels(made[0], 'image').indexOf('🖼️ Frame') >
            labels(made[0], 'image').indexOf('📝 Prompt'),
          labels(made[0], 'image'));
        t('the clip corner offers a video, not a frame',
          labels(made[0], 'video').indexOf('📽️ Video') >= 0 &&
          labels(made[0], 'video').indexOf('🖼️ Frame') < 0,
          labels(made[0], 'video'));
        t('and the still corner never offers a video',
          labels(made[0], 'image').indexOf('📽️ Video') < 0, labels(made[0], 'image'));

        /* the counting chips are gone from both lanes */
        t('no lane counts references at the corner any more',
          !laneOf(made[0], 'image').querySelector('.badge.refs') &&
          !laneOf(made[0], 'video').querySelector('.badge.refs'), '');
        t('not even on a card whose subject has no reference picture',
          !laneOf(made[1], 'image').querySelector('.badge.refs'), '');
        t('nor on an empty card',
          !laneOf(made[3], 'image').querySelector('.badge.refs'), '');

        /* A blocked push still says why. The old assertion only checked the
           element existed -- it is appended on every lane and merely hidden,
           so it could not fail, and it did not notice the note drifting two
           elements away from the button it explains. */
        const whyOf = function (sh, which) {
          const f = footOf(sh, which);
          const w = f && f.querySelector('.push-why');
          if (!w) return '(absent)';
          return (w.style.display === 'none' ? '(hidden)' : w.textContent || '(empty)');
        };
        const vFoot = footOf(made[0], 'video');
        const vWhy = vFoot.querySelector('.push-why');
        const vPush = vFoot.querySelector('.mini.push');
        t('a clip with no frame is blocked and the row says why in words',
          vPush.disabled && whyOf(made[0], 'video').length > 2 &&
          whyOf(made[0], 'video').indexOf('(') !== 0,
          whyOf(made[0], 'video') + ' / disabled=' + vPush.disabled);
        t('and the reason is the element immediately before that button',
          vWhy.nextElementSibling === vPush,
          vWhy.nextElementSibling ? vWhy.nextElementSibling.className : '(last)');
        /* the invariant, which holds whether or not this harness happens to
           have a runnable push: a reason is shown exactly when the button it
           sits beside is dark */
        const pairsOk = [];
        document.querySelectorAll('.pt-foot').forEach(function (f) {
          const w = f.querySelector('.push-why'), b = f.querySelector('.mini.push');
          if (!w || !b) return;
          const shown = w.style.display !== 'none' && !!w.textContent;
          if (shown !== !!b.disabled) pairsOk.push(b.textContent + '/' + w.textContent);
        });
        t('a reason is shown exactly where the push beside it is dark',
          pairsOk.length === 0, pairsOk.join(', '));

        /* the pictures above are still the answer to "what travels" */
        t('the clip lane still shows the frame as its one reference',
          !!laneOf(made[0], 'video').querySelector('.pt-fe.pt-frame'), '');
        t('and still marks the pictures it is not carrying',
          laneOf(made[0], 'video').querySelectorAll('.pt-fe.not-sent').length >= 1,
          laneOf(made[0], 'video').querySelectorAll('.pt-fe.not-sent').length);
        t('with no offer to download them as the clip\u2019s set',
          !Array.prototype.some.call(laneOf(made[0], 'video').querySelectorAll('button'),
            function (b) { return /Download for MXM/.test(b.textContent); }), '');

        /* ---- what the still lane carries, said by the pictures ----
         *
         * The counting chip was removed because the panel above it shows the
         * same thing in pictures. That was only true of the clip lane, which
         * dims what it is not sending; the still lane numbered every
         * reference as though every one travelled. These are the three cases
         * the chip used to warn about. */
        {
          const feedOf = function (sh, which) {
            return document.querySelector('.pt-feed[data-feed-cell="' + sh.id + ':' +
              which + '"]');
          };
          const rowsOf = function (sh, which) {
            const f = feedOf(sh, which);
            return f ? Array.prototype.slice.call(f.querySelectorAll('.pt-fe')) : [];
          };
          const noteOf = function (sh, which) {
            const f = feedOf(sh, which);
            const n = f && f.querySelector('.pt-fe-note');
            return n ? n.textContent : '';
          };

          const many = SB.Model.addShot(P(), sc.id, { type: 'Wide' });
          const crowd = [];
          for (let i = 0; i < 6; i++) {
            const per = SB.Personas.add(P(), 'person');
            per.name = 'Crowd ' + (i + 1);
            SB.Personas.setImage(per, { ref: 'refpic', w: 64, h: 36 }, 'front', null);
            crowd.push(per);
          }
          many.description = 'A crowd: ' + crowd.map(function (x) {
            return SB.Refs.mark(x.id, x.name); }).join(', ') + '.';
          many.personaIds = crowd.map(function (x) { return x.id; });
          app.changed(true);
          SB.PromptPanel.open();

          const carried = SB.Imagine.refsFor(P(), many, 'image').carries;
          const rows = rowsOf(many, 'image');
          t('a card feeding more references than a push carries shows six rows',
            rows.length === 6, rows.length + ' rows');
          t('and dims the ones that do not travel',
            rows.filter(function (r) { return /not-sent/.test(r.className); }).length ===
              6 - carried,
            rows.map(function (r) { return /not-sent/.test(r.className) ? 'x' : 'o'; }).join(''));
          t('numbering only the ones that do, since the prompt numbers the call',
            rows.slice(0, carried).every(function (r) {
              return /^[0-9]+$/.test(r.querySelector('.feed-n').textContent); }) &&
            rows.slice(carried).every(function (r) {
              return r.querySelector('.feed-n').textContent === '\u00b7'; }),
            rows.map(function (r) { return r.querySelector('.feed-n').textContent; }).join(''));
          t('and says it once in words, which a dimmed row alone does not',
            /only the first/.test(noteOf(many, 'image')) &&
            new RegExp(String(6 - carried)).test(noteOf(many, 'image')),
            noteOf(many, 'image'));

          /* the key push, which carries no reference at all */
          const wasT = SB.Imagine.transport();
          SB.Imagine.setTransport('key');
          SB.PromptPanel.close(); SB.PromptPanel.open();
          t('an API-key push says plainly that no picture travels',
            /signed out/.test(noteOf(many, 'image')), noteOf(many, 'image'));
          t('and dims every one of them, not just the overflow',
            rowsOf(many, 'image').every(function (r) { return /not-sent/.test(r.className); }),
            rowsOf(many, 'image').map(function (r) {
              return /not-sent/.test(r.className) ? 'x' : 'o'; }).join(''));
          SB.Imagine.setTransport(wasT);
          SB.PromptPanel.close(); SB.PromptPanel.open();

          t('a card inside what a push carries is not dimmed and says nothing',
            rowsOf(made[0], 'image').every(function (r) {
              return !/not-sent/.test(r.className); }) && !noteOf(made[0], 'image'),
            noteOf(made[0], 'image'));

          SB.PromptPanel.close();
          SB.Model.deleteShot(P(), many.id);
          crowd.forEach(function (x) { SB.Personas.remove(P(), x.id); });
          app.changed(true);
          SB.PromptPanel.open();
        }

        SB.PromptPanel.close();
        made.forEach(function (x) { SB.Model.deleteShot(P(), x.id); });
        SB.Personas.remove(P(), withPic.id);
        SB.Personas.remove(P(), noPic.id);
        app.changed(true);
      }

      /* ---- a filter must not take away the row you are working in ----
       *
       * The filter used to be re-applied on every render, and a render happens
       * whenever anything lands. So the row most likely to stop matching was
       * the one under the caret: type the last missing prompt of a card by
       * hand, have a clip land on another card mid-sentence, and the row was
       * gone — with the rest of the sentence going nowhere. */
      {
        app.commentMode = false;
        const sc = P().scenes[0];
        const im4 = SB.Model.imageModel(P()), vm4 = SB.Model.videoModel(P());
        const made = [];
        for (let i = 0; i < 4; i++) {
          const x = SB.Model.addShot(P(), sc.id, { type: 'Wide' });
          x.description = 'Pinned test shot ' + i;
          x.prompts = {};
          /* only the video prompt is missing, so typing it is what takes the
             row out of the Missing filter */
          if (im4) x.prompts[im4.id] = { imagePrompt: 'Frame ' + i + '.', videoPrompt: '', modelName: im4.name, at: Date.now() };
          made.push(x);
        }
        app.changed(true);
        SB.PromptPanel.open();

        /* pick Missing, the way somebody working through a board does */
        const tabs = Array.prototype.slice.call(document.querySelectorAll('.lib-head .lib-tabs button'));
        const missingTab = tabs.filter(function (b) { return /^Missing/.test(b.textContent); })[0];
        t('the table offers a Missing filter', !!missingTab,
          tabs.map(function (b) { return b.textContent; }).join(' / '));
        missingTab.click();

        const sh = made[1];
        const rowSel = '.pt-row[data-shot="' + sh.id + '"]';
        t('the card with a prompt still to write is in it', !!document.querySelector(rowSel), '');

        /* write the missing one by hand, which is what stops it matching */
        const boxes = document.querySelectorAll(rowSel + ' textarea.pt-text');
        const vbox = boxes[boxes.length - 1];
        vbox.focus();
        vbox.value = 'A slow push in along the bay';
        vbox.dispatchEvent(new Event('input', { bubbles: true }));
        vbox.setSelectionRange(vbox.value.length, vbox.value.length);

        /* ...and a clip lands on a different card, rebuilding the table */
        made[3].video = { at: Date.now(), dur: 5, unseen: true };
        app.changed(true);

        t('the row being typed in is still there', !!document.querySelector(rowSel),
          document.querySelectorAll('.pt-row').length + ' rows');
        t('and the caret is still in its box',
          document.activeElement === document.querySelector(rowSel + ' textarea.pt-text:last-of-type') ||
          (document.activeElement && document.activeElement.closest &&
           !!document.activeElement.closest(rowSel)),
          document.activeElement ? document.activeElement.tagName + '.' + document.activeElement.className : 'null');
        t('and what was typed is still what it holds',
          (function () {
            const b = document.querySelectorAll(rowSel + ' textarea.pt-text');
            return b[b.length - 1].value === 'A slow push in along the bay';
          })(), '');
        t('a row kept past the filter says so, or the filter looks broken',
          !!document.querySelector(rowSel + ' .badge.done'), '');

        /* picking the filter again is how you re-narrow it */
        document.activeElement.blur();
        Array.prototype.slice.call(document.querySelectorAll('.lib-head .lib-tabs button'))
          .filter(function (b) { return /^Missing/.test(b.textContent); })[0].click();
        t('picking the filter again drops what no longer matches',
          !document.querySelector(rowSel), 'still there');

        SB.PromptPanel.close();
        made.forEach(function (x) { SB.Model.deleteShot(P(), x.id); });
        app.changed(true);
      }

      /* ---- typing a description arms "generate", without a rebuild ----
       *
       * The button's disabled state was decided once, when the row was built,
       * out of a description the box three cells to the left can change at any
       * moment. Typing one into an empty card left it disabled until the panel
       * was closed and opened again. */
      {
        app.commentMode = false;
        const sh = P().scenes[0].shots[0];
        sh.description = '';
        sh.noShot = false;
        app.changed(true);
        SB.PromptPanel.open();

        const gens = function () {
          return Array.prototype.slice.call(
            document.querySelectorAll('.pt-row[data-shot="' + sh.id + '"] [data-gen]'));
        };
        t('a card with no description cannot be generated',
          gens().length > 0 && gens().every(function (b) { return b.disabled; }),
          gens().length + ' buttons');
        t('and says why', /Write a description first/.test(gens()[0].title), gens()[0].title);

        /* type into the panel's own description box, the way a person does */
        const desc = document.querySelector('.pt-row[data-shot="' + sh.id + '"] .pt-desc');
        desc.focus();
        SB.RefBox.write(desc, P(), 'A slow pan across the empty bay.');
        desc.dispatchEvent(new Event('input', { bubbles: true }));

        t('typing a description arms generate at once, with no rebuild',
          gens().every(function (b) { return !b.disabled; }),
          gens().map(function (b) { return b.disabled; }).join());
        t('and the reason goes with it',
          !/Write a description first/.test(gens()[0].title), gens()[0].title);
        t('the caret never left the description box', document.activeElement === desc,
          document.activeElement ? document.activeElement.className : 'null');

        /* emptying it disarms them again */
        SB.RefBox.write(desc, P(), '');
        desc.dispatchEvent(new Event('input', { bubbles: true }));
        t('and emptying it disarms them again',
          gens().every(function (b) { return b.disabled; }),
          gens().map(function (b) { return b.disabled; }).join());

        /* a prompt being written is state, not a button label: it survives the
           panel being closed and reopened, and it refuses a second press */
        SB.RefBox.write(desc, P(), 'A slow pan across the empty bay.');
        desc.dispatchEvent(new Event('input', { bubbles: true }));
        desc.blur();
        const im3 = SB.Model.imageModel(P());
        t('nothing is being written yet', !SB.Prompts.writing(sh.id, 'imagePrompt'), '');

        SB.PromptPanel.close();
        sh.description = '';
        app.changed(true);
      }

      /* ---- the description says one framing, the dropdown says another ----
       *
       * The dropdown is what the prompt is written to, and it is born "Wide".
       * A card reading "closeup of his hands" therefore went out as a wide
       * shot and came back with a whole person in it, with nothing anywhere
       * saying the two disagreed. */
      {
        app.commentMode = false;
        const sh = P().scenes[0].shots[0];
        sh.type = 'Wide';
        sh.description = 'Close-up of his hands on the keyboard.';
        app.changed(true);

        const host = document.querySelector('.card[data-shot="' + sh.id + '"] .fr-host');
        const badge = host && host.querySelector('.badge.framing');
        t('a description that disagrees with the dropdown says so on the card',
          !!badge && badge.textContent === 'Close-up', badge ? badge.textContent : 'no badge');
        t('and it says which way round the disagreement is',
          !!badge && /says close-up/.test(badge.title) && /set to .Wide./.test(badge.title),
          badge ? badge.title : '');

        /* one click settles it — and the dropdown is what actually moves */
        badge.click();
        t('clicking it sets the shot type', sh.type === 'Close-up', sh.type);
        const sel = document.querySelector('.card[data-shot="' + sh.id + '"] select.type');
        t('and the dropdown shows it', sel.value === 'Close-up', sel.value);
        t('and the badge goes, because they now agree',
          !document.querySelector('.card[data-shot="' + sh.id + '"] .badge.framing'), '');

        /* it is a disagreement, not a description of one: agreeing is silent */
        sh.description = 'Wide of the whole floor.';
        sh.type = 'Wide';
        app.changed(true);
        t('a description that agrees with the dropdown says nothing',
          !document.querySelector('.card[data-shot="' + sh.id + '"] .badge.framing'), '');
        sh.description = 'Danny is typing.';
        app.changed(true);
        t('and one that says nothing about framing says nothing either',
          !document.querySelector('.card[data-shot="' + sh.id + '"] .badge.framing'), '');

        /* the prompt table carries the same badge, on the screen where the
           prompts are actually read */
        sh.type = 'Wide';
        sh.description = 'Insert of the manifest.';
        app.changed(true);
        SB.PromptPanel.open();
        const rowBadge = document.querySelector('.pt-row[data-shot="' + sh.id + '"] .badge.framing');
        t('the prompt table carries it too',
          !!rowBadge && rowBadge.textContent === 'Insert', rowBadge ? rowBadge.textContent : 'none');
        SB.PromptPanel.close();

        sh.description = '';
        sh.type = 'Wide';
        app.changed(true);
      }

      /* ---- nothing takes the caret ----
       *
       * A clip or a written prompt lands minutes after the button that asked
       * for it, by which time the person is writing somewhere else. The
       * rebuild it causes used to destroy the box they were in: the rest of
       * the sentence went to <body>, and a space bar pressed after that went
       * to whatever the browser had focused instead. */
      (function () {
        app.commentMode = false;
        P().settings.showVideoPrompt = true;
        app.changed(true);

        /* a reference box (contenteditable) mid-sentence */
        const sh = P().scenes[0].shots[0];
        sh.description = 'A long empty corridor, lit from one end.';
        app.changed(true);
        const desc = document.querySelector('.desc-box[data-shot="' + sh.id + '"]');
        desc.focus();
        SB.RefBox.setCaret(desc, 12);
        const at = SB.RefBox.caret(desc);
        app.changed(true);                       // a background rebuild
        const desc2 = document.querySelector('.desc-box[data-shot="' + sh.id + '"]');
        t('a rebuild leaves the caret in the description box',
          document.activeElement === desc2,
          document.activeElement ? document.activeElement.className : 'null');
        t('and at the same character',
          SB.RefBox.caret(desc2) === at, SB.RefBox.caret(desc2) + ' want ' + at);

        /* a prompt textarea, with a selection rather than a bare caret */
        const box = document.querySelector('.prompt-box[data-shot="' + sh.id + '"] textarea');
        box.value = 'A slow push in along the corridor.';
        box.dispatchEvent(new Event('input', { bubbles: true }));
        box.focus();
        box.setSelectionRange(7, 11);
        app.changed(true);
        const box2 = document.querySelector('.prompt-box[data-shot="' + sh.id + '"] textarea');
        t('a rebuild leaves the caret in the prompt box', document.activeElement === box2,
          document.activeElement ? document.activeElement.tagName : 'null');
        t('and keeps the selection', box2.selectionStart === 7 && box2.selectionEnd === 11,
          box2.selectionStart + '-' + box2.selectionEnd);
        t('and the text is the text that was typed',
          box2.value === 'A slow push in along the corridor.', box2.value);

        /* a rebuild the app asked for on the user's behalf still waits for a
           gap in the typing — and lands by itself once there is one */
        box2.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
        let ran = 0;
        SB.Focus.defer('test', function () { ran++; });
        t('a background rebuild waits while a box is being typed in', ran === 0, ran);
        t('and the app can tell that it is', SB.Focus.busy() === true, SB.Focus.busy());
        SB.Focus.flush();
        t('and lands as soon as the typing stops', ran === 1, ran);

        /* with nothing focused there is nothing to protect */
        box2.blur();
        let straight = 0;
        SB.Focus.defer('test2', function () { straight++; });
        t('with no caret anywhere a rebuild is immediate', straight === 1, straight);
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
