/* gettypanel.js — the stock drawer.
 *
 * Every other panel in this app is a backdrop over a centred box, because
 * every other panel is somewhere you GO. This one is open while you work, and
 * the gesture it exists for is dragging a picture out of it onto a card — so a
 * backdrop would put the thing you need to drop on behind the thing you are
 * dragging from.
 *
 * It is a flex sibling of #main rather than a fixed strip over the board, and
 * that is the whole layout decision: #app is a column, #main is flex:1, so a
 * drawer with a fixed height makes the board SHRINK. Laid over the board
 * instead, the drawer would cover exactly the cards you want to drop on, and
 * the last row of the board would be unreachable — which is the same mistake
 * as using a modal, arrived at a second way.
 *
 * ---- what it hands over ----
 *
 * A tile sets two things on the drag: application/x-sb-getty with the asset,
 * and text/uri-list with the comp URL. The second one is already understood by
 * every drop path in the app (SB.imageFromTransfer fetches a dropped URL), so
 * the picture would land even with no new code in board.js at all. The first
 * one is what the licence needs — which asset this was — and board.js checks
 * it before falling through. Dropping on a card replaces its frame (the old
 * one banks as a take); dropping on empty scene space makes a new card.
 *
 * ---- and what it refuses to do ----
 *
 * Nothing in here searches on its own. A drawer that re-queried on every
 * selection change would spend somebody's QPS on scrolling and overwrite a
 * phrase mid-typing, so the phrase box re-seeds from the selected card only
 * while it has not been typed in, and the search runs when asked.
 */
(function (SB) {
  'use strict';

  const K_OPEN = 'sb.getty.open';
  const K_H = 'sb.getty.h';
  const MIN_H = 150, MAX_FRAC = 0.72, DEF_H = 320;

  const S = {
    el: null, headEl: null, chipEl: null, stripEl: null, judgeEl: null, phraseEl: null,
    statusEl: null, matchEl: null,
    /* the search as it stands */
    filters: null, phrase: '', family: 'creative',
    page: 1, total: 0, images: [], more: false,
    busy: false, error: '', typed: false, seededFor: '',
    /* what the judging pane is showing, and what a click would place */
    chosen: null,
    /* by-image: the uploaded frame's URL, so "more like this" can page */
    byImage: null,
    askedUpload: false
  };

  function P() { return SB.app.project; }

  function height() {
    const h = parseInt(ls(K_H), 10);
    const cap = Math.round(window.innerHeight * MAX_FRAC);
    if (!(h > 0)) return Math.min(DEF_H, cap);
    return Math.max(MIN_H, Math.min(h, cap));
  }
  function ls(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lsSet(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) { } }

  function isOpen() { return !!S.el; }

  /* ---------------- open / close ---------------- */

  function open() {
    if (S.el) { sync(); return; }
    const app = document.getElementById('app');
    const main = document.getElementById('main');
    if (!app || !main) return;

    S.el = SB.el('section', 'stock');
    S.el.id = 'stockDrawer';
    S.el.style.height = height() + 'px';

    const grip = SB.el('div', 'stock-grip');
    grip.title = 'Drag to resize';
    grip.addEventListener('mousedown', startResize);
    S.el.appendChild(grip);

    S.headEl = SB.el('div', 'stock-head');
    S.el.appendChild(S.headEl);

    const body = SB.el('div', 'stock-body');
    S.stripEl = SB.el('div', 'stock-strip');
    S.judgeEl = SB.el('div', 'stock-judge');
    body.appendChild(S.stripEl);
    body.appendChild(S.judgeEl);
    S.el.appendChild(body);

    /* after #main, so the board above it shrinks rather than being covered */
    main.parentNode.insertBefore(S.el, main.nextSibling);
    document.body.classList.add('stock-on');
    const btn = document.getElementById('btnStock');
    if (btn) btn.classList.add('on');
    lsSet(K_OPEN, '1');

    if (!S.filters) seed(true);
    drawHead();
    drawStrip();
    drawJudge();
    if (SB.Getty) S.unwatch = SB.Getty.onChange(function () { drawHead(); drawStrip(); });
    window.addEventListener('keydown', onKey);
  }

  function close() {
    if (!S.el) return;
    if (S.unwatch) { S.unwatch(); S.unwatch = null; }
    window.removeEventListener('keydown', onKey);
    S.el.remove();
    S.el = null;
    document.body.classList.remove('stock-on');
    /* the edge-scroll guard: a drag that ended with the drawer closing would
       otherwise leave it armed for every later drag in the app */
    document.body.classList.remove('stock-dragging');
    const btn = document.getElementById('btnStock');
    if (btn) btn.classList.remove('on');
    lsSet(K_OPEN, '');
  }

  function toggle() { isOpen() ? close() : open(); }

  function onKey(ev) {
    if (ev.key === 'Escape' && S.el && !document.querySelector('.modal-back, .lib-back')) {
      /* Escape closes the drawer only when nothing is open over it — a modal
         on top owns the key. */
      if (document.activeElement === S.phraseEl) { S.phraseEl.blur(); return; }
      close();
    }
  }

  /* ---------------- resizing ---------------- */

  function startResize(ev) {
    ev.preventDefault();
    const y0 = ev.clientY, h0 = S.el.getBoundingClientRect().height;
    const cap = Math.round(window.innerHeight * MAX_FRAC);
    const move = function (e) {
      const h = Math.max(MIN_H, Math.min(h0 + (y0 - e.clientY), cap));
      S.el.style.height = h + 'px';
    };
    const up = function () {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('resizing');
      lsSet(K_H, String(Math.round(S.el.getBoundingClientRect().height)));
      drawStrip();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.body.classList.add('resizing');
  }

  /* ---------------- the card this is about ---------------- */

  function shot() {
    const id = SB.app.selectedShotId;
    /* restore() runs inside boot(), before the first project exists — and a
       drawer reopened from localStorage must not be the thing that throws
       during start-up. */
    if (!id || !P()) return null;
    const f = SB.Model.findShot(P(), id);
    return f || null;
  }

  /* Re-seed the phrase and the filters from the selected card. `force` is the
   * first open and the explicit "from this card" button; otherwise a phrase
   * somebody has typed is theirs and is never overwritten — the same rule the
   * Create panel follows about the caret. */
  function seed(force) {
    const f = shot();
    const p = P();
    S.filters = SB.Getty ? SB.Getty.shotFilters(p, f && f.shot) : {};
    if (force || !S.typed) {
      S.phrase = SB.Getty ? SB.Getty.phraseFor(p, f && f.shot) : '';
      S.typed = false;
      if (S.phraseEl) S.phraseEl.value = S.phrase;
    }
    S.seededFor = f ? f.shot.id : '';
  }

  /* The board's selection moved, or a card was retyped. Cheap, and never a
     search. */
  function sync() {
    if (!S.el) return;
    const f = shot();
    if (f && f.shot.id !== S.seededFor) seed(false);
    drawHead();
    drawJudge();
  }

  /* ---------------- the head ---------------- */

  function drawHead() {
    if (!S.headEl) return;
    const h = S.headEl;
    h.textContent = '';

    const title = SB.el('div', 'stock-title', '◧ Stock');
    title.title = 'Getty Images — comps, for boarding. Licensing happens in the edit, not here.';
    h.appendChild(title);

    const f = shot();
    const forCard = SB.el('span', 'stock-for',
      f ? f.code + (f.shot.type ? ' · ' + f.shot.type : '') : 'no card selected');
    h.appendChild(forCard);

    const box = SB.el('input', 'stock-phrase');
    box.type = 'text';
    box.placeholder = 'what the shot shows…';
    box.spellcheck = false;
    box.value = S.phrase;
    box.addEventListener('input', function () { S.phrase = box.value; S.typed = true; });
    box.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); search(); }
      ev.stopPropagation();        // the board's own shortcuts are not for this box
    });
    S.phraseEl = box;
    h.appendChild(box);

    const go = SB.el('button', 'mini primary', 'Search');
    go.onclick = search;
    h.appendChild(go);

    const re = SB.el('button', 'mini', '↺ from this card');
    re.title = 'Rewrite the phrase and the filters from the selected card';
    re.onclick = function () { seed(true); drawHead(); };
    h.appendChild(re);

    /* Find a match for this frame — the reason this drawer is worth having on
       a board that was generated rather than shot. */
    const mf = SB.el('button', 'mini', '◎ match this frame');
    const canMatch = !!(f && SB.Model.modelFrame(P(), f.shot));
    mf.title = canMatch
      ? 'Upload this card’s frame to Getty and find real photographs that look like it'
      : (f && SB.Model.isStock(P(), f.shot)
        ? 'This card already holds a comp — use “more like this” on the tile instead'
        : 'Select a card that has a frame first');
    mf.disabled = !canMatch;
    mf.onclick = function () { matchFrame(f); };
    S.matchEl = mf;
    h.appendChild(mf);

    h.appendChild(SB.el('span', 'spacer'));

    S.statusEl = SB.el('span', 'stock-status', statusWords());
    h.appendChild(S.statusEl);

    const shut = SB.el('button', 'mini', '✕');
    shut.title = 'Close the drawer';
    shut.onclick = close;
    h.appendChild(shut);

    /* the chips, on their own line */
    S.chipEl = SB.el('div', 'stock-chips');
    drawChips();
    h.appendChild(S.chipEl);
  }

  function statusWords() {
    if (S.busy) return 'searching…';
    if (S.error) return '';
    if (!S.images.length) return '';
    return S.images.length + ' of ' + (S.total || S.images.length);
  }

  function drawChips() {
    if (!S.chipEl) return;
    const c = S.chipEl;
    c.textContent = '';
    if (!SB.Getty) return;
    const chips = SB.Getty.chips(S.filters || {});
    if (!chips.length) {
      c.appendChild(SB.el('span', 'stock-chip-none', 'no filters — everything Getty has'));
      return;
    }
    c.appendChild(SB.el('span', 'stock-chip-lbl', 'filtered to'));
    chips.forEach(function (ch) {
      const b = SB.el('button', 'stock-chip', ch.label + ' ✕');
      b.title = 'Drop this filter';
      b.onclick = function () { dropChip(ch); };
      c.appendChild(b);
    });
    /* The types Getty has no word for. Said once, here, rather than leaving
       somebody to wonder why a POV search looks like any other search. */
    const f = shot();
    if (f && f.shot.type && SB.Getty.typeFilters && !SB.Getty.typeFilters(f.shot.type)) {
      c.appendChild(SB.el('span', 'stock-chip-none',
        '· Getty has no filter for “' + f.shot.type + '” — words only'));
    }
  }

  function dropChip(ch) {
    const f = S.filters || {};
    if (ch.k === 'excludeEditorialOnly') f.excludeEditorialOnly = false;
    else if (Array.isArray(f[ch.k])) f[ch.k] = f[ch.k].filter(function (v) { return v !== ch.v; });
    drawChips();
  }

  /* ---------------- searching ---------------- */

  /* A keyword search: the phrase and the chips, and NOT by-image.
   *
   * The two are separate entry points because run() cannot be the place that
   * forgets the uploaded frame. It used to clear S.byImage on page 1 — two
   * lines above the ternary that reads it — so "match this frame" uploaded
   * the user's picture to Getty, threw the answer away, and ran an ordinary
   * keyword search with an empty phrase. It filled the strip, so it looked
   * like it had worked. */
  function search() { S.byImage = null; run(1); }

  function run(page) {
    if (!SB.Getty) return;
    if (!SB.Getty.configured()) {
      S.error = 'No Getty API key yet.';
      S.images = [];
      drawStrip();
      return;
    }
    const f = Object.assign({}, S.filters || {}, { phrase: S.phrase });
    S.busy = true; S.error = '';
    if (page === 1) { S.images = []; S.chosen = null; }
    paintStatus();
    const want = ++S.seq;
    const call = S.byImage
      ? SB.Getty.byImage({ imageUrl: S.byImage }, f, page, 60)
      : SB.Getty.searchImages(S.family, f, page, 60);
    call.then(function (r) {
      if (want !== S.seq) return;                 // a later search won
      S.busy = false;
      S.page = page;
      S.total = r.total;
      S.images = page === 1 ? r.images : S.images.concat(r.images);
      S.more = r.images.length >= 60 && S.images.length < r.total;
      if (!S.chosen && S.images.length) S.chosen = S.images[0];
      drawStrip(); drawJudge(); paintStatus();
    }).catch(function (e) {
      if (want !== S.seq) return;
      S.busy = false;
      S.error = e && e.message || String(e);
      drawStrip(); paintStatus();
    });
  }
  S.seq = 0;

  function paintStatus() {
    if (S.statusEl) S.statusEl.textContent = statusWords();
  }

  function moreLikeThis(a) {
    if (!SB.Getty) return;
    S.busy = true; S.error = ''; S.byImage = null;
    paintStatus();
    const want = ++S.seq;
    SB.Getty.similar(a.id, 1, 60).then(function (r) {
      if (want !== S.seq) return;
      S.busy = false;
      S.images = r.images; S.total = r.total || r.images.length; S.more = false;
      S.page = 1;
      S.chosen = S.images[0] || null;
      S.phrase = 'like ' + a.id; S.typed = true;
      if (S.phraseEl) S.phraseEl.value = S.phrase;
      drawStrip(); drawJudge(); paintStatus();
    }).catch(function (e) {
      if (want !== S.seq) return;
      S.busy = false; S.error = e && e.message || String(e);
      drawStrip(); paintStatus();
    });
  }

  /* Board it with a model, then find the licensable picture that looks like
   * what you drew. It sends a frame out of the project to Getty, which is a
   * thing to say plainly and ask about once. */
  function matchFrame(f) {
    if (!f || !SB.Getty) return;
    const p = P();
    const frame = SB.Model.modelFrame(p, f.shot);
    if (!frame) return;
    if (!S.askedUpload) {
      const ok = window.confirm(
        'Find Getty photographs that look like this frame?\n\n' +
        'This uploads the picture on ' + f.code + ' to Getty’s search service. It is a ' +
        'client frame leaving this machine — Getty searches with it and does not license ' +
        'or publish it, but it does leave.\n\nAsked once per session.');
      if (!ok) return;
      S.askedUpload = true;
    }
    S.busy = true; S.error = ''; paintStatus();
    /* The upload holds a ticket of its own: a keyword search started while
       the bytes are going up wins, and this must not then overwrite the strip
       with results for a frame nobody is waiting for any more. run() claims
       its own ticket after this one — no arithmetic on S.seq. */
    const want = ++S.seq;
    frameBlob(p, f.shot).then(function (blob) {
      if (!blob) throw new Error('That card’s picture could not be read back out of the file.');
      return SB.Getty.uploadSearchImage(f.code.replace(/\W+/g, '') + '.jpg', blob);
    }).then(function (url) {
      if (want !== S.seq) return;                  // a later search took over
      S.byImage = url;
      S.phrase = ''; S.typed = true;
      if (S.phraseEl) S.phraseEl.value = '';
      run(1);
    }).catch(function (e) {
      if (want !== S.seq) return;
      S.busy = false;
      S.error = (e && e.message || String(e));
      drawStrip(); paintStatus();
    });
  }

  function frameBlob(p, sh) {
    return SB.Renders.file(p, sh.render).then(function (file) {
      if (file) return file;
      const src = sh.image ? SB.Blobs.src(p, sh.image) : '';
      if (!src) return null;
      return fetch(src).then(function (r) { return r.blob(); });
    });
  }

  /* ---------------- the strip ---------------- */

  function drawStrip() {
    if (!S.stripEl) return;
    const strip = S.stripEl;
    strip.textContent = '';

    if (SB.Getty && !SB.Getty.configured()) {
      strip.appendChild(note('Getty needs an API key before it can search. ' +
        'Settings → Getty, then come back.', 'Open Settings', function () {
          SB.Settings.open('getty');
        }));
      return;
    }
    if (S.error) {
      strip.appendChild(note(S.error, 'Try again', function () { run(1); }));
      return;
    }
    if (!S.images.length) {
      strip.appendChild(note(S.busy ? 'Searching Getty…'
        : 'Type what the shot shows and press Search. The filters above come from the card.'));
      return;
    }

    S.images.forEach(function (a) {
      strip.appendChild(tile(a));
    });
    if (S.more) {
      const m = SB.el('button', 'stock-more', 'more\n›');
      m.onclick = function () { run(S.page + 1); };
      strip.appendChild(m);
    }
  }

  function note(text, label, fn) {
    const n = SB.el('div', 'stock-note');
    n.appendChild(SB.el('div', null, text));
    if (label) {
      const b = SB.el('button', 'mini', label);
      b.onclick = fn;
      n.appendChild(b);
    }
    return n;
  }

  function tile(a) {
    const t = SB.el('div', 'stock-tile' + (S.chosen && S.chosen.id === a.id ? ' on' : ''));
    t.draggable = true;
    t.dataset.id = a.id;

    const img = document.createElement('img');
    img.src = a.thumb || a.preview || a.comp;
    img.alt = a.title || a.id;
    img.draggable = false;                 // the TILE is the drag, not the <img>
    t.appendChild(img);

    if (a.editorialOnly) {
      const e = SB.el('span', 'stock-flag', '✎ editorial only');
      e.title = 'Licensed for editorial use only — not for a commercial client video.';
      t.appendChild(e);
    }

    const cap = SB.el('div', 'stock-cap');
    cap.appendChild(SB.el('span', 'stock-artist', a.artist || a.collection || a.id));
    t.appendChild(cap);

    t.addEventListener('mouseenter', function () { choose(a); });
    t.addEventListener('focus', function () { choose(a); });
    t.addEventListener('click', function () { choose(a); });
    t.tabIndex = 0;

    t.addEventListener('dragstart', function (ev) {
      const dt = ev.dataTransfer;
      dt.effectAllowed = 'copy';
      /* The asset, for the licence trail… */
      dt.setData(SB.Board.DND_STOCK, JSON.stringify({
        id: a.id, title: a.title, caption: a.caption, artist: a.artist,
        collection: a.collection, family: a.family, license: a.license,
        link: a.link, comp: a.comp, preview: a.preview, thumb: a.thumb
      }));
      /* …and the plain URL, which every drop path in the app already reads, so
         the picture lands even where nothing knows about Getty. */
      if (a.comp) {
        dt.setData('text/uri-list', a.comp);
        dt.setData('text/plain', a.comp);
      }
      try { dt.setDragImage(img, Math.min(80, img.width / 2), 40); } catch (e) { }
      document.body.classList.add('stock-dragging');
      choose(a);
    });
    t.addEventListener('dragend', function () {
      document.body.classList.remove('stock-dragging');
    });

    return t;
  }

  function choose(a) {
    if (S.chosen && S.chosen.id === a.id) return;
    S.chosen = a;
    if (S.stripEl) {
      S.stripEl.querySelectorAll('.stock-tile').forEach(function (el) {
        el.classList.toggle('on', el.dataset.id === a.id);
      });
    }
    drawJudge();
  }

  /* ---------------- the judging pane ----------------
   *
   * Thumbs are what you scan; the comp is what you decide on. Deciding from a
   * 170px thumb is how the wrong picture gets onto a board, and the comp is
   * already paid for by looking at it, so it costs nothing but a fetch.
   */
  function drawJudge() {
    if (!S.judgeEl) return;
    const j = S.judgeEl;
    j.textContent = '';
    const a = S.chosen;
    if (!a) { j.classList.add('empty'); return; }
    j.classList.remove('empty');

    const im = document.createElement('img');
    im.src = a.preview || a.comp || a.thumb;
    im.alt = a.title || a.id;
    j.appendChild(im);

    const meta = SB.el('div', 'stock-meta');
    meta.appendChild(SB.el('div', 'stock-meta-title', a.title || a.caption || a.id));
    const line = [a.artist, a.collection, a.family].filter(Boolean).join(' · ');
    meta.appendChild(SB.el('div', 'stock-meta-sub', line));
    meta.appendChild(SB.el('div', 'stock-meta-sub', a.id + (a.license ? ' · ' + a.license : '')));
    j.appendChild(meta);

    const row = SB.el('div', 'stock-acts');
    const f = shot();
    const use = SB.el('button', 'mini primary', f ? 'Use on ' + f.code : 'Use as frame');
    use.disabled = !f;
    use.title = f ? 'Put this comp on ' + f.code + ' (its current frame banks as a take)'
      : 'Select a card first — or just drag the picture onto one';
    use.onclick = function () {
      if (!f) return;
      use.disabled = true;
      use.textContent = 'placing…';
      SB.Board.placeStock(f.shot, a).then(function () {
        use.textContent = 'Use on ' + f.code;
        use.disabled = false;
      });
    };
    row.appendChild(use);

    const like = SB.el('button', 'mini', 'more like this');
    like.onclick = function () { moreLikeThis(a); };
    row.appendChild(like);

    if (a.link) {
      const go = SB.el('button', 'mini', 'on gettyimages ↗');
      go.onclick = function () { window.open(a.link, '_blank', 'noopener'); };
      row.appendChild(go);
    }
    j.appendChild(row);

    j.appendChild(SB.el('div', 'stock-legal',
      'Comp — layout and proofing only, for ' + SB.Model.COMP_DAYS + ' days. ' +
      'The watermark stays on, and it is never handed to a model.'));
  }

  /* ---------------- dragging onto a board that has scrolled away ----------
   *
   * With the drawer open the card you want is often above the fold, and a
   * browser will not scroll a custom drag for you. So the board scrolls itself
   * while something is being dragged over its edges.
   */
  function edgeScroll(ev) {
    const panel = document.getElementById('boardPanel');
    if (!panel || !document.body.classList.contains('stock-dragging')) return;
    const r = panel.getBoundingClientRect();
    const edge = 60;
    if (ev.clientY < r.top + edge) panel.scrollTop -= 18;
    else if (ev.clientY > r.bottom - edge) panel.scrollTop += 18;
  }
  document.addEventListener('dragover', edgeScroll);

  SB.Stock = {
    open: open, close: close, toggle: toggle, isOpen: isOpen, sync: sync,
    /* app.js calls this once on boot: the drawer reopens where it was left */
    restore: function () { if (ls(K_OPEN) === '1') open(); },
    /* tests reach in for the search state rather than scraping the DOM */
    _state: S
  };

})(window.SB);
