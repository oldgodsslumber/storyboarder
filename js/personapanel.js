/* personapanel.js — the reference library.
 *
 * A full-page takeover holding the two things that are true of the whole board
 * rather than of one card: every recurring subject (the cast, the locations,
 * the objects) and the scenes in the order they play. Both are answers to
 * "what is this film made of", which is a question you ask with your head up,
 * away from the cards — so it gets the whole window rather than a 320px column
 * squeezed in beside the board.
 *
 * The scenes here are deliberately shot-free: this is the shape of the film,
 * not its contents. Shots have a board.
 */
(function (SB) {
  'use strict';

  const SPLIT_KEY = 'sb.library.split';

  let root = null;          // the overlay, while it is open
  let refsEl, scenesEl, statusEl, searchEl, tabsEl;
  let filter = 'all';       // which kind the library is showing
  let query = '';
  let targetId = null;      // the subject a paste would land on
  /* A rename offer outlives the input that raised it: closing the panel, or
   * anything that re-renders it, detaches that input and fires its blur. The
   * offer is state, and the bar is drawn from it. */
  let pendingRename = null;

  function P() { return SB.app.project; }

  function init() { /* nothing to bind — the takeover is built when it opens */ }

  function setStatus(txt, isErr) {
    if (!statusEl) return;
    statusEl.textContent = txt || '';
    statusEl.classList.toggle('err', !!isErr);
  }

  /* ---------------------------------------------------------------- shell */

  function open() {
    if (root) { render(); return; }

    root = SB.el('div', 'lib-back');
    const lib = SB.el('div', 'lib');

    lib.appendChild(head());

    const split = SB.el('div', 'lib-split');
    refsEl = SB.el('section', 'lib-refs');
    scenesEl = SB.el('section', 'lib-scenes');
    const divider = SB.el('div', 'lib-divider');
    divider.title = 'Drag to give more room to either half';
    split.appendChild(refsEl);
    split.appendChild(divider);
    split.appendChild(scenesEl);
    lib.appendChild(split);
    dragDivider(divider, refsEl);

    root.appendChild(lib);
    root.addEventListener('mousedown', function (ev) { if (ev.target === root) close(); });
    document.addEventListener('keydown', onKey);
    document.getElementById('modalRoot').appendChild(root);
    document.getElementById('btnPersonas').classList.add('on');

    const saved = parseFloat(localStorage.getItem(SPLIT_KEY) || '');
    if (saved > 20 && saved < 90) refsEl.style.flexBasis = saved + '%';

    render();
    if (searchEl) searchEl.focus();
  }

  /* Esc closes, but not out from under a popover or a confirm inside it. */
  function onKey(e) {
    if (e.key !== 'Escape' || !root) return;
    if (document.querySelector('.modal-back')) return;   // a dialog owns Esc first
    if (document.querySelector('.lib-pop')) return;
    close();
  }

  function close() {
    if (!root) return;
    root.remove();
    root = null;
    refsEl = scenesEl = statusEl = searchEl = null;
    document.removeEventListener('keydown', onKey);
    document.getElementById('btnPersonas').classList.remove('on');
  }

  function toggle() { root ? close() : open(); }
  function isOpen() { return !!root; }
  function refresh() { if (root) render(); }
  function refreshScenes() { if (root) renderScenes(); }
  /* Just the library half — so something minted while typing in the scene
     organizer appears without rebuilding the box being typed into. */
  function refreshRefs() { if (root) renderRefs(); }

  /* The divider writes a percentage rather than pixels, so the split survives
   * the window being resized between sessions. */
  function dragDivider(divider, upper) {
    divider.addEventListener('mousedown', function (ev) {
      ev.preventDefault();
      const box = divider.parentNode.getBoundingClientRect();
      const move = function (m) {
        const pct = SB.clamp((m.clientY - box.top) / box.height * 100, 22, 88);
        upper.style.flexBasis = pct + '%';
      };
      const up = function () {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        try { localStorage.setItem(SPLIT_KEY, parseFloat(upper.style.flexBasis)); } catch (e) { /* private mode */ }
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  function head() {
    const h = SB.el('header', 'lib-head');
    h.appendChild(SB.el('h2', null, 'Reference library'));

    tabsEl = SB.el('div', 'lib-tabs');
    const tab = function (id, label) {
      const b = SB.el('button', 'tb toggle', label);
      b.dataset.kind = id;
      b.onclick = function () { filter = id; renderRefs(); };
      return b;
    };
    tabsEl.appendChild(tab('all', 'All'));
    SB.Personas.KINDS.forEach(function (k) { tabsEl.appendChild(tab(k.id, k.plural)); });
    h.appendChild(tabsEl);

    searchEl = document.createElement('input');
    searchEl.type = 'text';
    searchEl.className = 'lib-search';
    searchEl.placeholder = 'Search names and descriptions';
    searchEl.value = query;
    searchEl.addEventListener('input', function () {
      query = searchEl.value.trim().toLowerCase();
      renderRefs();
    });
    h.appendChild(searchEl);

    h.appendChild(SB.el('span', 'spacer'));

    SB.Personas.KINDS.forEach(function (k) {
      const b = SB.el('button', 'tb', '+ ' + k.label);
      b.onclick = function () {
        const per = SB.Personas.add(P(), { kind: k.id });
        SB.app.changed(true);
        filter = 'all'; query = ''; searchEl.value = '';
        renderRefs();
        focusName(per.id);
        targetId = per.id;
      };
      h.appendChild(b);
    });

    /* Demoted on purpose: generating a cast is what you do once, and it had no
       business owning the top of this panel for the rest of the project. */
    const bGen = SB.el('button', 'tb', '✦ Generate from script ▾');
    bGen.onclick = function (ev) { ev.stopPropagation(); generatePop(bGen); };
    h.appendChild(bGen);

    const x = SB.el('button', 'tb lib-x', '✕');
    x.title = 'Close (Esc)';
    x.onclick = close;
    h.appendChild(x);
    return h;
  }

  function focusName(id) {
    const el = root && root.querySelector('.persona[data-id="' + id + '"] .persona-name');
    if (el) { el.focus(); el.select(); }
  }

  /* ------------------------------------------------------ generate popover */

  function generatePop(anchor) {
    const old = document.querySelector('.lib-pop');
    if (old) old.remove();
    const pop = SB.el('div', 'lib-pop');
    pop.addEventListener('mousedown', function (ev) { ev.stopPropagation(); });

    const kindRow = SB.el('div', 'pp-row');
    kindRow.appendChild(SB.el('label', null, 'What'));
    const kind = document.createElement('select');
    SB.Personas.KINDS.forEach(function (k) {
      const o = document.createElement('option');
      o.value = k.id; o.textContent = k.plural;
      kind.appendChild(o);
    });
    kindRow.appendChild(kind);
    pop.appendChild(kindRow);

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
    pop.appendChild(row);

    const note = document.createElement('input');
    note.type = 'text';
    note.placeholder = 'optional direction — “one on-site technician”';
    const nRow = SB.el('div', 'pp-row');
    nRow.appendChild(SB.el('label', null, 'Direction'));
    nRow.appendChild(note);
    pop.appendChild(nRow);

    const acts = SB.el('div', 'pp-actions');
    const go = SB.el('button', 'tb on', 'Generate');
    go.onclick = function () {
      go.disabled = true;
      setStatus('reading the script…');
      SB.Personas.generate(P(), parseInt(count.value, 10) || 1, note.value.trim(), kind.value)
        .then(function (made) {
          pop.remove();
          SB.app.changed(true);
          filter = 'all';
          render();
          setStatus('added ' + made.length + ' — edit anything that is not right.');
        })
        .catch(function (e) {
          go.disabled = false;
          if (SB.apiBlocked(e, function () { go.onclick(); })) {
            setStatus('blocked — see the dialog', true);
            return;
          }
          setStatus(e.message || String(e), true);
        });
    };
    acts.appendChild(go);
    pop.appendChild(acts);
    pop.appendChild(SB.el('div', 'pp-note',
      'Read from the master script and the shot descriptions. Nothing is replaced — ' +
      'whatever comes back is added to what is already here.'));

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

  /* --------------------------------------------------------------- render */

  function render() {
    if (!root || !P()) return;
    renderRefs();
    renderScenes();
  }

  /* A board-wide sweep for descriptions that still carry a wardrobe. It lives
   * here because this panel is where the wardrobe gets changed, which is what
   * puts the descriptions out of date in the first place. */
  function sweepBlock(p) {
    const stale = SB.Coverage.shotsCarryingWardrobe(p);
    if (!stale.length) return null;

    const box = SB.el('div', 'pp-block warn-block');
    box.appendChild(SB.el('div', 't', 'descriptions out of date'));
    box.appendChild(SB.el('div', 'pp-note',
      stale.length + (stale.length === 1 ? ' card describes' : ' cards describe') +
      ' what somebody looks like in the description itself. The cast is the real ' +
      'record, so that text is a frozen copy — it does not change when you edit a ' +
      'persona, and it is simply wrong once a different person is put on the card.'));

    const st = SB.el('div', 'pp-status');
    const say = function (txt, isErr) {
      st.textContent = txt || '';
      st.classList.toggle('err', !!isErr);
    };

    const acts = SB.el('div', 'pp-actions');
    const b = SB.el('button', 'tb on', 'Clean ' + stale.length +
      (stale.length === 1 ? ' description' : ' descriptions'));
    b.title = 'Take the appearance and wardrobe out of those descriptions, keeping the action. ' +
      'Anything that is an exact copy of a persona is lifted off for free; the rest is rewritten.';
    b.onclick = function () {
      b.disabled = true;
      say('cleaning 0/' + stale.length + '…');
      SB.Coverage.cleanWardrobe(p, stale, {
        onProgress: function (done, total) { say('cleaning ' + done + '/' + total + '…'); }
      }).then(function (r) {
        SB.app.changed(true);
        renderRefs();
        /* renderRefs() has rebuilt this by now — the sweep block is gone once
           everything is clean, so anything left to say goes to the toast. */
        SB.toast(r.cleaned + ' description' + (r.cleaned === 1 ? '' : 's') + ' cleaned' +
          (r.stripped ? ' (' + r.stripped + ' without a request)' : '') +
          (r.failed ? ' · ' + r.failed + ' could not be done' : ''), !!r.failed);
      }).catch(function (e) {
        b.disabled = false;
        if (SB.apiBlocked(e, function () { b.onclick(); })) { say('blocked — see the dialog', true); return; }
        say(e.message || String(e), true);
      });
    };
    acts.appendChild(b);
    box.appendChild(acts);
    box.appendChild(st);
    return box;
  }

  function matches(per) {
    if (!query) return true;
    return ((per.name || '') + ' ' + (per.description || '')).toLowerCase().indexOf(query) >= 0;
  }

  function renderRefs() {
    if (!refsEl || !P()) return;
    const p = P();
    refsEl.innerHTML = '';

    /* The filter moves for reasons other than a tab being clicked — adding a
       subject, a generate run finishing — so the highlight is set from the
       filter every time, not by the click that happened to change it. */
    if (tabsEl) {
      tabsEl.querySelectorAll('button').forEach(function (b) {
        b.classList.toggle('on', b.dataset.kind === filter);
      });
    }

    statusEl = SB.el('div', 'pp-status lib-status');
    refsEl.appendChild(statusEl);

    const bar = renameBar();
    if (bar) refsEl.appendChild(bar);

    const sweep = sweepBlock(p);
    if (sweep) refsEl.appendChild(sweep);

    let shown = 0;
    SB.Personas.KINDS.forEach(function (kind) {
      if (filter !== 'all' && filter !== kind.id) return;
      const mine = SB.Personas.ofKind(p, kind.id).filter(matches);
      const sec = SB.el('div', 'lib-section');
      const h = SB.el('div', 'lib-section-head');
      h.appendChild(SB.el('span', 't', kind.plural));
      h.appendChild(SB.el('span', 'n', mine.length ? String(mine.length) : ''));
      sec.appendChild(h);

      if (!mine.length) {
        sec.appendChild(SB.el('div', 'pp-note lib-empty',
          query ? 'Nothing here matches “' + query + '”.'
                : 'No ' + kind.plural.toLowerCase() + ' yet.'));
      } else {
        const grid = SB.el('div', 'lib-grid');
        mine.forEach(function (per) { grid.appendChild(card(per)); });
        sec.appendChild(grid);
        shown += mine.length;
      }
      refsEl.appendChild(sec);
    });

    if (!shown && !query) {
      refsEl.appendChild(SB.el('div', 'pp-note',
        'A subject here is anything that has to look the same twice — a person, a room, ' +
        'a product. Descriptions carry the wardrobe; the description plus the reference ' +
        'images is what keeps it identical from shot to shot.'));
    }
  }

  /* ------------------------------------------------------------ one subject */

  function card(per) {
    const p = P();
    const kind = SB.Personas.kindOf(per);
    const wrap = SB.el('div', 'persona kind-' + kind.id + (targetId === per.id ? ' target' : ''));
    wrap.dataset.id = per.id;
    /* Whatever you last touched is what a pasted image belongs to. */
    const claim = function () {
      if (targetId === per.id) return;
      targetId = per.id;
      refsEl.querySelectorAll('.persona.target').forEach(function (x) { x.classList.remove('target'); });
      wrap.classList.add('target');
    };
    wrap.addEventListener('mousedown', claim);
    wrap.addEventListener('focusin', claim);

    /* ---- head: name, kind, usage, delete ---- */
    const head = SB.el('div', 'persona-head');
    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'persona-name';
    name.value = per.name || '';
    name.placeholder = 'Name';
    /* what the name was when this edit started, so a rename can be spotted */
    let nameWas = per.name || '';
    name.addEventListener('focus', function () { nameWas = per.name || ''; });
    name.addEventListener('input', function () {
      per.name = name.value;
      SB.Personas.touch(per);
      SB.Store.touch();
      /* Rows only — re-rendering this panel would rebuild the very input being
         typed into and drop focus after each keystroke. */
      SB.Board.refreshCastRows();
    });
    /* The name is written into descriptions by hand and by @, so a rename
       leaves copies of the old one lying around. Offered, never automatic. */
    name.addEventListener('blur', function () {
      const was = nameWas, now = per.name || '';
      nameWas = now;
      if (!was || !now || was === now) return;
      pendingRename = { id: per.id, was: was };
      /* This blur may be the panel tearing the input out from under the user
         — a tab, the kind select, the ✕. Redraw only if it was not. */
      if (root && refsEl && refsEl.querySelector('.persona[data-id="' + per.id + '"]')) renderRefs();
    });
    head.appendChild(name);

    const sel = document.createElement('select');
    sel.className = 'persona-kind';
    sel.title = 'What this is. It changes how the prompt writer is told about it.';
    SB.Personas.KINDS.forEach(function (k) {
      const o = document.createElement('option');
      o.value = k.id; o.textContent = k.label;
      if (k.id === kind.id) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = function () {
      per.kind = sel.value;
      SB.Personas.touch(per);
      SB.app.changed(true);
      renderRefs();
    };
    head.appendChild(sel);

    const used = countShots(per.id);
    const usedEl = SB.el('button', 'persona-used', used + (used === 1 ? ' shot' : ' shots'));
    if (used) {
      usedEl.title = 'Go to the first card this is on';
      usedEl.onclick = function () { jumpToFirst(per.id); };
    } else {
      usedEl.classList.add('none');
      usedEl.title = 'Not on any card yet';
      usedEl.disabled = true;
    }
    head.appendChild(usedEl);

    const del = SB.el('button', 'mini danger', '✕');
    del.title = 'Remove this and take it off every shot';
    del.onclick = function () {
      if (!confirm('Remove “' + (per.name || kind.one) + '”? It comes off ' + used + ' shot(s).')) return;
      SB.Personas.remove(p, per.id);
      SB.app.changed(true);
      render();
    };
    head.appendChild(del);
    wrap.appendChild(head);

    /* ---- reference frames ---- */
    wrap.appendChild(frames(per, kind));

    /* ---- description ---- */
    wrap.appendChild(SB.el('div', 'box-label', kind.descLabel));
    const d = document.createElement('textarea');
    d.className = 'persona-text';
    d.rows = 3;
    d.value = per.description || '';
    d.placeholder = kind.descHint;
    d.addEventListener('input', function () {
      per.description = d.value;
      SB.Personas.touch(per);
      SB.Store.touch();
      /* the cards carrying this may now be showing a prompt written against
         the old wardrobe */
      SB.Board.refreshCastRows();
      SB.Board.refreshPromptStale();
    });
    wrap.appendChild(d);

    /* ---- reference-image prompt ---- */
    wrap.appendChild(SB.el('div', 'box-label', 'reference image prompt'));
    const ip = document.createElement('textarea');
    ip.className = 'persona-text';
    ip.rows = 2;
    ip.value = per.imagePrompt || '';
    ip.placeholder = 'The prompt that makes this reference frame.';
    ip.addEventListener('input', function () {
      per.imagePrompt = ip.value;
      SB.Personas.touch(per);
      SB.Store.touch();
    });
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
        ' that produces ' + kind.refBrief + '. No gendered language.\n\n' +
        kind.label.toUpperCase() + ':\n' + per.description,
        { type: 'OBJECT', properties: { imagePrompt: { type: 'STRING' } }, required: ['imagePrompt'] },
        sys
      ).then(function (out) {
        per.imagePrompt = out.imagePrompt || '';
        ip.value = per.imagePrompt;
        write.disabled = false;
        SB.app.changed(true);
      }).catch(function (e) {
        write.disabled = false;
        if (SB.apiBlocked(e, function () { write.onclick(); })) return;
        SB.toast(e.message || String(e), true);
      });
    };
    foot.appendChild(write);
    wrap.appendChild(foot);

    return wrap;
  }

  /* One angle rarely pins a face or a room down, so a subject holds as many
   * frames as it needs. The first is the hero: it is what the board shows and
   * what a single-reference model gets handed. */
  function frames(per, kind) {
    const box = SB.el('div', 'persona-frames');
    const list = SB.Personas.imagesOf(per);

    const big = SB.el('div', 'persona-frame');
    if (list.length) {
      const img = document.createElement('img');
      img.src = SB.Blobs.src(P(), list[0]);
      big.appendChild(img);
      const rm = SB.el('button', 'frame-x', '✕');
      rm.title = 'Remove this reference image';
      rm.onclick = function (ev) {
        ev.stopPropagation();
        SB.Personas.removeImage(per, 0);
        SB.app.changed(true);
        renderRefs();
      };
      big.appendChild(rm);
    } else {
      big.appendChild(SB.el('div', 'drop-hint', 'drop the reference frame here, or click to load'));
    }
    big.title = list.length ? 'Drop or click to add another reference image' : '';
    dropTarget(big, per);
    box.appendChild(big);

    const strip = SB.el('div', 'persona-strip');
    list.forEach(function (img, i) {
      const cell = SB.el('div', 'strip-cell' + (i === 0 ? ' hero' : ''));
      const t = SB.el('div', 'strip-thumb');
      const im = document.createElement('img');
      im.src = SB.Blobs.src(P(), img);
      t.appendChild(im);
      t.title = i === 0 ? 'The hero frame' : 'Make this the hero frame';
      if (i > 0) {
        t.onclick = function () {
          SB.Personas.makeHero(per, i);
          SB.app.changed(true);
          renderRefs();
        };
      }
      const x = SB.el('button', 'frame-x small', '✕');
      x.title = 'Remove this reference image';
      x.onclick = function (ev) {
        ev.stopPropagation();
        SB.Personas.removeImage(per, i);
        SB.app.changed(true);
        renderRefs();
      };
      t.appendChild(x);
      cell.appendChild(t);

      /* The label is what the prompt block cites — "image 2 = Ops lead (3/4)" —
         so it is worth a box of its own rather than being guessed at. */
      const lb = document.createElement('input');
      lb.type = 'text';
      lb.className = 'strip-label';
      lb.value = img.label || '';
      lb.placeholder = i === 0 ? 'hero' : 'label';
      lb.title = (img.label || '') || 'What this angle is: front, 3/4, wardrobe detail, wide…';
      lb.addEventListener('input', function () {
        SB.Personas.labelImage(per, i, lb.value);
        lb.title = lb.value || 'What this angle is: front, 3/4, wardrobe detail, wide…';
        SB.Store.touch();
      });
      cell.appendChild(lb);
      strip.appendChild(cell);
    });

    const add = SB.el('div', 'strip-cell');
    const plus = SB.el('div', 'strip-thumb add', '+');
    plus.title = 'Add another reference image';
    plus.onclick = function () {
      SB.pickImageFile().then(function (f) { if (f) addImage(per, f); });
    };
    dropTarget(plus, per);
    add.appendChild(plus);
    strip.appendChild(add);
    box.appendChild(strip);

    const n = list.length;
    let note;
    if (!n) note = 'No reference image — prompts will describe this in full instead.';
    else note = (n === 1 ? 'One frame' : n + ' frames') + ', fed in this order wherever ' +
      (per.name || 'this') + ' appears.';
    if (n > SB.Personas.IMAGE_ADVICE) {
      note += ' Past ' + SB.Personas.IMAGE_ADVICE + ', most image models start averaging ' +
        'references together instead of reading them.';
    }
    box.appendChild(SB.el('div', 'pp-note' + (n > SB.Personas.IMAGE_ADVICE ? ' warn' : ''), note));
    return box;
  }

  function dropTarget(el, per) {
    el.onclick = el.onclick || function () {
      SB.pickImageFile().then(function (f) { if (f) addImage(per, f); });
    };
    el.addEventListener('dragover', function (ev) {
      ev.preventDefault();
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', function () { el.classList.remove('drag-over'); });
    el.addEventListener('drop', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      el.classList.remove('drag-over');
      SB.imageFromTransfer(ev.dataTransfer).then(function (src) {
        if (src) addImage(per, src);
        else SB.toast('No image in that drop', true);
      });
    });
  }

  function addImage(per, src) {
    return SB.downscaleImage(src).then(function (img) {
      SB.Personas.addImage(per, SB.Blobs.image(P(), img.data, img.w, img.h));
      SB.app.changed(true);
      renderRefs();
    }).catch(function (e) { SB.toast('Image failed: ' + e.message, true); });
  }

  /* ---- renaming leaves copies of the old name in descriptions ---- */

  /* Built from `pendingRename` on every render rather than inserted by the blur
   * that raised it: that blur is often the panel tearing the input out from
   * under the user (a tab, the kind select, the ✕), and a bar inserted then
   * went into a tree that had already been thrown away. Held as state, the
   * offer survives a re-render and a close, and the hits are counted fresh
   * each time so it never offers to repair something already repaired. */
  function renameBar() {
    if (!pendingRename) return null;
    const per = SB.Personas.find(P(), pendingRename.id);
    const was = pendingRename.was;
    const now = per ? (per.name || '') : '';
    if (!per || !was || !now || was === now) { pendingRename = null; return null; }

    const re = new RegExp('\\b' + was.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
    const hits = [];
    SB.Model.eachShot(P(), function (sh) {
      if ((sh.personaIds || []).indexOf(per.id) < 0) return;
      re.lastIndex = 0;
      if (re.test(sh.description || '')) hits.push(sh);
    });
    if (!hits.length) { pendingRename = null; return null; }

    const bar = SB.el('div', 'lib-rename');
    bar.appendChild(SB.el('span', null,
      '“' + was + '” is still written into ' + hits.length +
      (hits.length === 1 ? ' description' : ' descriptions') + '.'));
    const b = SB.el('button', 'mini primary', 'Update ' + (hits.length === 1 ? 'it' : 'them') +
      ' to “' + now + '”');
    b.onclick = function () {
      hits.forEach(function (sh) {
        re.lastIndex = 0;
        sh.description = (sh.description || '').replace(re, now);
      });
      pendingRename = null;
      SB.app.changed(true);
      renderRefs();
      SB.toast(hits.length + (hits.length === 1 ? ' description' : ' descriptions') + ' updated');
    };
    const no = SB.el('button', 'mini link', 'leave them');
    no.onclick = function () { pendingRename = null; renderRefs(); };
    bar.appendChild(b);
    bar.appendChild(no);
    return bar;
  }

  /* ---- a pasted image belongs to the subject you last touched ---- */

  function pasteImage(blob) {
    if (!blob) return;
    const per = targetId ? SB.Personas.find(P(), targetId) : null;
    if (!per) {
      SB.toast('Click the subject you want it on first, then paste', true);
      return;
    }
    addImage(per, blob);
    SB.toast('Added to ' + (per.name || 'that subject'));
  }

  /* --------------------------------------------------------------- scenes */

  /* The shape of the film. Headings and descriptions, in order, with no shots
   * under them — the board is where shots live, and putting them here would
   * make this a second board instead of a way to see the whole thing at once. */
  function renderScenes() {
    if (!scenesEl || !P()) return;
    const p = P();
    /* This is called from under the user's hands — a generate finishing, an
       undo — so where the caret was is remembered across the rebuild. */
    const act = document.activeElement;
    const keep = (act && scenesEl.contains(act) && act.dataset && act.dataset.scene)
      ? { scene: act.dataset.scene, cls: act.className, at: act.selectionStart, to: act.selectionEnd }
      : null;
    scenesEl.innerHTML = '';

    const h = SB.el('div', 'lib-section-head');
    h.appendChild(SB.el('span', 't', 'Scenes'));
    h.appendChild(SB.el('span', 'n', String(p.scenes.length)));
    h.appendChild(SB.el('span', 'spacer'));
    const add = SB.el('button', 'tb', '+ Scene');
    add.onclick = function () {
      const sc = SB.Model.addScene(p);
      SB.app.selectedSceneId = sc.id;
      SB.app.changed(true);
      renderScenes();
      const el = scenesEl.querySelector('.sc-row[data-id="' + sc.id + '"] .sh-heading');
      if (el) { el.focus(); el.select(); }
    };
    h.appendChild(add);
    scenesEl.appendChild(h);

    const list = SB.el('div', 'sc-list');
    p.scenes.forEach(function (sc, i) { list.appendChild(sceneRow(sc, i)); });
    scenesEl.appendChild(list);
    scenesEl.appendChild(SB.el('div', 'pp-note',
      'Drag a scene by its handle to reorder the film. Shots stay with their scene.'));

    if (keep) {
      const back = scenesEl.querySelector(
        '[data-scene="' + keep.scene + '"].' + keep.cls.split(' ').join('.'));
      if (back) {
        back.focus();
        try { back.setSelectionRange(keep.at, keep.to); } catch (e) { /* not a text box */ }
      }
    }
  }

  function sceneRow(sc, idx) {
    const p = P();
    const row = SB.el('div', 'sc-row' + (SB.app.selectedSceneId === sc.id ? ' sel' : ''));
    row.dataset.id = sc.id;

    const grip = SB.el('div', 'sc-grip', '⠿');
    grip.title = 'Drag to reorder';
    grip.draggable = true;
    grip.addEventListener('dragstart', function (ev) {
      ev.dataTransfer.setData('text/sb-scene', sc.id);
      ev.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    grip.addEventListener('dragend', function () { row.classList.remove('dragging'); });
    row.appendChild(grip);

    row.addEventListener('dragover', function (ev) {
      if (ev.dataTransfer.types.indexOf('text/sb-scene') < 0) return;
      ev.preventDefault();
      row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', function () { row.classList.remove('drag-over'); });
    row.addEventListener('drop', function (ev) {
      row.classList.remove('drag-over');
      const id = ev.dataTransfer.getData('text/sb-scene');
      if (!id || id === sc.id) return;
      ev.preventDefault();
      /* moveScene inserts BEFORE the index it is given, so dropping on the
         lower half of a row has to mean the slot after it — without this you
         could never drag a scene to the end, and a one-step drag downward
         quietly did nothing at all. */
      const r = row.getBoundingClientRect();
      const after = ev.clientY > r.top + r.height / 2;
      SB.Model.moveScene(p, id, after ? idx + 1 : idx);
      SB.app.changed(true);
      renderScenes();
      SB.Board.renderSceneList();
    });

    const num = SB.el('div', 'sc-num', String(idx + 1));
    row.appendChild(num);

    const fields = SB.el('div', 'sc-fields');
    const hd = document.createElement('input');
    hd.type = 'text';
    hd.className = 'sh-heading';
    hd.value = sc.heading || '';
    hd.placeholder = 'Scene heading';
    hd.dataset.scene = sc.id;
    hd.addEventListener('input', function () {
      sc.heading = hd.value;
      SB.app.changed(false);
      SB.Board.renderSceneList();
      SB.Board.syncSceneFields(sc.id);
    });
    fields.appendChild(hd);

    const d = document.createElement('textarea');
    d.className = 'sh-desc';
    d.rows = 3;
    d.value = sc.description || '';
    d.placeholder = 'Scene description — what happens here, in prose.';
    d.dataset.scene = sc.id;
    d.addEventListener('input', function () {
      sc.description = d.value;
      SB.app.changed(false);
      SB.Board.syncSceneFields(sc.id);
    });
    SB.Mentions.attach(d, { scene: sc });
    fields.appendChild(d);
    fields.appendChild(SB.Board.sceneAi(sc, d));
    row.appendChild(fields);

    /* The only nod to shots: how many, and whether the scene claims a section
       of the script. Both are answers about the scene, not about its contents. */
    const meta = SB.el('div', 'sc-meta');
    const claim = sc.link && !sc.broken ? 'section'
      : (sc.broken ? 'section broken' : (sc.local ? 'own section' : 'untied'));
    const go = SB.el('button', 'mini', sc.shots.length +
      (sc.shots.length === 1 ? ' shot' : ' shots'));
    go.title = 'Show this scene on the board';
    go.onclick = function () {
      close();
      SB.app.selectedSceneId = sc.id;
      SB.Board.renderSceneList();
      const blk = document.querySelector('.scene-block[data-scene="' + sc.id + '"]');
      if (blk) blk.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    meta.appendChild(go);
    meta.appendChild(SB.el('div', 'sc-claim' + (sc.broken ? ' broken' : ''), claim));

    const del = SB.el('button', 'mini danger', '✕');
    del.title = 'Delete this scene';
    del.onclick = function () {
      if (p.scenes.length < 2) { SB.toast('A board keeps at least one scene', true); return; }
      /* The claim on the script is worth as much as the cards are, and it is
         the thing you cannot see from here — so it is asked about too. */
      const what = [];
      if (sc.shots.length) what.push(sc.shots.length + ' shot' + (sc.shots.length === 1 ? '' : 's'));
      if (SB.Model.sceneTied(sc)) what.push('its claim on the script');
      if (what.length && !confirm('Delete “' + (sc.heading || 'this scene') + '” and ' +
        what.join(' and ') + '?')) return;
      SB.Model.deleteScene(p, sc.id);
      SB.Board.forgetScene(sc.id);
      SB.app.changed(true);
      renderScenes();
      SB.Board.renderSceneList();
    };
    meta.appendChild(del);
    row.appendChild(meta);

    return row;
  }

  /* ---------------------------------------------------------------- utils */

  function countShots(id) {
    let n = 0;
    SB.Model.eachShot(P(), function (sh) {
      if ((sh.personaIds || []).indexOf(id) >= 0) n++;
    });
    return n;
  }

  function jumpToFirst(id) {
    let found = null;
    SB.Model.eachShot(P(), function (sh) {
      if (!found && (sh.personaIds || []).indexOf(id) >= 0) found = sh;
    });
    if (!found) return;
    close();
    SB.Board.select(found.id);
    const el = document.querySelector('.card[data-shot="' + found.id + '"]');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  SB.PersonaPanel = {
    init: init, open: open, close: close, toggle: toggle, isOpen: isOpen,
    refresh: refresh, refreshScenes: refreshScenes, refreshRefs: refreshRefs,
    pasteImage: pasteImage
  };

})(window.SB);
