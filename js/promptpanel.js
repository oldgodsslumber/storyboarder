/* promptpanel.js — the prompt table.
 *
 * A board is made one card at a time; prompts are written a whole film at a
 * time. Doing that on the cards means scrolling a wall of pictures to find the
 * three shots that have no video prompt yet, and editing a paragraph in a box
 * the width of a thumbnail. So this is a table: one row per shot, the columns
 * being the four things that matter at this stage — what it is, what it says,
 * the two prompts, and which pictures go with it.
 *
 * It is the same data as the cards. Editing here edits the board; the boxes are
 * simply the right shape for the job, and the filters (missing, stale, this
 * scene) turn "what is left to do" into a list you can act on.
 */
(function (SB) {
  'use strict';

  let root = null;
  let bodyEl, statusEl, usageEl, limitEl, headEl;
  let filter = 'all';
  /* Which rows the filter let through when it was CHOSEN.
   *
   * The filter used to be re-applied on every render, and a render happens
   * whenever anything lands — a clip, a written prompt, a frame. So the row
   * most likely to stop matching was the one being worked in: type the last
   * missing prompt of a card by hand, have a clip land on another card
   * mid-sentence, and the row under the caret was gone, with the rest of the
   * sentence going nowhere and no way to tell where it went.
   *
   * A filter is a way of choosing what to work on, not a rule the table has to
   * keep obeying while you work. So it is applied when it is picked, and what
   * it let through stays until it is picked again. Anything that newly matches
   * still appears — that is the filter doing its job — nothing is taken away.
   */
  let pinned = null;
  /* A push runs for minutes and this table re-renders on every keystroke, so
     nothing about a running job is kept here — it is read back out of
     SB.Imagine each time something is painted. These two only say that the
     panel is listening. */
  let unwatch = null;
  let ticker = null;

  function P() { return SB.app.project; }

  function init() { /* built on open */ }

  /* ---------------------------------------------------------------- shell */

  function open() {
    if (root) { render(); return; }
    root = SB.el('div', 'lib-back');
    const box = SB.el('div', 'lib');
    headEl = SB.el('header', 'lib-head');
    box.appendChild(headEl);
    bodyEl = SB.el('section', 'pt-body');
    box.appendChild(bodyEl);
    root.appendChild(box);
    root.addEventListener('mousedown', function (ev) { if (ev.target === root) close(); });
    document.addEventListener('keydown', onKey);
    document.getElementById('modalRoot').appendChild(root);
    document.getElementById('btnPrompts').classList.add('on');
    watchJobs();
    pinFilter();
    render();
  }

  /* Repaint just the push buttons: once a second so the elapsed time on a
     running job moves, and whenever a job starts, finishes or fails. A full
     render() would throw away whatever textarea has the caret in it. */
  let unwatchWriting = null;

  function watchJobs() {
    /* a prompt being written is not an ImagineArt job, and it can start and
       end from the card as well as from this table */
    unwatchWriting = SB.Prompts.onWriting(paintGens);
    if (!SB.Imagine) return;
    unwatch = SB.Imagine.onChange(paintPushes);
    ticker = setInterval(paintPushes, 1000);
  }

  function stopWatching() {
    if (unwatch) { unwatch(); unwatch = null; }
    if (unwatchWriting) { unwatchWriting(); unwatchWriting = null; }
    if (ticker) { clearInterval(ticker); ticker = null; }
  }

  function onKey(e) {
    if (e.key !== 'Escape' || !root) return;
    if (document.querySelector('.modal-back')) return;
    if (document.querySelector('.lib-pop') || document.querySelector('.men-pop')) return;
    /* Another takeover may be sitting on top of this one; whatever is last in
       the root is the one in front, and only it should answer. */
    const backs = document.querySelectorAll('#modalRoot .lib-back');
    if (backs.length && backs[backs.length - 1] !== root) return;
    close();
  }

  function close() {
    if (!root) return;
    stopWatching();
    root.remove();
    root = null;
    bodyEl = statusEl = usageEl = limitEl = headEl = null;
    document.removeEventListener('keydown', onKey);
    document.getElementById('btnPrompts').classList.remove('on');
  }

  function toggle() { root ? close() : open(); }
  function isOpen() { return !!root; }
  function refresh() { if (root) render(); }

  /* Called from app.changed(): the board moved under the table. */
  function follow() { if (root) render(); }

  function setStatus(txt, isErr) {
    if (!statusEl) return;
    statusEl.textContent = txt || '';
    /* the line is one row and ellipsised, and errors are the longest thing it
       ever holds — so the whole of it is on the hover */
    statusEl.title = txt || '';
    statusEl.classList.toggle('err', !!isErr);
  }

  /* ---------------------------------------------------------------- rows */

  /* Every shot on the board, with the scene it belongs to and its code, in the
   * order it plays. "no shot" cards come too — they are part of the film, and
   * the table is where you notice one is still marked that way. */
  function allRows() {
    const p = P();
    const out = [];
    p.scenes.forEach(function (sc, si) {
      sc.shots.forEach(function (sh, sj) {
        out.push({ shot: sh, scene: sc, si: si, sj: sj, code: SB.Model.code(si, sj) });
      });
    });
    return out;
  }

  function isMissing(r, im, vm) {
    return missingCount(r, im, vm) > 0;
  }

  /* How many prompts this row still needs. Counting rows meant the number did
   * not move when you finished one of a row's two prompts — on the one screen
   * whose job is "what is left to do". */
  function missingCount(r, im, vm) {
    if (r.shot.noShot) return 0;
    const pi = im && r.shot.prompts[im.id];
    const pv = vm && r.shot.prompts[vm.id];
    let n = 0;
    if (im && !(pi && pi.imagePrompt)) n++;
    if (vm && !(pv && pv.videoPrompt)) n++;
    return n;
  }

  function isStale(r, im, vm) {
    const one = function (m, field) {
      const pr = m && r.shot.prompts[m.id];
      return !!(pr && pr[field] && SB.Personas.staleFor(P(), r.shot, pr.at));
    };
    return one(im, 'imagePrompt') || one(vm, 'videoPrompt');
  }

  function matches(r, im, vm) {
    if (filter === 'missing') return isMissing(r, im, vm);
    if (filter === 'stale') return isStale(r, im, vm);
    if (filter === 'scene') return r.scene.id === SB.app.selectedSceneId;
    return true;
  }

  /* Take the filter's word for it, now. Everything it lets through is kept
     until somebody asks again. */
  function pinFilter() {
    const im = SB.Model.imageModel(P()), vm = SB.Model.videoModel(P());
    pinned = {};
    allRows().forEach(function (r) {
      if (matches(r, im, vm)) pinned[r.shot.id] = 1;
    });
  }

  /* What is on screen: what the filter let through when it was chosen, plus
     anything that has come to match since. Never less.
   *
   * "Never less" has to include the ones that arrived AFTER the pin. A row
   * that newly matched was shown but never pinned, so the first time it
   * stopped matching it was deleted -- and the row that newly matches is
   * exactly the one being worked on. Add a card, write its last missing
   * prompt by hand, have anything land: the row went, mid-sentence, with the
   * rest of what was typed. That is the bug this pinning exists to prevent,
   * and it was still live on the rows most likely to hit it.
   *
   * So being on screen is what pins a row, not being on screen at one
   * particular moment. */
  function visible(im, vm) {
    const rows = allRows();
    if (filter === 'all') return rows;
    if (!pinned) pinFilter();
    return rows.filter(function (r) {
      if (pinned[r.shot.id]) return true;
      if (!matches(r, im, vm)) return false;
      pinned[r.shot.id] = 1;
      return true;
    });
  }

  /* A row still on screen because it was being worked on when it stopped
     matching — which is worth saying, or the filter looks broken. */
  function settled(r, im, vm) {
    return filter !== 'all' && !matches(r, im, vm);
  }

  /* --------------------------------------------------------------- header */

  function modelSelect(role) {
    const p = P();
    const sel = document.createElement('select');
    sel.className = 'pt-model';
    sel.title = role === 'image' ? 'Which model the first-frame prompts are written for'
      : 'Which model the image→video prompts are written for';
    const none = document.createElement('option');
    none.value = ''; none.textContent = role === 'image' ? '(no image model)' : '(no video model)';
    sel.appendChild(none);
    [['image', 'Image models'], ['video', 'Video models']].forEach(function (g) {
      const list = p.settings.models.filter(function (m) { return m.kind === g[0]; });
      if (!list.length) return;
      const og = document.createElement('optgroup');
      og.label = g[1];
      list.forEach(function (m) {
        const o = document.createElement('option');
        o.value = m.id; o.textContent = m.name;
        if (m.id === (role === 'image' ? p.settings.imageModelId : p.settings.videoModelId)) {
          o.selected = true;
        }
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
    sel.addEventListener('change', function () {
      if (role === 'image') p.settings.imageModelId = sel.value;
      else p.settings.videoModelId = sel.value;
      SB.app.changed(true);            // the cards relabel to the new model
      render();
    });
    return sel;
  }

  /* Two rows on purpose: what you are looking at, then what you are working
   * with. Crammed into one they wrapped unpredictably as the model names
   * changed length, and the close button ended up beside the run button. */
  function head(im, vm, rows) {
    headEl.innerHTML = '';
    const r1 = SB.el('div', 'pt-hrow');
    const r2 = SB.el('div', 'pt-hrow pt-hrow2');
    headEl.appendChild(r1);
    headEl.appendChild(r2);

    r1.appendChild(SB.el('h2', null, 'Prompts'));

    const tabs = SB.el('div', 'lib-tabs');
    const all = allRows();
    const counts = {
      all: all.length,
      /* prompts left to write, not rows with something left */
      missing: all.reduce(function (n, r) { return n + missingCount(r, im, vm); }, 0),
      stale: all.filter(function (r) { return isStale(r, im, vm); }).length,
      scene: all.filter(function (r) { return r.scene.id === SB.app.selectedSceneId; }).length
    };
    /* Every count is shown, zero included: "Missing" with the number left off
       reads as "not counted", and none-left-to-do is the one moment this screen
       most wants to say a number. */
    [['all', 'All'], ['missing', 'Missing'], ['stale', 'Stale'],
    ['scene', 'This scene']].forEach(function (t) {
      const b = SB.el('button', 'tb toggle' + (filter === t[0] ? ' on' : ''),
        t[1] + ' ' + counts[t[0]]);
      b.onclick = function () {
        filter = t[0];
        pinFilter();              // re-picking a filter is how you re-narrow it
        render();
      };
      tabs.appendChild(b);
    });
    r1.appendChild(tabs);
    r1.appendChild(SB.el('span', 'spacer'));

    const x = SB.el('button', 'tb lib-x', '✕');
    x.title = 'Close (Esc)';
    x.onclick = close;
    r1.appendChild(x);

    r2.appendChild(modelSelect('image'));
    r2.appendChild(modelSelect('video'));

    /* The provider switch is a working decision — quota gone, offline, a draft
       not worth spending calls on — so it stays one click away, not in a modal. */
    const provWrap = SB.el('div', 'prov-pick pt-prov');
    SB.Providers.list().forEach(function (prov) {
      const b = SB.el('button', 'tb toggle' + (prov.id === SB.Providers.activeId() ? ' on' : ''),
        prov.id === 'gemini' ? 'Gemini' : 'Local');
      b.title = prov.label;
      b.onclick = function () { SB.Providers.setActive(prov.id); SB.app.changed(true); render(); };
      provWrap.appendChild(b);
    });
    r2.appendChild(provWrap);

    r2.appendChild(usageBit());

    /* Whether the cards carry their prompt boxes as well. Off by default so the
       board stays a board; this is the screen where you would change it. */
    const onCards = SB.el('div', 'pt-oncards');
    onCards.appendChild(SB.el('span', 'l', 'on cards'));
    [['showImagePrompt', 'first frame'], ['showVideoPrompt', 'video']].forEach(function (k) {
      const l = SB.el('label', 'pp-toggle');
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.checked = !!P().settings[k[0]];
      c.dataset.setting = k[0];
      c.addEventListener('change', function () {
        P().settings[k[0]] = c.checked;
        SB.app.changed(true);
      });
      l.appendChild(c);
      l.appendChild(document.createTextNode(' ' + k[1]));
      onCards.appendChild(l);
    });
    r2.appendChild(onCards);

    r2.appendChild(SB.el('span', 'spacer'));

    r2.appendChild(readyChip(rows, im, vm));
    r2.appendChild(accountChip());

    const acts = SB.el('div', 'pt-acts');
    statusEl = SB.el('span', 'pt-status');
    acts.appendChild(statusEl);
    r2.appendChild(acts);
  }

  /* Who the pushes are billed to, in the one place they are pressed. Also the
     way in to fix it, because "not signed in" with nowhere to click is just a
     complaint. */
  /* How much of the board could actually be pushed right now. Without this
     the answer is "hover thirty buttons". */
  function readyChip(rows, im, vm) {
    const el = SB.el('span', 'pt-ready');
    if (!SB.Imagine) return el;
    let ri = 0, rv = 0, ni = 0, nv = 0;
    rows.forEach(function (r) {
      if (im) { ni++; if (!pushBlock(r.shot, im, 'image')) ri++; }
      if (vm) { nv++; if (!pushBlock(r.shot, vm, 'video')) rv++; }
    });
    el.textContent = '▶ ' + ri + '/' + ni + ' frames · ' + rv + '/' + nv + ' clips';
    el.title = 'How many of these rows can be pushed as they stand. A row needs a prompt ' +
      'written for the model named above its column — prompts are kept per model.';
    el.classList.toggle('none', !ri && !rv);
    return el;
  }

  let acctEl = null;

  function accountChip() {
    acctEl = SB.el('button', 'tb pt-acct', '');
    acctEl.onclick = function () { SB.Settings.open('imagine'); };
    paintAccount();
    return acctEl;
  }

  function paintAccount() {
    if (!acctEl || !SB.Imagine) return;
    const IM = SB.Imagine;
    if (IM.transport() === 'key') {
      const has = !!IM.apiKey();
      acctEl.textContent = has ? 'Imagine · API key' : 'Imagine · no key';
      acctEl.classList.toggle('warn', !has);
      acctEl.title = has
        ? 'Pushes are billed to the ImagineArt API key in this browser.'
        : 'No ImagineArt API key yet — click to add one.';
      return;
    }
    const a = IM.account();
    if (!IM.isSignedIn()) {
      acctEl.textContent = 'Imagine · sign in';
      acctEl.classList.add('warn');
      acctEl.title = 'Not signed in to ImagineArt — click to sign in.';
      return;
    }
    acctEl.classList.remove('warn');
    const cr = a && typeof a.credits === 'number' ? ' · ' + a.credits : '';
    acctEl.textContent = 'Imagine' + cr;
    acctEl.title = ((a && a.email) || 'signed in') +
      (cr ? ' — ' + a.credits + ' credits left' : '') + '. Click for settings.';
  }

  /* the quota readout, kept because a run of thirty rows is where it matters */
  function usageBit() {
    const p = P();
    const wrap = SB.el('span', 'pt-usage-wrap');
    if (SB.Providers.activeId() !== 'gemini') {
      usageEl = null; limitEl = null;
      const o = SB.Store.getOoba();
      wrap.appendChild(SB.el('span', 'pp-usage', o.model || 'local model'));
      return wrap;
    }
    const pick = SB.GeminiModels.picker(p.settings.geminiModel, function (id) {
      p.settings.geminiModel = id || SB.GeminiModels.DEFAULT;
      SB.Store.touch();
      refreshUsage();
    });
    pick.el.classList.add('pt-gm');
    wrap.appendChild(pick.el);
    usageEl = SB.el('span', 'pp-usage');
    wrap.appendChild(usageEl);
    limitEl = document.createElement('input');
    limitEl.type = 'number';
    limitEl.min = '0';
    limitEl.className = 'pp-limit';
    limitEl.title = 'Your free-tier requests per day for this model. Blank = just count.';
    limitEl.placeholder = 'limit';
    limitEl.addEventListener('change', function () {
      SB.GeminiModels.setLimit(p.settings.geminiModel, parseInt(limitEl.value, 10) || 0);
      refreshUsage();
    });
    wrap.appendChild(limitEl);
    return wrap;
  }

  function refreshUsage() {
    if (!usageEl || !P()) return;
    if (SB.Providers.activeId() !== 'gemini') return;   // local runs have no allowance
    const id = P().settings.geminiModel;
    usageEl.textContent = SB.GeminiModels.usageText(id);
    usageEl.classList.toggle('spent', SB.GeminiModels.remaining(id) === 0);
    if (limitEl && document.activeElement !== limitEl) {
      const lim = SB.GeminiModels.limit(id);
      limitEl.value = lim ? lim : '';
    }
  }

  /* ---------------------------------------------------------------- table */

  /* Rebuilt from nothing, like the board — so the caret goes back where it
     was rather than to <body>. */
  function render() { SB.Focus.keep(renderNow); }

  function renderNow() {
    if (!root || !P()) return;
    const p = P();
    const im = SB.Model.imageModel(p), vm = SB.Model.videoModel(p);
    const rows = visible(im, vm);
    head(im, vm, rows);
    refreshUsage();

    bodyEl.innerHTML = '';

    const grid = SB.el('div', 'pt-grid');
    const hdr = SB.el('div', 'pt-head-row');
    ['Shot', 'Description', 'First frame' + (im ? ' · ' + im.name : ''),
      'Video' + (vm ? ' · ' + vm.name : ''), 'Feed'].forEach(function (t) {
        hdr.appendChild(SB.el('div', 'pt-h', t));
      });
    grid.appendChild(hdr);

    if (!rows.length) {
      grid.appendChild(SB.el('div', 'pt-empty',
        filter === 'missing' ? 'Every shot in this board has both its prompts.'
          : filter === 'stale' ? 'No prompt has fallen behind its cast.'
            : filter === 'scene'
              ? (SB.app.selectedSceneId
                ? 'That scene has no shots yet.'
                : 'No scene is selected — pick one on the board or in the scene list.')
              : 'No shots yet.'));
    }

    let lastScene = null;
    rows.forEach(function (r) {
      if (r.scene.id !== lastScene) {
        lastScene = r.scene.id;
        const band = SB.el('div', 'pt-scene');
        band.appendChild(SB.el('span', 'n', 'Scene ' + (r.si + 1)));
        band.appendChild(SB.el('span', 't', r.scene.heading || '(untitled)'));
        grid.appendChild(band);
      }
      grid.appendChild(rowEl(r, im, vm));
    });
    bodyEl.appendChild(grid);

    const ready = SB.Providers.active().ready();
    if (!ready) setStatus(SB.Providers.active().notReady(), true);
  }

  function rowEl(r, im, vm) {
    const sh = r.shot;
    const row = SB.el('div', 'pt-row' + (sh.noShot ? ' noshot' : '') +
      (sh.video && sh.video.unseen ? ' fresh' : '') +
      (settled(r, im, vm) ? ' settled' : ''));
    row.dataset.shot = sh.id;

    /* ---- what it is ---- */
    const c1 = SB.el('div', 'pt-cell pt-shot');
    const line = SB.el('div', 'pt-code-line');
    line.appendChild(SB.el('span', 'code', r.code));
    if (sh.render && sh.render.serial) {
      const full = SB.Renders.has(P(), sh.render);
      const ser = SB.el('span', 'code-serial' + (full ? '' : ' none'),
        SB.Renders.pad(sh.render.serial));
      ser.title = full
        ? 'Full-size original in this file, exports as ' +
          SB.Renders.fileName(sh.render.serial, sh.render.ext)
        : 'This number is all that is left: the original is not in this file. Drop the ' +
          'picture in again to bring it with you.';
      line.appendChild(ser);
    }
    if (settled(r, im, vm)) {
      const d = SB.el('span', 'badge done', 'done');
      d.title = 'This one no longer matches the filter \u2014 it is kept on screen because it ' +
        'was on screen. Click the filter again to narrow the list.';
      line.appendChild(d);
    }
    c1.appendChild(line);

    const thumb = SB.el('div', 'pt-thumb');
    if (sh.image) {
      const im2 = document.createElement('img');
      im2.src = SB.Blobs.src(P(), sh.image);
      thumb.appendChild(im2);
    } else {
      thumb.classList.add('none');
      thumb.textContent = 'not rendered';
    }
    thumb.title = 'Show this card on the board';
    thumb.onclick = function () {
      close();
      SB.Board.select(sh.id);
      const el = document.querySelector('.card[data-shot="' + sh.id + '"]');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    c1.appendChild(thumb);
    c1.appendChild(SB.el('div', 'pt-type' + (sh.noShot ? ' noshot' : ''),
      sh.noShot ? 'no shot' + (sh.type ? ' · ' + sh.type : '') : (sh.type || '—')));
    /* the same badge the card carries, on the screen where the prompts are
       actually read — this is where a wrong shot type is noticed */
    c1.appendChild(SB.Board.framingHost(sh));
    row.appendChild(c1);

    /* ---- what it says ---- */
    const c2 = SB.el('div', 'pt-cell');
    const desc = SB.el('div', 'pt-desc');
    desc.dataset.shot = sh.id;
    SB.RefBox.attach(desc, {
      get: function () { return sh.description || ''; },
      set: function (t) {
        sh.description = t;
        SB.Store.touch();
        SB.Board.refreshCastRows();
        SB.Board.refreshFraming(sh.id);
        refreshFeedCell(sh.id);
        paintGens();          // a description is the thing "generate" waits for
      },
      placeholder: 'What we see. @ anything the model should be shown.',
      ctx: { shot: sh, code: r.code }
    });
    c2.appendChild(desc);
    row.appendChild(c2);

    /* ---- the two prompts ---- */
    row.appendChild(promptCell(sh, im, 'imagePrompt'));
    row.appendChild(promptCell(sh, vm, 'videoPrompt'));

    /* ---- what goes in with it ---- */
    const c5 = SB.el('div', 'pt-cell pt-feed');
    c5.dataset.feedCell = sh.id;
    c5.appendChild(feedList(sh, r.code));
    row.appendChild(c5);

    return row;
  }

  /* The box comes first in every column, so the three of them start on the same
   * line. With the badges and the generate button above it, the two prompt
   * boxes sat a row lower than the description beside them and the whole table
   * read as if it were out of register. Everything that acts on a prompt now
   * sits under it, which is also the order you use it in: read, then act. */
  function code(sh) {
    const f = SB.Model.findShot(P(), sh.id);
    return f ? f.code : 'this shot';
  }

  /* ------------------------------------------------------------ pushing
   *
   * The row already holds everything a generation needs: the prompt, the model
   * it was written for, and (for a clip) the full-size frame the shot already
   * has. So this is one button, and one press is one generation — never a
   * batch, never automatic, and never while the same one is already running.
   */
  function roleOf(field) { return field === 'imagePrompt' ? 'image' : 'video'; }

  function pushBtn(sh, m, field, note) {
    const IM = SB.Imagine;
    if (!IM) return null;
    const role = roleOf(field);
    const b = SB.Focus.costly(SB.el('button', 'mini push'));
    /* held on the button: paintPush runs once before either is in the
       document, and a parentNode lookup would find nothing */
    b.__why = note || null;
    b.dataset.push = sh.id + ':' + role;
    b.onclick = function () {
      if (IM.busy(sh.id, role)) return;
      /* A clip asks once per session what it will cost, wherever the push
         was started from — this button or the clip review. */
      if (role === 'video') {
        SB.Clip.confirmCost(P(), sh, m, function () { go(); });
        return;
      }
      go();
    };

    function go() {
      IM.clear(sh.id, role);
      paintPushes();
      IM.run(sh, role).then(function (out) {
        if (!out) return;
        setStatus('');
        if (out.remoteOnly) {
          SB.toast('Clip made, but its bytes could not be read back — the board is holding a ' +
            'link, and links expire', true, {
            action: {
              label: 'Try again',
              onClick: function () {
                SB.Imagine.fetchClip(sh).then(function (ok) {
                  SB.toast(ok ? 'Clip is in the board now' : 'Nothing to fetch');
                  render();
                }).catch(function (e2) { SB.toast(e2.message, true); });
              }
            }
          });
        } else {
          SB.toast(out.kind === 'video' ? 'Clip saved into the board' : 'Frame updated');
        }
        /* The picture or the clip is new, so the row itself has changed --
           but this lands minutes after the button was pressed, so it waits for
           a gap in the typing the way the generate handler does rather than
           rebuilding the table under somebody's caret. */
        SB.Focus.defer('promptpanel', render);
      }).catch(function (e) {
        /* The reason stays on the button until the next press: the job registry
           is the only place it is written down. */
        paintPushes();
        SB.toast(e.message, true);
      });
    }
    paintPush(b, sh, m, role);
    return b;
  }

  /* Why this row cannot be pushed, in the fewest words that are still an
     instruction — answered by SB.Imagine, because the clip review asks the
     same question and one wording is better than two. */
  function pushBlock(sh, m, role) {
    return SB.Imagine.whyNot(P(), sh, m, role);
  }

  /* What this press will spend, and how much that figure is worth. A
     measured number came from the account's own balance either side of a
     real generation; a published one is ImagineArt's base price, and a floor
     for anything longer or larger. Kept apart, because they are not the same
     claim. */
  function priceOf(m, role) {
    if (!SB.Imagine || !m) return null;
    const slug = SB.Imagine.slugOf(m);
    if (!slug) return null;
    const res = SB.Imagine.resolutionFor(P(), slug, role);
    const c = SB.Imagine.costFor(slug, '', res);
    if (!c) return { res: res };
    return { res: res, credits: c.credits, from: c.from, note: c.note };
  }

  function priceLine(m, role) {
    const pr = priceOf(m, role);
    if (!pr) return '';
    const bits = [];
    if (pr.res) bits.push('at ' + pr.res);
    if (pr.credits) {
      bits.push(pr.from === 'measured'
        ? 'about ' + pr.credits + ' credits, which is what it cost last time'
        : 'about ' + pr.credits + ' credits (' + (pr.note || 'published base price') + ')');
    }
    return bits.length ? '\n' + bits.join(' \u00b7 ') : '';
  }


  function paintPush(b, sh, m, role) {
    const IM = SB.Imagine;
    const job = IM.job(sh.id, role);
    const noun = role === 'image' ? 'render' : 'shoot';
    if (job && (job.state === 'working' || job.state === 'waiting')) {
      const secs = Math.round((Date.now() - job.started) / 1000);
      b.textContent = (job.state === 'waiting' ? 'waiting ' : 'sending ') +
        Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
      b.disabled = true;
      b.classList.add('running');
      b.classList.remove('failed');
      b.title = 'ImagineArt is working on this one. Closing this panel does not stop it.';
      return;
    }
    b.classList.remove('running');
    b.classList.toggle('failed', !!(job && job.state === 'error'));
    b.textContent = (job && job.state === 'error' ? '\u21ba retry' : '\u25b6 ' + noun);
    const block = pushBlock(sh, m, role);
    b.disabled = !!block;
    /* The reason sits beside the button, not only in a tooltip — a button
       that is dark in half the rows and says nothing about it reads as
       broken. */
    const note = b.__why || (b.parentNode && b.parentNode.querySelector('.push-why'));
    if (note) {
      note.textContent = block ? block.short : '';
      note.title = block ? block.long : '';
      note.style.display = block ? '' : 'none';
    }
    if (job && job.state === 'error') {
      b.title = job.error + ' — press to try again.';
    } else if (block) {
      b.title = block.long;
    } else if (role === 'video') {
      b.title = (sh.render || sh.image
        ? 'Animate this shot’s own frame with the prompt above.'
        : 'No frame on this card yet, so this is text-to-video.') + priceLine(m, role);
    } else {
      b.title = 'Make this frame on ImagineArt and put it on the card.' + priceLine(m, role);
    }
  }

  /* In place, without re-rendering: a running job ticks every second and the
     boxes around it must keep their text and their caret. */
  /* Which rows have a clip nobody has watched yet. A class on the row, toggled
     where it stands — a rebuild would be both wasteful and, if a box in the
     table has the caret, rude. Runs on the same beat as the push buttons, so a
     clip landing lights its row within the second and watching it puts the row
     back. */
  function paintFresh() {
    bodyEl.querySelectorAll('.pt-row[data-shot]').forEach(function (row) {
      const f = SB.Model.findShot(P(), row.dataset.shot);
      row.classList.toggle('fresh', !!(f && f.shot.video && f.shot.video.unseen));
    });
  }

  function paintPushes() {
    if (!root || !P() || !SB.Imagine) return;
    const p = P();
    const im = SB.Model.imageModel(p), vm = SB.Model.videoModel(p);
    bodyEl.querySelectorAll('[data-push]').forEach(function (b) {
      const bits = b.dataset.push.split(':');
      const f = SB.Model.findShot(p, bits[0]);
      const m = bits[1] === 'image' ? im : vm;
      if (!f || !m) return;
      paintPush(b, f.shot, m, bits[1]);
    });
    paintFresh();
    paintGens();
    paintAccount();
  }

  /* Whether a prompt can be written, and why not — repainted where it stands.
   *
   * This was decided once, when the row was built, out of a description that
   * the box three cells to the left can change at any moment. Typing a
   * description into a card that had none therefore left "✦ generate"
   * disabled until the panel was closed and opened again, which is a render by
   * another name.
   *
   * The panel's own description box does not call app.changed() — that would
   * rebuild the table under the caret — so the repaint has to be this one:
   * in place, on the same beat as the push buttons. */
  function paintGen(b, sh, field) {
    if (SB.Prompts.writing(sh.id, field)) {
      b.disabled = true;
      b.textContent = '\u2026';
      b.title = 'Writing this one now.';
      return;
    }
    b.textContent = '\u2726 generate';
    const hasDesc = !!(sh.description || '').trim();
    b.disabled = !!sh.noShot || !hasDesc;
    const m = field === 'imagePrompt' ? SB.Model.imageModel(P()) : SB.Model.videoModel(P());
    const already = m && ((sh.prompts || {})[m.id] || {})[field];
    b.title = sh.noShot
      ? 'A \u201cno shot\u201d card never generates'
      : !hasDesc
        ? 'Write a description first \u2014 there is nothing for the writer to work from'
        : already
          ? 'Write this one again, replacing what is there'
          : 'Write this prompt from the description';
  }

  function paintGens() {
    if (!root || !P() || !bodyEl) return;
    bodyEl.querySelectorAll('[data-gen]').forEach(function (b) {
      const bits = b.dataset.gen.split(':');
      const f = SB.Model.findShot(P(), bits[0]);
      if (f) paintGen(b, f.shot, bits[1]);
    });
  }

  function promptCell(sh, m, field) {
    const cell = SB.el('div', 'pt-cell pt-prompt');
    if (!m) {
      cell.appendChild(SB.el('div', 'pt-none', 'no model chosen'));
      return cell;
    }
    const pr = sh.prompts[m.id] || null;

    const ta = document.createElement('textarea');
    ta.className = 'pt-text';
    /* Named, so that a rebuild can find this exact box again and give the
       caret back to it rather than to the page. */
    ta.dataset.shot = sh.id;
    ta.dataset.model = m.id;
    ta.dataset.field = field;
    ta.value = (pr && pr[field]) || '';
    ta.placeholder = sh.noShot ? '(\u201cno shot\u201d \u2014 never generated)' : 'not generated yet';
    ta.addEventListener('input', function () {
      sh.prompts[m.id] = sh.prompts[m.id] || { imagePrompt: '', videoPrompt: '', modelName: m.name };
      sh.prompts[m.id][field] = ta.value;
      sh.prompts[m.id].modelName = m.name;
      /* Editing by hand is the user restating the prompt as it should read now,
         so it stops being behind the cast. */
      sh.prompts[m.id].at = Date.now();
      /* Editing by hand answers the camera-move flag, whatever it now says */
      delete sh.prompts[m.id].moved;
      delete sh.prompts[m.id].gendered;
      const mvb = cell.querySelector('.moved');
      if (mvb) mvb.remove();
      const gbb = cell.querySelector('.gendered');
      if (gbb) gbb.remove();
      SB.Store.touch();
      SB.Board.refreshPromptStale();
    });
    cell.appendChild(ta);

    const foot = SB.el('div', 'pt-foot');

    if (pr && pr[field] && SB.Personas.staleFor(P(), sh, pr.at)) {
      const b = SB.el('span', 'badge warn stale', 'cast changed');
      b.title = 'Something on this card was edited after this prompt was written.';
      foot.appendChild(b);
    }

    /* Gender decided for somebody nobody cast, kept through its one rewrite. */
    if (pr && pr[field] && Array.isArray(pr.gendered) && pr.gendered.length) {
      const b = SB.el('span', 'badge warn gendered', 'gendered');
      b.title = 'This prompt decides someone\u2019s gender — "' + pr.gendered.join('", "') +
        '" — for a person the board has not cast. Edit them out, or cast that person.';
      foot.appendChild(b);
    }

    /* A move the writer put in and then kept through its one rewrite. */
    if (field === 'videoPrompt' && pr && Array.isArray(pr.moved) && pr.moved.length) {
      const b = SB.el('span', 'badge warn moved', 'camera move');
      b.title = 'This prompt moves the camera — "' + pr.moved.join('", "') + '" — and nothing ' +
        'in the description asked for one. Edit it out, or write the move you want into the ' +
        'description and generate again.';
      foot.appendChild(b);
    }

    const copy = SB.el('button', 'mini', 'copy');
    copy.disabled = !ta.value;
    copy.onclick = function () {
      navigator.clipboard.writeText(ta.value || '').then(function () {
        SB.toast('Prompt copied');
      }).catch(function () { SB.toast('Could not copy', true); });
    };
    foot.appendChild(copy);

    /* The clip this row already has, if any — the one place it can be played
       back without going and finding it. */
    /* One clip control per row, as on every card: it is the way IN to a clip
       as well as the way to watch one, so a row with none needs it most. */
    if (field === 'videoPrompt') {
      const has = !!sh.video;
      const play = SB.el('button', 'mini' + (has ? '' : ' quiet'), '▷ clip' +
        (has && sh.video.dur ? ' ' + sh.video.dur + 's' : ''));
      play.title = (!has
        ? 'No clip on this row yet — shoot one, or add a file you already have'
        : (sh.video.ref
          ? 'Play, replace or remove the clip on this card (' +
            SB.Renders.fileName(sh.video.serial, sh.video.ext) + ')'
          : 'Play the clip — held only as a link, which expires')) +
        (has && SB.Clip.label(sh.video) ? '\n' + SB.Clip.label(sh.video) : '');
      play.onclick = function () { SB.Clip.open(P(), sh); };
      foot.appendChild(play);
    }

    foot.appendChild(SB.el('span', 'spacer'));

    const why = SB.el('span', 'push-why');
    why.style.display = 'none';
    foot.appendChild(why);

    const push = pushBtn(sh, m, field, why);
    if (push) foot.appendChild(push);

    const gen = SB.Focus.costly(SB.el('button', 'mini primary', '\u2726 generate'));
    gen.dataset.gen = sh.id + ':' + field;
    paintGen(gen, sh, field);
    gen.onclick = function () {
      setStatus('writing the ' + (field === 'imagePrompt' ? 'first frame' : 'video') +
        ' prompt for ' + code(sh) + '\u2026');
      const roles = field === 'imagePrompt' ? { image: true } : { video: true };
      SB.Prompts.generateFor(sh, roles).then(function (r) {
        setStatus(r && r.kept && r.kept.length ? 'kept your edit \u2014 see the toast' : '');
        refreshUsage();
        /* The buttons come back from the state rather than from a rebuild, so
           the row stops saying "\u2026" at once even when the rebuild is
           waiting for a gap in the typing. */
        paintGens();
        SB.Focus.defer('promptpanel', render);
      }).catch(function (e) {
        paintGens();
        refreshUsage();
        writeError(e, function () { gen.onclick(); });
      });
    };
    foot.appendChild(gen);

    cell.appendChild(foot);
    return cell;
  }

  /* The references this row hands over, in order — the same feed the card
   * shows, laid out down the column because there is room for it here. */
  /* The references this row hands over, in order.
   *
   * Named by FILE, not by subject. "Nat" tells you nothing you can act on: the
   * point of this column is that you go and find those pictures and drop them
   * into a model in this order, so it says 0007.png. The subject's name rides
   * along after it, because the filename alone says nothing about who it is.
   */
  function feedList(sh, code) {
    const wrap = SB.el('div', 'pt-feed-list');
    const list = SB.Refs.feed(P(), sh);
    if (!list.length) {
      wrap.appendChild(SB.el('div', 'pt-none', 'no references'));
      return wrap;
    }
    /* one line per FILE, so the numbers down the column are the numbers in the
       prompt's mapping and in the folder */
    SB.Refs.images(P(), sh).forEach(function (e) {
      const it = SB.el('div', 'pt-fe' + (e.kind === 'shot' ? ' is-shot' : ''));
      it.appendChild(SB.el('span', 'feed-n', String(e.n)));

      const t = SB.el('span', 'feed-thumb');
      const im3 = document.createElement('img');
      im3.src = SB.Blobs.src(P(), e.img);
      t.appendChild(im3);
      it.appendChild(t);

      const file = SB.Renders.has(P(), e.render)
        ? SB.Renders.fileName(e.render.serial, e.render.ext)
        : null;
      const nameEl = SB.el('span', 'feed-file' + (file ? '' : ' none'),
        file || 'board copy only');
      it.appendChild(nameEl);
      it.appendChild(SB.el('span', 'feed-who', e.label + (e.role ? ' · ' + e.role : '')));

      it.title = (file
        ? file + ' — the full-size original, carried in this file'
        : 'No original for this one: the board\'s 854×480 copy is what gets fed. Drop the ' +
          'picture in again and the original comes with it.') +
        '\n' + e.label + (e.role ? ' (' + e.role + ')' : '');
      wrap.appendChild(it);
    });

    /* things that are referenced but have no picture behind them still have to
       be said — they are numbered nowhere and feed nothing */
    list.forEach(function (e) {
      if (e.images.length) return;
      const it = SB.el('div', 'pt-fe' + (e.kind === 'dead' ? ' dead' : ' empty'));
      it.appendChild(SB.el('span', 'feed-n', '–'));
      it.appendChild(SB.el('span', 'feed-thumb none', '?'));
      it.appendChild(SB.el('span', 'feed-file none', e.kind === 'dead' ? 'gone' : 'no picture'));
      it.appendChild(SB.el('span', 'feed-who', e.label));
      it.title = e.label + (e.why ? ' — ' + e.why : '');
      wrap.appendChild(it);
    });

    const imgs = SB.Refs.images(P(), sh);
    if (imgs.length) {
      const full = imgs.filter(function (e) { return SB.Renders.has(P(), e.render); }).length;
      const b = SB.el('button', 'mini', 'copy image set');
      b.title = imgs.length + ' images, numbered in feed order' +
        (full ? ' — ' + full + ' full-size' : ' — all at board size');
      b.onclick = function () { SB.Board.saveFeed(sh, imgs, code); };
      wrap.appendChild(b);
    }
    return wrap;
  }

  function refreshFeedCell(id) {
    if (!root) return;
    const cell = bodyEl.querySelector('.pt-feed[data-feed-cell="' + id + '"]');
    if (!cell) return;
    const f = SB.Model.findShot(P(), id);
    if (!f) return;
    cell.innerHTML = '';
    cell.appendChild(feedList(f.shot, f.code));
  }

  /* ------------------------------------------------------- one shot at a time */

  /* Prompts are written one shot at a time, because that is how they are read
   * and edited. There was a button here that wrote a whole board's worth in one
   * go; it was faster at producing text nobody had looked at, and every prompt
   * it wrote was one you then had to open anyway.
   *
   * What it did carry, and this does now, is the answer to a writer model the
   * key cannot reach: a 404 is not a dead end, it is a question the key can be
   * asked directly. */
  function writeError(e, retry) {
    if (SB.apiBlocked(e, retry)) {
      setStatus('blocked — see the dialog', true);
      return;
    }
    const msg = e.message || String(e);
    setStatus(msg, true);
    const notAvailable = msg.indexOf('404') >= 0 && SB.Providers.activeId() === 'gemini';
    if (!notAvailable) {
      SB.toast(msg, true);
      return;
    }
    setStatus(msg + ' — checking what your key can reach…', true);
    SB.GeminiModels.fetchAvailable().then(function (models) {
      render();
      setStatus('“' + P().settings.geminiModel + '” is not available to this key. ' +
        'The writer list now shows the ' + models.length +
        ' models it can reach — pick one.', true);
    }).catch(function () {
      setStatus(msg, true);
    });
  }

  SB.PromptPanel = {
    init: init, open: open, close: close, toggle: toggle, isOpen: isOpen, refresh: refresh,
    follow: follow, refreshUsage: refreshUsage
  };

})(window.SB);
