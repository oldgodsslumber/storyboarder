/* pptxoptions.js — the dialog behind "Slides (PowerPoint)…".
 *
 * A sibling of exportoptions.js. Three or six panels a slide, the same card
 * toggles the sheets use, and a preview drawn from the very shapes that go
 * into the file. On Export the choices are committed to
 * project.settings.export, like the PDF dialog's, so the board remembers how
 * it was last presented.
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

  let busy = false;

  function open() {
    const p = P();
    /* edit a copy: Cancel has to leave the project exactly as it was */
    const working = SB.Pptx.options(SB.clone(p.settings.export || SB.Model.defaultExport()));

    const body = SB.el('div', 'xp-body');
    const left = SB.el('div', 'xp-left');
    const right = SB.el('div', 'xp-right');
    body.appendChild(left);
    body.appendChild(right);

    const presetSel = document.createElement('select');
    SB.Pptx.PRESETS.forEach(function (pr) {
      const op = document.createElement('option');
      op.value = pr.id; op.textContent = pr.label;
      if (pr.id === working.slidePreset) op.selected = true;
      presetSel.appendChild(op);
    });
    presetSel.onchange = function () { working.slidePreset = presetSel.value; draw(); };
    left.appendChild(field('Layout', presetSel));

    left.appendChild(SB.el('div', 'xp-head', 'Under each frame'));
    [
      ['showType', 'Shot type'],
      ['showScript', 'Script'],
      ['showDesc', 'Description'],
      ['showSceneHeading', 'Scene name']
    ].forEach(function (t) {
      left.appendChild(toggle(t[1], working[t[0]], function (v) { working[t[0]] = v; draw(); }));
    });

    left.appendChild(SB.el('div', 'xp-head', 'Scenes'));
    left.appendChild(toggle('A title slide with the scene description where a scene starts',
      working.sceneBanner, function (v) { working.sceneBanner = v; draw(); }));
    left.appendChild(toggle('Start each scene on a new slide',
      working.scenePageBreak, function (v) { working.scenePageBreak = v; draw(); }));

    left.appendChild(SB.el('div', 'xp-head', 'Slides'));
    left.appendChild(toggle('Full-size originals where the board has them',
      working.slideOriginals, function (v) { working.slideOriginals = v; draw(); }));
    left.appendChild(toggle('Card colour as a stripe beside each caption',
      working.color === 'accent', function (v) { working.color = v ? 'accent' : 'off'; draw(); }));
    /* the deck's own, not the sheets' `footer` — off by default, because
       these slides usually go into a deck that has a footer of its own */
    left.appendChild(toggle('Footer with the project name, version and slide number',
      working.slideFooter, function (v) { working.slideFooter = v; draw(); }));

    left.appendChild(SB.el('div', 'pp-note',
      'Cards marked “no shot” are left out. Words that do not fit under a frame are ' +
      'cut with an ellipsis — PowerPoint does not shrink text until it is edited. ' +
      'Every frame and caption stays editable in the deck.'));

    const count = SB.el('div', 'xp-count');
    const stage = SB.el('div', 'xp-stage');
    const frame = document.createElement('iframe');
    frame.className = 'xp-frame';
    stage.appendChild(frame);
    right.appendChild(SB.el('div', 'xp-head', 'Preview'));
    right.appendChild(count);
    right.appendChild(stage);

    function draw() {
      const pl = SB.Pptx.plan(working);
      const n = pl.slides.length;
      count.textContent = pl.shots + (pl.shots === 1 ? ' shot' : ' shots') + ' → ' +
        n + (n === 1 ? ' slide' : ' slides') +
        (working.slideOriginals ? ' · ' + pl.originals + ' full-size' : '');
      /* 960 wide plus the body padding and the scrollbar, scaled to the 300px column */
      const pw = 1000;
      const ph = 760;
      const scale = 300 / pw;
      frame.style.width = pw + 'px';
      frame.style.height = ph + 'px';
      frame.style.transform = 'scale(' + scale + ')';
      stage.style.height = Math.round(ph * scale) + 'px';
      const win = frame.contentDocument;
      win.open();
      win.write(SB.Pptx.previewHTML(pl));
      win.close();
    }

    SB.modal({
      title: 'PowerPoint export', width: '820px', body: body,
      buttons: [
        { label: 'Cancel' },
        {
          label: 'Export .pptx', primary: true, onClick: function (close) {
            /* said, not swallowed: a click that silently did nothing looked
               like a dead button */
            if (busy) { SB.toast('A deck is still being built — export again once it has downloaded', true); return; }
            const saved = SB.clone(p.settings.export || SB.Model.defaultExport());
            Object.keys(working).forEach(function (k) { saved[k] = working[k]; });
            p.settings.export = saved;
            SB.app.changed(false);
            close();
            busy = true;
            SB.toast('Building the deck…');
            /* inside a then, so a synchronous throw in plan() is a rejection
               too — otherwise `busy` stuck true for the rest of the session */
            Promise.resolve().then(function () { return SB.Pptx.exportPptx(working); }).catch(function (e) {
              SB.toast('The deck could not be built: ' + (e && e.message || e), true);
            }).then(function () { busy = false; });
          }
        }
      ]
    });
    draw();
  }

  SB.PptxOptions = { open: open };

})(window.SB);
