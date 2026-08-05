/* index.js — the Premiere side.
 *
 * Walks the active sequence for cuts, exports one JPEG per cut, slices the
 * transcript at those same cut times, and writes a .storyboard file that opens
 * straight in Storyboarder.
 *
 * The Text panel itself is not scriptable — there is no API for its contents or
 * its caret — so the script comes from an exported transcript (SRT / VTT /
 * transcript JSON). Those carry real timecodes, which pin each word to a cut
 * far more reliably than a cursor position could.
 */
(function () {
  'use strict';

  const ppro = require('premierepro');
  const uxp = require('uxp');
  const fs = uxp.storage.localFileSystem;
  const formats = uxp.storage.formats;

  const T = globalThis.SBTranscript;
  const Board = globalThis.SBBoard;
  const B64 = globalThis.SBB64;
  const Cuts = globalThis.SBCuts;
  const Host = globalThis.SBHost;
  const WriteJson = globalThis.SBWriteJson;

  const el = function (id) { return document.getElementById(id); };

  const state = {
    sequence: null,
    guid: '',            // to catch the user switching sequences without refreshing
    fps: 30,
    frameW: 1920,
    frameH: 1080,
    zeroPoint: 0,        // display offset only; clip times stay zero-based
    tracks: [],          // [{index, name, shots:[{start,end,name}]}]
    words: null,
    transcriptName: '',
    framesFolder: null,  // null = the plugin's temp folder
    rawDir: '',
    probeSeconds: 0
  };

  /* Sequence and file names are user data going into innerHTML. */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function guidOf(seq) {
    try { return String(seq.guid && seq.guid.toString ? seq.guid.toString() : seq.guid || ''); }
    catch (e) { return ''; }
  }

  /* ---------- logging ---------- */

  function log(msg, cls) {
    const box = el('log');
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = msg;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
  }

  function clearLog() { el('log').innerHTML = ''; }

  function fail(e) {
    log((e && e.message) ? e.message : String(e), 'err');
  }

  /* ---------- small helpers ---------- */

  /* Premiere wants a plain native directory path with a trailing separator. */
  function dirPath(entry) {
    let p = String(entry.nativePath).replace(/\\/g, '/');
    if (p[p.length - 1] !== '/') p += '/';
    return p;
  }

  function even(n) { return Math.max(2, Math.round(n / 2) * 2); }

  /* The card code Storyboarder will show for shot i. Everything lands in scene 1,
   * so this matches SB.letters: 1A, 1B … 1Z, 1AA. Named in the log so a failure
   * points at a card you can actually find on the board. */
  function SB_CODE(i) {
    let s = '';
    i = i | 0;
    do { s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26) - 1; }
    while (i >= 0);
    return '1' + s;
  }

  /* ---------- sequence metrics ----------
   *
   * These accessors have moved between Premiere builds — getVideoFrameRate() on
   * the settings object is missing on some of them. Frame rate and frame size are
   * needed, but never so badly that failing to read them should stop the panel
   * finding the sequence, so every lookup is probed and falls through to the next.
   */

  const tryCall = Host.tryCall;
  const secondsOf = Host.secondsOf;

  async function readSequenceMetrics(seq) {
    const m = await Host.readMetrics(seq, function () { return seq.getSettings(); });
    state.fps = m.fps;
    state.frameW = m.width;
    state.frameH = m.height;
    state.zeroPoint = m.zeroPoint;

    if (m.guessedFps || m.guessedSize) {
      log('Could not read the sequence ' +
        (m.guessedFps && m.guessedSize ? 'frame rate or frame size' :
          m.guessedFps ? 'frame rate' : 'frame size') +
        ' — assuming ' + state.fps + ' fps, ' + state.frameW + '×' + state.frameH + '.', 'warn');
      log('  sequence methods: ' + Host.methodsOf(seq), 'muted');
      if (m.settings) log('  settings methods: ' + Host.methodsOf(m.settings), 'muted');
    }
  }

  /* ---------- reading the sequence ---------- */

  async function readSequence() {
    const project = await ppro.Project.getActiveProject();
    if (!project) throw new Error('No project is open.');
    const seq = await project.getActiveSequence();
    if (!seq) throw new Error('No sequence is active. Open a sequence in the Timeline first.');

    state.sequence = seq;
    state.guid = guidOf(seq);
    await readSequenceMetrics(seq);

    const count = await seq.getVideoTrackCount();
    const tracks = [];
    let skipped = 0;
    for (let i = 0; i < count; i++) {
      const track = await seq.getVideoTrack(i);
      const items = await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
      const shots = [];
      for (let j = 0; j < items.length; j++) {
        const item = items[j];
        const start = secondsOf(await tryCall(item, ['getStartTime']));
        const end = secondsOf(await tryCall(item, ['getEndTime']));
        if (start === null || end === null || !(end > start)) {
          skipped++;
          continue;                           // unreadable clip, not a silent zero-length card
        }
        const name = (await tryCall(item, ['getName'])) || '';
        const isAdjustment = await tryCall(item, ['isAdjustmentLayer']);
        shots.push({
          start: start, end: end, name: String(name), isAdjustment: !!isAdjustment
        });
      }
      shots.sort(function (a, b) { return a.start - b.start; });
      const muted = await tryCall(track, ['isMuted']);
      tracks.push({
        index: i,
        name: track.name || ('V' + (i + 1)),
        muted: !!muted,
        shots: shots
      });
    }
    state.tracks = tracks;
    if (skipped) log(skipped + ' clip(s) had unreadable times and were left out.', 'warn');
    return seq;
  }

  /* Premiere numbers video tracks bottom-up; the list shows V1 last so it reads
   * the same way round as the timeline. */
  function populateTracks() {
    const box = el('trackList');
    box.innerHTML = '';
    const ordered = state.tracks.slice().reverse();
    ordered.forEach(function (t) {
      const row = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = String(t.index);
      cb.className = 'trackCb';
      // every track carrying picture counts by default; muted ones do not show
      cb.checked = t.shots.length > 0 && !t.muted;
      cb.disabled = !t.shots.length;
      if (!t.shots.length || t.muted) row.className = 'off';

      const name = document.createElement('span');
      name.textContent = 'V' + (t.index + 1) + (t.muted ? ' (hidden)' : '');
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = t.shots.length + (t.shots.length === 1 ? ' clip' : ' clips');

      row.appendChild(cb);
      row.appendChild(name);
      row.appendChild(count);
      cb.addEventListener('change', previewCuts);
      box.appendChild(row);
    });
  }

  function checkedTrackIndexes() {
    const out = [];
    const boxes = document.getElementsByClassName('trackCb');
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].checked && !boxes[i].disabled) out.push(Number(boxes[i].value));
    }
    return out;
  }

  function cutOptions() {
    const mode = el('mode').value;
    return {
      mode: mode,
      trackIndexes: checkedTrackIndexes(),
      // The threshold is a tool for untangling a stacked timeline. On a
      // scene-detected export every clip is a real cut, including the fast ones,
      // so nothing may be dropped — and the control is hidden in this mode, which
      // would leave no way to put a vanished shot back.
      minDuration: mode === 'track' ? 0 : Math.max(0, Number(el('minDur').value) || 0),
      ignoreAdjustment: el('ignoreAdj').checked,
      fps: state.fps
    };
  }

  function findCuts() {
    return Cuts.find(state.tracks, cutOptions());
  }

  /* Live count, so the effect of a track or threshold change is visible before
   * committing to an export run. */
  function previewCuts() {
    if (!state.tracks.length) { el('cutInfo').textContent = ''; return; }
    const single = el('mode').value === 'track';
    el('minRow').style.display = single ? 'none' : '';
    const cuts = findCuts();
    const picked = checkedTrackIndexes().length;
    if (!picked) {
      el('cutInfo').innerHTML = '<span class="warn">No tracks ticked.</span>';
    } else if (single) {
      el('cutInfo').textContent = cuts.length + ' cards — every clip boundary on the ' +
        'topmost ticked track.';
    } else {
      el('cutInfo').textContent = cuts.length + ' cards from ' + picked +
        (picked === 1 ? ' track' : ' tracks') + '.';
    }
    return cuts;
  }

  async function refresh() {
    clearLog();
    el('seqInfo').textContent = 'Reading sequence…';
    try {
      // pinned in the log because these APIs differ between builds
      try { log('Premiere ' + ppro.Application.version, 'muted'); } catch (e) { /* optional */ }
      const seq = await readSequence();
      populateTracks();
      el('seqInfo').innerHTML = '<b>' + esc(seq.name) + '</b> · ' +
        state.fps.toFixed(2).replace(/\.00$/, '') + ' fps · ' +
        state.frameW + '×' + state.frameH;
      const cuts = previewCuts();
      const used = state.tracks.filter(function (t) { return t.shots.length; }).length;
      log('Sequence read — ' + used + ' video ' + (used === 1 ? 'track' : 'tracks') +
        ' with clips, ' + (cuts ? cuts.length : 0) + ' cuts.',
        (cuts && cuts.length) ? 'ok' : 'warn');
    } catch (e) {
      el('seqInfo').textContent = 'No sequence loaded.';
      fail(e);
    }
  }

  /* ---------- transcript ---------- */

  async function pickTranscript() {
    try {
      const file = await fs.getFileForOpening({
        types: ['srt', 'vtt', 'json', 'txt'],
        allowMultiple: false
      });
      if (!file) return;
      const text = await file.read();
      state.words = T.parse(text, file.name);
      state.transcriptName = file.name;
      el('transcriptInfo').innerHTML = '<b>' + esc(file.name) + '</b> · ' +
        state.words.length + ' words';
      log('Transcript loaded: ' + state.words.length + ' words, ' +
        T.secondsToTimecode(state.words[state.words.length - 1].end, state.fps) + ' long.', 'ok');
    } catch (e) {
      state.words = null;
      el('transcriptInfo').textContent = 'None chosen.';
      fail(e);
    }
  }

  /* ---------- frame export ---------- */

  /* Premiere writes frames with native host code, which does not necessarily have
   * the same reach as the plugin. UXP's temporary folder is sandboxed under the
   * plugin's own storage, and the host exporter can refuse to write there —
   * Adobe's own example uses an ordinary path like 'C:/temp/'. So the folder is
   * choosable, and temp is only the default. */
  async function framesFolder() {
    if (state.framesFolder) return state.framesFolder;
    const tmp = await fs.getTemporaryFolder();
    try {
      return await tmp.createFolder('storyboarder-frames');
    } catch (e) {
      return await tmp.getEntry('storyboarder-frames');   // already there from a previous run
    }
  }

  async function pickFramesFolder() {
    try {
      const folder = await fs.getFolder();
      if (!folder) return;
      state.framesFolder = folder;
      el('folderInfo').textContent = folder.name;
      log('Frames will be written to ' + dirPath(folder), 'muted');
    } catch (e) {
      fail(e);
    }
  }

  /* Distinguishes "the plugin cannot reach this folder" from "Premiere will not
   * write here" — without it, both look identical from the log. */
  async function uxpCanWrite(folder) {
    try {
      const f = await folder.createFile('sb_write_test.txt', { overwrite: true });
      await f.write('ok');
      try { await f.delete(); } catch (e) { /* tidy-up only */ }
      return true;
    } catch (e) {
      return false;
    }
  }

  /* Grab a frame a little way into the shot, so a dissolve on the cut itself
   * doesn't hand back a half-mixed or black frame. Snapped to a whole frame —
   * see lib/cuts.js. */
  const grabTime = Cuts.grabTime;

  /* TickTime construction has moved between builds too. */
  function makeTime(seconds) {
    const TT = ppro.TickTime;
    if (TT && typeof TT.createWithSeconds === 'function') {
      try { return TT.createWithSeconds(seconds); } catch (e) { /* try the next */ }
    }
    if (TT && typeof TT.createWithTicks === 'function') {
      try {
        return TT.createWithTicks(String(Math.round(seconds * T.TICKS_PER_SECOND)));
      } catch (e) { /* try the next */ }
    }
    if (TT && typeof TT.createWithFrameAndFrameRate === 'function' &&
        ppro.FrameRate && typeof ppro.FrameRate.createWithValue === 'function') {
      try {
        return TT.createWithFrameAndFrameRate(
          Math.round(seconds * state.fps), ppro.FrameRate.createWithValue(state.fps));
      } catch (e) { /* out of options */ }
    }
    throw new Error('Cannot build a TickTime on this build. TickTime has: ' +
      Host.methodsOf(TT || {}));
  }

  function wait(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  async function entryNames(folder) {
    try {
      const entries = await folder.getEntries();
      return (entries || []).map(function (e) { return e.name; });
    } catch (e) {
      return [];
    }
  }

  /* Remove anything left from an earlier attempt, so the probe cannot mistake a
   * stale file for a successful export. */
  async function clearMatching(folder, prefix) {
    const names = await entryNames(folder);
    for (let i = 0; i < names.length; i++) {
      if (names[i].indexOf(prefix) !== 0) continue;
      try {
        const e = await folder.getEntry(names[i]);
        if (e) await e.delete();
      } catch (err) { /* best effort */ }
    }
  }

  /* Premiere writes the file with native code, not through UXP's filesystem, so
   * the entry can take a moment to appear — and listing the folder is what busts
   * UXP's cached view of it.
   *
   * The name is never assumed. Premiere appends the extension a second time
   * (Adobe's own sample logs "output.png.png *(We do double extension)*"), and
   * it may sanitise the name besides — so anything that was NOT in the folder
   * before this export counts, with the expected basename merely preferred.
   * `before` is the listing taken immediately prior to the export call.
   */
  async function waitForFile(folder, prefix, before) {
    const wasThere = {};
    (before || []).forEach(function (n) { wasThere[n] = 1; });

    // A heavy frame — long-GOP source, stacked effects — can take seconds to
    // render. Waiting ~1s was enough for most and not for all, which is what an
    // occasional missing card looks like.
    let waited = 0;
    for (let attempt = 0; attempt < 40 && waited < 20000; attempt++) {
      const names = await entryNames(folder);
      const fresh = names.filter(function (n) { return !wasThere[n]; });
      const name = Host.matchExported(fresh, prefix) ||
        Host.matchExported(names, prefix) ||
        (fresh.length === 1 ? fresh[0] : null);
      if (name) {
        try {
          const entry = await folder.getEntry(name);
          if (entry) return entry;
        } catch (e) { /* listed but not readable yet */ }
      }
      const pause = attempt < 4 ? 30 : (attempt < 12 ? 150 : 500);
      await wait(pause);
      waited += pause;
    }
    return null;
  }

  /* Read only once the file has stopped growing. Premiere is still writing when
   * the entry first appears, and a read that lands mid-write returns a truncated
   * or empty buffer — which looked exactly like a failed export. */
  async function readStable(entry) {
    let last = -1;
    for (let attempt = 0; attempt < 10; attempt++) {
      let buf = null;
      try {
        buf = await entry.read({ format: formats.binary });
      } catch (e) { /* still locked by the writer */ }
      const size = buf ? buf.byteLength : 0;
      if (size > 0 && size === last) return buf;      // two identical reads: done
      last = size;
      await wait(attempt < 4 ? 40 : 150);
    }
    // one last go, in case it settled on the final pass
    try {
      const buf = await entry.read({ format: formats.binary });
      return (buf && buf.byteLength) ? buf : null;
    } catch (e) {
      return null;
    }
  }

  const exportPlans = Host.exportPlans;

  async function attempt(seq, folder, plan, time) {
    await clearMatching(folder, plan.prefix);
    const before = await entryNames(folder);
    let returned;
    try {
      returned = await ppro.Exporter.exportSequenceFrame(
        seq, time, plan.filename, plan.filepath, plan.w, plan.h);
    } catch (e) {
      return { ok: false, why: (e && e.message) ? e.message : String(e) };
    }
    const entry = await waitForFile(folder, plan.prefix, before);
    if (!entry) {
      return { ok: false, why: returned === false ? 'returned false' : 'no file appeared' };
    }
    return { ok: true, entry: entry };
  }

  function describePlan(t) {
    return t.shape.ext + ' ' + t.shape.w + '×' + t.shape.h + ', ' + t.plan.label;
  }

  /* Work out a working call convention once, then reuse it for every frame. */
  async function probeExport(seq, folder, dir, baseName, w, h) {
    // scaled JPEG first, then PNG, then the sequence's own size in case the
    // scaler is what this build objects to
    const shapes = [
      { ext: 'jpg', w: w, h: h },
      { ext: 'png', w: w, h: h },
      { ext: 'jpg', w: state.frameW, h: state.frameH }
    ];
    const found = await Host.probeVariants(
      shapes,
      function (shape) {
        return exportPlans(dir, baseName, shape.ext, shape.w, shape.h, state.rawDir);
      },
      function (plan) { return attempt(seq, folder, plan, makeTime(state.probeSeconds)); }
    );

    if (found.plan) {
      if (found.fallback) {
        log('Frame export needed a fallback: ' +
          describePlan({ plan: found.plan, shape: found.shape }) + '.', 'warn');
      }
      return { plan: found.plan, entry: found.result.entry };
    }

    log('Could not export a frame. Tried:', 'err');
    found.tried.forEach(function (t) { log('  ' + describePlan(t) + ' → ' + t.why, 'muted'); });
    log('  folder: ' + dir, 'muted');
    log('  Exporter has: ' + Host.methodsOf(ppro.Exporter || {}), 'muted');
    log('  TickTime has: ' + Host.methodsOf(ppro.TickTime || {}), 'muted');

    // Was it the time we asked for, or the destination? Retry at the very start of
    // the sequence, at its native size, using the constant rather than a built time.
    let zeroWorked = false;
    try {
      const zero = (ppro.TickTime && ppro.TickTime.TIME_ZERO) || makeTime(0);
      const plan = exportPlans(dir, 'sb_zero', 'png',
        state.frameW, state.frameH, state.rawDir)[0];
      const res = await attempt(seq, folder, plan, zero);
      zeroWorked = res.ok;
      if (res.ok) { try { await res.entry.delete(); } catch (e) { /* tidy-up */ } }
      log('  sanity export at 00:00:00:00 → ' + (res.ok ? 'worked' : res.why), 'muted');
    } catch (e) {
      log('  sanity export threw: ' + ((e && e.message) || e), 'muted');
    }

    if (zeroWorked) {
      log('The destination is fine — it is the grab times being rejected. ' +
        'Try setting the frame offset to 0.', 'warn');
    } else if (!state.framesFolder) {
      log('Premiere may be refusing to write into the plugin\'s sandboxed temp folder. ' +
        'Set Frames folder → Choose… to an ordinary folder (Documents, or next to the ' +
        'project) and build again.', 'warn');
    } else {
      log('Premiere would not write into that folder either. Check it is on a local ' +
        'drive and writable.', 'warn');
    }
    return null;
  }

  async function readAndBin(entry, w, h, ext) {
    const buf = await readStable(entry);
    try { await entry.delete(); } catch (e) { /* leftover is harmless */ }
    if (!buf || !buf.byteLength) return null;
    // the extension we asked for is not proof of what was written
    const mime = Host.sniffImageType(buf) || (ext === 'png' ? 'image/png' : 'image/jpeg');
    return { data: 'data:' + mime + ';base64,' + B64.encode(buf), w: w, h: h };
  }

  /* One shot, trying its preferred frame first and then a few others. A frame
   * Premiere will not render is rarer than it is fatal — another frame from the
   * same shot is a far better card than an empty one. */
  async function exportFrame(seq, folder, dir, index, shot, offset, plan) {
    const baseName = 'sb_' + String(index + 1).padStart(4, '0');
    const p = exportPlans(dir, baseName, plan.ext, plan.w, plan.h, state.rawDir)
      .filter(function (x) { return x.label === plan.label; })[0];

    const primary = grabTime(shot, offset, state.fps);
    const times = [primary].concat(Cuts.grabAlternatives(shot, offset, state.fps));
    // A one-frame shot has no other frame to offer, so it used to get exactly one
    // attempt — the shortest shots were the least likely to survive a transient
    // failure. Everything gets at least three goes.
    while (times.length < 3) times.push(primary);

    let why = 'no attempt made';
    for (let i = 0; i < times.length; i++) {
      let res;
      try {
        res = await attempt(seq, folder, p, makeTime(times[i]));
      } catch (e) {
        res = { ok: false, why: (e && e.message) ? e.message : String(e) };
      }
      if (res.ok) {
        const image = await readAndBin(res.entry, plan.w, plan.h, plan.ext);
        if (image) return { image: image, retried: i > 0 };
        why = 'file was empty';
      } else {
        why = res.why;
      }
    }
    return { image: null, why: why };
  }

  /* ---------- build ---------- */

  async function build() {
    clearLog();
    const btn = el('build');
    btn.disabled = true;
    try {
      if (!state.sequence) {
        await readSequence();
        populateTracks();
      } else {
        // switching sequences without hitting Refresh would export frames from
        // the old timeline against the new one's cuts
        const liveProject = await ppro.Project.getActiveProject();
        const live = liveProject ? await liveProject.getActiveSequence() : null;
        if (live && guidOf(live) !== state.guid) {
          throw new Error('The active sequence changed to “' + live.name +
            '”. Hit Refresh, then build again.');
        }
      }
      if (!checkedTrackIndexes().length) throw new Error('Tick at least one track.');
      const shots = findCuts();
      if (!shots.length) throw new Error('No cuts found on the ticked tracks.');
      if (!state.words) throw new Error('Choose a transcript file first.');

      const offset = Math.max(0, Number(el('offset').value) || 0);
      const w = even(Number(el('width').value) || 854);
      const h = even(w * (state.frameH / state.frameW));

      // ask for the destination before doing any work, so a cancel costs nothing
      const outName = (state.sequence.name || 'sequence').replace(/[\\/:*?"<>|]+/g, '_');
      const outFile = await fs.getFileForSaving(outName + '.storyboard', {
        types: ['storyboard', 'json']
      });
      if (!outFile) { log('Cancelled.', 'muted'); return; }

      const folder = await framesFolder();
      const dir = dirPath(folder);
      state.rawDir = String(folder.nativePath || '');   // what Adobe's own sample passes
      log('Frames folder: ' + state.rawDir, 'muted');
      if (!(await uxpCanWrite(folder))) {
        log('  the plugin itself cannot write there — pick a different folder.', 'warn');
      }
      log('Exporting ' + shots.length + ' frames at ' + w + '×' + h + '…');

      // settle on a working call convention using the first shot's own grab time
      state.probeSeconds = grabTime(shots[0], offset, state.fps);
      const probe = await probeExport(state.sequence, folder, dir, 'sb_0001', w, h);

      const failures = [];
      let retried = 0;
      if (!probe) {
        shots.forEach(function (s, i) {
          s.image = null;
          failures.push({ i: i, shot: s, why: 'no working export convention' });
        });
      } else {
        shots[0].image = await readAndBin(probe.entry, probe.plan.w, probe.plan.h, probe.plan.ext);
        if (!shots[0].image) failures.push({ i: 0, shot: shots[0], why: 'file was empty' });
        for (let i = 1; i < shots.length; i++) {
          let res;
          try {
            res = await exportFrame(
              state.sequence, folder, dir, i, shots[i], offset, probe.plan);
          } catch (e) {
            res = { image: null, why: (e && e.message) ? e.message : String(e) };
          }
          shots[i].image = res.image;
          if (res.retried) retried++;
          if (!res.image) failures.push({ i: i, shot: shots[i], why: res.why });
          if ((i + 1) % 5 === 0 || i === shots.length - 1) {
            log('  ' + (i + 1) + ' / ' + shots.length + ' frames');
          }
        }
      }
      if (retried) {
        log(retried + ' frame(s) needed a different frame from the same shot.', 'muted');
      }

      /* A second sweep over whatever is still missing. Most of these failures are
       * transient — Premiere busy, a frame slow to render — and simply asking
       * again a moment later usually gets them. Cheap, because by now there are
       * only a handful left. */
      if (probe && failures.length) {
        log('Retrying ' + failures.length + ' missing frame(s)…');
        await wait(600);
        const stillMissing = [];
        for (let k = 0; k < failures.length; k++) {
          const f = failures[k];
          let res;
          try {
            res = await exportFrame(
              state.sequence, folder, dir, f.i, f.shot, offset, probe.plan);
          } catch (e) {
            res = { image: null, why: (e && e.message) ? e.message : String(e) };
          }
          if (res.image) {
            shots[f.i].image = res.image;
          } else {
            f.why = res.why;
            stillMissing.push(f);
          }
        }
        const recovered = failures.length - stillMissing.length;
        if (recovered) log('  recovered ' + recovered + ' on the second pass.', 'ok');
        failures.length = 0;
        stillMissing.forEach(function (f) { failures.push(f); });
      }

      if (failures.length) {
        log(failures.length + ' of ' + shots.length + ' frame(s) could not be exported — ' +
          'those cards come through empty:', 'warn');
        failures.slice(0, 12).forEach(function (f) {
          log('  card ' + SB_CODE(f.i) + ' at ' +
            T.secondsToTimecode(f.shot.start + state.zeroPoint, state.fps) +
            ' (' + (f.shot.end - f.shot.start).toFixed(2) + 's) → ' + f.why, 'muted');
        });
        if (failures.length > 12) log('  …and ' + (failures.length - 12) + ' more', 'muted');
      }

      const project = Board.build(shots, state.words, {
        sequenceName: state.sequence.name,
        fps: state.fps,
        sceneHeading: state.sequence.name || 'Scene one'
      });

      /* Written, read back and parsed before we claim it worked — a partial
       * write here only shows up as "Unexpected end of JSON input" much later,
       * when the board is opened. */
      const written = await WriteJson.writeJson(outFile, project, formats, log);

      const withText = project.scenes[0].shots.filter(function (s) { return !!s.link; }).length;
      log('Wrote ' + outFile.name + ' — ' + Math.round(written.bytes / 1024) + ' KB, verified', 'ok');
      log(shots.length + ' cards · ' + withText + ' with script · ' +
        (shots.length - missed) + ' with a frame');
      log('Open it in Storyboarder with Open project…', 'muted');
    } catch (e) {
      fail(e);
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- wiring ---------- */

  el('refresh').addEventListener('click', refresh);
  el('pickTranscript').addEventListener('click', pickTranscript);
  el('pickFolder').addEventListener('click', pickFramesFolder);
  el('build').addEventListener('click', build);
  el('mode').addEventListener('change', previewCuts);
  el('minDur').addEventListener('change', previewCuts);
  el('ignoreAdj').addEventListener('change', previewCuts);

  refresh();
})();
