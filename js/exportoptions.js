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
    left.appendChild(field('Layout', presetSel));

    const shape = SB.el('div', 'pp-note');
    left.appendChild(shape);

    /* ---------------- what goes on a card ---------------- */
    left.appendChild(SB.el('div', 'xp-head', 'On each card'));
    [
      ['showType', 'Shot type'],
      ['showScript', 'Script'],
      ['showDesc', 'Description'],
      ['showSceneHeading', 'Scene name']
    ].forEach(function (t) {
      left.appendChild(toggle(t[1], working[t[0]], function (v) { working[t[0]] = v; draw(); }));
    });

    /* ---------------- scenes ---------------- */
    left.appendChild(SB.el('div', 'xp-head', 'Scenes'));
    left.appendChild(toggle('Band with the scene description where a scene starts',
      working.sceneBanner, function (v) { working.sceneBanner = v; draw(); }));
    left.appendChild(toggle('Start each scene on a new sheet',
      working.scenePageBreak, function (v) { working.scenePageBreak = v; draw(); }));

    /* ---------------- colour + footer ---------------- */
    left.appendChild(SB.el('div', 'xp-head', 'Sheet'));
    const colorSel = document.createElement('select');
    [['accent', 'Card colour on the edge and meta bar'], ['off', 'Plain grey, no card colour']]
      .forEach(function (o) {
        const op = document.createElement('option');
        op.value = o[0]; op.textContent = o[1];
        if (working.color === o[0]) op.selected = true;
        colorSel.appendChild(op);
      });
    colorSel.onchange = function () { working.color = colorSel.value; draw(); };
    left.appendChild(field('Colour', colorSel));
    left.appendChild(toggle('Footer with the project name, version and page number',
      working.footer, function (v) { working.footer = v; draw(); }));

    left.appendChild(SB.el('div', 'pp-note',
      'Cards marked “no shot” never print. Comments and ink are left off the sheet. ' +
      'Frames are stored at 854×480, so a one-up sheet will look soft up close.'));

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
      const info = SB.Pdf.layout(working);
      shape.textContent = describe(info.preset);
      count.textContent = info.shots + (info.shots === 1 ? ' shot → ' : ' shots → ') +
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
      const doc = frame.contentDocument;
      doc.open();
      doc.write(SB.Pdf.html(shown));
      doc.close();
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
