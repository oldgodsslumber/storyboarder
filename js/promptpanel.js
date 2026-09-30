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
 * simply the right shape for the job.
 *
 * Scenes fold (create_panel_scenes_plan.md). The table used to open as every
 * row of every scene, a long scroll to the one scene you came for, with filters
 * (All / Missing / Stale / This scene) nobody used. Now each scene is a band
 * that folds to one line carrying its counts — prompts to write, stale, ready
 * to push — and the header is a button per scene. It opens on the scene
 * selected on the board, everything else folded.
 */
(function (SB) {
  'use strict';

  let root = null;
  let bodyEl, statusEl, usageEl, limitEl, headEl;
  /* Folded scenes, by id. Per board, in this browser: a viewing preference,
     not part of the film, so it is not saved in the project. */
  let folded = null;
  let startScene = null;          // the scene to scroll to on the next paint
  const SCENE_RUN = {};           // scene id -> true while "Write missing" runs

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
    startFolds();
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
      if (pr && pr[field] && pr.stale) return true;
      return !!(pr && pr[field] && SB.Personas.staleFor(P(), r.shot, pr.at));
    };
    return one(im, 'imagePrompt') || one(vm, 'videoPrompt');
  }

  /* ---------------------------------------------------------------- folds */

  function foldKey() { return 'sb.create.folds.' + (P() && P().id); }
  function saveFolds() {
    try { localStorage.setItem(foldKey(), JSON.stringify(folded || {})); } catch (e) { }
  }
  function sceneWork(sc, im, vm) {
    let miss = 0, stale = 0, ready = 0, n = 0;
    sc.shots.forEach(function (sh) {
      const r = { shot: sh };
      n++;
      miss += missingCount(r, im, vm);
      if (isStale(r, im, vm)) stale++;
      if (SB.Imagine && ((im && !pushBlock(sh, im, 'image')) || (vm && !pushBlock(sh, vm, 'video')))) ready++;
    });
    return { n: n, miss: miss, stale: stale, ready: ready };
  }
  /* How the panel opens: the scene selected on the board, unfolded and
     scrolled to; without one, the first scene with work left; else the
     first. What was folded before is kept, but the scene you came for opens. */
  function startFolds() {
    const p = P();
    const im = SB.Model.imageModel(p), vm = SB.Model.videoModel(p);
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(foldKey()) || 'null'); } catch (e) { saved = null; }
    const sel = p.scenes.filter(function (sc) { return sc.id === SB.app.selectedSceneId; })[0];
    const work = p.scenes.filter(function (sc) { const w = sceneWork(sc, im, vm); return w.miss || w.stale; })[0];
    const start = sel || work || p.scenes[0] || null;
    if (saved && typeof saved === 'object') folded = saved;
    else { folded = {}; p.scenes.forEach(function (sc) { folded[sc.id] = true; }); }
    if (start) { delete folded[start.id]; startScene = start.id; }
    saveFolds();
  }
  function isFolded(sc) { return !!(folded && folded[sc.id]); }
  function setFold(id, on) { if (!folded) folded = {}; if (on) folded[id] = true; else delete folded[id]; saveFolds(); }
  function foldAll(on) { P().scenes.forEach(function (sc) { setFold(sc.id, on); }); render(); }
  /* One scene, the others folded, scrolled to. `add` keeps the others as they are. */
  function openScene(id, add) {
    if (!add) P().scenes.forEach(function (sc) { setFold(sc.id, sc.id !== id); });
    else setFold(id, false);
    startScene = id;
    render();
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
    /* Each picker offers its own kind only. The video one lists every model
       twice: pushed from here (one picture, the first frame), or exported, where
       you upload the files yourself and the prompt is written for all of them
       (vexport.js). */
    const cur = role === 'image' ? p.settings.imageModelId : p.settings.videoModelId;
    const groups = [[role, 'Send from Storyboarder', ''], [role, 'Export \u2014 upload the files yourself', SB.Model.EXPORT_SUFFIX]];
    groups.forEach(function (g) {
      const list = p.settings.models.filter(function (m) { return m.kind === g[0]; });
      if (!list.length) return;
      const og = document.createElement('optgroup');
      og.label = g[1];
      list.forEach(function (m) {
        const o = document.createElement('option');
        o.value = m.id + g[2]; o.textContent = m.name + (g[2] ? ' \u00b7 export' : '');
        if (o.value === cur) o.selected = true;
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

    r1.appendChild(SB.el('h2', null, 'Create'));

    /* A button per scene, marked with what is left to do in it. Click: that
       scene, the others folded, scrolled to. Ctrl/Cmd-click: that one as well. */
    const btns = SB.el('div', 'pt-scenebtns');
    P().scenes.forEach(function (sc, si) {
      const w = sceneWork(sc, im, vm);
      const b = SB.el('button', 'tb toggle pt-scenebtn' + (isFolded(sc) ? '' : ' on'));
      b.dataset.scene = sc.id;
      b.appendChild(SB.el('span', 'sn', String(si + 1)));
      b.appendChild(SB.el('span', 'sh', sc.heading || '(untitled)'));
      const marks = SB.el('span', 'sm');
      paintMarks(marks, w);
      b.appendChild(marks);
      b.title = 'Scene ' + (si + 1) + ' \u2014 ' + (sc.heading || '(untitled)') + '\n' + workText(w) +
        '\nClick: work on this scene. Ctrl-click: open it as well.';
      b.onclick = function (ev) { openScene(sc.id, ev.ctrlKey || ev.metaKey); };
      btns.appendChild(b);
    });
    const tabs = btns;
    r1.appendChild(tabs);
    r1.appendChild(SB.el('span', 'spacer'));
    [['Fold all', true], ['Unfold all', false]].forEach(function (f) {
      const b = SB.el('button', 'tb pt-foldall', f[0]);
      b.onclick = function () { foldAll(f[1]); };
      r1.appendChild(b);
    });

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
    const rows = allRows();
    head(im, vm, rows);
    refreshUsage();

    bodyEl.innerHTML = '';

    const grid = SB.el('div', 'pt-grid');
    const hdr = SB.el('div', 'pt-head-row');
    /* Four columns, not five. There used to be one Feed column at the end,
       which showed a single list for two calls that are handed different
       things — each lane now carries the list it will actually send, numbered
       the way its own prompt cites it. */
    ['Shot', 'Description', 'First frame' + (im ? ' · ' + im.name : ''),
      'Video' + (vm ? ' · ' + vm.name : '')].forEach(function (t) {
        hdr.appendChild(SB.el('div', 'pt-h', t));
      });
    grid.appendChild(hdr);

    if (!p.scenes.length) grid.appendChild(SB.el('div', 'pt-empty', 'No scenes yet.'));
    p.scenes.forEach(function (sc, si) {
      grid.appendChild(sceneBand(sc, si, im, vm));
      if (isFolded(sc)) return;
      if (!sc.shots.length) { grid.appendChild(SB.el('div', 'pt-empty', 'This scene has no shots yet.')); return; }
      sc.shots.forEach(function (sh, sj) {
        grid.appendChild(rowEl({ shot: sh, scene: sc, si: si, sj: sj, code: SB.Model.code(si, sj) }, im, vm));
      });
    });
    bodyEl.appendChild(grid);

    const ready = SB.Providers.active().ready();
    if (!ready) setStatus(SB.Providers.active().notReady(), true);
    if (startScene) {
      const band = bodyEl.querySelector('.pt-scene[data-scene="' + startScene + '"]');
      startScene = null;
      if (band) {
        /* measured, not offsetTop: the band's offset parent is the grid, and the
           column-heading row sticks over the top of the scroll */
        const hr = bodyEl.querySelector('.pt-head-row');
        const under = hr ? hr.getBoundingClientRect().height : 0;
        bodyEl.scrollTop += band.getBoundingClientRect().top - bodyEl.getBoundingClientRect().top - under;
      }
    }
  }

  function workText(w) {
    return w.n + ' shot' + (w.n === 1 ? '' : 's') + ' · ' +
      (w.miss ? w.miss + ' prompt' + (w.miss === 1 ? '' : 's') + ' to write' : 'all written') +
      (w.stale ? ' · ' + w.stale + ' stale' : '') +
      (SB.Imagine ? ' · ▶ ' + w.ready + '/' + w.n + ' ready' : '');
  }
  function paintMarks(el, w) {
    el.innerHTML = '';
    if (w.miss) el.appendChild(SB.el('span', 'mk miss', '●' + w.miss));
    if (w.stale) el.appendChild(SB.el('span', 'mk stale', '▲' + w.stale));
  }

  /* The scene's header: click to fold, Alt-click folds or unfolds them all.
     Folded, it is the scene in one line — its counts and its pictures. */
  function sceneBand(sc, si, im, vm) {
    const w = sceneWork(sc, im, vm), fold = isFolded(sc);
    const band = SB.el('div', 'pt-scene' + (fold ? ' folded' : ''));
    band.dataset.scene = sc.id;
    band.appendChild(SB.el('span', 'chev', fold ? '▸' : '▾'));
    band.appendChild(SB.el('span', 'n', 'Scene ' + (si + 1)));
    band.appendChild(SB.el('span', 't', sc.heading || '(untitled)'));
    const cnt = SB.el('span', 'pt-scene-work' + (w.miss ? ' miss' : '') + (w.stale ? ' stale' : ''), workText(w));
    band.appendChild(cnt);
    band.appendChild(SB.el('span', 'spacer'));
    const strip = SB.el('span', 'pt-scene-strip');
    sc.shots.slice(0, 12).forEach(function (sh) {
      const src = sh.image ? SB.Blobs.src(P(), sh.image)
        : (SB.Pose && SB.Pose.has(sh) ? SB.Blobs.src(P(), sh.pose.image) : null);
      if (src) { const i = document.createElement('img'); i.src = src; strip.appendChild(i); }
      else strip.appendChild(SB.el('span', 'blank'));
    });
    band.appendChild(strip);
    if (!fold && w.miss) band.appendChild(writeMissingBtn(sc, w));
    band.title = 'Click to ' + (fold ? 'open' : 'fold') + ' this scene · Alt-click: all scenes';
    band.onclick = function (ev) {
      if (ev.target.closest('button')) return;
      if (ev.altKey) { foldAll(!fold); return; }
      setFold(sc.id, !fold);
      render();
    };
    return band;
  }

  /* Every missing prompt in the scene, written one after another with the same
     writer as the row buttons. No push-all: pushes cost credits, they stay per row. */
  function writeMissingBtn(sc, w) {
    const b = SB.Focus.costly(SB.el('button', 'mini primary pt-scene-write'));
    const running = !!SCENE_RUN[sc.id];
    b.textContent = running ? 'Writing…' : 'Write missing (' + w.miss + ')';
    b.disabled = running;
    b.title = 'Write every prompt this scene is still missing, one at a time.';
    b.onclick = function () { writeScene(sc); };
    return b;
  }

  function writeScene(sc) {
    if (SCENE_RUN[sc.id]) return;
    const p = P(), im = SB.Model.imageModel(p), vm = SB.Model.videoModel(p);
    const jobs = [];
    sc.shots.forEach(function (sh) {
      if (sh.noShot || !SB.Model.described(sh)) return;
      const roles = {};
      const pi = im && sh.prompts[im.id], pv = vm && sh.prompts[vm.id];
      if (im && !(pi && pi.imagePrompt) && !SB.Prompts.writing(sh.id, 'imagePrompt')) roles.image = true;
      if (vm && !(pv && pv.videoPrompt) && !SB.Prompts.writing(sh.id, 'videoPrompt')) roles.video = true;
      if (roles.image || roles.video) jobs.push({ sh: sh, roles: roles });
    });
    if (!jobs.length) { setStatus('Nothing in this scene can be written — the cards missing prompts have no description yet.', true); return; }
    SCENE_RUN[sc.id] = true;
    render();
    let i = 0, failed = 0;
    const next = function () {
      if (i >= jobs.length) {
        delete SCENE_RUN[sc.id];
        setStatus('scene written' + (failed ? ' — ' + failed + ' failed; the rows say why' : ''), !!failed);
        refreshUsage();
        SB.Focus.defer('promptpanel', render);
        return;
      }
      const j = jobs[i++];
      setStatus('writing ' + code(j.sh) + ' (' + i + ' of ' + jobs.length + ')…');
      SB.Prompts.generateFor(j.sh, j.roles).then(function () { paintGens(); refreshUsage(); next(); })
        .catch(function () { failed++; paintGens(); next(); });
    };
    next();
  }


  function rowEl(r, im, vm) {
    const sh = r.shot;
    const row = SB.el('div', 'pt-row' + (sh.noShot ? ' noshot' : '') +
      (sh.video && sh.video.unseen ? ' fresh' : ''));
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
    c1.appendChild(line);

    const thumb = SB.el('div', 'pt-thumb');
    if (sh.image) {
      const im2 = document.createElement('img');
      im2.src = SB.Blobs.src(P(), sh.image);
      thumb.appendChild(im2);
    } else if (SB.Pose && SB.Pose.has(sh)) {
      /* No still yet, but a blocking: that IS this shot's picture until one
         lands — the board shows it, and so does this. Labelled, so a clay
         render is never mistaken for a finished frame. */
      const im2 = document.createElement('img');
      im2.src = SB.Blobs.src(P(), sh.pose.image);
      thumb.appendChild(im2);
      thumb.classList.add('blocking');
      thumb.appendChild(SB.el('span', 'pt-thumb-tag', '⛹ blocking'));
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
      placeholder: 'What we see — both prompts read this. @ anything to be shown.',
      ctx: { shot: sh, code: r.code }
    });
    c2.appendChild(desc);
    row.appendChild(c2);

    /* ---- the two lanes ---- */
    row.appendChild(promptCell(sh, im, 'imagePrompt', r));
    row.appendChild(promptCell(sh, vm, 'videoPrompt', r));

    return row;
  }

  /* What this lane says beyond the shared description, and what that adds to
   * what it hands over. An @ typed here is a picture THIS lane sends and the
   * other never sees — which is the whole reason the boxes are separate. */
  const LANE = {
    imagePrompt: { role: 'image', key: 'imageDescription', label: 'first frame',
      hint: 'Only what is true as the shot opens. @ anything the first frame should see.' },
    videoPrompt: { role: 'video', key: 'videoDescription', label: 'motion',
      hint: 'What moves, in what order, how it ends. @ someone to name them \u2014 ' +
        'the clip is handed the frame, not their photo.' }
  };

  function laneDesc(sh, field, r) {
    const lane = LANE[field];
    const wrap = SB.el('div', 'pt-lane');
    const box = SB.el('div', 'pt-desc pt-lane-desc');
    box.dataset.shot = sh.id;
    box.dataset.lane = lane.role;
    SB.RefBox.attach(box, {
      get: function () { return sh[lane.key] || ''; },
      set: function (t) {
        sh[lane.key] = t;
        SB.Store.touch();
        SB.Board.refreshCastRows();
        refreshFeedCell(sh.id);
        paintGens();
        /* The dashed, dimmed state is the panel's only sign of which lane is
           overridden. Set once at render, it went on saying "empty" about a
           box you had just filled, until something else forced a redraw. */
        wrap.classList.toggle('using-shared', !(sh[lane.key] || '').trim());
      },
      placeholder: field === 'videoPrompt' && (SB.Model.videoModel(P()) || {}).export
        ? 'What moves, in what order, how it ends. @ someone to name them — their photo goes up with the clip.'
        : lane.hint,
      ctx: { shot: sh, code: r.code }
    });
    wrap.appendChild(box);
    /* An empty lane is not an omission — it is the shared description doing
       the work, which is the common case and should look like a decision. */
    if (!(sh[lane.key] || '').trim()) wrap.classList.add('using-shared');
    return wrap;
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

  /* ---------------------------------------------------------- the shoot row
   *
   * What this push will ask the model for, beside the button that sends it.
   * Every menu is the model's OWN list — an unlisted value is swapped for the
   * model's floor without a word, so it must not be possible to choose one.
   *
   * A card says nothing until it does: the first entry is the board's answer,
   * and a card that has overridden it is drawn in the accent so a board's
   * worth of rows can be scanned for the ones that differ.
   */
  const SHOOT = {
    duration: { label: 's', title: 'How long this clip runs' },
    resolution: { label: '', title: 'What size this is asked for' },
    quality: { label: '', title: 'How hard the model is asked to work' }
  };

  function shootPick(sh, slug, kind, what) {
    const IM = SB.Imagine;
    const one = IM.settleOne(P(), sh, slug, kind, what);
    if (!one.allowed.length) return null;          // the model takes none
    /* settleOne knows which key this lane keeps its answer under — image and
       video resolutions share no values, so they cannot share a key. */
    const mine = one.mine || '';
    const sel = document.createElement('select');
    sel.className = 'shoot-pick' + (mine ? ' mine' : '') + (one.fell ? ' fell' : '');

    /* what happens when this card says nothing */
    const board = IM.settleOne(P(), { shoot: {} }, slug, kind, what);
    const first = document.createElement('option');
    first.value = '';
    first.textContent = board.value
      ? board.value + (what === 'duration' ? 's' : '') + ' · board'
      : 'model\u2019s own';
    sel.appendChild(first);

    one.allowed.forEach(function (v) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = v + (what === 'duration' ? 's' : '');
      if (v === mine) o.selected = true;
      sel.appendChild(o);
    });

    /* A request this model cannot honour is shown rather than swallowed. */
    if (one.fell && one.asked) {
      const bad = document.createElement('option');
      bad.value = '';
      bad.disabled = true;
      bad.textContent = one.asked + (what === 'duration' ? 's' : '') +
        ' \u2014 not on ' + slug;
      sel.insertBefore(bad, sel.firstChild);
    }

    sel.title = SHOOT[what].title + '.\n' +
      (mine ? 'This card asks for ' + mine + '.' : 'Following the board.') +
      '\nThis model takes: ' + one.allowed.join(', ') + '.' +
      (one.fell ? '\n' + one.asked + ' is not among them \u2014 ' + one.value +
        ' is what would be sent.' : '');

    const key = IM.shootKey(kind, what);
    sel.onchange = function () {
      sh.shoot = sh.shoot || {};
      if (sel.value) sh.shoot[key] = sel.value; else delete sh.shoot[key];
      SB.app.changed(false);
      render();
    };
    return sel;
  }

  /* The one picture a clip may carry besides its frame.
   *
   * Offered only where it can work: five of the fifteen video models take
   * reference pictures at all, and the board default is not one of them — a
   * second picture sent anywhere else is dropped without a word. And it is
   * never on by default, because a second picture stops the call animating
   * the approved frame and starts it building from both. */
  function arrivalPick(sh, m, field) {
    const IM = SB.Imagine;
    if (!IM || !IM.arrivalRefs || field !== 'videoPrompt' || !m || sh.noShot) return null;
    const slug = IM.slugOf(m);
    if (!slug) return null;
    const a = IM.arrivalRefs(P(), sh, slug);
    if (!a.people.length) return null;             // nobody to send

    const who = a.people.map(function (x) { return x.label; }).join(', ');
    if (!a.can) {
      const no = SB.el('span', 'badge refs warn', 'arrives · not on ' + slug);
      no.title = who + ' arrive' + (a.people.length === 1 ? 's' : '') +
        ' during this shot and ' + (a.people.length === 1 ? 'is' : 'are') + ' in no frame, so ' +
        'only the words describe ' + (a.people.length === 1 ? 'them' : 'them') + '. ' +
        slug + ' takes no reference pictures — sending one is dropped without a word. ' +
        'The models that do: seedance-2.5, seedance-2.0, seedance-2.0-fast, veo-3.1, ' +
        'happy_horse.';
      return no;
    }

    const on = a.on;
    const b = SB.el('button', 'mini' + (on ? ' primary' : ''),
      (on ? '\u2713 ' : '') + 'send ' + who);
    b.title = on
      ? who + '\u2019s picture goes with the clip, after the frame. That makes this a ' +
        'reference-to-video call rather than an animation of your frame: the model builds ' +
        'from both pictures. Press to stop sending it.'
      : who + ' arrive' + (a.people.length === 1 ? 's' : '') + ' during this shot, so ' +
        (a.people.length === 1 ? 'their' : 'their') + ' appearance reaches the model as words ' +
        'only. Press to send the reference picture too — but note it stops the call animating ' +
        'your frame and starts it building from both pictures.';
    b.onclick = function () {
      sh.shoot = sh.shoot || {};
      if (on) delete sh.shoot.sendArrivals; else sh.shoot.sendArrivals = true;
      /* The written prompt named the pictures this call carries — <Picture 2>
         bound to a subject, "reference generation" among the task types.
         Pressing this changes how many pictures the call carries, so a prompt
         written before the press now describes a different call: turn it off
         and one picture travels against a prompt promising two; turn it on
         and a photograph travels that no label names. Both are the failure
         the numbering exists to prevent, arriving one click later.

         Marked on the prompt rather than by ageing it, because staleness is
         otherwise a question about persona edits and this is not one. */
      const vm2 = SB.Model.videoModel(P());
      const pr2 = vm2 && sh.prompts && sh.prompts[vm2.id];
      if (pr2 && pr2.videoPrompt) pr2.stale = 'the arrival pictures changed';
      SB.app.changed(true);
      render();
    };
    return b;
  }

  function shootRow(sh, m, field) {
    const IM = SB.Imagine;
    if (!IM || !IM.settleOne || !m || sh.noShot) return null;
    const slug = IM.slugOf(m);
    if (!slug) return null;
    const kind = roleOf(field);
    const wrap = SB.el('div', 'shoot-row');
    const want = kind === 'video' ? ['duration', 'resolution'] : ['resolution', 'quality'];
    let any = false;
    want.forEach(function (what) {
      const pick = shootPick(sh, slug, kind, what);
      if (!pick) return;
      any = true;
      wrap.appendChild(pick);
    });
    return any ? wrap : null;
  }

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
  function priceOf(m, role, sh) {
    if (!SB.Imagine || !m) return null;
    const slug = SB.Imagine.slugOf(m);
    if (!slug) return null;
    const res = SB.Imagine.resolutionFor(P(), slug, role, sh);
    /* costFor has been keyed on duration since it was written and has only
       ever been handed '' — a clip that runs twice as long costs accordingly,
       so this is the key finally carrying something. */
    const dur = role === 'video' ? SB.Imagine.durationFor(P(), sh, slug) : '';
    const c = SB.Imagine.costFor(slug, dur, res);
    if (!c) return { res: res };
    return { res: res, credits: c.credits, from: c.from, note: c.note };
  }

  function priceLine(m, role, sh) {
    const pr = priceOf(m, role, sh);
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
    /* named for what comes out of it, not for the verb: the label beside it
       already says Generate. */
    const noun = role === 'image' ? '🖼️ Frame' : '📽️ Video';
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
    b.textContent = (job && job.state === 'error' ? '\u21ba retry' : noun);
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
        : 'No frame on this card yet, so this is text-to-video.') + priceLine(m, role, sh);
    } else {
      b.title = 'Make this frame on ImagineArt and put it on the card.' + priceLine(m, role, sh);
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
   * description into a card that had none therefore left the prompt button
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
    b.textContent = '📝 Prompt';
    /* Any of the three boxes — the same gate generateFor uses. This one said
       "write a description first" at a card that had already been written. */
    const hasDesc = SB.Model.described(sh);
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

  function paintScenes() {
    if (!root || !P() || !bodyEl) return;
    const im = SB.Model.imageModel(P()), vm = SB.Model.videoModel(P());
    P().scenes.forEach(function (sc) {
      const w = sceneWork(sc, im, vm);
      const band = bodyEl.querySelector('.pt-scene[data-scene="' + sc.id + '"] .pt-scene-work');
      if (band) {
        band.textContent = workText(w);
        band.classList.toggle('miss', !!w.miss);
        band.classList.toggle('stale', !!w.stale);
      }
      const mk = headEl && headEl.querySelector('.pt-scenebtn[data-scene="' + sc.id + '"] .sm');
      if (mk) paintMarks(mk, w);
    });
  }

  function paintGens() {
    if (!root || !P() || !bodyEl) return;
    paintScenes();
    bodyEl.querySelectorAll('[data-gen]').forEach(function (b) {
      const bits = b.dataset.gen.split(':');
      const f = SB.Model.findShot(P(), bits[0]);
      if (f) paintGen(b, f.shot, bits[1]);
    });
  }

  function promptCell(sh, m, field, r) {
    const cell = SB.el('div', 'pt-cell pt-prompt');
    cell.dataset.lane = LANE[field].role;
    /* Which lane this is. Invisible at full width, where the column heading
       says it; the heading is what goes away when the lanes stack. */
    cell.appendChild(SB.el('div', 'pt-lane-cap',
      (LANE[field].role === 'image' ? 'First frame' : 'Video') +
      (m ? ' \u00b7 ' + m.name : '')));
    /* say it, see what goes with it, read what was written, act on it */
    if (r) cell.appendChild(laneDesc(sh, field, r));
    if (r) {
      const fe = SB.el('div', 'pt-feed', '');
      fe.dataset.feedCell = sh.id + ':' + LANE[field].role;
      const fl = feedList(sh, r.code, LANE[field].role);
      if (fl) fe.appendChild(fl);
      cell.appendChild(fe);
    }
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
      if (sh.prompts[m.id].invented) delete sh.prompts[m.id].invented[field];
      if (field === 'imagePrompt') delete sh.prompts[m.id].flat;
      const flb = cell.querySelector('.flat');
      if (flb) flb.remove();
      const mvb = cell.querySelector('.moved');
      if (mvb) mvb.remove();
      const gbb = cell.querySelector('.gendered');
      if (gbb) gbb.remove();
      const ibb = cell.querySelector('.invented');
      if (ibb) ibb.remove();
      SB.Store.touch();
      SB.Board.refreshPromptStale();
      paintScenes();
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

    /* Clothing or props the writer added that nothing on the card mentions. */
    if (pr && pr[field] && pr.invented && Array.isArray(pr.invented[field]) && pr.invented[field].length) {
      const said = pr.invented[field];
      const b = SB.el('span', 'badge warn invented', 'added: ' + said.join(', '));
      b.title = 'The writer added things no description on this card mentions — "' + said.join('", "') + '" — and kept them through one rewrite. Take them out, or put them in the description if they belong.';
      foot.appendChild(b);
    }

    /* A still that came back without the house look, even after its rewrite. */
    if (field === 'imagePrompt' && pr && pr[field] && Array.isArray(pr.flat) && pr.flat.length) {
      const b = SB.el('span', 'badge warn flat', 'look: no ' + pr.flat.join(', '));
      b.title = 'This prompt doesn\u2019t name ' + pr.flat.join(', ') + ' \u2014 the house look the style asks for \u2014 ' +
        'even after one rewrite. Generate again, or write it in.';
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

    const arr = arrivalPick(sh, m, field);
    if (arr) foot.appendChild(arr);

    const shoot = shootRow(sh, m, field);
    if (shoot) foot.appendChild(shoot);

    foot.appendChild(SB.el('span', 'spacer'));

    /* Appended further down, immediately before the button it explains.
       Left where it was it read "sign in  Generate: 📝 Prompt 🖼️ Frame" —
       the reason butted against the word Generate and against the one button
       on the row that needs no account at all, 140px from the dark button it
       was actually about. */
    const why = SB.el('span', 'push-why');
    why.style.display = 'none';

    const push = pushBtn(sh, m, field, why);

    /* The corner names what the two buttons make, and nothing else.
     *
     * It used to carry a chip counting what the push would hand over --
     * "sends 1 ref", "animates the frame". The references panel directly
     * above now shows those same pictures, so the chip was answering a
     * question already answered, in words, beside the pictures that answer
     * it better. Worse, "animates the frame" sat next to a button whose job
     * IS to animate the frame, so the row read as two different things. */
    foot.appendChild(SB.el('span', 'gen-label', 'Generate:'));
    const gen = SB.Focus.costly(SB.el('button', 'mini primary'));
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
    if (push) { foot.appendChild(why); foot.appendChild(push); }

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
  /* Is this person already there when the shot opens?
   *
   * A first frame is one instant, so somebody who walks in partway through
   * must not be drawn standing in it — and the video cast block splits its
   * two lists on exactly this. The control used to live on the card's feed
   * strip; the strip has gone, and this is the list of the people the FIRST
   * FRAME is built from, which is what the question is about. */
  function whenBtn(sh, id, role) {
    if (role === 'video') return null;
    const per = SB.Personas.find(P(), id);
    if (!per || SB.Personas.kindOf(per).id !== 'person') return null;
    const arriving = SB.Personas.enters(sh, id);
    const b = SB.el('button', 'feed-when' + (arriving ? ' arriving' : ''),
      arriving ? '\u25b7' : '\u25c9');
    b.title = arriving
      ? 'Arrives during the shot, so the first frame leaves them out. Click to say they are ' +
        'there when it opens.'
      : 'There when the shot opens. Click if they arrive partway through instead.';
    b.onclick = function (ev) {
      ev.stopPropagation();
      SB.Personas.toggleEnters(sh, id);
      SB.Store.touch();
      refreshFeedCell(sh.id);
      if (SB.Board.refreshFeed) SB.Board.refreshFeed(sh.id);
    };
    return b;
  }

  /* The MiniMax package for this lane (mxm.js). */
  function mxmButton(wrap, sh, role) {
    if (!SB.Mxm) return;
    const m = SB.Mxm.manifest(P(), sh, role);
    if (!m.assets.length && !SB.Model.described(sh)) return;
    const b = SB.el('button', 'mini mxm-btn', 'Export for MiniMax');
    b.title = (role === 'video' ? 'MiniMax H3 full reference' : 'MiniMax Image') + ': ' +
      m.assets.length + ' file' + (m.assets.length === 1 ? '' : 's') +
      ' in upload order, prompt.txt and ORDER.txt' +
      (m.warnings.length ? ' — ' + m.warnings.length + ' thing' + (m.warnings.length === 1 ? '' : 's') + ' to check' : '');
    b.onclick = function () { SB.Mxm.open(sh, role); };
    wrap.appendChild(b);
    /* the Seedance reference-mode experiments (seedtest.js) — temporary, for a card cut from a performance */
    if (role === 'video' && SB.SeedTest && SB.Pose && SB.Pose.perfLink(sh)) {
      const t = SB.el('button', 'mini seedtest-btn', '🧪 Test Seedance reference (3 pushes)');
      t.title = 'Runs the three reference-mode tests through your ImagineArt sign-in: the clay clip alone, ' +
        'the still as the opening frame + the clip, and a reference photo + the clip. Each costs a Seedance clip.';
      t.onclick = function () {
        if (!window.confirm('Run 3 Seedance reference-mode test pushes for this card? Each one is billed as a ' +
          'Seedance clip on your ImagineArt organization.')) return;
        SB.SeedTest.run(sh);
      };
      wrap.appendChild(t);
    }
  }

  function feedList(sh, code, role) {
    const wrap = SB.el('div', 'pt-feed-list');
    const list = SB.Refs.feed(P(), sh, role);

    /* The video lane's reference is the card's own frame — always, and
     * nothing else. Listing the marked subjects here as though they travel
     * with the clip is what made the two lanes look paired when they are
     * not: the still is built from those pictures and approved, and the clip
     * moves the result. They stay on the list because they are still what
     * the WORDS of the video prompt were written against, but they are
     * shown for what they are. */
    /* A blocked card on a stock H3 board: the call is the full-reference one,
       and its files are the blocking's clay clip (or still), the first frame if
       there is one, and each subject's picture — numbered as the prompt names
       them and as the MiniMax package uploads them. */
    if (role === 'video' && SB.Mxm && SB.Mxm.h3Card(P(), sh)) {
      const m = SB.Mxm.manifest(P(), sh, 'video');
      m.assets.forEach(function (a) {
        const it = SB.el('div', 'pt-fe' + (a.kind === 'first-frame' ? ' pt-frame' : ''));
        it.appendChild(SB.el('span', 'feed-n', String(a.n)));
        const th = SB.el('span', 'feed-thumb');
        const src = a.kind === 'clay-clip' || a.kind === 'clay-still' ? SB.Blobs.src(P(), sh.pose.image)
          : a.kind === 'first-frame' ? SB.Blobs.src(P(), sh.image)
            : (function () { const x = m.figures.filter(function (f) { return f.asset === a; })[0]; return x ? SB.Blobs.src(P(), x.img) : ''; })();
        if (src) { const im = document.createElement('img'); im.src = src; th.appendChild(im); }
        else th.textContent = a.kind === 'clay-clip' ? '▶' : '?';
        it.appendChild(th);
        it.appendChild(SB.el('span', 'feed-file', a.h3));
        it.appendChild(SB.el('span', 'feed-who', a.kind === 'clay-clip' ? 'the blocking, animated (clay clip)'
          : a.kind === 'clay-still' ? 'the blocking (clay render)' : a.role));
        it.title = a.h3 + ' — ' + a.role + '. Goes up as ' + a.file + ' in the MiniMax package.';
        it.classList.add('mxm-fe');
        wrap.appendChild(it);
      });
      if (!m.frame) {
        wrap.appendChild(SB.el('div', 'pt-none', 'no still needed — the blocking is the reference' +
          (m.clip ? '' : '; record a performance in Pose Bench for the motion')));
      }
      mxmButton(wrap, sh, role);
      return wrap;
    }
    /* A still, exported: every reference as its own numbered file, no sheet. */
    const imod = role === 'image' ? SB.Model.imageModel(P()) : null;
    if (imod && imod.export && SB.VExport) {
      const files = SB.VExport.imageFiles(P(), sh);
      files.forEach(function (x) {
        const it = SB.el('div', 'pt-fe');
        it.appendChild(SB.el('span', 'feed-n', String(x.n)));
        const th = SB.el('span', 'feed-thumb');
        if (x.url) { const im = document.createElement('img'); im.src = x.url; th.appendChild(im); }
        it.appendChild(th);
        it.appendChild(SB.el('span', 'feed-file', x.file));
        it.appendChild(SB.el('span', 'feed-who', x.cite + ' \u00b7 ' + x.label));
        it.title = x.cite + ' = ' + x.label + '. Uploaded by hand, in this order.';
        wrap.appendChild(it);
      });
      if (!files.length) wrap.appendChild(SB.el('div', 'pt-none', 'no files \u2014 the prompt is the whole call'));
      const b = SB.el('button', 'mini vexp-btn', '\u2913 Files');
      b.title = 'Download ' + files.length + ' file' + (files.length === 1 ? '' : 's') + ' in upload order, with prompt.txt and ORDER.txt';
      b.onclick = function () {
        b.disabled = true; setStatus('packing the files for ' + code + '\u2026');
        SB.VExport.zipImage(P(), sh, imod).then(function (z) { SB.VExport.save(z.blob, z.name); setStatus(''); })
          .catch(function (e) { setStatus(e.message || String(e), true); })
          .then(function () { b.disabled = false; });
      };
      wrap.appendChild(b);
      return wrap;
    }
    /* Exported: every file the clip is given, in upload order, as the prompt
       cites them, and one button that downloads them with the prompt. */
    const vmod = role === 'video' ? SB.Model.videoModel(P()) : null;
    if (vmod && vmod.export && SB.VExport) {
      const list = SB.VExport.assets(P(), sh);
      list.forEach(function (a) {
        const it = SB.el('div', 'pt-fe' + (a.kind === 'first-frame' ? ' pt-frame' : ''));
        it.appendChild(SB.el('span', 'feed-n', a.video ? 'V' + a.cite.split(' ')[1] : a.cite.split(' ')[1]));
        const th = SB.el('span', 'feed-thumb');
        const fig = a.kind === 'subject' ? a.manifest.figures.filter(function (x) { return x.asset && x.asset.n === a.n; })[0] : null;
        const src = a.kind === 'clay-clip' || a.kind === 'clay-still' ? SB.Blobs.src(P(), sh.pose.image)
          : a.kind === 'first-frame' ? (sh.image ? SB.Blobs.src(P(), sh.image) : '') : (fig ? SB.Blobs.src(P(), fig.img) : '');
        if (src) { const im = document.createElement('img'); im.src = src; th.appendChild(im); }
        else th.textContent = a.video ? '\u25b6' : '?';
        it.appendChild(th);
        it.appendChild(SB.el('span', 'feed-file', a.file));
        it.appendChild(SB.el('span', 'feed-who', a.cite + ' \u00b7 ' + (a.kind === 'clay-clip' ? 'the blocking, animated'
          : a.kind === 'clay-still' ? 'the blocking (clay render)' : a.role)));
        it.title = a.cite + ' = ' + a.role + '. Uploaded by hand, in this order.';
        wrap.appendChild(it);
      });
      if (!list.length) wrap.appendChild(SB.el('div', 'pt-none', 'no files \u2014 the prompt is the whole call'));
      const b = SB.el('button', 'mini vexp-btn', '\u2913 Files');
      b.title = 'Download ' + list.length + ' file' + (list.length === 1 ? '' : 's') + ' in upload order, with prompt.txt and ORDER.txt';
      b.onclick = function () {
        b.disabled = true; setStatus('packing the files for ' + code + '\u2026');
        SB.VExport.zip(P(), sh, vmod).then(function (z) { SB.VExport.save(z.blob, z.name); setStatus(''); })
          .catch(function (e) { setStatus(e.message || String(e), true); })
          .then(function () { b.disabled = false; });
      };
      wrap.appendChild(b);
      return wrap;
    }
    if (role === 'video') {
      const framed = !!(sh.render || sh.image);
      const head = SB.el('div', 'pt-fe pt-frame' + (framed ? '' : ' empty'));
      head.appendChild(SB.el('span', 'feed-n', framed ? '1' : '\u2013'));
      const th = SB.el('span', 'feed-thumb' + (framed ? '' : ' none'));
      if (framed && sh.image) {
        const im = document.createElement('img');
        im.src = SB.Blobs.src(P(), sh.image);
        th.appendChild(im);
      } else if (!framed) {
        th.textContent = '?';
      }
      head.appendChild(th);
      const full = framed && SB.Renders.has(P(), sh.render);
      head.appendChild(SB.el('span', 'feed-file' + (full ? '' : ' none'),
        full ? SB.Renders.fileName(sh.render.serial, sh.render.ext)
          : (framed ? 'board copy only' : 'not rendered yet')));
      head.appendChild(SB.el('span', 'feed-who', 'this card\u2019s frame'));
      head.title = framed
        ? 'The clip animates this. It is the only picture the video call is sent.'
        : 'There is no frame to animate yet. Render the first frame before pushing a clip, ' +
          'or the model invents the shot from the words instead of moving your picture.';
      wrap.appendChild(head);
      if (!list.length) return wrap;
    }
    if (!list.length) {
      /* Two lanes means this would be said twice on every row of a board that
         does not use references. The board itself says it once, on the card,
         where the description it is about is being typed. */
      if (role) return null;
      wrap.appendChild(SB.el('div', 'pt-none', 'no references'));
      return wrap;
    }
    /* one line per FILE, so the numbers down the column are the numbers in the
       prompt's mapping and in the folder */
    const notSent = role === 'video';
    /* How many of these the still push can actually carry, asked of the code
       that does the carrying. A sheet holds four; an API-key push holds none
       at all. The rest are named in the prompt and reach the model as words,
       which is a fine outcome to choose and a terrible one to discover from a
       face that came back wrong. */
    const refs = (!notSent && SB.Imagine && SB.Imagine.refsFor)
      ? SB.Imagine.refsFor(P(), sh, role) : null;
    const byKey = !!(refs && refs.byKey);
    const carries = refs ? (byKey ? 0 : refs.carries) : Infinity;
    const pics = SB.Refs.images(P(), sh, role);
    let dropped = 0;
    pics.forEach(function (e, i) {
      const rowOut = notSent || i >= carries;
      if (rowOut && !notSent) dropped++;
      const it = SB.el('div', 'pt-fe' + (e.kind === 'shot' ? ' is-shot' : '') +
        (rowOut ? ' not-sent' : ''));
      /* No number on the video lane: the only numbered picture there is the
         frame, and giving these one implied they went with it. A still that
         is not carried has no number in the call either. */
      it.appendChild(SB.el('span', 'feed-n', rowOut ? '\u00b7' : String(e.n)));

      const t = SB.el('span', 'feed-thumb');
      const im3 = document.createElement('img');
      im3.src = SB.Blobs.src(P(), e.img);
      t.appendChild(im3);
      it.appendChild(t);

      /* the blocking has no export serial — it is not a take — so it is named
         by its own version instead of a render filename */
      const file = e.kind === 'pose'
        ? 'blocking v' + ((sh.pose && sh.pose.serial) || 1)
        : SB.Renders.has(P(), e.render)
          ? SB.Renders.fileName(e.render.serial, e.render.ext)
          : null;
      const nameEl = SB.el('span', 'feed-file' + (file ? '' : ' none'),
        file || 'board copy only');
      it.appendChild(nameEl);
      it.appendChild(SB.el('span', 'feed-who', e.label + (e.role ? ' · ' + e.role : '')));
      (function () { const w = whenBtn(sh, e.id, role); if (w) it.appendChild(w); })();

      it.title = (notSent
        ? 'Not sent with the clip. The still was built from this and approved; the clip ' +
          'animates that frame. It is here because the video prompt was written knowing ' +
          'this is in the picture.'
        : rowOut
          ? (byKey
            ? 'Not sent: an API-key push carries no reference picture at all. This one is ' +
              'named in the prompt and reaches the model as words only. Sign in to ' +
              'ImagineArt to send it, or drop it in by hand there.'
            : 'Not sent: this push carries ' + carries + ' picture' +
              (carries === 1 ? '' : 's') + ' and this is number ' + e.n + '. It reaches the ' +
              'model as words only — drop it in by hand on ImagineArt if it has to be ' +
              'matched exactly.')
        : (file
          ? file + ' — the full-size original, carried in this file'
          : 'No original for this one: the board\'s 854×480 copy is what gets fed. Drop the ' +
            'picture in again and the original comes with it.')) +
        '\n' + e.label + (e.role ? ' (' + e.role + ')' : '');
      wrap.appendChild(it);
    });

    /* and said once in words as well, because a dimmed row is a thing you
       notice only if you already knew to look */
    if (dropped) {
      const note = SB.el('div', 'pt-fe-note', byKey
        ? 'signed out \u2014 no reference picture travels'
        : 'only the first ' + carries + ' travel \u2014 ' + dropped + ' go as words');
      note.title = byKey
        ? 'Signed in to ImagineArt, this push would carry ' +
          (carries || pics.length) + '. On an API key it carries none.'
        : 'A still push hands over ' + carries + ' picture' + (carries === 1 ? '' : 's') +
          '. The other ' + dropped + ' are described in the prompt but not supplied, so ' +
          'the model works from the words for those.';
      wrap.appendChild(note);
    }

    /* things that are referenced but have no picture behind them still have to
       be said — they are numbered nowhere and feed nothing */
    list.forEach(function (e) {
      if (e.images.length) return;
      /* controls are said once, together, below */
      if (e.as === 'control') return;
      const it = SB.el('div', 'pt-fe' + (e.kind === 'dead' ? ' dead' : ' empty') +
        (notSent ? ' not-sent' : ''));
      it.appendChild(SB.el('span', 'feed-n', '–'));
      it.appendChild(SB.el('span', 'feed-thumb none', '?'));
      it.appendChild(SB.el('span', 'feed-file none', e.kind === 'dead' ? 'gone' : 'no picture'));
      it.appendChild(SB.el('span', 'feed-who', e.label));
      (function () { const w = whenBtn(sh, e.id, role); if (w) it.appendChild(w); })();
      it.title = e.label + (e.why ? ' — ' + e.why : '');
      wrap.appendChild(it);
    });

    /* The blocking's control passes: listed so it is visible they exist, and
       plainly not sent — ImagineArt takes pictures, not depth or pose
       controls. They are rendered from the blocking for export. */
    const controls = list.filter(function (e) { return e.as === 'control'; });
    if (controls.length && role !== 'video') {
      const it = SB.el('div', 'pt-fe empty not-sent');
      it.appendChild(SB.el('span', 'feed-n', '·'));
      it.appendChild(SB.el('span', 'feed-thumb none', '⛹'));
      it.appendChild(SB.el('span', 'feed-file none', 'controls, not sent'));
      it.appendChild(SB.el('span', 'feed-who', controls.map(function (e) { return e.label; }).join(' · ')));
      it.title = 'Rendered from this card’s blocking when exported. ImagineArt has no ' +
        'depth or pose input, so nothing here is sent with the still — the blocking picture ' +
        '(number 1) is what carries the layout.';
      wrap.appendChild(it);
    }

    /* The MiniMax package (mxm.js): the numbered files, the prompt and the
       upload order, written from one list so they cannot disagree. The still
       lane's is MiniMax Image (clay render + each subject's picture); the video
       lane's is MiniMax H3 full reference (clip, first frame, subjects) — a
       different call from the ImagineArt push above, which carries the frame
       alone. */
    mxmButton(wrap, sh, role);
    return wrap;
  }

  function refreshFeedCell(id) {
    if (!root) return;
    const f = SB.Model.findShot(P(), id);
    if (!f) return;
    ['image', 'video'].forEach(function (role) {
      const cell = bodyEl.querySelector('.pt-feed[data-feed-cell="' + id + ':' + role + '"]');
      if (!cell) return;
      cell.innerHTML = '';
      const fl = feedList(f.shot, f.code, role);
      if (fl) cell.appendChild(fl);
    });
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
