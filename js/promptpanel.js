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
    render();
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
    if (r.shot.noShot) return false;
    const pi = im && r.shot.prompts[im.id];
    const pv = vm && r.shot.prompts[vm.id];
    return (im && !(pi && pi.imagePrompt)) || (vm && !(pv && pv.videoPrompt));
  }

  function isStale(r, im, vm) {
    const one = function (m, field) {
      const pr = m && r.shot.prompts[m.id];
      return !!(pr && pr[field] && SB.Personas.staleFor(P(), r.shot, pr.at));
    };
    return one(im, 'imagePrompt') || one(vm, 'videoPrompt');
  }

  function visible(im, vm) {
    const rows = allRows();
    if (filter === 'missing') return rows.filter(function (r) { return isMissing(r, im, vm); });
    if (filter === 'stale') return rows.filter(function (r) { return isStale(r, im, vm); });
    if (filter === 'scene') {
      return rows.filter(function (r) { return r.scene.id === SB.app.selectedSceneId; });
    }
    return rows;
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
      missing: all.filter(function (r) { return isMissing(r, im, vm); }).length,
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
      b.onclick = function () { filter = t[0]; render(); };
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

    const acts = SB.el('div', 'pt-acts');
    statusEl = SB.el('span', 'pt-status');
    acts.appendChild(statusEl);
    r2.appendChild(acts);
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

  function render() {
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
    const row = SB.el('div', 'pt-row' + (sh.noShot ? ' noshot' : ''));
    row.dataset.shot = sh.id;

    /* ---- what it is ---- */
    const c1 = SB.el('div', 'pt-cell pt-shot');
    const line = SB.el('div', 'pt-code-line');
    line.appendChild(SB.el('span', 'code', r.code));
    if (sh.render && sh.render.serial) {
      const ser = SB.el('span', 'code-serial', SB.Renders.pad(sh.render.serial));
      ser.title = 'Full-size render: ' + SB.Renders.fileName(sh.render.serial, sh.render.ext);
      line.appendChild(ser);
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
        refreshFeedCell(sh.id);
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

  function promptCell(sh, m, field) {
    const cell = SB.el('div', 'pt-cell pt-prompt');
    if (!m) {
      cell.appendChild(SB.el('div', 'pt-none', 'no model chosen'));
      return cell;
    }
    const pr = sh.prompts[m.id] || null;

    const ta = document.createElement('textarea');
    ta.className = 'pt-text';
    ta.value = (pr && pr[field]) || '';
    ta.placeholder = sh.noShot ? '(\u201cno shot\u201d \u2014 never generated)' : 'not generated yet';
    ta.addEventListener('input', function () {
      sh.prompts[m.id] = sh.prompts[m.id] || { imagePrompt: '', videoPrompt: '', modelName: m.name };
      sh.prompts[m.id][field] = ta.value;
      sh.prompts[m.id].modelName = m.name;
      /* Editing by hand is the user restating the prompt as it should read now,
         so it stops being behind the cast. */
      sh.prompts[m.id].at = Date.now();
      SB.Store.touch();
      SB.Board.refreshPromptStale();
    });
    cell.appendChild(ta);

    const foot = SB.el('div', 'pt-foot');

    const flagged = (pr && pr.flagged && pr.flagged[field]) || null;
    if (flagged && flagged.length) {
      const warn = SB.el('span', 'badge warn', 'gendered');
      warn.title = 'This prompt still contains: ' + flagged.join(', ') +
        '. Edit it or generate again.';
      foot.appendChild(warn);
    }
    if (pr && pr[field] && SB.Personas.staleFor(P(), sh, pr.at)) {
      const b = SB.el('span', 'badge warn stale', 'cast changed');
      b.title = 'Something on this card was edited after this prompt was written.';
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

    foot.appendChild(SB.el('span', 'spacer'));

    const gen = SB.el('button', 'mini primary', '\u2726 generate');
    gen.disabled = !!sh.noShot || !(sh.description || '').trim();
    if (gen.disabled) {
      gen.title = sh.noShot ? 'A \u201cno shot\u201d card never generates'
        : 'Write a description first \u2014 there is nothing for the writer to work from';
    } else if (ta.value) {
      gen.title = 'Write this one again, replacing what is there';
    }
    gen.onclick = function () {
      gen.disabled = true;
      gen.textContent = '\u2026';
      setStatus('writing the ' + (field === 'imagePrompt' ? 'first frame' : 'video') +
        ' prompt for ' + code(sh) + '\u2026');
      const roles = field === 'imagePrompt' ? { image: true } : { video: true };
      SB.Prompts.generateFor(sh, roles).then(function () {
        setStatus('');
        refreshUsage();
        render();
      }).catch(function (e) {
        gen.disabled = false;
        gen.textContent = '\u2726 generate';
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
  function feedList(sh, code) {
    const wrap = SB.el('div', 'pt-feed-list');
    const list = SB.Refs.feed(P(), sh);
    if (!list.length) {
      wrap.appendChild(SB.el('div', 'pt-none', 'no references'));
      return wrap;
    }
    list.forEach(function (e) {
      const it = SB.el('div', 'pt-fe' +
        (e.kind === 'dead' ? ' dead' : '') +
        (e.kind === 'shot' ? ' is-shot' : '') +
        (e.images.length ? '' : ' empty') +
        (e.mentioned ? '' : ' unmentioned'));
      const n = e.numbers.length
        ? (e.numbers.length === 1 ? e.numbers[0]
          : e.numbers[0] + '–' + e.numbers[e.numbers.length - 1])
        : '–';
      it.appendChild(SB.el('span', 'feed-n', String(n)));
      if (e.images.length) {
        const t = SB.el('span', 'feed-thumb');
        const im3 = document.createElement('img');
        im3.src = SB.Blobs.src(P(), e.images[0]);
        t.appendChild(im3);
        it.appendChild(t);
      } else {
        it.appendChild(SB.el('span', 'feed-thumb none', '?'));
      }
      it.appendChild(SB.el('span', 'feed-name', e.label));
      const sers = (e.renders || []).filter(Boolean)
        .map(function (x) { return SB.Renders.pad(x.serial); });
      if (sers.length) it.appendChild(SB.el('span', 'feed-ser', sers.join(' ')));
      it.title = e.label + (e.why ? ' — ' + e.why : '') +
        (sers.length ? '\nFull-size ' + sers.join(', ') + ' if the folder still has it.' : '');
      wrap.appendChild(it);
    });

    const imgs = SB.Refs.images(P(), sh);
    if (imgs.length) {
      const full = imgs.filter(function (e) { return !!e.render; }).length;
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
