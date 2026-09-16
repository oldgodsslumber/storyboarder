/* personapanel.js — the reference library.
 *
 * A full-page takeover holding the one thing that is true of the whole board
 * rather than of one card: every recurring subject (the cast, the locations,
 * the objects). It is an answer to "what is this film made of", which is a
 * question you ask with your head up, away from the cards — so it gets the
 * whole window rather than a 320px column squeezed in beside the board.
 *
 * Scenes live on the board, which has a list of its own.
 */
(function (SB) {
  'use strict';

  const SIZE_KEY = 'sb.library.size';

  /* How big a reference reads at. Portrait subjects are stored at 270x480 at
     most (SB.downscaleImage caps at 854x480), so L stops short of upscaling.
     The column widens with the hero: a tall picture plus the fields beside it
     needs the room. */
  const SIZES = {
    s: { hero: 170, col: 300 },
    m: { hero: 260, col: 380 },
    l: { hero: 380, col: 460 }
  };
  let size = 'm';
  try { if (SIZES[localStorage.getItem(SIZE_KEY)]) size = localStorage.getItem(SIZE_KEY); }
  catch (e) { /* private mode */ }

  let root = null;          // the overlay, while it is open
  let refsEl, statusEl, searchEl, tabsEl, sizeEl;
  let filter = 'all';       // which kind the library is showing
  let query = '';
  let targetId = null;      // the subject a paste would land on
  /* A rename offer outlives the input that raised it: closing the panel, or
   * anything that re-renders it, detaches that input and fires its blur. The
   * offer is state, and the bar is drawn from it. */
  let pendingRename = null;

  function P() { return SB.app.project; }

  /* Pure CSS, so changing size costs no re-render — the portrait cards' own
     widths are calc()s off the same variable and follow along. */
  function applySize() {
    if (!refsEl) return;
    const v = SIZES[size] || SIZES.m;
    refsEl.style.setProperty('--ref-hero', v.hero + 'px');
    refsEl.style.setProperty('--ref-col', v.col + 'px');
    if (sizeEl) {
      sizeEl.querySelectorAll('button').forEach(function (b) {
        b.classList.toggle('on', b.dataset.size === size);
      });
    }
  }

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

    refsEl = SB.el('section', 'lib-refs');
    lib.appendChild(refsEl);

    root.appendChild(lib);
    root.addEventListener('mousedown', function (ev) { if (ev.target === root) close(); });
    document.addEventListener('keydown', onKey);
    document.getElementById('modalRoot').appendChild(root);
    document.getElementById('btnPersonas').classList.add('on');

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
    refsEl = statusEl = searchEl = null;
    document.removeEventListener('keydown', onKey);
    document.getElementById('btnPersonas').classList.remove('on');
  }

  function toggle() { root ? close() : open(); }
  function isOpen() { return !!root; }
  function refresh() { if (root) render(); }
  /* Just the library grid — so something minted while typing elsewhere
     appears without rebuilding the box being typed into. */
  function refreshRefs() { if (root) renderRefs(); }

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

    /* A library of people is a library of tall pictures, and how big they need
       to read is a matter of the screen and the eyes in front of it. */
    sizeEl = SB.el('div', 'lib-size');
    sizeEl.appendChild(SB.el('span', 'lbl', 'size'));
    [['s', 'S'], ['m', 'M'], ['l', 'L']].forEach(function (pair) {
      const b = SB.el('button', 'tb toggle', pair[1]);
      b.dataset.size = pair[0];
      b.title = 'Show references ' +
        (pair[0] === 's' ? 'small' : pair[0] === 'm' ? 'at the usual size' : 'large');
      b.onclick = function () {
        size = pair[0];
        try { localStorage.setItem(SIZE_KEY, size); } catch (e) { /* private mode */ }
        applySize();
      };
      sizeEl.appendChild(b);
    });
    h.appendChild(sizeEl);

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

  /* Rebuilt from nothing, like the board — so the caret goes back where it
     was rather than to <body>. */
  function render() { SB.Focus.keep(renderNow); }

  function renderNow() {
    if (!root || !P()) return;
    renderRefs();
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

    applySize();

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
    wrap.dataset.per = per.id;
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
      /* Renaming in two passes — fixing a typo, thinking again — used to lose
         the repair: the second blur overwrote the pending record with a name
         that was never in any description, which then cancelled itself. The
         oldest unrepaired name is the one actually sitting in the text, so an
         offer already standing for this subject is left alone. */
      if (!pendingRename || pendingRename.id !== per.id) {
        pendingRename = { id: per.id, was: was };
      }
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
      /* This cannot be undone — structural changes are deliberately outside the
         undo stack — and it takes more with it than the cards it is on. */
      const frames = SB.Personas.imagesOf(per).length + SB.Personas.retiredOf(per).length;
      const marked = markedIn(per.id);
      const takes = [];
      if (used) takes.push('comes off ' + used + ' card' + (used === 1 ? '' : 's'));
      if (frames) takes.push('deletes ' + frames + ' reference image' + (frames === 1 ? '' : 's'));
      if (marked) takes.push(marked + ' description' + (marked === 1 ? '' : 's') +
        ' will keep the name as plain text');
      if (!confirm('Remove “' + (per.name || kind.one) + '”?' +
        (takes.length ? '\n\nIt ' + takes.join(', ') + '.' : '') +
        '\n\nThis cannot be undone.')) return;
      SB.Personas.remove(p, per.id);
      SB.app.changed(true);
      render();
    };
    head.appendChild(del);
    wrap.appendChild(head);

    /* ---- reference frames, and the fields beside or below them ---- */
    const body = SB.el('div', 'persona-body');
    const fields = SB.el('div', 'persona-fields');
    body.appendChild(frames(per, kind, wrap));
    body.appendChild(fields);
    wrap.appendChild(body);

    /* ---- description ---- */
    fields.appendChild(SB.el('div', 'box-label', kind.descLabel));
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
    fields.appendChild(d);

    /* ---- reference-image prompt ---- */
    fields.appendChild(SB.el('div', 'box-label', 'reference image prompt'));
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
    fields.appendChild(ip);

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
      const brand = SB.Brand.brandOf(P());
      const sys = brand.enabled
        ? 'HOUSE STYLE\n\n' + brand.text + '\n\n' + SB.Brand.REFERENCE_RIDER
        : SB.Brand.REFERENCE_RIDER;
      SB.Prompts.raw(
        'Write one still-image prompt for ' + (m ? m.name : 'an image model') +
        ' that produces ' + kind.refBrief + '.\n\n' +
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
    fields.appendChild(foot);

    return wrap;
  }

  /* One angle rarely pins a face or a room down, so a subject holds as many
   * frames as it needs. The first is the hero: it is what the board shows and
   * what a single-reference model gets handed. */
  /* The shape of a stored picture, or 0 when the record predates w/h being
   * kept. Everything added through this panel has them — SB.downscaleImage
   * hands them over — so a 0 means an old file or a hand-built fixture. */
  function ratioOf(rec) {
    if (!rec || !(rec.w > 0) || !(rec.h > 0)) return 0;
    return rec.w / rec.h;
  }

  /* Below this a subject is tall enough that the fields belong beside it
   * rather than under it. Square-ish stays stacked. */
  const PORTRAIT_AT = 0.95;

  function applyShape(wrap, box, big, ratio) {
    const portrait = !!ratio && ratio < PORTRAIT_AT;
    if (big) big.style.setProperty('--ar', ratio ? String(ratio) : '');
    wrap.classList.toggle('portrait', portrait);
    /* The frames column is exactly as wide as the frame, so the fields get
       every pixel the picture is not using. It tracks the size dial. */
    box.style.width = portrait
      ? 'calc(var(--ref-hero, 260px) * ' + ratio.toFixed(4) + ')'
      : '';
  }

  /* One reference frame per subject.
   *
   * It was a strip — a hero, then any number of angles, each with a label and
   * a promote button. Nothing ever sent more than the first one anywhere, so
   * the rest were numbering a person had to honour by hand. Two angles are two
   * subjects now ("Nat", "Nat (back)"), which the feed can already number.
   *
   * What a board already had is not deleted: extra frames are retired. They
   * are not shown here — a second thumbnail under the reference read as a
   * second reference — but they are in the viewer behind this frame, on the
   * arrow keys, and Settings → General counts them, saves them out at full
   * size and deletes them for good.
   */
  function frames(per, kind, wrap) {
    const box = SB.el('div', 'persona-frames');
    const one = SB.Personas.hero(per);

    const big = SB.el('div', 'persona-frame');
    applyShape(wrap, box, big, ratioOf(one));
    if (one) {
      const img = document.createElement('img');
      img.src = SB.Blobs.src(P(), one);
      /* An old record carrying no dimensions learns its own shape the first
         time it is drawn, and the file keeps the answer. */
      if (!ratioOf(one)) {
        img.onload = function () {
          const w = img.naturalWidth, h = img.naturalHeight;
          if (!w || !h) return;
          one.w = w; one.h = h;
          SB.Store.touch();
          applyShape(wrap, box, big, w / h);
        };
      }
      big.appendChild(img);
      const rm = SB.el('button', 'frame-x', '✕');
      rm.title = 'Remove this reference image';
      rm.onclick = function (ev) {
        ev.stopPropagation();
        SB.Personas.clearImage(per);
        SB.app.changed(true);
        renderRefs();
      };
      big.appendChild(rm);
    } else {
      big.appendChild(SB.el('div', 'drop-hint', 'drop the reference frame here, or click to load'));
    }
    if (one) {
      /* Same trade as the card's frame, and worse here: this picture is often
         the only copy of somebody's face in the file, and a click meant to
         inspect it opened a picker over the top. */
      big.style.cursor = 'zoom-in';
      big.addEventListener('click', function (ev) {
        if (ev.target.closest && ev.target.closest('.frame-x')) return;
        ev.stopPropagation();
        const old = SB.Personas.retiredOf(per);
        const items = [{
          img: one, render: one.render, label: per.name || 'reference',
          note: one.label || '',
          onReplace: function (file) { addImage(per, file); },
          onRemove: function () {
            const kept = SB.Personas.retiredOf(per).length;
            SB.Personas.clearImage(per);
            SB.app.changed(true);
            renderRefs();
            if (kept) {
              /* this frame was the way into the viewer that lists them */
              SB.toast(kept + ' older frame' + (kept === 1 ? '' : 's') +
                ' of ' + (per.name || 'this subject') + ' ' + (kept === 1 ? 'is' : 'are') +
                ' still in the file — Settings → General', false, { ms: 9000 });
            }
          }
        }].concat(old.map(function (x) {
          return { img: x, render: x.render, label: per.name || 'reference',
            note: (x.label ? x.label + ' · ' : '') + 'older frame, fed to nothing' };
        }));
        SB.Viewer.open(P(), items, 0, { title: per.name || 'Reference' });
      });
    }
    big.title = one
      ? 'Click to see it full size. Drop a file on it to replace it.'
      : '';
    dropTarget(big, per);
    box.appendChild(big);

    /* The label is what the prompt block cites — "image 2 = Ops lead (3/4)" —
       and what the export names the file, so it keeps a box of its own. */
    if (one) {
      const lb = document.createElement('input');
      lb.type = 'text';
      lb.className = 'strip-label wide';
      lb.value = one.label || '';
      lb.placeholder = 'what this shows — front, 3/4, wardrobe…';
      lb.addEventListener('input', function () {
        SB.Personas.labelImage(per, lb.value);
        SB.Store.touch();
        SB.Board.refreshCastRows();
      });
      box.appendChild(lb);
    }

    /* Frames a board carried before the cut are still in the file, but they
       are not shown here. A second thumbnail under the reference reads as a
       second reference — which is the thing that was removed. They are
       counted, and cleared out, in Settings → General, next to everything
       else that weighs. */

    box.appendChild(SB.el('div', 'pp-note', one
      ? 'One reference, fed wherever ' + (per.name || 'this') + ' appears. For a second ' +
        'angle, make it a subject of its own — it gets its own number in the feed.'
      : 'No reference image — prompts will describe this in full instead.'));
    return box;
  }

  function dropTarget(el, per) {
    /* Only an EMPTY frame picks a file on click. One with a picture in it
       opens the viewer instead — wanting a better look at a face must not be
       the same gesture as replacing it. */
    el.onclick = el.onclick || function () {
      if (SB.Personas.hero(per)) return;
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
    /* The proxy is the visible half and does not wait on the other: encoding a
       large original takes a moment, and a reference should appear the instant
       it is dropped. */
    return SB.downscaleImage(src).then(function (img) {
      const had = SB.Personas.hero(per);
      const rec = SB.Personas.setImage(per, SB.Blobs.image(P(), img.data, img.w, img.h),
        (had && had.label) || '');
      SB.app.changed(true);
      renderRefs();
      SB.Renders.keep(P(), src, null).then(function (r) {
        /* The reference may have been deleted while its original encoded —
           writing onto a record nobody holds any more would strand the bytes
           until the next sweep. */
        if (!r || !rec || SB.Personas.hero(per) !== rec) return;
        rec.render = r;
        SB.Store.touch();
        renderRefs();
      }).catch(function (e) {
        SB.toast('Kept the board copy only — the full-size original could not be stored: ' +
          (e.message || e), true);
      });
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

    /* Only where the old name sits in the text as PROSE. A mark resolves by
       id, so it already says the new name and needs no repair — and matching
       inside one would rewrite the token's own fallback. */
    const hits = [];
    SB.Model.eachShot(P(), function (sh) {
      const any = SB.Refs.KEYS.some(function (k) {
        return SB.Refs.proseHits(P(), sh[k], was).length > 0;
      });
      if (any) hits.push(sh);
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
        SB.Refs.rewrite(sh, function (was2) {
          /* back to front, so each rewrite leaves the earlier offsets alone */
          const spots = SB.Refs.proseHits(P(), was2, was);
          let text = was2 || '';
          for (let i = spots.length - 1; i >= 0; i--) {
            text = text.slice(0, spots[i].from) + now + text.slice(spots[i].to);
          }
          return text;
        });
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

  /* ---------------------------------------------------------------- utils */

  /* How many descriptions carry a mark for this subject — they do not break
   * when it goes, but they stop feeding a picture. */
  function markedIn(id) {
    let n = 0;
    SB.Model.eachShot(P(), function (sh) {
      const any = SB.Refs.KEYS.some(function (k) {
        return SB.Refs.parse(P(), sh[k]).some(function (m) { return m.id === id; });
      });
      if (any) n++;
    });
    return n;
  }

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
    refresh: refresh, refreshRefs: refreshRefs,
    pasteImage: pasteImage
  };

})(window.SB);
