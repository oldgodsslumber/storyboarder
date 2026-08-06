/* board.js — scene list, scene blocks, shot cards, drag & drop. */
(function (SB) {
  'use strict';

  const DND_SHOT = 'application/x-sb-shot';
  const DND_SCENE = 'application/x-sb-scene';

  const B = {
    scriptEditors: {},   // shotId -> editor api
    scriptEls: {}        // shotId -> element
  };

  /* Scene-level AI state, per scene id and only for this session: the text a
   * rewrite replaced, the shots a generate created, and the line under the
   * buttons. It lives outside the project so nothing here reaches the file, and
   * outside the render so a re-render doesn't drop the way back. */
  const AI = {};
  function aiOf(id) { return AI[id] || (AI[id] = { prev: null, ids: null, status: '', err: false, count: 0 }); }

  function P() { return SB.app.project; }

  /* ---------------- selecting cards ---------------- */

  function boardOrder() {
    const ids = [];
    SB.Model.eachShot(P(), function (sh) { ids.push(sh.id); });
    return ids;
  }

  function selection() {
    const app = SB.app;
    if (!Array.isArray(app.selection)) app.selection = app.selectedShotId ? [app.selectedShotId] : [];
    /* drop anything that has since been deleted */
    const live = boardOrder();
    app.selection = app.selection.filter(function (id) { return live.indexOf(id) >= 0; });
    return app.selection;
  }

  function isSelected(id) { return selection().indexOf(id) >= 0; }

  /* Plain click replaces, Ctrl/Cmd adds or removes, Shift takes the run
   * between the last card and this one — the shortcuts everything else uses. */
  function selectShot(id, ev) {
    const app = SB.app;
    const sel = selection();
    if (ev && (ev.ctrlKey || ev.metaKey)) {
      const i = sel.indexOf(id);
      if (i >= 0) sel.splice(i, 1); else sel.push(id);
      app.selectedShotId = sel.length ? sel[sel.length - 1] : null;
    } else if (ev && ev.shiftKey && app.selectedShotId) {
      const order = boardOrder();
      const a = order.indexOf(app.selectedShotId), b = order.indexOf(id);
      if (a < 0 || b < 0) { app.selection = [id]; app.selectedShotId = id; }
      else {
        app.selection = order.slice(Math.min(a, b), Math.max(a, b) + 1);
        app.selectedShotId = id;
      }
    } else {
      app.selection = [id];
      app.selectedShotId = id;
    }
    render();
  }

  function clearSelection() {
    SB.app.selection = [];
    SB.app.selectedShotId = null;
    render();
  }

  /* Which cards a drop should carry: the whole group if the dragged card is
   * part of one, otherwise just the card. */
  function dragged(id) {
    if (B.dragging && B.dragging.indexOf(id) >= 0) return B.dragging.slice();
    return [id];
  }

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
          SB.Model.moveShots(P(), dragged(shotId), sc.id, sc.shots.length);
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
    /* clicking the empty space below the cards drops the selection */
    board.onmousedown = function (ev) {
      if (ev.target === board && selection().length) clearSelection();
    };
    const bar = document.getElementById('selBar');
    if (bar) {
      bar.innerHTML = '';
      bar.appendChild(selectionBar());
      bar.classList.toggle('hidden', selection().length < 2);
    }
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

  /* The two writer-model actions that belong to the scene description itself:
   * sharpen the draft, and turn it into a run of shots. */
  function sceneAi(sc, descEl) {
    const ai = aiOf(sc.id);
    const row = SB.el('div', 'sc-ai');

    const bRw = SB.el('button', 'mini', '✦ Rewrite');
    bRw.title = 'Rewrite this description as something shootable — same facts, sharper';
    const bRev = SB.el('button', 'mini link' + (ai.prev == null ? ' hidden' : ''), 'revert');
    bRev.title = 'Put the previous description back';

    const cnt = document.createElement('select');
    cnt.className = 'sc-ai-count';
    cnt.title = 'How many shots. Auto lets the writer pick 2 or 3.';
    [['0', 'Auto'], ['2', '2'], ['3', '3'], ['4', '4']].forEach(function (o) {
      const op = document.createElement('option');
      op.value = o[0]; op.textContent = o[1];
      cnt.appendChild(op);
    });
    cnt.value = String(ai.count || 0);
    cnt.addEventListener('change', function () { ai.count = parseInt(cnt.value, 10) || 0; });

    const bGen = SB.el('button', 'mini primary', '✦ Generate shots');
    bGen.title = 'Board this description as consecutive beats of one moment';
    const bUndo = SB.el('button', 'mini link' + (ai.ids && ai.ids.length ? '' : ' hidden'), 'undo');
    bUndo.title = 'Remove the shots that were just generated';

    const st = SB.el('span', 'sc-ai-status' + (ai.err ? ' err' : ''), ai.status || '');

    row.appendChild(bRw); row.appendChild(bRev);
    row.appendChild(SB.el('span', 'sc-ai-gap'));
    row.appendChild(cnt); row.appendChild(bGen); row.appendChild(bUndo);
    row.appendChild(st);

    /* Editing by hand is the user taking the description back — the old text
     * stops being something they can return to. */
    descEl.addEventListener('input', function () {
      if (ai.prev == null) return;
      ai.prev = null;
      bRev.classList.add('hidden');
    });

    function busy(on, msg, isErr) {
      bRw.disabled = on; bGen.disabled = on; cnt.disabled = on;
      st.textContent = msg || '';
      st.classList.toggle('err', !!isErr);
      st.classList.toggle('run', !!on);
      if (!on) { ai.status = msg || ''; ai.err = !!isErr; }
    }

    /* A network block is answered by the dialog, with a way to run this again;
     * everything else is said where it happened. */
    function failed(e, again) {
      if (SB.apiBlocked(e, again)) { busy(false, 'blocked — see the dialog', true); return; }
      const msg = e && e.message ? e.message : String(e);
      busy(false, msg, true);
      SB.toast(msg, true);
    }

    bRw.onclick = function () {
      const prev = sc.description || '';
      busy(true, 'rewriting…');
      SB.Coverage.rewrite(P(), sc.id, '').then(function (next) {
        const f = SB.Model.findScene(P(), sc.id);
        if (!f) return;
        f.scene.description = next;
        descEl.value = next;
        ai.prev = prev;
        bRev.classList.remove('hidden');
        busy(false, 'rewritten');
        SB.app.changed(false);
      }).catch(function (e) { failed(e, bRw.onclick); });
    };

    bRev.onclick = function () {
      const f = SB.Model.findScene(P(), sc.id);
      if (!f || ai.prev == null) return;
      f.scene.description = ai.prev;
      descEl.value = ai.prev;
      ai.prev = null;
      bRev.classList.add('hidden');
      busy(false, '');
      SB.app.changed(false);
    };

    bGen.onclick = function () {
      const p = P();
      const kept = sc.shots.filter(function (sh) { return !SB.Coverage.isBlank(p, sh); }).length;
      if (kept && !confirm('Add generated shots to the end of "' + (sc.heading || 'this scene') +
        '"? It already has ' + kept + ' shot' + (kept === 1 ? '' : 's') + '.')) return;
      runGen();
    };

    /* Retry goes straight here: nothing was added, so asking again whether to
     * add to a scene that already has shots would just be a second door. */
    function runGen() {
      const p = P();
      busy(true, 'boarding…');
      SB.Coverage.generate(p, sc.id, { count: ai.count | 0 }).then(function (r) {
        ai.ids = r.ids.slice();
        ai.status = r.ids.length + ' shot' + (r.ids.length === 1 ? '' : 's') + ' added';
        ai.err = false;
        SB.app.selectedShotId = r.ids[0];
        SB.app.selection = [r.ids[0]];
        SB.app.changed(true);                 // rebuilds this row from ai state
        SB.toast(ai.status + (r.beats.length ? ' — ' + r.beats.join(' → ') : ''));
      }).catch(function (e) { failed(e, runGen); });
    }

    bUndo.onclick = function () {
      if (!ai.ids || !ai.ids.length) return;
      SB.Coverage.undo(P(), ai.ids);
      ai.ids = null;
      ai.status = 'generated shots removed';
      ai.err = false;
      SB.app.selectedShotId = null;
      SB.app.selection = [];
      SB.app.changed(true);
    };

    return row;
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
    fields.appendChild(sceneAi(sc, d));
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
    sc.shots.forEach(function (sh, sj) {
      /* A break between two cards: everything from the right-hand card on
       * becomes a new scene. A Premiere import arrives as one long scene of
       * cuts, and this is how it gets carved up. */
      if (sj > 0) shots.appendChild(sceneBreak(sc, sj));
      shots.appendChild(card(sh, sc, si, sj));
    });

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
      SB.Model.moveShots(P(), dragged(id), sc.id, sc.shots.length);
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
      SB.Model.moveShots(P(), dragged(id), sc.id, sc.shots.length);
      SB.app.changed(true);
    });

    return blk;
  }

  /* ---------------- a scene break between two cards ---------------- */

  function sceneBreak(sc, idx) {
    const b = SB.el('div', 'scene-break');
    b.title = 'Start a new scene here — this card and the ones after it move into it';
    b.appendChild(SB.el('span', 'scene-break-label', 'new scene'));
    b.onclick = function (ev) {
      ev.stopPropagation();
      const made = SB.Model.splitSceneAt(P(), sc.id, idx);
      if (!made) return;
      SB.app.selectedSceneId = made.id;
      SB.app.changed(true);
      SB.toast('Split into a new scene — ' + made.shots.length +
        ' card' + (made.shots.length === 1 ? '' : 's') + ' moved');
    };
    return b;
  }

  /* ---------------- what you can do to a group ---------------- */

  function selectionBar() {
    const sel = selection();
    const bar = SB.el('div', 'sel-bar' + (sel.length > 1 ? '' : ' hidden'));
    if (sel.length < 2) return bar;

    bar.appendChild(SB.el('span', 'sel-count', sel.length + ' shots selected'));

    const scene = SB.el('button', 'mini', '⤓ New scene from these');
    scene.title = 'Move them into a scene of their own';
    scene.onclick = function () {
      const made = SB.Model.sceneFromShots(P(), sel.slice());
      if (!made) return;
      SB.app.selectedSceneId = made.id;
      SB.app.changed(true);
      SB.toast('Moved ' + made.shots.length + ' cards into a new scene');
    };
    bar.appendChild(scene);

    const colour = SB.el('button', 'mini', '◧ Colour');
    colour.onclick = function (ev) {
      ev.stopPropagation();
      palette(colour, null, function (hex) {
        sel.forEach(function (id) {
          const f = SB.Model.findShot(P(), id);
          if (f) f.shot.color = hex;
        });
        SB.app.changed(true);
      });
    };
    bar.appendChild(colour);

    const ns = SB.el('button', 'mini', 'Toggle “no shot”');
    ns.onclick = function () {
      const anyOn = sel.some(function (id) {
        const f = SB.Model.findShot(P(), id);
        return f && !f.shot.noShot;
      });
      sel.forEach(function (id) {
        const f = SB.Model.findShot(P(), id);
        if (f) f.shot.noShot = anyOn;
      });
      SB.app.changed(true);
    };
    bar.appendChild(ns);

    const del = SB.el('button', 'mini danger', 'Delete');
    del.onclick = function () {
      if (!confirm('Delete ' + sel.length + ' shots? Their script text stays in the master script.')) return;
      sel.slice().forEach(function (id) { SB.Model.deleteShot(P(), id); });
      clearSelection();
      SB.app.changed(true);
    };
    bar.appendChild(del);

    const clear = SB.el('button', 'mini', 'Clear');
    clear.onclick = clearSelection;
    bar.appendChild(clear);

    return bar;
  }

  /* ---------------- one card ---------------- */

  function card(sh, sc, si, sj) {
    const c = SB.el('div', 'card' + (sh.noShot ? ' noshot' : '') +
      (isSelected(sh.id) ? ' sel' : '') +
      (SB.app.selectedShotId === sh.id ? ' lead' : ''));
    c.dataset.shot = sh.id;
    c.style.setProperty('--card-color', sh.color);

    c.addEventListener('dragover', function (ev) {
      if (ev.dataTransfer.types.indexOf(DND_SHOT) < 0) return;
      ev.preventDefault(); ev.stopPropagation();
      /* Alt turns the drop from "move this card here" into "swap the two
       * pictures over, leave both bits of dialogue where they are". */
      c.classList.toggle('swap-target', !!ev.altKey);
      c.classList.toggle('drag-over', !ev.altKey);
    });
    c.addEventListener('dragleave', function () {
      c.classList.remove('drag-over');
      c.classList.remove('swap-target');
    });
    c.addEventListener('drop', function (ev) {
      if (ev.dataTransfer.types.indexOf(DND_SHOT) < 0) return;
      ev.preventDefault(); ev.stopPropagation();
      c.classList.remove('drag-over');
      c.classList.remove('swap-target');
      const id = ev.dataTransfer.getData(DND_SHOT);
      if (!id || id === sh.id) return;
      if (ev.altKey) { doSwap(id, sh.id); return; }
      const r = c.getBoundingClientRect();
      const before = ev.clientX < r.left + r.width / 2;
      SB.Model.moveShots(P(), dragged(id), sc.id, sj + (before ? 0 : 1));
      SB.app.changed(true);
    });

    /* the two-click route, for when a modifier key is not on your mind */
    if (B.swapFrom && B.swapFrom !== sh.id) c.classList.add('swap-pick');
    if (B.swapFrom === sh.id) c.classList.add('swap-armed');
    c.addEventListener('click', function (ev) {
      if (!B.swapFrom || B.swapFrom === sh.id) return;
      /* Once a swap is armed, a click anywhere on another card completes it.
       * It used to ignore clicks that landed on a text box or a dropdown,
       * which is most of a card — so picking the second card often did
       * nothing at all. The ⇄ button has its own handler. */
      if (ev.target.closest('.ch-actions')) return;
      doSwap(B.swapFrom, sh.id);
    });
    c.addEventListener('mousedown', function (ev) {
      if (ev.target.closest('button, select, input, textarea, [contenteditable]')) return;
      if (ev.ctrlKey || ev.metaKey || ev.shiftKey) {
        ev.preventDefault();                       // no text selection while picking
        selectShot(sh.id, ev);
        return;
      }
      if (isSelected(sh.id) && selection().length > 1) return;  // keep the group for a drag
      selectShot(sh.id, ev);
    });

    /* --- head --- */
    const head = SB.el('div', 'card-head');
    head.draggable = true;
    head.addEventListener('dragstart', function (ev) {
      ev.dataTransfer.setData(DND_SHOT, sh.id);
      ev.dataTransfer.effectAllowed = 'move';
      /* dragging one of a group takes the whole group */
      B.dragging = isSelected(sh.id) ? selection().slice() : [sh.id];
      B.dragging.forEach(function (id) {
        const el = document.querySelector('.card[data-shot="' + id + '"]');
        if (el) el.classList.add('dragging');
      });
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

    const armedHere = B.swapFrom === sh.id;
    const armedElsewhere = !!B.swapFrom && !armedHere;
    const swap = SB.el('button', 'mini' + (armedHere ? ' primary' : (armedElsewhere ? ' danger' : '')), '⇄');
    swap.title = armedHere
      ? 'Waiting — click the card to swap with, or press Esc'
      : armedElsewhere
        ? 'Swap ' + SB.Model.findShot(P(), B.swapFrom).code + ' with this card'
        : 'Swap this shot with another — picture, description and prompts move, ' +
        'the dialogue and the position stay. Alt-drag does the same.';
    swap.onclick = function (ev) {
      ev.stopPropagation();
      /* Pressing ⇄ on a second card is the obvious way to finish the job, so
       * do that rather than quietly re-arming and looking like nothing works. */
      if (armedElsewhere) { doSwap(B.swapFrom, sh.id); return; }
      armSwap(armedHere ? null : sh.id);
    };
    acts.appendChild(swap);

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

  /* ---------------- swapping two shots ---------------- */

  /* Move the pictures, leave the dialogue. Announced afterwards, because doing
   * it again puts everything back — that IS the undo. */
  function doSwap(aId, bId) {
    const r = SB.Model.swapShotContent(P(), aId, bId);
    B.swapFrom = null;
    if (!r) return;
    SB.app.selectedShotId = bId;
    SB.app.changed(true);
    SB.toast('Swapped ' + r.a + ' and ' + r.b + ' — the script stayed put');
  }

  function armSwap(id) {
    B.swapFrom = id || null;
    SB.app.changed(true);
    if (B.swapFrom) SB.toast('Click the card to swap with, or press Esc');
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
          gen.disabled = false; gen.textContent = 'generate';
          if (SB.apiBlocked(e, function () { gen.onclick(); })) return;
          SB.toast(e.message || String(e), true);
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
    swap: doSwap,
    armSwap: armSwap,
    swapArmed: function () { return B.swapFrom || null; },
    select: selectShot,
    selection: selection,
    clearSelection: clearSelection,
    DND_SHOT: DND_SHOT
  };

})(window.SB);
