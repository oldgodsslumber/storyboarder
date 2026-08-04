/* personapanel.js — add, edit and maintain the people who recur on the board. */
(function (SB) {
  'use strict';

  let panel, bodyEl, statusEl;

  function P() { return SB.app.project; }

  function init() {
    panel = document.getElementById('personaPanel');
    bodyEl = document.getElementById('personaBody');
  }

  function setStatus(txt, isErr) {
    if (!statusEl) return;
    statusEl.textContent = txt || '';
    statusEl.classList.toggle('err', !!isErr);
  }

  function render() {
    if (!panel || !P()) return;
    const p = P();
    bodyEl.innerHTML = '';

    /* --- generate --- */
    const gen = SB.el('div', 'pp-block');
    gen.appendChild(SB.el('div', 't', 'generate from the script'));

    const row = SB.el('div', 'pp-row');
    row.appendChild(SB.el('label', null, 'How many'));
    const count = document.createElement('select');
    [1, 2, 3, 4, 5].forEach(function (n) {
      const o = document.createElement('option');
      o.value = n; o.textContent = n;
      if (n === 2) o.selected = true;
      count.appendChild(o);
    });
    row.appendChild(count);
    gen.appendChild(row);

    const note = document.createElement('input');
    note.type = 'text';
    note.placeholder = 'optional direction — “one on-site technician”';
    const nRow = SB.el('div', 'pp-row');
    nRow.appendChild(SB.el('label', null, 'Direction'));
    nRow.appendChild(note);
    gen.appendChild(nRow);

    const acts = SB.el('div', 'pp-actions');
    const bGen = SB.el('button', 'tb on', 'Generate');
    bGen.onclick = function () {
      bGen.disabled = true;
      setStatus('reading the script…');
      SB.Personas.generate(p, parseInt(count.value, 10) || 1, note.value.trim())
        .then(function (made) {
          bGen.disabled = false;
          SB.app.changed(true);
          render();
          setStatus('added ' + made.length + ' — edit anything that is not right.');
        })
        .catch(function (e) {
          bGen.disabled = false;
          setStatus(e.message || String(e), true);
        });
    };
    const bAdd = SB.el('button', 'tb', '+ Blank persona');
    bAdd.onclick = function () {
      SB.Personas.add(p, {});
      SB.app.changed(true);
      render();
    };
    acts.appendChild(bGen);
    acts.appendChild(bAdd);
    gen.appendChild(acts);

    statusEl = SB.el('div', 'pp-status');
    gen.appendChild(statusEl);
    gen.appendChild(SB.el('div', 'pp-note',
      'Descriptions carry the wardrobe. That text plus the reference image is what keeps ' +
      'a person identical from shot to shot.'));
    bodyEl.appendChild(gen);

    /* --- the personas themselves --- */
    const list = SB.Personas.all(p);
    if (!list.length) {
      bodyEl.appendChild(SB.el('div', 'pp-note', 'No personas yet.'));
    }
    list.forEach(function (per, i) { bodyEl.appendChild(card(per, i)); });
  }

  function card(per, idx) {
    const p = P();
    const wrap = SB.el('div', 'persona');

    const head = SB.el('div', 'persona-head');
    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'persona-name';
    name.value = per.name || '';
    name.placeholder = 'Name';
    name.addEventListener('input', function () {
      per.name = name.value;
      SB.Store.touch();
      SB.Board.refreshCast();
    });
    head.appendChild(name);

    const used = countShots(per.id);
    head.appendChild(SB.el('span', 'persona-used', used + (used === 1 ? ' shot' : ' shots')));

    const del = SB.el('button', 'mini danger', '✕');
    del.title = 'Remove this persona and take it off every shot';
    del.onclick = function () {
      if (!confirm('Remove “' + (per.name || 'persona') + '”? It comes off ' + used + ' shot(s).')) return;
      SB.Personas.remove(p, per.id);
      SB.app.changed(true);
      render();
    };
    head.appendChild(del);
    wrap.appendChild(head);

    /* reference frame */
    const frame = SB.el('div', 'persona-frame');
    if (per.image) {
      const img = document.createElement('img');
      img.src = SB.Blobs.src(P(), per.image);
      frame.appendChild(img);
    } else {
      frame.appendChild(SB.el('div', 'drop-hint', 'drop the reference frame here, or click to load'));
    }
    frame.onclick = function () {
      SB.pickImageFile().then(function (f) { if (f) setImage(per, f); });
    };
    frame.addEventListener('dragover', function (ev) {
      ev.preventDefault();
      frame.classList.add('drag-over');
    });
    frame.addEventListener('dragleave', function () { frame.classList.remove('drag-over'); });
    frame.addEventListener('drop', function (ev) {
      ev.preventDefault();
      frame.classList.remove('drag-over');
      SB.imageFromTransfer(ev.dataTransfer).then(function (src) {
        if (src) setImage(per, src);
        else SB.toast('No image in that drop', true);
      });
    });
    if (per.image) {
      const rm = SB.el('button', 'mini danger persona-clear', 'remove image');
      rm.onclick = function (ev) {
        ev.stopPropagation();
        per.image = null;
        SB.app.changed(true);
        render();
      };
      frame.appendChild(rm);
    }
    wrap.appendChild(frame);
    wrap.appendChild(SB.el('div', 'pp-note',
      per.image
        ? 'Fed to the model as image ' + imageIndex(per) + ' wherever this persona appears.'
        : 'No reference image — prompts will describe this person in full instead.'));

    wrap.appendChild(SB.el('div', 'box-label', 'description + wardrobe'));
    const d = document.createElement('textarea');
    d.className = 'persona-text';
    d.rows = 4;
    d.value = per.description || '';
    d.placeholder = 'Age range, build, hair, and the exact outfit — fabric and colour.';
    d.addEventListener('input', function () { per.description = d.value; SB.Store.touch(); });
    wrap.appendChild(d);

    wrap.appendChild(SB.el('div', 'box-label', 'reference image prompt'));
    const ip = document.createElement('textarea');
    ip.className = 'persona-text';
    ip.rows = 4;
    ip.value = per.imagePrompt || '';
    ip.placeholder = 'The prompt that makes this person’s reference frame.';
    ip.addEventListener('input', function () { per.imagePrompt = ip.value; SB.Store.touch(); });
    wrap.appendChild(ip);

    const foot = SB.el('div', 'pp-actions');
    const copy = SB.el('button', 'mini', 'copy prompt');
    copy.onclick = function () {
      navigator.clipboard.writeText(per.imagePrompt || '').then(function () {
        SB.toast('Reference prompt copied');
      }).catch(function () { SB.toast('Could not copy', true); });
    };
    foot.appendChild(copy);

    const write = SB.el('button', 'mini', 'write it for me');
    write.title = 'Ask the writer model for a reference-frame prompt from the description';
    write.onclick = function () {
      if (!(per.description || '').trim()) { SB.toast('Write a description first', true); return; }
      write.disabled = true;
      const m = SB.Model.imageModel(P());
      const sys = SB.Brand.brandOf(P()).enabled
        ? 'HOUSE STYLE — obey this.\n\n' + SB.Brand.brandOf(P()).text : '';
      SB.Prompts.raw(
        'Write one still-image prompt for ' + (m ? m.name : 'an image model') +
        ' that produces a clean, front-facing reference frame of this person: plain background, ' +
        'natural light, full wardrobe visible, neutral expression. No gendered language.\n\n' +
        'PERSON:\n' + per.description,
        { type: 'OBJECT', properties: { imagePrompt: { type: 'STRING' } }, required: ['imagePrompt'] },
        sys
      ).then(function (out) {
        per.imagePrompt = out.imagePrompt || '';
        ip.value = per.imagePrompt;
        write.disabled = false;
        SB.app.changed(true);
      }).catch(function (e) {
        write.disabled = false;
        SB.toast(e.message || String(e), true);
      });
    };
    foot.appendChild(write);
    wrap.appendChild(foot);

    return wrap;
  }

  function imageIndex(per) {
    const withImg = SB.Personas.all(P()).filter(function (x) { return !!x.image; });
    return withImg.indexOf(per) + 1;
  }

  function countShots(id) {
    let n = 0;
    SB.Model.eachShot(P(), function (sh) {
      if ((sh.personaIds || []).indexOf(id) >= 0) n++;
    });
    return n;
  }

  function setImage(per, src) {
    return SB.downscaleImage(src).then(function (img) {
      per.image = SB.Blobs.image(P(), img.data, img.w, img.h);
      SB.app.changed(true);
      render();
    }).catch(function (e) { SB.toast('Image failed: ' + e.message, true); });
  }

  function open() {
    panel.classList.remove('hidden');
    document.getElementById('btnPersonas').classList.add('on');
    render();
  }
  function close() {
    panel.classList.add('hidden');
    document.getElementById('btnPersonas').classList.remove('on');
  }
  function toggle() { panel.classList.contains('hidden') ? open() : close(); }
  function isOpen() { return panel && !panel.classList.contains('hidden'); }
  function refresh() { if (isOpen()) render(); }

  SB.PersonaPanel = {
    init: init, open: open, close: close, toggle: toggle, isOpen: isOpen, refresh: refresh
  };

})(window.SB);
