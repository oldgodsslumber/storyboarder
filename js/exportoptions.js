/* exportoptions.js — the dialog behind the PDF button.
 *
 * Picks a layout preset and what goes on each card, previews the real sheet in
 * an iframe, and on Export commits the choices to project.settings.export so
 * the board remembers how it prints.
 */
(function (SB) {
  'use strict';

  function P() { return SB.app.project; }

  function field(labelText, control) {
    const l = SB.el('label', 'field');
    l.appendChild(SB.el('span', null, labelText));
    l.appendChild(control);
    return l;
  }

  function toggle(labelText, checked, onChange) {
    const l = SB.el('label', 'pp-toggle');
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = !!checked;
    chk.onchange = function () { onChange(chk.checked); };
    l.appendChild(chk);
    l.appendChild(document.createTextNode(' ' + labelText));
    return l;
  }

  /* "Landscape, 3 across × 2 down — 6 cards a sheet" */
  function describe(pr) {
    const shape = pr.cols + ' across × ' + pr.rows + ' down';
    const n = pr.cols * pr.rows;
    return (pr.orient === 'landscape' ? 'Landscape' : 'Portrait') + ', ' + shape +
      ' — ' + n + (n === 1 ? ' card a sheet' : ' cards a sheet') +
      (pr.dir === 'row' ? ', frame beside the words' : '');
  }

  function open() {
    const p = P();
    /* edit a copy: Cancel has to leave the project exactly as it was */
    const working = SB.clone(p.settings.export || SB.Model.defaultExport());

    const body = SB.el('div', 'xp-body');
    const left = SB.el('div', 'xp-left');
    const right = SB.el('div', 'xp-right');
    body.appendChild(left);
    body.appendChild(right);

    /* ---------------- which document ----------------
     *
     * One button, two documents. The board is the storyboard sheets; the
     * references are what the subjects on it are supposed to LOOK like, which
     * is the page you hand somebody who has to match them -- and until now the
     * only way to see a board's references together was to open them one at a
     * time in the References panel. */
    const docSel = document.createElement('select');
    [['board', 'The storyboard'],
     ['refs', 'The references \u2014 what everything looks like'],
     ['both', 'Both \u2014 the storyboard, then the references']].forEach(function (o) {
      const op = document.createElement('option');
      op.value = o[0]; op.textContent = o[1];
      if ((working.doc || 'board') === o[0]) op.selected = true;
      docSel.appendChild(op);
    });
    docSel.onchange = function () { working.doc = docSel.value; draw(); };
    left.appendChild(field('Print', docSel));

    /* Everything below belongs to the storyboard half and goes when the
       references are what is being printed. */
    const boardWrap = SB.el('div', 'xp-board');
    left.appendChild(boardWrap);

    /* ---------------- layout ---------------- */
    const presetSel = document.createElement('select');
    SB.Pdf.PRESETS.forEach(function (pr) {
      const op = document.createElement('option');
      op.value = pr.id;
      op.textContent = pr.label;
      if (pr.id === working.preset) op.selected = true;
      presetSel.appendChild(op);
    });
    presetSel.onchange = function () { working.preset = presetSel.value; draw(); };
    boardWrap.appendChild(field('Layout', presetSel));

    const shape = SB.el('div', 'pp-note');
    boardWrap.appendChild(shape);

    /* ---------------- what goes on a card ---------------- */
    boardWrap.appendChild(SB.el('div', 'xp-head', 'On each card'));
    [
      ['showType', 'Shot type'],
      ['showScript', 'Script'],
      ['showDesc', 'Description'],
      ['showSceneHeading', 'Scene name']
    ].forEach(function (t) {
      boardWrap.appendChild(toggle(t[1], working[t[0]], function (v) { working[t[0]] = v; draw(); }));
    });

    /* ---------------- scenes ---------------- */
    boardWrap.appendChild(SB.el('div', 'xp-head', 'Scenes'));
    boardWrap.appendChild(toggle('Band with the scene description where a scene starts',
      working.sceneBanner, function (v) { working.sceneBanner = v; draw(); }));
    boardWrap.appendChild(toggle('Start each scene on a new sheet',
      working.scenePageBreak, function (v) { working.scenePageBreak = v; draw(); }));

    /* ---------------- colour + footer ---------------- */
    boardWrap.appendChild(SB.el('div', 'xp-head', 'Sheet'));
    const colorSel = document.createElement('select');
    [['accent', 'Card colour on the edge and meta bar'], ['off', 'Plain grey, no card colour']]
      .forEach(function (o) {
        const op = document.createElement('option');
        op.value = o[0]; op.textContent = o[1];
        if (working.color === o[0]) op.selected = true;
        colorSel.appendChild(op);
      });
    colorSel.onchange = function () { working.color = colorSel.value; draw(); };
    boardWrap.appendChild(field('Colour', colorSel));

    boardWrap.appendChild(SB.el('div', 'pp-note',
      'Cards marked “no shot” never print. Comments and ink are left off the sheet. ' +
      'Frames are stored at 854×480, so a one-up sheet will look soft up close.'));

    /* ---------------- the reference sheets ---------------- */
    const refWrap = SB.el('div', 'xp-refs');
    refWrap.appendChild(SB.el('div', 'xp-head', 'The references'));
    const refSel = document.createElement('select');
    SB.Pdf.REF_PRESETS.forEach(function (pr) {
      const op = document.createElement('option');
      op.value = pr.id; op.textContent = pr.label;
      if (pr.id === working.refPreset) op.selected = true;
      refSel.appendChild(op);
    });
    refSel.onchange = function () { working.refPreset = refSel.value; draw(); };
    refWrap.appendChild(field('Layout', refSel));
    refWrap.appendChild(toggle('Which cards each one appears on',
      working.refShots, function (v) { working.refShots = v; draw(); }));
    refWrap.appendChild(toggle('Subjects no card uses',
      working.refUnused, function (v) { working.refUnused = v; draw(); }));
    refWrap.appendChild(toggle('A page listing what each card hands over, in order',
      working.refFeeds, function (v) { working.refFeeds = v; draw(); }));
    refWrap.appendChild(SB.el('div', 'pp-note',
      'Cast, then locations, then objects, each starting a fresh sheet. The full-size ' +
      'original is printed where the board has one \u2014 a page marked “board copy only” is ' +
      'showing 854×480, which is not enough to match a face against.'));
    left.appendChild(refWrap);

    /* On every sheet of either document, so it is not in either box. */
    left.appendChild(SB.el('div', 'xp-head', 'Both'));
    left.appendChild(toggle('Footer with the project name, version and page number',
      working.footer, function (v) { working.footer = v; draw(); }));

    /* ---------------- preview ---------------- */
    const count = SB.el('div', 'xp-count');
    const stage = SB.el('div', 'xp-stage');
    const frame = document.createElement('iframe');
    frame.className = 'xp-frame';
    stage.appendChild(frame);
    right.appendChild(SB.el('div', 'xp-head', 'Preview'));
    right.appendChild(count);
    right.appendChild(stage);

    /* Redraw everything from `working` — same clear-and-rebuild style as the
     * settings dialog, and cheap because SB.Pdf.html() already hands back a
     * whole document. `silent` keeps the sheet from opening a print dialog. */
    function draw() {
      const doc = working.doc || 'board';
      /* Only the half being printed is on screen: a dialog offering card
         toggles for a document with no cards on it is a dialog that has to be
         read twice. */
      boardWrap.style.display = doc === 'refs' ? 'none' : '';
      refWrap.style.display = doc === 'board' ? 'none' : '';

      const info = SB.Pdf.layout(working);
      shape.textContent = describe(info.preset);
      const bits = [];
      if (doc !== 'refs') bits.push(info.shots + (info.shots === 1 ? ' shot' : ' shots'));
      if (doc !== 'board') bits.push(info.refs + (info.refs === 1 ? ' reference' : ' references'));
      count.textContent = bits.join(' · ') + ' → ' +
        info.sheets + (info.sheets === 1 ? ' sheet' : ' sheets');

      /* the sheet is laid out in mm; scale the real thing down rather than
       * re-styling it, so what is previewed is what prints */
      const wide = info.preset.orient === 'landscape';
      const pw = wide ? 964 : 703;              // page width in px at 96dpi
      const ph = wide ? 703 : 949;
      const scale = 300 / pw;
      frame.style.width = pw + 'px';
      frame.style.height = ph + 'px';
      frame.style.transform = 'scale(' + scale + ')';
      stage.style.height = Math.round(ph * scale) + 'px';

      const shown = SB.clone(working);
      shown.silent = true;
      const win = frame.contentDocument;
      win.open();
      win.write(SB.Pdf.html(shown));
      win.close();
    }
    /* the iframe has no document until it is in the page, so the modal has to
     * exist before the first preview is drawn */
    SB.modal({
      title: 'PDF export', width: '820px', body: body,
      buttons: [
        { label: 'Cancel' },
        {
          label: 'Export', primary: true, onClick: function (close) {
            delete working.silent;
            p.settings.export = working;
            SB.app.changed(false);
            close();
            SB.Pdf.exportPdf(working);
          }
        }
      ]
    });
    draw();
  }

  SB.ExportOptions = { open: open };

})(window.SB);
