/* board.js — scene list, scene blocks, shot cards, drag & drop. */
(function (SB) {
  'use strict';

  const DND_SHOT = 'application/x-sb-shot';
  const DND_SCENE = 'application/x-sb-scene';

  const B = {
    scriptEditors: {},   // shotId -> editor api
    scriptEls: {}        // shotId -> element
  };

  function P() { return SB.app.project; }

  /* ---------------- scene navigator ---------------- */

  function renderSceneList() {
    const host = document.getElementById('sceneList');
    host.innerHTML = '';
    P().scenes.forEach(function (sc, idx) {
      const it = SB.el('div', 'scene-item' + (SB.app.selectedSceneId === sc.id ? ' sel' : ''));
      it.draggable = true;
      it.dataset.scene = sc.id;
      const t = SB.el('div');
      t.innerHTML = '<span class="num">' + (idx + 1) + '</span><span class="ttl">' +
        SB.esc(sc.heading || '(untitled scene)') + '</span>';
      it.appendChild(t);
      it.appendChild(SB.el('div', 'cnt', sc.shots.length + ' shot' + (sc.shots.length === 1 ? '' : 's')));

      it.addEventListener('click', function () {
        SB.app.selectedSceneId = sc.id;
        renderSceneList();
        const blk = document.querySelector('.scene-block[data-scene="' + sc.id + '"]');
        if (blk) blk.scrollIntoView({ behavior: 'smooth', block: 'start' });
        document.querySelectorAll('.scene-head').forEach(function (h) {
          h.classList.toggle('sel', h.parentNode.dataset.scene === sc.id);
        });
      });

      it.addEventListener('dragstart', function (ev) {
        ev.dataTransfer.setData(DND_SCENE, sc.id);
        ev.dataTransfer.effectAllowed = 'move';
      });
      it.addEventListener('dragover', function (ev) {
        const types = ev.dataTransfer.types;
        /* dropping a CARD on a scene here moves it into that scene — the
         * shortest way to reach a scene that is off-screen on the board */
        if (types.indexOf(DND_SHOT) >= 0) {
          ev.preventDefault();
          it.classList.add('drop-shot');
          return;
        }
        if (types.indexOf(DND_SCENE) < 0) return;
        ev.preventDefault();
        it.classList.add('drag-over');
      });
      it.addEventListener('dragleave', function () {
        it.classList.remove('drag-over');
        it.classList.remove('drop-shot');
      });
      it.addEventListener('drop', function (ev) {
        it.classList.remove('drag-over');
        it.classList.remove('drop-shot');
        const shotId = ev.dataTransfer.getData(DND_SHOT);
        if (shotId) {
          ev.preventDefault();
          SB.Model.moveShot(P(), shotId, sc.id, sc.shots.length);
          SB.app.selectedSceneId = sc.id;
          SB.app.changed(true);
          const f = SB.Model.findShot(P(), shotId);
          if (f) SB.toast('Moved to scene ' + (idx + 1) + ' — now ' + f.code);
          return;
        }
        const id = ev.dataTransfer.getData(DND_SCENE);
        if (!id) return;
        ev.preventDefault();
        const r = it.getBoundingClientRect();
        const before = ev.clientY < r.top + r.height / 2;
        SB.Model.moveScene(P(), id, before ? idx : idx + 1);
        SB.app.changed(true);
      });

      host.appendChild(it);
    });
  }

  /* ---------------- board ---------------- */

  /* Dragging a card to a scene further down the board needs the board to
   * follow — Chrome will not scroll a container on its own. */
  function armAutoScroll() {
    if (B.autoScroll) return;
    B.autoScroll = true;
    const panel = document.getElementById('boardPanel');
    panel.addEventListener('dragover', function (ev) {
      if (ev.dataTransfer.types.indexOf(DND_SHOT) < 0) return;
      const r = panel.getBoundingClientRect();
      const edge = 70;
      if (ev.clientY < r.top + edge) panel.scrollTop -= 18;
      else if (ev.clientY > r.bottom - edge) panel.scrollTop += 18;
    });
    document.addEventListener('dragend', function () {
      document.querySelectorAll('.drag-over,.drop-shot,.dragging').forEach(function (el) {
        el.classList.remove('drag-over');
        el.classList.remove('drop-shot');
        el.classList.remove('dragging');
      });
    });
  }

  /* Rebuilding the board throws the scroll position away, so anything that
   * changes every card — switching a field on, changing the target model —
   * used to fling you back to the top and away from the card you were on.
   * Hold the position, and if a card was selected, hold IT still: the cards
   * change height, so the same scrollTop is not the same place. */
  function render() {
    armAutoScroll();
    const panel = document.getElementById('boardPanel');
    const prevTop = panel ? panel.scrollTop : 0;
    let anchorId = null, anchorOffset = null;
    if (panel) {
      const top = panel.getBoundingClientRect().top;
      /* "the one you were on", in order of how sure we can be:
       * the card you are typing in, then the selected one, then the topmost
       * card on screen. */
      let anchor = null;
      const focused = document.activeElement;
      if (focused && focused.closest) anchor = focused.closest('#board .card');
      if (!anchor && SB.app.selectedShotId) {
        const sel = document.querySelector('.card[data-shot="' + SB.app.selectedShotId + '"]');
        if (sel && sel.getBoundingClientRect().bottom > top) anchor = sel;
      }
      if (!anchor) {
        const cards = document.querySelectorAll('#board .card');
        for (let i = 0; i < cards.length; i++) {
          if (cards[i].getBoundingClientRect().bottom > top + 4) { anchor = cards[i]; break; }
        }
      }
      if (anchor) {
        anchorId = anchor.dataset.shot;
        anchorOffset = anchor.getBoundingClientRect().top;
      }
    }

    B.scriptEditors = {};
    B.scriptEls = {};
    const board = document.getElementById('board');
    board.innerHTML = '';
    P().scenes.forEach(function (sc, si) { board.appendChild(sceneBlock(sc, si)); });
    renderSceneList();
    SB.ScriptMode.refresh();

    if (!panel) return;
    panel.scrollTop = prevTop;
    if (!anchorId) return;
    const now = document.querySelector('.card[data-shot="' + anchorId + '"]');
    if (!now) return;
    /* Correct from where the scroller ACTUALLY is, not from where we asked it
     * to go: hiding the prompt boxes shortens the board, the browser clamps
     * scrollTop to the new maximum, and correcting against the pre-clamp value
     * left the card somewhere else entirely. Two passes, because moving the
     * scroller can itself change what is clamped. */
    for (let i = 0; i < 2; i++) {
      const at = panel.scrollTop;
      const delta = now.getBoundingClientRect().top - anchorOffset;
      if (!delta) break;
      panel.scrollTop = at + delta;
      if (panel.scrollTop === at) break;          // already as close as it can get
    }

    /* If the board shrank past what the scroller can give back, the card can
     * still end up off screen. Whatever else happens, keep it in view. */
    const pr = panel.getBoundingClientRect();
    const cr = now.getBoundingClientRect();
    if (cr.bottom <= pr.top + 8 || cr.top >= pr.bottom - 8) {
      panel.scrollTop += cr.top - pr.top - 12;
    }
  }

  function sceneBlock(sc, si) {
    const blk = SB.el('div', 'scene-block');
    blk.dataset.scene = sc.id;

    const head = SB.el('div', 'scene-head' + (SB.app.selectedSceneId === sc.id ? ' sel' : ''));
    head.appendChild(SB.el('div', 'snum', 'Scene ' + (si + 1)));

    const fields = SB.el('div', 'fields');
    const h = document.createElement('input');
    h.className = 'sh-heading';
    h.value = sc.heading || '';
    h.placeholder = 'Scene heading';
    h.addEventListener('input', function () {
      sc.heading = h.value; SB.app.changed(false); renderSceneList();
    });
    const d = document.createElement('textarea');
    d.className = 'sh-desc';
    d.rows = 1;
    d.value = sc.description || '';
    d.placeholder = 'Scene description';
    d.addEventListener('input', function () { sc.description = d.value; SB.app.changed(false); });
    fields.appendChild(h); fields.appendChild(d);
    head.appendChild(fields);

    const acts = SB.el('div', 'scene-actions');
    const bAdd = SB.el('button', 'mini', '+ Shot');
    bAdd.onclick = function () {
      const sh = SB.Model.addShot(P(), sc.id, {});
      SB.app.selectedShotId = sh.id;
      SB.app.changed(true);
    };
    const bAddScene = SB.el('button', 'mini', '+ Scene below');
    bAddScene.onclick = function () { SB.Model.addScene(P(), si); SB.app.changed(true); };
    const bDel = SB.el('button', 'mini danger', 'Delete scene');
    bDel.onclick = function () {
      if (sc.shots.length && !confirm('Delete "' + (sc.heading || 'scene') + '" and its ' +
        sc.shots.length + ' shot(s)? Script text stays in the master script.')) return;
      SB.Model.deleteScene(P(), sc.id);
      SB.app.changed(true);
    };
    acts.appendChild(bAdd); acts.appendChild(bAddScene); acts.appendChild(bDel);
    head.appendChild(acts);
    blk.appendChild(head);

    const shots = SB.el('div', 'shots');
    shots.dataset.scene = sc.id;
    sc.shots.forEach(function (sh, sj) { shots.appendChild(card(sh, sc, si, sj)); });

    const add = SB.el('button', 'add-shot', '+ Add shot');
    add.onclick = function () {
      const s = SB.Model.addShot(P(), sc.id, {});
      SB.app.selectedShotId = s.id;
      SB.app.changed(true);
    };
    shots.appendChild(add);

    shots.addEventListener('dragover', function (ev) {
      if (ev.dataTransfer.types.indexOf(DND_SHOT) < 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      shots.classList.add('drag-over');
    });
    shots.addEventListener('dragleave', function (ev) {
      if (!shots.contains(ev.relatedTarget)) shots.classList.remove('drag-over');
    });
    shots.addEventListener('drop', function (ev) {
      if (ev.dataTransfer.types.indexOf(DND_SHOT) < 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      shots.classList.remove('drag-over');
      const id = ev.dataTransfer.getData(DND_SHOT);
      if (!id) return;
      SB.Model.moveShot(P(), id, sc.id, sc.shots.length);
      SB.app.changed(true);
    });

    blk.appendChild(shots);

    /* Anywhere in the scene block — including its heading — accepts a card.
     * Aiming at a scene's title is the obvious gesture; it used to do nothing. */
    blk.addEventListener('dragover', function (ev) {
      if (ev.dataTransfer.types.indexOf(DND_SHOT) < 0) return;
      ev.preventDefault();
      blk.classList.add('drag-over');
    });
    blk.addEventListener('dragleave', function (ev) {
      if (!blk.contains(ev.relatedTarget)) blk.classList.remove('drag-over');
    });
    blk.addEventListener('drop', function (ev) {
      if (ev.dataTransfer.types.indexOf(DND_SHOT) < 0) return;
      ev.preventDefault();
      blk.classList.remove('drag-over');
      const id = ev.dataTransfer.getData(DND_SHOT);
      if (!id) return;
      SB.Model.moveShot(P(), id, sc.id, sc.shots.length);
      SB.app.changed(true);
    });

    return blk;
  }

  /* ---------------- one card ---------------- */

  function card(sh, sc, si, sj) {
    const c = SB.el('div', 'card' + (sh.noShot ? ' noshot' : '') +
      (SB.app.selectedShotId === sh.id ? ' sel' : ''));
    c.dataset.shot = sh.id;
    c.style.setProperty('--card-color', sh.color);

    c.addEventListener('dragover', function (ev) {
      if (ev.dataTransfer.types.indexOf(DND_SHOT) < 0) return;
      ev.preventDefault(); ev.stopPropagation();
      c.classList.add('drag-over');
    });
    c.addEventListener('dragleave', function () { c.classList.remove('drag-over'); });
    c.addEventListener('drop', function (ev) {
      if (ev.dataTransfer.types.indexOf(DND_SHOT) < 0) return;
      ev.preventDefault(); ev.stopPropagation();
      c.classList.remove('drag-over');
      const id = ev.dataTransfer.getData(DND_SHOT);
      if (!id || id === sh.id) return;
      const r = c.getBoundingClientRect();
      const before = ev.clientX < r.left + r.width / 2;
      SB.Model.moveShot(P(), id, sc.id, sj + (before ? 0 : 1));
      SB.app.changed(true);
    });
    c.addEventListener('mousedown', function () {
      if (SB.app.selectedShotId === sh.id) return;
      SB.app.selectedShotId = sh.id;
      document.querySelectorAll('.card.sel').forEach(function (x) { x.classList.remove('sel'); });
      c.classList.add('sel');
      SB.ScriptMode.refresh();
    });

    /* --- head --- */
    const head = SB.el('div', 'card-head');
    head.draggable = true;
    head.addEventListener('dragstart', function (ev) {
      ev.dataTransfer.setData(DND_SHOT, sh.id);
      ev.dataTransfer.effectAllowed = 'move';
      c.classList.add('dragging');
    });
    head.addEventListener('dragend', function () { c.classList.remove('dragging'); });

    head.appendChild(SB.el('span', 'code', SB.Model.code(si, sj)));

    const sel = document.createElement('select');
    sel.className = 'type';
    const types = P().settings.shotTypes.slice();
    if (sh.type && types.indexOf(sh.type) < 0) types.unshift(sh.type);
    types.forEach(function (t) {
      const o = document.createElement('option');
      o.value = t; o.textContent = t;
      if (t === sh.type) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () { sh.type = sel.value; SB.app.changed(false); });
    head.appendChild(sel);

    if (sh.noShot) head.appendChild(SB.el('span', 'badge noshot', 'no shot'));

    const acts = SB.el('div', 'ch-actions');
    const col = SB.el('button', 'swatch');
    col.style.background = sh.color;
    col.title = 'Card colour';
    col.onclick = function (ev) {
      ev.stopPropagation();
      palette(col, sh.color, function (hex) {
        sh.color = hex;
        col.style.background = hex;
        c.style.setProperty('--card-color', hex);
        SB.app.changed(false);
      });
    };
    acts.appendChild(col);

    const ns = SB.el('button', 'mini', sh.noShot ? 'shot' : 'no shot');
    ns.title = 'Mark as “no shot” — stays on the board, excluded from prompts and PDF';
    ns.onclick = function () { sh.noShot = !sh.noShot; SB.app.changed(true); };
    acts.appendChild(ns);

    const del = SB.el('button', 'mini danger', '✕');
    del.title = 'Delete shot (script text stays in the master)';
    del.onclick = function () {
      if (!confirm('Delete shot ' + SB.Model.code(si, sj) + '? The script text stays in the master script.')) return;
      SB.Model.deleteShot(P(), sh.id);
      SB.app.changed(true);
    };
    acts.appendChild(del);
    head.appendChild(acts);
    c.appendChild(head);

    /* --- frame --- */
    c.appendChild(frame(sh));

    /* --- cast --- */
    if (SB.Personas.all(P()).length) c.appendChild(castRow(sh));

    /* --- script box --- */
    const linked = !!sh.link;
    const lbl = SB.el('div', 'box-label');
    const dot = SB.el('span', 'link-dot' + (sh.broken ? ' broken' : (linked ? '' : ' free')));
    lbl.appendChild(dot);
    lbl.appendChild(SB.el('span', null,
      sh.broken ? 'script — link broken' : (linked ? 'script — linked' : 'script — freestanding')));
    const la = SB.el('div', 'lbl-actions');
    if (linked) {
      const bl = SB.el('button', null, 'break link');
      bl.title = 'Stop syncing with the master script; keep the text as this shot’s own';
      bl.onclick = function () { SB.Model.breakLink(P(), sh); SB.app.changed(true); };
      la.appendChild(bl);
      const go = SB.el('button', null, 'show');
      go.onclick = function () {
        SB.app.selectedShotId = sh.id;
        SB.ScriptMode.open();
        SB.ScriptMode.scrollTo(sh);
      };
      la.appendChild(go);
    }
    lbl.appendChild(la);
    c.appendChild(lbl);

    const box = SB.el('div', 'script-box' + (sh.broken ? ' broken' : ''));
    box.dataset.shot = sh.id;
    B.scriptEls[sh.id] = box;
    B.scriptEditors[sh.id] = SB.Editor.attach(box, {
      get: function () {
        const f = SB.Model.findShot(P(), sh.id);
        return f ? SB.Model.windowFor(P(), f.shot) : null;
      },
      edit: function (s, e, t) { SB.Model.applyShotEdit(P(), sh, s, e, t); },
      toggle: function (type, s, e) {
        const w = SB.Model.windowFor(P(), sh);
        SB.Doc.toggleMark(w.doc, type, w.from + s, w.from + e);
      },
      after: function () { SB.app.scriptChanged(); }
    });
    c.appendChild(box);

    /* --- description --- */
    const dl = SB.el('div', 'box-label');
    dl.appendChild(SB.el('span', null, 'description'));
    c.appendChild(dl);

    const desc = document.createElement('textarea');
    desc.className = 'desc-box';
    desc.value = sh.description || '';
    desc.placeholder = 'What we see. This is what the prompt writer reads.';
    desc.addEventListener('input', function () { sh.description = desc.value; SB.app.changed(false); });
    c.appendChild(desc);

    /* --- the project's own extra fields --- */
    SB.Fields.enabled(P()).forEach(function (f) {
      const lbl = SB.el('div', 'box-label');
      lbl.appendChild(SB.el('span', null, f.label));
      c.appendChild(lbl);
      const ta = document.createElement('textarea');
      ta.className = 'desc-box field-box';
      ta.dataset.field = f.id;
      ta.value = SB.Fields.value(sh, f.id);
      ta.placeholder = f.label;
      ta.addEventListener('input', function () {
        SB.Fields.set(sh, f.id, ta.value);
        SB.app.changed(false);
      });
      c.appendChild(ta);
    });

    /* --- prompts (hidden until asked for, in the Prompts panel) --- */
    const st = P().settings;
    if (st.showImagePrompt) {
      const im = SB.Model.imageModel(P());
      if (im) c.appendChild(promptBox(sh, im, 'imagePrompt', 'first-frame prompt'));
    }
    if (st.showVideoPrompt) {
      const vm = SB.Model.videoModel(P());
      if (vm) c.appendChild(promptBox(sh, vm, 'videoPrompt', 'image→video prompt'));
    }

    /* --- comments --- */
    if (SB.app.commentMode || (sh.comments && sh.comments.length)) {
      c.appendChild(SB.Comments.list(sh));
    }

    return c;
  }

  /* Who is in this shot. The order is the order their reference images are fed
   * to the model, so it is shown. */
  function castRow(sh) {
    const row = SB.el('div', 'cast-row');
    row.dataset.shot = sh.id;
    const cast = SB.Personas.forShot(P(), sh);
    cast.forEach(function (per) {
      const chip = SB.el('span', 'cast-chip' + (per.image ? ' has-img' : ''),
        (per.image ? '◉ ' : '') + (per.name || 'unnamed'));
      chip.title = per.image
        ? (per.name + ' — reference image supplied')
        : (per.name + ' — no reference image, described in full');
      row.appendChild(chip);
    });
    if (!cast.length) row.appendChild(SB.el('span', 'cast-empty', 'no cast'));

    const b = SB.el('button', 'mini cast-edit', cast.length ? 'edit' : '+ cast');
    b.onclick = function (ev) {
      ev.stopPropagation();
      castPicker(b, sh);
    };
    row.appendChild(b);
    return row;
  }

  function castPicker(anchor, sh) {
    const old = document.querySelector('.cast-pop');
    if (old) old.remove();
    const pop = SB.el('div', 'cast-pop');
    SB.Personas.all(P()).forEach(function (per) {
      const l = SB.el('label', 'cast-opt');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = (sh.personaIds || []).indexOf(per.id) >= 0;
      cb.onchange = function () {
        SB.Personas.toggleOnShot(P(), sh, per.id);
        SB.Store.touch();
        refreshCast();
      };
      l.appendChild(cb);
      l.appendChild(document.createTextNode(' ' + (per.name || 'unnamed')));
      pop.appendChild(l);
    });
    const manage = SB.el('button', 'mini', 'manage personas…');
    manage.onclick = function () { pop.remove(); SB.PersonaPanel.open(); };
    pop.appendChild(manage);

    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.min(r.left, window.innerWidth - pop.offsetWidth - 8) + 'px';
    pop.style.top = Math.min(r.bottom + 4, window.innerHeight - pop.offsetHeight - 8) + 'px';
    setTimeout(function () {
      document.addEventListener('mousedown', function away(ev) {
        if (pop.contains(ev.target)) return;
        pop.remove();
        document.removeEventListener('mousedown', away);
      });
    }, 0);
  }

  /* Redraw just the cast rows — cheaper than rebuilding every card. */
  function refreshCast() {
    document.querySelectorAll('.cast-row').forEach(function (row) {
      const f = SB.Model.findShot(P(), row.dataset.shot);
      if (!f) return;
      const fresh = castRow(f.shot);
      row.parentNode.replaceChild(fresh, row);
    });
    SB.PersonaPanel.refresh();
  }

  /* a small popover of card colours that read on both themes */
  function palette(anchor, current, pick) {
    const old = document.querySelector('.pal-pop');
    if (old) old.remove();
    const pop = SB.el('div', 'pal-pop');
    SB.Model.CARD_COLORS.forEach(function (hex) {
      const b = SB.el('button', hex.toLowerCase() === String(current).toLowerCase() ? 'on' : '');
      b.style.background = hex;
      b.onclick = function (ev) { ev.stopPropagation(); pop.remove(); pick(hex); };
      pop.appendChild(b);
    });
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.min(r.left, window.innerWidth - pop.offsetWidth - 8) + 'px';
    pop.style.top = Math.min(r.bottom + 4, window.innerHeight - pop.offsetHeight - 8) + 'px';
    setTimeout(function () {
      document.addEventListener('mousedown', function away(ev) {
        if (pop.contains(ev.target)) return;
        pop.remove();
        document.removeEventListener('mousedown', away);
      });
    }, 0);
  }

  function promptBox(sh, m, field, title) {
    const pr = sh.prompts[m.id] || null;
    const wrap = SB.el('div', 'prompt-box');
    const t = SB.el('div', 'ptitle');
    t.appendChild(SB.el('span', null, title + ' · ' + m.name));

    /* the brand forbids gendered language; say so if some got through */
    const flagged = (pr && pr.flagged && pr.flagged[field]) || null;
    if (flagged && flagged.length) {
      const warn = SB.el('span', 'badge warn', 'gendered');
      warn.title = 'This prompt still contains: ' + flagged.join(', ') +
        '. The rewrite pass could not clear it — edit it or generate again.';
      t.appendChild(warn);
    }
    const gen = SB.el('button', 'mini', 'generate');
    gen.style.marginLeft = 'auto';
    gen.onclick = function () {
      gen.disabled = true; gen.textContent = '…';
      const roles = field === 'imagePrompt' ? { image: true } : { video: true };
      SB.Prompts.generateFor([sh], { roles: roles })
        .catch(function (e) {
          SB.toast(e.message || String(e), true);
          gen.disabled = false; gen.textContent = 'generate';
        });
    };
    t.appendChild(gen);
    wrap.appendChild(t);
    const ta = document.createElement('textarea');
    ta.value = (pr && pr[field]) || '';
    ta.placeholder = sh.noShot ? '(“no shot” — excluded from generation)' : 'not generated yet';
    ta.addEventListener('input', function () {
      sh.prompts[m.id] = sh.prompts[m.id] || { imagePrompt: '', videoPrompt: '', modelName: m.name };
      sh.prompts[m.id][field] = ta.value;
      sh.prompts[m.id].modelName = m.name;
      SB.app.changed(false);
    });
    wrap.appendChild(ta);
    return wrap;
  }

  /* ---------------- image frame ---------------- */

  function frame(sh) {
    const f = SB.el('div', 'frame');
    if (sh.image) {
      const img = document.createElement('img');
      img.className = 'shot-img';
      img.src = SB.Blobs.src(P(), sh.image);
      f.appendChild(img);
      if (sh.annotation) {
        const a = document.createElement('img');
        a.className = 'anno';
        a.src = SB.Blobs.src(P(), sh.annotation);
        f.appendChild(a);
      }
    } else {
      f.appendChild(SB.el('div', 'drop-hint', 'drop / paste an image, or click to load'));
    }

    const tools = SB.el('div', 'frame-tools');
    if (SB.app.commentMode && sh.image) {
      const dr = SB.el('button', 'mini', 'draw');
      dr.onclick = function (ev) { ev.stopPropagation(); SB.Comments.draw(sh); };
      tools.appendChild(dr);
      if (sh.annotation) {
        const cl = SB.el('button', 'mini danger', 'clear ink');
        cl.onclick = function (ev) { ev.stopPropagation(); sh.annotation = null; SB.app.changed(true); };
        tools.appendChild(cl);
      }
    }
    if (sh.image) {
      const rm = SB.el('button', 'mini danger', '✕');
      rm.title = 'Remove image';
      rm.onclick = function (ev) { ev.stopPropagation(); sh.image = null; SB.app.changed(true); };
      tools.appendChild(rm);
    }
    f.appendChild(tools);

    f.addEventListener('click', function () {
      SB.pickImageFile().then(function (file) { if (file) setImage(sh, file); });
    });
    f.addEventListener('dragover', function (ev) {
      if (ev.dataTransfer.types.indexOf(DND_SHOT) >= 0) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'copy';
      f.classList.add('drag-over');
    });
    f.addEventListener('dragleave', function () { f.classList.remove('drag-over'); });
    f.addEventListener('drop', function (ev) {
      if (ev.dataTransfer.types.indexOf(DND_SHOT) >= 0) return;
      ev.preventDefault();
      f.classList.remove('drag-over');
      SB.imageFromTransfer(ev.dataTransfer).then(function (src) {
        if (!src) { SB.toast('No image found in that drop', true); return; }
        setImage(sh, src);
      });
    });
    return f;
  }

  function setImage(sh, src) {
    return SB.downscaleImage(src).then(function (img) {
      sh.image = SB.Blobs.image(P(), img.data, img.w, img.h);
      SB.app.changed(true);
    }).catch(function (e) { SB.toast('Image failed: ' + e.message, true); });
  }

  /* ---------------- live script sync ---------------- */

  function renderScriptWindows() {
    Object.keys(B.scriptEditors).forEach(function (id) {
      const f = SB.Model.findShot(P(), id);
      const el = B.scriptEls[id];
      if (!f || !el) return;
      el.classList.toggle('broken', !!f.shot.broken);
      B.scriptEditors[id].render();
      const lbl = el.previousSibling;
      if (lbl && lbl.classList && lbl.classList.contains('box-label')) {
        const dot = lbl.querySelector('.link-dot');
        const txt = lbl.querySelector('span:nth-child(2)');
        const linked = !!f.shot.link;
        if (dot) dot.className = 'link-dot' + (f.shot.broken ? ' broken' : (linked ? '' : ' free'));
        if (txt) txt.textContent = f.shot.broken ? 'script — link broken' :
          (linked ? 'script — linked' : 'script — freestanding');
      }
    });
  }

  SB.Board = {
    render: render,
    renderSceneList: renderSceneList,
    renderScriptWindows: renderScriptWindows,
    refreshCast: refreshCast,
    setImage: setImage,
    DND_SHOT: DND_SHOT
  };

})(window.SB);
