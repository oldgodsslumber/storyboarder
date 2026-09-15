/* board.js — scene list, scene blocks, shot cards, drag & drop. */
(function (SB) {
  'use strict';

  const DND_SHOT = 'application/x-sb-shot';
  const DND_SCENE = 'application/x-sb-scene';

  const B = {
    openBox: {},              // shotId:role -> the lane box is open on this card
    scriptEditors: {},        // shotId -> editor api
    scriptEls: {},            // shotId -> element
    sceneScriptEditors: {},   // sceneId -> editor api, for a scene's own section
    sceneScriptEls: {}        // sceneId -> element
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
  /* Shift-drag: the cards that were dragged, copied where they landed. */
  function doCopy(id, toSceneId, toIdx) {
    const ids = dragged(id);
    let at = typeof toIdx === 'number' ? toIdx : null;
    let last = null;
    const copies = [];
    ids.forEach(function (one) {
      last = SB.Model.duplicateShot(P(), one, toSceneId, at);
      if (last) copies.push(last.id);
      if (last && at != null) at++;
    });
    if (!last) return;
    /* The copies are what is now selected. Leaving the selection on the
       originals while the lead moved to a copy meant the next shift-click
       anchored off a card that was not in the selection. */
    SB.app.selection = copies.slice();
    SB.app.selectedShotId = last.id;
    SB.app.changed(true);
    SB.toast(ids.length === 1 ? 'Card copied' : ids.length + ' cards copied');
  }

  function dragged(id) {
    if (B.dragging && B.dragging.indexOf(id) >= 0) return B.dragging.slice();
    return [id];
  }

  /* ---------------- where a drop lands ----------------
   *
   * Only the cards and the scene rows themselves ever answered this. A drop
   * anywhere else - the gap between two cards, a scene-break marker, the add
   * button, the padding above the first scene, the empty space below the last
   * one - meant "put it at the end", or nothing at all. Which is why the ends
   * were the unreliable part: aiming just outside the first card is the
   * natural way to say "put it first", and it sent the card to the far end.
   *
   * So the pointer is measured against every card (or every scene row) and the
   * nearest edge wins, wherever in the container it lands. */
  function nearest(els, x, y, horiz) {
    let bi = 0, bd = Infinity, br = null;
    els.forEach(function (el, i) {
      const r = el.getBoundingClientRect();
      let d;
      if (horiz) {
        /* the row under the pointer first, then the nearest card in it */
        const dy = y < r.top ? r.top - y : (y > r.bottom ? y - r.bottom : 0);
        d = dy * 10000 + Math.abs(x - (r.left + r.width / 2));
      } else {
        d = Math.abs(y - (r.top + r.height / 2));
      }
      if (d < bd) { bd = d; bi = i; br = r; }
    });
    if (!br) return { idx: 0, rect: null, after: false };
    const after = horiz ? (x > br.left + br.width / 2) : (y > br.top + br.height / 2);
    return { idx: bi + (after ? 1 : 0), rect: br, after: after };
  }

  function kids(host, cls) {
    return Array.prototype.filter.call(host.children, function (k) {
      return k.classList && k.classList.contains(cls);
    });
  }

  /* the cards of one scene, in order, whatever else is in the container */
  function shotHit(shots, ev) {
    return nearest(kids(shots, 'card'), ev.clientX, ev.clientY, true);
  }
  function sceneHit(host, ev) {
    return nearest(kids(host, 'scene-item'), ev.clientX, ev.clientY, false);
  }

  /* A line where the thing will land. Without it the only way to find out was
   * to let go. */
  function mark(hit, horiz, copy) {
    let m = document.getElementById('dropMark');
    if (!m) {
      m = SB.el('div');
      m.id = 'dropMark';
      document.body.appendChild(m);
    }
    if (!hit || !hit.rect) { m.style.display = 'none'; return; }
    const r = hit.rect;
    m.style.display = 'block';
    m.classList.toggle('copy', !!copy);
    if (horiz) {
      m.style.left = ((hit.after ? r.right + 4 : r.left - 4) - 1) + 'px';
      m.style.top = r.top + 'px';
      m.style.width = '3px';
      m.style.height = r.height + 'px';
    } else {
      m.style.left = r.left + 'px';
      m.style.top = ((hit.after ? r.bottom + 2 : r.top - 2) - 1) + 'px';
      m.style.width = r.width + 'px';
      m.style.height = '3px';
    }
  }
  function unmark() {
    const m = document.getElementById('dropMark');
    if (m) m.style.display = 'none';
  }

  /* ---------------- scene navigator ---------------- */

  /* Which lane boxes somebody has opened is about the board on screen. A new
   * board has opened none, and the keys of the old one would otherwise sit in
   * memory for the life of the session. */
  function forgetOpenBoxes() { B.openBox = {}; }

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
      /* Which sections are claimed, answerable without opening the script. */
      const claim = sc.link && !sc.broken ? ' · section'
        : (sc.broken ? ' · section broken' : (sc.local ? ' · own section' : ''));
      it.appendChild(SB.el('div', 'cnt', sc.shots.length + ' shot' +
        (sc.shots.length === 1 ? '' : 's') + claim));

      it.addEventListener('click', function () {
        SB.app.selectedSceneId = sc.id;
        renderSceneList();
        const blk = document.querySelector('.scene-block[data-scene="' + sc.id + '"]');
        if (blk) blk.scrollIntoView({ behavior: 'smooth', block: 'start' });
        document.querySelectorAll('.scene-head').forEach(function (h) {
          h.classList.toggle('sel', h.parentNode.dataset.scene === sc.id);
        });
      });

      it.addEventListener('dragend', function () { unmark(); });
      it.addEventListener('dragstart', function (ev) {
        ev.dataTransfer.setData(DND_SCENE, sc.id);
        ev.dataTransfer.effectAllowed = 'copyMove';
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
        ev.stopPropagation();
        const hit = sceneHit(host, ev);
        mark(hit, false);
        it.classList.toggle('drag-over', !hit.after);
        it.classList.toggle('drag-under', !!hit.after);
      });
      it.addEventListener('dragleave', function () {
        it.classList.remove('drag-over');
        it.classList.remove('drag-under');
        it.classList.remove('drop-shot');
      });
      it.addEventListener('drop', function (ev) {
        it.classList.remove('drag-over');
        it.classList.remove('drag-under');
        it.classList.remove('drop-shot');
        unmark();
        const shotId = ev.dataTransfer.getData(DND_SHOT);
        if (shotId) {
          ev.preventDefault();
          if (ev.shiftKey) {
            doCopy(shotId, sc.id, sc.shots.length);
            SB.toast('Copied into scene ' + (idx + 1));
            return;
          }
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
        ev.stopPropagation();
        SB.Model.moveScene(P(), id, sceneHit(host, ev).idx);
        SB.app.changed(true);
      });

      host.appendChild(it);
    });

    /* The padding, the gaps between rows, and the empty space under the last
     * scene. Dropping there is how you say "put it at the bottom", and it used
     * to do nothing at all. */
    if (!host.dataset.wired) {
      host.dataset.wired = '1';
      host.addEventListener('dragover', function (ev) {
        if (ev.dataTransfer.types.indexOf(DND_SCENE) < 0) return;
        ev.preventDefault();
        mark(sceneHit(host, ev), false);
      });
      host.addEventListener('dragleave', function (ev) {
        if (!host.contains(ev.relatedTarget)) unmark();
      });
      host.addEventListener('drop', function (ev) {
        if (ev.dataTransfer.types.indexOf(DND_SCENE) < 0) return;
        ev.preventDefault();
        unmark();
        const id = ev.dataTransfer.getData(DND_SCENE);
        if (!id) return;
        SB.Model.moveScene(P(), id, sceneHit(host, ev).idx);
        SB.app.changed(true);
      });
    }
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
      document.querySelectorAll('.drag-over,.drop-shot,.dragging,.copy-target,.swap-target').forEach(function (el) {
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
  /* The board is rebuilt from nothing every time, so whatever box had the
   * caret is destroyed by it. Focus.keep puts the caret back in the same box
   * at the same offset — see focus.js for why that matters more than it
   * sounds like it does. */
  function render() { SB.Focus.keep(renderNow); }

  function renderNow() {
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
    B.sceneScriptEditors = {};
    B.sceneScriptEls = {};
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

  /* A scene's heading and description are on screen in two places at once —
   * the banner over its cards, and the row in the reference library's scene
   * organizer. Both write straight to the same object, so whichever one you
   * are not typing into is holding a copy that went stale the moment you
   * touched the other. Left alone, the next keystroke in the stale box wrote
   * its whole outdated string back over the newer text.
   *
   * Every box carries its scene id, so both sides can be brought up to date
   * from the model. The focused one is never touched: it is the one that is
   * right, and writing to it would move the caret. */
  function syncSceneFields(id) {
    const f = SB.Model.findScene(P(), id);
    if (!f) return;
    document.querySelectorAll('[data-scene="' + id + '"]').forEach(function (el) {
      if (el === document.activeElement) return;
      let v = null;
      if (el.classList.contains('sh-heading')) v = f.scene.heading || '';
      else if (el.classList.contains('sh-desc')) v = f.scene.description || '';
      if (v === null) return;
      if (el.__refPaint) { if (SB.RefBox.read(el) !== v) el.__refPaint(false); return; }
      if (el.value !== v) el.value = v;
    });
  }

  /* Whether the way back from a rewrite, or the way out of a generate, is
   * offered — on every copy of the buttons, not just the one clicked. */
  function syncSceneAi(id) {
    const ai = aiOf(id);
    document.querySelectorAll('.sc-revert[data-scene="' + id + '"]').forEach(function (b) {
      b.classList.toggle('hidden', ai.prev == null);
    });
    document.querySelectorAll('.sc-undo[data-scene="' + id + '"]').forEach(function (b) {
      b.classList.toggle('hidden', !(ai.ids && ai.ids.length));
    });
  }

  /* The two writer-model actions that belong to the scene description itself:
   * sharpen the draft, and turn it into a run of shots. */
  function sceneAi(sc, descEl) {
    const ai = aiOf(sc.id);
    const row = SB.el('div', 'sc-ai');

    const bRw = SB.el('button', 'mini', '✦ Rewrite');
    bRw.title = 'Rewrite this description as something shootable — same facts, sharper';
    const bRev = SB.el('button', 'mini link sc-revert' + (ai.prev == null ? ' hidden' : ''), 'revert');
    bRev.dataset.scene = sc.id;
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
    const bUndo = SB.el('button', 'mini link sc-undo' + (ai.ids && ai.ids.length ? '' : ' hidden'), 'undo');
    bUndo.dataset.scene = sc.id;
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
      syncSceneAi(sc.id);
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
        f.scene.description = SB.Refs.relink(P(), next, prev);   // it comes back as prose
        /* the box is a reference box now: it is repainted, not assigned to */
        const dropped = SB.Refs.lostIn(P(), f.scene.description, prev);
        ai.prev = prev;
        syncSceneAi(sc.id);
        syncSceneFields(sc.id);
        if (descEl.__refPaint) descEl.__refPaint(false);
        busy(false, dropped.length
          ? 'rewritten — ' + dropped.length + ' reference' + (dropped.length === 1 ? '' : 's') + ' dropped'
          : 'rewritten', !!dropped.length);
        if (dropped.length) {
          SB.toast('The rewrite no longer mentions ' +
            dropped.map(function (m) { return m.label; }).join(', ') +
            ' — @ ' + (dropped.length === 1 ? 'it' : 'them') + ' again if the picture is still wanted', true);
        }
        SB.app.changed(false);
      }).catch(function (e) { failed(e, bRw.onclick); });
    };

    bRev.onclick = function () {
      const f = SB.Model.findScene(P(), sc.id);
      if (!f || ai.prev == null) return;
      f.scene.description = ai.prev;
      if (descEl.__refPaint) descEl.__refPaint(false);
      ai.prev = null;
      syncSceneAi(sc.id);
      syncSceneFields(sc.id);
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
        ai.personaIds = (r.personaIds || []).slice();
        /* A person the run had to invent is a change to the whole board, not
         * just to this scene, so it is said out loud rather than found later. */
        const newCast = (r.created || []).map(function (per) { return per.name; });
        ai.status = r.ids.length + ' shot' + (r.ids.length === 1 ? '' : 's') + ' added' +
          (newCast.length ? ' · cast ' + newCast.join(', ') : '');
        ai.err = false;
        SB.app.selectedShotId = r.ids[0];
        SB.app.selection = [r.ids[0]];
        SB.app.changed(true);                 // rebuilds this row from ai state
        if (newCast.length) SB.PersonaPanel.refresh();
        SB.PersonaPanel.refreshScenes();      // the shot count on this scene just moved
        SB.toast(ai.status + (r.beats.length ? ' — ' + r.beats.join(' → ') : ''));
      }).catch(function (e) { failed(e, runGen); });
    }

    bUndo.onclick = function () {
      if (!ai.ids || !ai.ids.length) return;
      const hadCast = !!(ai.personaIds && ai.personaIds.length);
      SB.Coverage.undo(P(), ai.ids, ai.personaIds);
      ai.ids = null;
      ai.personaIds = null;
      /* the status is what the rebuilt row reads, so it is set before the
         rebuild — otherwise the organizer redraws still saying "3 shots added" */
      ai.status = 'generated shots removed';
      ai.err = false;
      if (hadCast) SB.PersonaPanel.refresh();
      SB.PersonaPanel.refreshScenes();
      SB.app.selectedShotId = null;
      SB.app.selection = [];
      SB.app.changed(true);
    };

    return row;
  }

  /* A scene's own section of the script — the same box a card gets, so the two
   * layers behave alike, and only ever present once a scene claims something. */
  function sceneScriptBox(sc) {
    const wrap = SB.el('div', 'scene-script');
    const linked = !!sc.link;

    const lbl = SB.el('div', 'box-label');
    lbl.appendChild(SB.el('span', 'link-dot' + (sc.broken ? ' broken' : (linked ? '' : ' free'))));
    lbl.appendChild(SB.el('span', null, sc.broken ? 'section — link broken'
      : (linked ? 'section — linked' : 'section — freestanding')));

    const la = SB.el('div', 'lbl-actions');
    if (linked) {
      const bl = SB.el('button', null, 'break link');
      bl.title = 'Stop syncing with the master script; keep the text as this scene’s own';
      bl.onclick = function () {
        SB.Model.breakSceneLink(P(), sc);
        SB.app.changed(true);
        SB.ScriptMode.refresh();
      };
      la.appendChild(bl);
      const go = SB.el('button', null, 'show');
      go.onclick = function () {
        SB.app.selectedSceneId = sc.id;
        SB.ScriptMode.open();
        SB.ScriptMode.scrollToScene();
      };
      la.appendChild(go);
    }
    /* Letting go of a section is not creating one, so this does not give an
     * untied scene a way in — it has no label at all. */
    const rm = SB.el('button', null, linked ? 'untie' : 'remove');
    rm.title = linked ? 'Forget which part of the script this scene covers'
      : 'Delete this scene’s own script text';
    rm.onclick = function () {
      if (!linked && sc.local && (sc.local.text || '').trim() &&
        !confirm('Delete this scene’s script text? It is no longer in the master script.')) return;
      SB.Model.untieScene(P(), sc.id);
      SB.app.changed(true);
      SB.ScriptMode.refresh();
    };
    la.appendChild(rm);
    lbl.appendChild(la);
    wrap.appendChild(lbl);

    const box = SB.el('div', 'script-box scene-script-box' + (sc.broken ? ' broken' : ''));
    box.dataset.scene = sc.id;
    B.sceneScriptEls[sc.id] = box;
    B.sceneScriptEditors[sc.id] = SB.Editor.attach(box, {
      get: function () {
        const f = SB.Model.findScene(P(), sc.id);
        return f ? SB.Model.windowForScene(P(), f.scene) : null;
      },
      edit: function (s, e, t) { SB.Model.applySceneEdit(P(), sc, s, e, t); },
      toggle: function (type, s, e) {
        const w = SB.Model.windowForScene(P(), sc);
        if (w) SB.Doc.toggleMark(w.doc, type, w.from + s, w.from + e);
      },
      after: function () { SB.app.scriptChanged(); }
    });
    wrap.appendChild(box);
    return wrap;
  }

  function sceneBlock(sc, si) {
    const blk = SB.el('div', 'scene-block');
    blk.dataset.scene = sc.id;

    const head = SB.el('div', 'scene-head' + (SB.app.selectedSceneId === sc.id ? ' sel' : ''));
    head.appendChild(SB.el('div', 'snum', 'Scene ' + (si + 1)));

    const fields = SB.el('div', 'fields');
    const h = document.createElement('input');
    h.className = 'sh-heading';
    h.dataset.scene = sc.id;
    h.value = sc.heading || '';
    h.placeholder = 'Untitled scene — what happens here';
    h.addEventListener('input', function () {
      sc.heading = h.value; SB.app.changed(false); renderSceneList();
      syncSceneFields(sc.id);
    });
    const d = SB.el('div', 'sh-desc');
    d.dataset.scene = sc.id;
    SB.RefBox.attach(d, {
      get: function () { return sc.description || ''; },
      set: function (t) {
        sc.description = t; SB.app.changed(false);
        syncSceneFields(sc.id);
      },
      placeholder: 'Scene description',
      ctx: { scene: sc }
    });
    fields.appendChild(h); fields.appendChild(d);
    fields.appendChild(sceneAi(sc, d));
    /* Only once the scene actually claims something — an untied scene, which is
     * most of them, looks exactly as it always did. */
    if (SB.Model.sceneTied(sc)) fields.appendChild(sceneScriptBox(sc));
    head.appendChild(fields);

    /* Selecting a scene by clicking its header is what makes the Capture form's
     * scene picker already point at the one you mean. */
    head.addEventListener('mousedown', function (ev) {
      if (ev.target.tagName === 'BUTTON' || ev.target.tagName === 'SELECT') return;
      if (SB.app.selectedSceneId === sc.id) return;
      SB.app.selectedSceneId = sc.id;
      renderSceneList();
      document.querySelectorAll('.scene-head').forEach(function (x) {
        x.classList.toggle('sel', x.parentNode.dataset.scene === sc.id);
      });
      if (SB.ScriptMode.isOpen()) SB.ScriptMode.refresh();
    });

    const acts = SB.el('div', 'scene-actions');
    const bAdd = SB.el('button', 'mini', '+ Shot');
    bAdd.title = 'Add a shot — or drop an image here to make a card from it';
    acceptImageDrop(bAdd, sc);
    bAdd.onclick = function () {
      const sh = SB.Model.addShot(P(), sc.id, {});
      SB.app.selectedShotId = sh.id;
      SB.app.changed(true);
    };
    const bAddScene = SB.el('button', 'mini', '+ Scene below');
    bAddScene.onclick = function () { SB.Model.addScene(P(), si); SB.app.changed(true); };
    const bDel = SB.el('button', 'mini danger', 'Delete scene');
    bDel.onclick = function () {
      /* A scene holding a claim but no cards used to delete with no warning. */
      if ((sc.shots.length || SB.Model.sceneTied(sc)) &&
        !confirm('Delete "' + (sc.heading || 'scene') + '"' +
          (sc.shots.length ? ' and its ' + sc.shots.length + ' shot(s)' : '') +
          '? Script text stays in the master script.')) return;
      SB.Model.deleteScene(P(), sc.id);
      delete AI[sc.id];                  // its session state goes with it
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
    add.title = 'Add a shot — or drop an image here to make a card from it';
    acceptImageDrop(add, sc);
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
      if (!ev.altKey) mark(shotHit(shots, ev), true);
    });
    shots.addEventListener('dragleave', function (ev) {
      if (!shots.contains(ev.relatedTarget)) { shots.classList.remove('drag-over'); unmark(); }
    });
    shots.addEventListener('drop', function (ev) {
      if (ev.dataTransfer.types.indexOf(DND_SHOT) < 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      shots.classList.remove('drag-over');
      unmark();
      const id = ev.dataTransfer.getData(DND_SHOT);
      if (!id) return;
      /* the gap left of the first card means "first", not "last" */
      const hit = shotHit(shots, ev);
      if (ev.shiftKey) {
        doCopy(id, sc.id, kids(shots, 'card').length ? hit.idx : sc.shots.length);
        return;
      }
      SB.Model.moveShots(P(), dragged(id), sc.id,
        kids(shots, 'card').length ? hit.idx : sc.shots.length);
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
      unmark();
      const id = ev.dataTransfer.getData(DND_SHOT);
      if (!id) return;
      /* every drop target answers the same gesture, or the one that does not
         is the one somebody lands on and it quietly does the destructive thing */
      if (ev.shiftKey) { doCopy(id, sc.id, sc.shots.length); return; }
      SB.Model.moveShots(P(), dragged(id), sc.id, sc.shots.length);
      SB.app.changed(true);
    });

    return blk;
  }

  /* ---------------- pictures dropped on an add button ----------------
   *
   * Dragging a still straight at "+ Add shot" is the gesture people try
   * first, and it used to do nothing at all. The card is made only once the
   * picture has actually been resolved, so a drop carrying no image leaves no
   * empty card behind.
   */
  function acceptImageDrop(el, sc) {
    el.addEventListener('dragover', function (ev) {
      /* A card being reordered is not ours — let it fall through to the strip
       * underneath, which is what actually moves it. */
      if (ev.dataTransfer.types.indexOf(DND_SHOT) >= 0) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'copy';
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', function () { el.classList.remove('drag-over'); });
    el.addEventListener('drop', function (ev) {
      if (ev.dataTransfer.types.indexOf(DND_SHOT) >= 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      el.classList.remove('drag-over');
      SB.imagesFromTransfer(ev.dataTransfer).then(function (imgs) {
        if (!imgs.length) { SB.toast('No image found in that drop', true); return; }
        /* One at a time: the cards then land in the order they were picked,
           and the blob writes do not race each other. */
        return imgs.reduce(function (chain, src) {
          return chain.then(function () {
            const sh = SB.Model.addShot(P(), sc.id, {});
            if (!sh) return null;
            SB.app.selectedShotId = sh.id;
            SB.app.changed(true);          // the card shows at once, then fills in
            return setImage(sh, src);
          });
        }, Promise.resolve()).then(function () {
          if (imgs.length > 1) SB.toast('Added ' + imgs.length + ' shots');
        });
      });
    });
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
    del.title = 'Delete the selected shots (their script text stays in the master)';
    SB.armButton(del, 'Delete ' + sel.length + '?', function () {
      const n = sel.length;
      sel.slice().forEach(function (id) { SB.Model.deleteShot(P(), id); });
      clearSelection();
      SB.app.changed(true);
      SB.toast('Deleted ' + n + ' shot' + (n === 1 ? '' : 's') +
        ' — their script text stays in the master');
    });
    bar.appendChild(del);

    const clear = SB.el('button', 'mini', 'Clear');
    clear.onclick = clearSelection;
    bar.appendChild(clear);

    return bar;
  }

  /* ---------------- one card ---------------- */

  /* The card's window onto the stretch of master script it claims. */
  function scriptSection(sh) {
    const c = SB.el('div', 'script-section');
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

    return c;
  }

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
      ev.dataTransfer.dropEffect = ev.shiftKey ? 'copy' : 'move';
      c.classList.toggle('swap-target', !!ev.altKey && !ev.shiftKey);
      c.classList.toggle('drag-over', !ev.altKey || !!ev.shiftKey);
      c.classList.toggle('copy-target', !!ev.shiftKey);
      if (ev.altKey && !ev.shiftKey) unmark();
      else mark(shotHit(c.parentNode, ev), true, ev.shiftKey);
    });
    c.addEventListener('dragleave', function () {
      c.classList.remove('drag-over');
      c.classList.remove('swap-target');
      c.classList.remove('copy-target');
    });
    c.addEventListener('drop', function (ev) {
      if (ev.dataTransfer.types.indexOf(DND_SHOT) < 0) return;
      ev.preventDefault(); ev.stopPropagation();
      c.classList.remove('drag-over');
      c.classList.remove('swap-target');
      c.classList.remove('copy-target');
      unmark();
      const id = ev.dataTransfer.getData(DND_SHOT);
      if (!id) return;
      /* Read at the DROP, not at the dragstart: a modifier held on the way
         out and let go before landing should not still count. */
      if (ev.shiftKey) { doCopy(id, sc.id, shotHit(c.parentNode, ev).idx); return; }
      if (id === sh.id) return;
      if (ev.altKey) { doSwap(id, sh.id); return; }
      /* measured against every card in the scene, so a drop that lands a few
       * pixels off this one still means the edge it looks like it means */
      SB.Model.moveShots(P(), dragged(id), sc.id, shotHit(c.parentNode, ev).idx);
      SB.app.changed(true);
    });

    /* Swapping two cards' pictures is alt-drag, and only alt-drag. The
       two-click route existed for when a modifier is not on your mind; it
       cost a button on every card to save a key on a rare gesture. */
    c.addEventListener('mousedown', function (ev) {
      if (ev.target.closest('button, select, input, textarea, [contenteditable]')) return;
      /* The header is the drag handle, and preventDefault here cancels the
       * browser's drag before it starts — so shift-drag could not even begin
       * from the one place a drag begins. Range-select keeps the rest of the
       * card; the handle's job is dragging. */
      if (ev.shiftKey && ev.target.closest('.card-head')) return;
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
    head.addEventListener('dragend', function () { unmark(); });
    head.addEventListener('dragstart', function (ev) {
      ev.dataTransfer.setData(DND_SHOT, sh.id);
      /* copyMove, not move: a dropEffect outside effectAllowed is forced to
       * `none`, and `none` means the drop event never fires at all. Saying
       * move here made every shift-drag a silent no-op. */
      ev.dataTransfer.effectAllowed = 'copyMove';
      /* dragging one of a group takes the whole group */
      B.dragging = isSelected(sh.id) ? selection().slice() : [sh.id];
      B.dragging.forEach(function (id) {
        const el = document.querySelector('.card[data-shot="' + id + '"]');
        if (el) el.classList.add('dragging');
      });
    });
    head.addEventListener('dragend', function () { c.classList.remove('dragging'); });

    head.appendChild(SB.el('span', 'code', SB.Model.code(si, sj)));
    /* The number the full-size render is filed under. A serial means nothing on
       its own, so the board is where it is given a meaning. */

    /* Riffing is how a board actually gets made: you stand on a finished shot
       and want the next one OFF it — the reverse, tighter, a moment later. The
       new card arrives with this one already marked as a reference, so its
       frame is fed and the description only has to say what changes. */

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
    sel.addEventListener('change', function () {
      sh.type = sel.value;
      SB.app.changed(false);
      refreshFraming(sh.id);          // the badge is about to agree, or to go
      SB.PromptPanel.follow();
    });
    head.appendChild(sel);
    head.appendChild(framingHost(sh));


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

    const ns = SB.el('button', 'mini' + (sh.noShot ? ' on' : ''), '🚫');
    ns.title = sh.noShot
      ? 'Marked “no shot” — on the board, out of the prompts and the PDF. Press to put it back.'
      : 'Mark as “no shot” — stays on the board, excluded from prompts and PDF';
    ns.onclick = function () { sh.noShot = !sh.noShot; SB.app.changed(true); };
    acts.appendChild(ns);

    const del = SB.el('button', 'mini danger', '✕');
    del.title = 'Delete shot (script text stays in the master)';
    SB.armButton(del, 'delete?', function () {
      SB.Model.deleteShot(P(), sh.id);
      SB.app.changed(true);
      SB.toast('Deleted shot ' + SB.Model.code(si, sj) + ' — its script text stays in the master');
    });
    acts.appendChild(del);
    head.appendChild(acts);
    c.appendChild(head);

    /* --- frame --- */
    c.appendChild(frame(sh));

    /* --- script box ---
     *
     * Only once there is something to show. A card that has never claimed a
     * stretch of the master script used to carry a labelled box reading
     * "(empty)" for the life of the project — and on a board written straight
     * into the cards, which is most of them, that is every card saying the
     * script is empty when the script is not. Claiming a stretch is a
     * deliberate act (select in the script panel, then Capture); until
     * somebody does it, the box has nothing to be. */
    if (sh.link || sh.broken || (sh.local && (sh.local.text || '').trim())) {
      c.appendChild(scriptSection(sh));
    }

    /* --- description --- */
    const dl = SB.el('div', 'box-label');
    dl.appendChild(SB.el('span', null, 'description'));
    c.appendChild(dl);

    /* Not a textarea: a mark has to be visible as an object, because the whole
       point of @ is that it means a picture is being handed over. */
    const desc = SB.el('div', 'desc-box');
    desc.dataset.shot = sh.id;
    SB.RefBox.attach(desc, {
      get: function () { return sh.description || ''; },
      set: function (t) {
        sh.description = t;
        SB.app.changed(false);
        refreshFeed(sh.id);
        refreshFraming(sh.id);
      },
      placeholder: 'What we see. @ anything the model should be shown.',
      ctx: { shot: sh, code: SB.Model.code(si, sj) }
    });
    c.appendChild(desc);

    /* what this card will actually feed, in order */
    c.appendChild(feedRow(sh));

    /* The still and the clip want different words, and most cards never need
     * to say so — so the two boxes are chips until somebody opens one, and a
     * card that does not use them never grows. One that does is open on sight:
     * text nobody can see is worse than a taller card. */
    c.appendChild(laneBoxes(sh, si, sj));

    /* --- the project's own extra fields --- */
    SB.Fields.enabled(P()).forEach(function (f) {
      const lbl = SB.el('div', 'box-label');
      lbl.appendChild(SB.el('span', null, f.label));
      c.appendChild(lbl);
      const ta = SB.el('div', 'desc-box field-box');
      ta.dataset.field = f.id;
      SB.RefBox.attach(ta, {
        get: function () { return SB.Fields.value(sh, f.id); },
        set: function (t) {
          SB.Fields.set(sh, f.id, t);
          SB.app.changed(false);
        },
        placeholder: f.label,
        ctx: { shot: sh, code: SB.Model.code(si, sj) }
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
    if (!r) {
      /* say so rather than looking like the click missed */
      SB.app.changed(true);
      SB.toast('Could not swap those two cards', true);
      return;
    }
    SB.app.selectedShotId = bId;
    SB.app.changed(true);
    SB.toast('Swapped ' + r.a + ' and ' + r.b + ' — the script stayed put');
  }

  /* Who is in this shot. The order is the order their reference images are fed
   * to the model, so it is shown. */

  /* ---- the two lanes ----
   *
   * `description` is what we see and both prompts read it. These two are read
   * by one prompt each — and because a reference IS a mark in the text it was
   * written in, an @ in here is a picture that lane hands over and the other
   * never sees. That is the whole mechanism; there is no second list.
   */
  const LANES = [
    { role: 'image', key: 'imageDescription', label: 'first frame',
      hint: 'Only what is true as the shot opens. @ anything the FIRST FRAME should be shown.' },
    { role: 'video', key: 'videoDescription', label: 'motion',
      /* NOT "@ anything the clip should be shown": a clip is shown the frame
         and nothing else. An @ here names somebody so the writer uses their
         name — it sends no picture, and following the old wording was how a
         person put a face into the still by writing about the clip. */
      hint: 'What moves, in what order, how it ends. @ someone to name them \u2014 ' +
        'the clip is handed the frame, not their photo.' }
  ];

  function laneOpen(sh, lane) {
    if ((sh[lane.key] || '').trim()) return true;
    return !!B.openBox[sh.id + ':' + lane.role];
  }

  function laneBoxes(sh, si, sj) {
    const wrap = SB.el('div', 'lanes');
    const chips = SB.el('div', 'lane-chips');
    LANES.forEach(function (lane) {
      const open = laneOpen(sh, lane);
      const has = !!(sh[lane.key] || '').trim();
      const chip = SB.el('button', 'lane-chip' + (has ? ' has' : '') + (open ? ' open' : ''),
        (has ? '\u25cf ' : '\u2295 ') + lane.label);
      chip.title = lane.hint + (has ? '' : '\nEmpty — this lane uses the description above.');
      chip.onclick = function () {
        const k = sh.id + ':' + lane.role;
        /* Read live: typing in the box does not re-render the card, so the
           value captured when the chip was drawn is a lie by the time anyone
           clicks it — and the chip then silently cleared the open flag
           instead of saying why it would not close. */
        if ((sh[lane.key] || '').trim()) {
          /* a filled box is never hidden — emptying it is how you close it */
          SB.toast('Clear the ' + lane.label + ' box to put it away');
          return;
        }
        if (B.openBox[k]) delete B.openBox[k]; else B.openBox[k] = 1;
        render();
      };
      chips.appendChild(chip);
    });
    wrap.appendChild(chips);

    LANES.forEach(function (lane) {
      if (!laneOpen(sh, lane)) return;
      const lbl = SB.el('div', 'box-label lane-label');
      lbl.appendChild(SB.el('span', null, lane.label));
      wrap.appendChild(lbl);
      const box = SB.el('div', 'desc-box lane-box lane-' + lane.role);
      box.dataset.shot = sh.id;
      box.dataset.lane = lane.role;
      SB.RefBox.attach(box, {
        get: function () { return sh[lane.key] || ''; },
        set: function (t) {
          sh[lane.key] = t;
          SB.app.changed(false);
          refreshFeed(sh.id);
        },
        placeholder: lane.hint,
        ctx: { shot: sh, code: SB.Model.code(si, sj) }
      });
      wrap.appendChild(box);
    });
    return wrap;
  }

  /* ---- what is WRONG with this card ----
   *
   * This was the feed strip: what the card hands over, numbered, with
   * thumbnails and a button to write the files out. That moved to the prompt
   * table, where each lane shows what IT sends — the version that is true per
   * call rather than per card.
   *
   * What is left is the part that was never information. A name typed without
   * an @ feeds nothing; a mark whose subject was deleted points at nobody;
   * past the advice limit a model averages references instead of reading
   * them; and a description that reads as somebody arriving needs one of them
   * marked. A healthy card shows none of it.
   */
  function feedRow(sh) {
    const row = SB.el('div', 'feed-row');
    row.dataset.feed = sh.id;

    /* What this card hands over used to be listed here, numbered, with the
     * pictures and a button to write them out. It is gone from the card: the
     * prompt table shows each call's own references, numbered the way that
     * call's prompt cites them, which is the version that is true per push
     * rather than per card.
     *
     * Three things on that row were never information though. They are
     * mistakes, they have nowhere else to appear, and a board that hides
     * them is a board that ships them:
     *
     *   a name typed without an @        — feeds nothing, which is the exact
     *                                      mistake the @ rule exists to stop
     *   a mark whose subject was deleted — plain text now, pointing at nobody
     *   more references than a model reads — past the advice limit they are
     *                                      averaged together, not read
     *
     * So a healthy card shows nothing at all, and a card with one of these
     * shows that one line and the button that fixes it.
     */
    const dead = SB.Refs.feed(P(), sh).filter(function (e) { return e.kind === 'dead'; });

    const seenLoose = {};
    const loose = SB.Refs.boxes(sh).reduce(function (acc, t) {
      return acc.concat(SB.Refs.unlinked(P(), t || ''));
    }, []).filter(function (x) {
      /* the same name in two boxes is one name to link, not two */
      if (seenLoose[x.id]) return false;
      seenLoose[x.id] = 1;
      return true;
    });

    const imgs = SB.Refs.images(P(), sh, 'image');
    /* A frame this shot is derived from is not one of these: it is the
       picture being edited, not a reference averaged in with others. */
    const refCount = imgs.filter(function (e) { return e.kind !== 'shot'; }).length;

    /* People, not subjects: an insert of one hand and one scanner is two
       "cast", and the nudge asks which of them makes an entrance. It stays on
       the card because the description that reads as an arrival is being
       typed six inches above it. */
    const people = SB.Personas.forShot(P(), sh).filter(function (x) {
      return SB.Personas.kindOf(x).id === 'person';
    });
    const late = people.length > 1 && !SB.Personas.arriving(P(), sh).length &&
      SB.Personas.readsAsArrival(SB.Refs.text(P(), sh));

    if (!dead.length && !loose.length && !late &&
        refCount <= SB.Personas.IMAGE_ADVICE) return row;

    if (late) {
      const nudge = SB.el('button', 'mini feed-late', 'someone arrives?');
      nudge.title = 'This description reads as somebody turning up partway through, but ' +
        'everyone here is marked as being present when it opens — so they will all be ' +
        'drawn into the first frame. Mark whoever arrives with the ◉ beside them on the ' +
        'first-frame lane in Prompts.';
      nudge.onclick = function (ev) {
        ev.stopPropagation();
        SB.toast('Prompts → the first-frame lane: ◉ beside whoever arrives');
      };
      row.appendChild(nudge);
    }

    if (loose.length) {
      const fix = SB.el('button', 'mini feed-fix',
        loose.length === 1 ? 'link 1 name' : 'link ' + loose.length + ' names');
      fix.title = loose.map(function (x) { return x.name; }).join(', ') +
        (loose.length === 1 ? ' is named' : ' are named') +
        ' on this card but not referenced, so no picture is sent for ' +
        (loose.length === 1 ? 'it' : 'them') + '. Click to link ' +
        (loose.length === 1 ? 'it' : 'them') + '.';
      fix.onclick = function (ev) {
        ev.stopPropagation();
        /* every box — the count above reads all three, and linking only the
           shared one left the button sitting there after a toast saying the
           job was done */
        SB.Refs.rewrite(sh, function (t) { return SB.Refs.linkAll(P(), t); });
        loose.forEach(function (x) {
          if ((sh.personaIds || []).indexOf(x.id) < 0) {
            sh.personaIds = (sh.personaIds || []).concat([x.id]);
          }
        });
        SB.app.changed(true);
        SB.toast(loose.length + (loose.length === 1 ? ' name' : ' names') + ' linked and cast');
      };
      row.appendChild(fix);
    }

    dead.forEach(function (e) {
      const gone = SB.el('button', 'mini feed-fix danger', e.label + ' is gone');
      gone.title = (e.why || 'This subject was deleted.') +
        ' Click to leave the name as plain text.';
      gone.onclick = function (ev) {
        ev.stopPropagation();
        /* the strip was the union of all three boxes, so the dead mark is
           not necessarily in the shared one */
        SB.Refs.rewrite(sh, function (t) { return SB.Refs.unmark(P(), t, e.id); });
        SB.app.changed(true);
        SB.toast('\u201c' + e.label + '\u201d is plain text now');
      };
      row.appendChild(gone);
    });

    if (refCount > SB.Personas.IMAGE_ADVICE) {
      const warn = SB.el('span', 'feed-warn', refCount + ' references');
      warn.title = 'Past ' + SB.Personas.IMAGE_ADVICE + ' references most image models start ' +
        'averaging them together instead of reading them. Drop a mark, or drop a frame off one ' +
        'of these subjects.';
      row.appendChild(warn);
    }

    return row;
  }


  function refreshFeed(id) {
    document.querySelectorAll('.feed-row[data-feed="' + id + '"]').forEach(function (row) {
      const f = SB.Model.findShot(P(), id);
      if (!f) return;
      row.parentNode.replaceChild(feedRow(f.shot), row);
    });
  }

  /* Hand the images over in feed order. Named 1_, 2_, … because the order is
   * the promise the prompt's mapping makes, and a folder sorts by name.
   *
   * Full-size wherever the board holds the original, the board copy where it
   * does not, so the set is always complete and never silently short — and
   * the toast says which you got. This is the app's one way out until the
   * export panel exists; when it does, this is the first thing it absorbs. */
  function saveFeed(sh, imgs, code) {
    downloadFeed(imgs);
  }

  function downloadFeed(imgs) {
    let n = 0, full = 0;
    imgs.forEach(function (e) {
      const orig = SB.Renders.dataUrl(P(), e.render);
      const src = orig || SB.Blobs.src(P(), e.img);
      if (!src) return;
      if (orig) full++;
      const a = document.createElement('a');
      a.href = src;
      const ext = (/^data:image\/([a-z0-9+]+)/i.exec(src) || [])[1] || 'jpg';
      /* The same rule the export panel uses, so a name in any script comes
         out the same whichever button you press. */
      a.download = e.n + '_' + (SB.Renders.slug(e.label) || 'ref') +
        (e.role ? '_' + SB.Renders.slug(e.role) : '') +
        '.' + (ext === 'jpeg' ? 'jpg' : ext);
      document.body.appendChild(a);
      a.click();
      a.remove();
      n++;
    });
    SB.toast(n + ' reference image' + (n === 1 ? '' : 's') + ' saved, numbered in feed order' +
      (n ? ' — ' + (full === n ? 'all full-size' : full ? full + ' full-size' : 'all at board size') : ''));
  }


  /* Redraw just the cast rows — cheaper than rebuilding every card. */
  /* The cast used to have a row of its own, above the feed, saying the same
   * thing twice: who is on this card, and then which pictures that means. The
   * feed is the honest half — it names the actual images, in the order they go
   * in — so it absorbed the rest: who arrives partway through, the description
   * that still carries a wardrobe, and taking something off the card. The name
   * is kept because half the app calls it. */
  function refreshCastRows() {
    document.querySelectorAll('.feed-row').forEach(function (row) {
      refreshFeed(row.dataset.feed);
    });
  }

  function refreshCast() {
    refreshCastRows();
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

  /* A stored prompt froze its cast's wardrobe at the moment it was written. If
   * the persona has been edited since, the text in the box is describing
   * somebody who no longer exists — say so rather than letting it look current. */
  /* A camera move that survived its corrective rewrite. The prompt is kept —
   * the rest of the paragraph is usually right — but nobody should ship a push
   * in they never asked for without knowing it is there. */
  function moveBadge(sh, m, field) {
    if (field !== 'videoPrompt') return null;
    const pr = sh.prompts[m.id] || null;
    const moved = pr && Array.isArray(pr.moved) ? pr.moved : [];
    if (!moved.length) return null;
    const b = SB.el('span', 'badge warn moved', 'camera move');
    b.title = 'This prompt moves the camera — "' + moved.join('", "') + '" — and the shot ' +
      'description did not ask for one. It was asked to rewrite it once and kept the move. ' +
      'Edit it out, or write the move you do want into the description and generate again.';
    return b;
  }

  /* Gender the writer decided on for somebody the board never cast. */
  function genderBadge(sh, m, field) {
    const pr = sh.prompts[m.id] || null;
    const said = pr && Array.isArray(pr.gendered) ? pr.gendered : [];
    if (!said.length || !(pr[field] || '').trim()) return null;
    const b = SB.el('span', 'badge warn gendered', 'gendered');
    b.title = 'This prompt decides someone\u2019s gender — "' + said.join('", "') + '" — for ' +
      'a person the board has not cast. It was asked to rewrite it once and kept them. ' +
      'Edit them out, or cast that person in the reference library so it is the board saying ' +
      'it and not the model.';
    return b;
  }

  function staleBadge(sh, m, field) {
    const pr = sh.prompts[m.id] || null;
    if (!pr || !(pr[field] || '').trim()) return null;
    if (!SB.Personas.staleFor(P(), sh, pr.at)) return null;
    const b = SB.el('span', 'badge warn stale', 'persona changed');
    b.title = 'A persona on this card was edited after this prompt was written, so it still ' +
      'describes the old wardrobe. Generate again to pick up the current one.';
    return b;
  }

  /* ---------------- the framing the description asks for ----------------
   *
   * The shot type comes from the dropdown and stays there: it is the one place
   * the framing is stated, and the prompt is written to it. But a description
   * that opens "close-up of Danny's hands" is saying the same thing in words,
   * and when the two disagree the dropdown wins silently — which is how a card
   * reading "closeup of his hands" went out as "Shot type: Wide" and came back
   * with his whole face in it.
   *
   * So: notice, say so, and offer the one click. Never change it by itself —
   * "insert" in the middle of a sentence is a word as often as it is a framing,
   * and a dropdown that moves on its own is worse than one that is wrong. */
  function framingWanted(sh) {
    /* Framing is about the still, so it reads the still's lane: "extreme
       close-up on her hands" typed in the first-frame box is exactly where
       this badge is worth having. */
    const want = SB.Model.guessFraming(P(), SB.Refs.text(P(), sh, 'image'));
    return (want && want !== sh.type) ? want : '';
  }

  function paintFraming(host, sh) {
    host.innerHTML = '';
    const want = framingWanted(sh);
    if (!want) return;
    const b = SB.el('button', 'badge warn framing', want);
    b.title = 'The description says ' + want.toLowerCase() + ', but this card is set to ' +
      (sh.type ? '“' + sh.type + '”' : 'no shot type') + ' — and the shot type is what ' +
      'the prompt is written to. Click to set it to ' + want + '.';
    b.onclick = function (ev) {
      ev.stopPropagation();
      sh.type = want;
      SB.app.changed(true);
      SB.PromptPanel.follow();
      SB.toast('1 card set to ' + want);
    };
    host.appendChild(b);
  }

  /* A host per card, wherever one is drawn — the card head and the prompt
     table both carry one, and both are repainted from the same keystroke. */
  function framingHost(sh) {
    const host = SB.el('span', 'fr-host');
    host.dataset.shot = sh.id;
    paintFraming(host, sh);
    return host;
  }

  function refreshFraming(id) {
    const f = SB.Model.findShot(P(), id);
    if (!f) return;
    document.querySelectorAll('.fr-host[data-shot="' + id + '"]').forEach(function (h) {
      paintFraming(h, f.shot);
    });
  }

  /* Re-evaluate the badges without rebuilding the cards — editing a persona
   * description is a keystroke-rate event, and replacing the textarea under the
   * cursor would be worse than the staleness. */
  function refreshPromptStale() {
    document.querySelectorAll('.prompt-box').forEach(function (box) {
      const f = SB.Model.findShot(P(), box.dataset.shot);
      const t = box.querySelector('.ptitle');
      if (!f || !t) return;
      const old = t.querySelector('.stale');
      if (old) old.remove();
      const m = SB.Model.modelById(P(), box.dataset.model);
      if (!m) return;
      const b = staleBadge(f.shot, m, box.dataset.field);
      if (b) t.insertBefore(b, t.querySelector('button') || null);
    });
  }

  function promptBox(sh, m, field, title) {
    const pr = sh.prompts[m.id] || null;
    const wrap = SB.el('div', 'prompt-box');
    wrap.dataset.shot = sh.id;
    wrap.dataset.model = m.id;
    wrap.dataset.field = field;
    const t = SB.el('div', 'ptitle');
    t.appendChild(SB.el('span', null, title + ' · ' + m.name));

    const st = staleBadge(sh, m, field);
    if (st) t.appendChild(st);
    const mv = moveBadge(sh, m, field);
    if (mv) t.appendChild(mv);
    const gb = genderBadge(sh, m, field);
    if (gb) t.appendChild(gb);
    const gen = SB.Focus.costly(SB.el('button', 'mini', 'generate'));
    gen.style.marginLeft = 'auto';
    gen.onclick = function () {
      gen.disabled = true; gen.textContent = '…';
      const roles = field === 'imagePrompt' ? { image: true } : { video: true };
      SB.Prompts.generateFor(sh, roles)
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
      /* Hand-editing is the user restating the prompt as it should read now, so
       * it stops being behind the persona. */
      sh.prompts[m.id].at = Date.now();
      const badge = wrap.querySelector('.stale');
      if (badge) badge.remove();
      /* Editing by hand is the answer to the move, whatever the words now say */
      delete sh.prompts[m.id].moved;
      delete sh.prompts[m.id].gendered;
      const mvb = wrap.querySelector('.moved');
      if (mvb) mvb.remove();
      const gbb = wrap.querySelector('.gendered');
      if (gbb) gbb.remove();
      SB.app.changed(false);
    });
    wrap.appendChild(ta);
    return wrap;
  }

  /* ---------------- image frame ---------------- */

  /* Both ways of removing a picture, in one place, because they were two
   * places that did half the job each. `render` is the full-size ORIGINAL —
   * not something generated, which is `render.made` — so a card that has had
   * its picture removed must not go on holding it, exporting it as its
   * original, feeding it to a clip, or opening it when the now-empty frame
   * is clicked. */
  function dropImage(sh) {
    sh.image = null;
    sh.render = null;
    SB.app.changed(true);
  }

  function frame(sh) {
    const f = SB.el('div', 'frame');
    /* The board copy is what this draws, and where there is none the ORIGINAL
     * is — a card carrying a picture must never look empty. Boards written
     * before Remove was fixed hold exactly that state: an original with no
     * proxy, exported and fed to clips while the frame offered a file picker
     * and the picture was reachable from nowhere. */
    const shown = sh.image ? SB.Blobs.src(P(), sh.image)
      : (sh.render ? SB.Renders.dataUrl(P(), sh.render) : '');
    if (shown) {
      const img = document.createElement('img');
      img.className = 'shot-img';
      img.src = shown;
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

    /* One clip control, in the same place, whatever the state — and the
       same one the Prompts panel opens. It used to be two buttons that did
       different things: a badge that played the clip, and a ▷+ in the hover
       tools that went straight to a file dialog with no warning, so
       pressing the one you could see when there was no clip yet produced no
       popup at all.

       Always visible, unlike the rest of the tools: the card draws the still
       either way, so this badge is the only sign a clip exists. */
    {
      const has = !!sh.video;
      /* A card holds its takes now, so the badge says how many rather than
         letting three clips hide behind one triangle. */
      const n = SB.Model.takeCount(sh);
      const play = SB.el('button', 'clip-badge' + (has ? '' : ' none') + (n > 1 ? ' many' : ''),
        '\u25b7' + (has && sh.video.dur ? ' ' + sh.video.dur + 's' : '') +
        (n > 1 ? ' \u00d7' + n : ''));
      play.title = has
        ? (n > 1 ? n + ' takes on this card — play them, choose one, or remove one'
                 : 'Play, replace or remove the clip on this card') +
          (SB.Clip.label(sh.video) ? ' — ' + SB.Clip.label(sh.video) : '')
        : 'No clip on this card yet — shoot one, or add a file you already have';
      play.onclick = function (ev) { ev.stopPropagation(); SB.Clip.open(P(), sh); };
      f.appendChild(play);
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
    if (sh.image || sh.render) {
      const rm = SB.el('button', 'mini danger', '✕');
      rm.title = 'Remove image';
      rm.onclick = function (ev) {
        ev.stopPropagation();
        dropImage(sh);
      };
      tools.appendChild(rm);
    }
    f.appendChild(tools);

    f.addEventListener('click', function () {
      /* A click used to open the file picker, so wanting a better look at a
         480p frame was the same gesture as replacing it. Now it opens the
         picture; an empty frame still picks, because there is nothing to
         look at and "click to load" is all it has. */
      /* Either one counts, the same way the frame draws either one — a
         picture the card is holding must be openable. */
      if (!sh.image && !sh.render) {
        SB.pickImageFile().then(function (file) { if (file) setImage(sh, file); });
        return;
      }
      if (!SB.Viewer) {
        SB.toast('This page is an old copy and the viewer did not load — reload it.', true);
        return;
      }
      const f2 = SB.Model.findShot(P(), sh.id);
      SB.Viewer.open(P(), [{
        img: sh.image, render: sh.render,
        label: (f2 ? f2.code : '') + (sh.type ? ' · ' + sh.type : ''),
        onReplace: function (file) { setImage(sh, file); },
        onRemove: function () { dropImage(sh); }
      }], 0, { title: 'First frame' });
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
      /* A video dropped on a card is a clip for that card, not a picture that
         failed to decode — which is what it used to be reported as. A drop
         carrying both is two things for the same card, and taking only the
         clip threw the picture away in silence. */
      const clips = SB.videosFromTransfer(ev.dataTransfer);
      SB.imageFromTransfer(ev.dataTransfer).then(function (src) {
        if (src) setImage(sh, src);
        if (clips.length) { clipDrop(sh, clips); return; }
        if (!src) SB.toast('No image or clip found in that drop', true);
      });
    });
    return f;
  }

  /* Two copies of one picture: the proxy the board draws, and the original a
     model gets handed. Both go in the file.
   *
   * The proxy goes on first and the card is live from that moment; encoding
   * the original takes longer and finishes on its own. That second half used
   * to assign onto the shot object it was handed at drop time — which is not
   * an address that holds still. Swapping two cards moves `render` and
   * `image` between shot objects, so a swap landing mid-encode wrote the new
   * original onto the OTHER card, overwriting that card's record; its bytes
   * were then collected and a full-size original was gone with nothing said.
   *
   * So the original is filed against the picture it was made from, found by
   * its blob reference — the one thing that travels with a picture when cards
   * move. If nobody is holding that picture any more (replaced, deleted), the
   * record has nowhere to live and is dropped; gc() takes the bytes. */
  function mb(n) { return (n / 1048576).toFixed(1) + ' MB'; }

  /* Every card in board order, with its code — for spreading a multi-clip
     drop across the cards that follow. */
  function ordered() {
    const p = P();
    const out = [];
    p.scenes.forEach(function (sc, si) {
      sc.shots.forEach(function (s, sj) { out.push({ shot: s, code: SB.Model.code(si, sj) }); });
    });
    return out;
  }

  function takeClip(sh, file) {
    const had = !!sh.video;
    return SB.Clip.attach(P(), sh, file).then(function (rec) {
      if (!rec) return null;
      SB.toast((had ? 'Another take added — the one that was here is kept' : 'Clip added') +
        (SB.Clip.label(rec) ? ' · ' + SB.Clip.label(rec) : ''));
      return rec;
    }).catch(function (e) {
      SB.toast('That clip could not be stored: ' + (e.message || e), true);
      return null;
    });
  }

  /* One clip per card, said out loud at the moment it matters.
   *
   * Two things used to happen silently: a drop carrying several clips used
   * one and ignored the rest, and a drop onto a card that already had one
   * replaced it — bytes and all — with a toast you could easily miss. Both
   * now ask, and the question names what is at stake either way. */
  function clipDrop(sh, files) {
    if (!files.length) return;
    const p = P();
    const here = SB.Model.findShot(p, sh.id);
    const code = here ? here.code : 'this card';

    if (files.length === 1 && !sh.video) { takeClip(sh, files[0]); return; }

    const box = SB.el('div', 'clip-pick');
    let m = null;

    if (sh.video) {
      const old = SB.Clip.label(sh.video) || 'a clip';
      box.appendChild(SB.el('div', 'pp-note warn',
        code + ' already holds ' + old + (sh.video.name ? ' (' + sh.video.name + ')' : '') +
        '. It is kept as another take — the new one becomes the chosen one, and ' +
        'the clip window has both.'));
    }
    box.appendChild(SB.el('div', 'pp-note', files.length === 1
      ? 'Replace it with:'
      : files.length + ' clips in that drop. A card holds one — which of them is ' + code + '?'));

    files.forEach(function (f) {
      const row = SB.el('button', 'clip-row');
      row.appendChild(SB.el('span', 'n', f.name || 'clip'));
      row.appendChild(SB.el('span', 'b', mb(f.size)));
      row.onclick = function () { if (m) m.close(); takeClip(sh, f); };
      box.appendChild(row);
    });

    /* The reason somebody drags four clips onto a board at once is that they
       belong to four cards in a row. */
    const list = ordered();
    const at = list.map(function (x) { return x.shot.id; }).indexOf(sh.id);
    const run = (at >= 0) ? list.slice(at, at + files.length) : [];
    const buttons = [{ label: 'Cancel' }];
    if (files.length > 1 && run.length === files.length) {
      /* The spread replaces whatever those cards hold, and it used to do it
         without a word — the warning above only ever looked at the card the
         drop landed on. */
      const over = run.filter(function (x) { return !!x.shot.video; });
      if (over.length) {
        box.appendChild(SB.el('div', 'pp-note warn',
          'One each would also replace the clip' + (over.length === 1 ? '' : 's') + ' on ' +
          over.map(function (x) { return x.code; }).join(', ') + '.'));
      }
      buttons.push({
        label: 'One each, from ' + run[0].code,
        onClick: function (close) {
          close();
          let n = 0;
          const next = function (i) {
            if (i >= files.length) {
              SB.toast(n + ' clip' + (n === 1 ? '' : 's') + ' placed, ' +
                run[0].code + ' to ' + run[run.length - 1].code);
              return;
            }
            SB.Clip.attach(P(), run[i].shot, files[i]).then(function (rec) {
              if (rec) n++;
            }).catch(function () { }).then(function () { next(i + 1); });
          };
          next(0);
        }
      });
    }

    m = SB.modal({
      title: files.length > 1 ? 'Which clip for ' + code + '?'
        : 'Add another take to ' + code + '?',
      width: '460px',
      body: box,
      buttons: buttons
    });
  }

  function setImage(sh, src, made) {
    return SB.downscaleImage(src).then(function (img) {
      const proxy = SB.Blobs.image(P(), img.data, img.w, img.h);
      sh.image = proxy;
      /* Always asynchronous — a generated still can land long after the click
         that asked for it, so it queues behind whatever is being typed. */
      SB.Focus.defer('image:' + sh.id, function () { SB.app.changed(true); });

      const existing = sh.render;
      return SB.Renders.keep(P(), src, existing, made).then(function (rec) {
        if (!rec) return;
        const target = (sh.image && sh.image.ref === proxy.ref)
          ? sh : SB.Model.shotHolding(P(), proxy.ref);
        if (!target) return;
        target.render = rec;
        SB.Store.touch();
        SB.Board.refreshFeed(target.id);
      }).catch(function (e) {
        /* The proxy is already on the card, so this is not a lost picture —
           but it IS a lost original, and that is exactly what used to happen
           in silence. */
        SB.toast('Kept the board copy only — the full-size original could not be stored: ' +
          (e.message || e), true);
      });
    }).catch(function (e) { SB.toast('Image failed: ' + e.message, true); });
  }

  /* ---------------- live script sync ---------------- */

  /* Both kinds of box are built the same way — label then box, appended to the
   * same parent — so one sync serves them both. */
  function syncScriptBox(el, api, linked, broken, what) {
    el.classList.toggle('broken', !!broken);
    api.render();
    const lbl = el.previousSibling;
    if (!lbl || !lbl.classList || !lbl.classList.contains('box-label')) return;
    const dot = lbl.querySelector('.link-dot');
    const txt = lbl.querySelector('span:nth-child(2)');
    if (dot) dot.className = 'link-dot' + (broken ? ' broken' : (linked ? '' : ' free'));
    if (txt) txt.textContent = what +
      (broken ? ' — link broken' : (linked ? ' — linked' : ' — freestanding'));
  }

  function renderScriptWindows() {
    Object.keys(B.scriptEditors).forEach(function (id) {
      const f = SB.Model.findShot(P(), id);
      const el = B.scriptEls[id];
      if (!f || !el) return;
      syncScriptBox(el, B.scriptEditors[id], !!f.shot.link, !!f.shot.broken, 'script');
    });

    /* Undo can hand a scene back a claim it no longer has a box for, or take
     * one away from a scene that still shows one — only a full render can add
     * or remove the box itself. */
    let drift = false;
    Object.keys(B.sceneScriptEditors).forEach(function (id) {
      const f = SB.Model.findScene(P(), id);
      const el = B.sceneScriptEls[id];
      if (!f || !el) return;
      if (!SB.Model.sceneTied(f.scene)) { drift = true; return; }
      syncScriptBox(el, B.sceneScriptEditors[id], !!f.scene.link, !!f.scene.broken, 'section');
    });
    P().scenes.forEach(function (sc) {
      if (SB.Model.sceneTied(sc) && !B.sceneScriptEls[sc.id]) drift = true;
    });
    if (drift) render();
  }

  SB.Board = {
    render: render,
    sceneAi: sceneAi,
    syncSceneFields: syncSceneFields,
    syncSceneAi: syncSceneAi,
    forgetScene: function (id) { delete AI[id]; },
    renderSceneList: renderSceneList, forgetOpenBoxes: forgetOpenBoxes,
    renderScriptWindows: renderScriptWindows,
    refreshCast: refreshCast,
    refreshCastRows: refreshCastRows, refreshPromptStale: refreshPromptStale,
    framingHost: framingHost, refreshFraming: refreshFraming,
    refreshFeed: refreshFeed,
    saveFeed: saveFeed,
    setImage: setImage, clipDrop: clipDrop,
    swap: doSwap,
    select: selectShot,
    selection: selection,
    clearSelection: clearSelection,
    DND_SHOT: DND_SHOT
  };

})(window.SB);
