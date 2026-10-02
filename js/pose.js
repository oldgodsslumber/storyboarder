/* pose.js — blocking a shot in 3D.
 *
 * Pose Bench (posebench/pose.html, carried into this build as SB_POSEBENCH_SRC
 * by build.mjs) poses mannequins, props and a camera. Opened from a card, it
 * hands back:
 *
 *   - the SCENE — figures, props, camera — which is the source of truth and is
 *     what reopening restores, exactly;
 *   - a BEAUTY render — grey mannequins on a plain ground — which travels with
 *     the still push as the card's layout reference (Refs.feed puts it first);
 *   - the BLOCKING TEXT — who is where, facing what, doing what — which goes
 *     into the prompt writer's input, and is the only layout the API-key door
 *     (no picture at all) ever receives;
 *   - which mannequin is which subject, and its colour, so the prompt can say
 *     "the tan mannequin is Nat".
 *
 * It is NOT written into the frame. The frame is where a still lands; the next
 * render would bank the blocking as a take and it would stop feeding. An empty
 * frame SHOWS the blocking (board.js) without holding it.
 *
 * Depth / OpenPose / normal / mask passes are not stored. They are rendered
 * from the scene when something asks (passes()), so they can never disagree
 * with it and a board does not carry four extra PNGs per card. ImagineArt has
 * no control input, so they are for export and for a future control route —
 * the feed lists them as `as:'control'` entries that nothing sends yet.
 *
 * A recorded PERFORMANCE (a Pose Bench motion take: webcam or video file,
 * baked onto the mannequins) belongs to the scene, not to a card —
 * scene.performances[] — so one performance is recut across the scene's cards.
 * A card that uses one records which, through which camera, over which range
 * and at which moment its still was taken, in shot.pose.perf. Its reference
 * clip is rendered from that on demand (clip()), like the passes.
 *
 * shot.pose = { serial, scene, image{ref,w,h}, render{ref,w,h}, cast[], text,
 *               lens, aspect, at,
 *               perf: null | {id, name, version, at, in, out, cam, camName, view, fps, cut} }
 */
(function (SB) {
  'use strict';

  function P() { return SB.app.project; }
  const LONG_EDGE = 1536;
  const CLIP_EDGE = 1280;    // a reference clip: 720p at 16:9
  const PASSES = ['depth', 'openpose', 'normal', 'mask'];

  let editor = null;     // {shotId, token, back, frame, code}
  let worker = null;     // hidden instance rendering passes: {frame, ready, queue}

  function available() { return typeof window.SB_POSEBENCH_SRC === 'string' && !!window.SB_POSEBENCH_SRC; }
  function token() { return 'pb_' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
  /* The ratios a shot can be blocked at: the ones the image models are asked for (Settings → ImagineArt). A shot
     keeps its own (pose.aspect, chosen in Pose Bench); without one it is the board's. */
  const ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2'];
  function boardAspect(p) { return SB.Imagine && SB.Imagine.aspectOf ? SB.Imagine.aspectOf(p) : '16:9'; }
  function aspectFor(p, shot) {
    const a = shot && shot.pose && shot.pose.aspect;
    return a && ASPECTS.indexOf(a) >= 0 ? a : boardAspect(p);
  }
  function has(shot) { return !!(shot && shot.pose && shot.pose.image && shot.pose.scene); }

  /* ---------- the scene blob ---------- */

  /* ASCII-safe (Blobs hashes bytes as ASCII): percent-encoded JSON. */
  function putJson(p, o) {
    return SB.Blobs.put(p, 'data:application/json,' + encodeURIComponent(JSON.stringify(o)));
  }
  function readJson(p, ref) {
    const u = SB.Blobs.get(p, ref);
    const i = u.indexOf(',');
    if (i < 0) return null;
    try { return JSON.parse(decodeURIComponent(u.slice(i + 1))); } catch (e) { return null; }
  }
  function putScene(p, scene) { return putJson(p, scene); }
  function sceneOf(p, shot) {
    if (!has(shot)) return null;
    return readJson(p, shot.pose.scene);
  }

  /* ---------- performances ---------- */

  function perfsOf(sc) { return (sc && Array.isArray(sc.performances)) ? sc.performances : []; }

  /* Anywhere on the board: a card can have been moved or copied out of the
     scene its performance was recorded in. */
  function findPerf(p, id) {
    if (!id) return null;
    for (let i = 0; i < p.scenes.length; i++) {
      const rec = perfsOf(p.scenes[i]).filter(function (r) { return r.id === id; })[0];
      if (rec) return { rec: rec, scene: p.scenes[i] };
    }
    return null;
  }
  function perfLink(shot) { return (shot && shot.pose && shot.pose.perf) || null; }
  function perfOf(p, shot) {
    const L = perfLink(shot);
    const f = L && findPerf(p, L.id);
    return f ? f.rec : null;
  }
  /* The performance this card was cut from has changed since — re-baked,
     corrected, its cameras moved — or is gone. */
  function perfStale(p, shot) {
    const L = perfLink(shot);
    if (!L) return false;
    const rec = perfOf(p, shot);
    return !rec || (rec.version | 0) > (L.version | 0);
  }

  /* Everything Pose Bench hands back replaces the scene's list; a performance
     that lives in another scene (the card came from there) is updated where
     it lives. */
  function storePerfs(p, sc, snaps) {
    const now = Date.now();
    const mine = [];
    snaps.forEach(function (s) {
      if (!s || !s.id) return;
      const rec = { id: String(s.id), name: String(s.name || 'Take'), dur: +s.dur || 0,
        version: s.version | 0 || 1, data: putJson(p, s), at: now };
      const elsewhere = findPerf(p, rec.id);
      if (elsewhere && elsewhere.scene !== sc) {
        const i = elsewhere.scene.performances.indexOf(elsewhere.rec);
        if (elsewhere.rec.data === rec.data) rec.at = elsewhere.rec.at;
        elsewhere.scene.performances[i] = rec;
        return;
      }
      const old = perfsOf(sc).filter(function (r) { return r.id === rec.id; })[0];
      if (old && old.data === rec.data) rec.at = old.at;
      mine.push(rec);
    });
    sc.performances = mine;
  }

  function cleanLink(L) {
    if (!L || !L.id) return null;
    const n = function (v) { return typeof v === 'number' && isFinite(v) ? Math.round(v * 1000) / 1000 : 0; };
    const v = L.view;
    return {
      id: String(L.id), name: String(L.name || ''), version: L.version | 0 || 1,
      at: n(L.at), in: n(L.in), out: n(L.out),
      cam: L.cam ? String(L.cam) : null, camName: String(L.camName || ''),
      view: v && typeof v === 'object' && Array.isArray(v.target)
        ? { theta: +v.theta || 0, phi: +v.phi || 0, radius: +v.radius || 1, target: v.target.slice(0, 3).map(Number), mm: +v.mm || 35 }
        : null,
      fps: +L.fps || 24,
      cut: !!L.cut
    };
  }

  function castFor(p, shot) {
    return SB.Personas.forShot(p, shot).map(function (per) {
      return { id: per.id, name: per.name || 'unnamed', kind: SB.Personas.kindOf(per).id };
    });
  }

  function codeOf(p, shot) {
    const f = SB.Model.findShot(p, shot.id);
    return f ? f.code : '';
  }

  /* The name a linked subject has NOW — a rename after blocking must not leave
     the prompt calling somebody by their old name. */
  function nameOf(p, c) {
    const per = (p.personas || []).filter(function (x) { return x.id === c.personaId; })[0];
    return per ? (per.name || 'unnamed') : (c.name || '');
  }

  /* The full-size copy: WebP at native size, like Renders.keep, but without a
     serial — the blocking is not a take and is never exported as one. */
  function encodeOriginal(dataUrl) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.onload = function () {
        const w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) { reject(new Error('the blocking render had no size')); return; }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0);
        let out = '';
        try { out = c.toDataURL('image/webp', 0.9); } catch (e) { out = ''; }
        if (!/^data:image\/webp/.test(out)) out = c.toDataURL('image/jpeg', 0.92);
        resolve({ data: out, w: w, h: h });
      };
      img.onerror = function () { reject(new Error('could not decode the blocking render')); };
      img.src = dataUrl;
    });
  }

  /* ---------- the editor ---------- */

  function frameFor(cls) {
    const fr = document.createElement('iframe');
    /* the name is how Pose Bench knows it is embedded: synchronous, and
       readable before its first line runs */
    fr.name = 'posebench-embed';
    fr.className = cls;
    /* camera: Pose Bench can pose a figure from the webcam (pose_from_camera_plan.md). `camera *`, not
       plain `camera`: the plain form means "the frame's own src origin", and a srcdoc frame on a file://
       page has an opaque origin that nothing matches — so the camera was refused with the attribute in
       place. The frame's content is this build's own Pose Bench, so any-origin is not a widening. */
    fr.setAttribute('allow', 'clipboard-write *; camera *');
    fr.srcdoc = window.SB_POSEBENCH_SRC;
    return fr;
  }

  function open(shot) {
    if (!shot) return;
    if (!available()) {
      SB.toast('Pose Bench is not in this copy of the app — rebuild it (node build.mjs).', true);
      return;
    }
    if (editor) close();
    const p = P();
    const code = codeOf(p, shot);
    const back = SB.el('div', 'modal-back pose-back');
    const shell = SB.el('div', 'pose-shell');
    const bar = SB.el('div', 'pose-bar');
    bar.appendChild(SB.el('span', 'pose-title', 'Blocking ' + (code || 'this shot') +
      (has(shot) ? ' · v' + shot.pose.serial : ' · new')));
    bar.appendChild(SB.el('span', 'pose-hint',
      'Pose the mannequins and the camera, then “Use for ' + (code || 'shot') + '” (top right). ' +
      'Link each mannequin to a person in the Figures panel.'));
    /* a way out that does not depend on Pose Bench having loaded — three.js
       comes from a CDN, and offline the page inside shows only an error */
    const x = SB.el('button', 'tb', 'Close without saving');
    x.onclick = function () { close(); };
    bar.appendChild(x);
    const fr = frameFor('pose-frame');
    shell.appendChild(bar); shell.appendChild(fr);
    back.appendChild(shell);
    document.getElementById('modalRoot').appendChild(back);
    editor = { shotId: shot.id, token: token(), back: back, frame: fr, code: code,
      aspect: aspectFor(p, shot) };
  }

  /* What the editor opens with: the card's own blocking, and every
     performance of its scene (plus the one it uses, if that lives elsewhere).
     A card not blocked yet, in a scene that has performances, starts from the
     set of the scene's most recently blocked card — a performance drives
     mannequins by id, so a fresh set would have nobody for it to move. */
  function openingFor(p, f) {
    let scene = sceneOf(p, f.shot);
    const recs = perfsOf(f.scene).slice();
    const own = perfOf(p, f.shot);
    if (own && recs.indexOf(own) < 0) recs.push(own);
    if (!scene && recs.length) {
      const sib = f.scene.shots.filter(function (s) { return s !== f.shot && has(s); })
        .sort(function (a, b) { return (b.pose.at || 0) - (a.pose.at || 0); })[0];
      if (sib) scene = sceneOf(p, sib);
    }
    if (scene) delete scene.takes;
    return { scene: scene, takes: recs.map(function (r) { return readJson(p, r.data); }).filter(Boolean) };
  }

  function close() {
    if (!editor) return;
    editor.back.remove();
    editor = null;
  }

  function send(fr, msg) {
    try { fr.contentWindow.postMessage(msg, '*'); } catch (e) { /* frame gone */ }
  }

  /* Build talks to whichever writer the board uses: Gemini (with this browser's key and the board's model), or the
     local server the Local writer uses. */
  function llmFor(p) {
    if (!SB.Providers || !SB.Store) return null;
    if (SB.Providers.activeId() === 'gemini') {
      return { kind: 'gemini', model: SB.Providers.get('gemini').model(), key: SB.Store.getApiKey() || '' };
    }
    return { kind: 'local', url: SB.Providers.baseUrl(), model: SB.Store.getOoba().model || '', key: SB.Store.getOoba().key || '' };
  }
  function save(shotId, d) {
    const p = P();
    const f = SB.Model.findShot(p, shotId);
    if (!f) { SB.toast('That card is gone — the blocking was not saved.', true); return Promise.resolve(false); }
    const sh = f.shot;
    if (!d.beauty || !d.scene) { SB.toast('Pose Bench sent nothing to save.', true); return Promise.resolve(false); }
    return Promise.all([SB.downscaleImage(d.beauty), encodeOriginal(d.beauty)]).then(function (r) {
      const proxy = r[0], orig = r[1];
      const prev = sh.pose || null;
      if (Array.isArray(d.takes)) storePerfs(p, f.scene, d.takes);
      const scene = Object.assign({}, d.scene);
      delete scene.takes;
      d = Object.assign({}, d, { scene: scene });
      sh.pose = {
        serial: ((prev && prev.serial) | 0) + 1,
        scene: putScene(p, d.scene),
        image: SB.Blobs.image(p, proxy.data, proxy.w, proxy.h),
        render: { ref: SB.Blobs.put(p, orig.data), w: orig.w, h: orig.h },
        cast: (Array.isArray(d.cast) ? d.cast : []).filter(function (c) { return c && c.personaId; })
          .map(function (c) {
            const ps = c.pos && typeof c.pos === 'object' ? c.pos : null;
            return { fig: String(c.fig || ''), personaId: String(c.personaId), name: String(c.name || ''),
              color: String(c.color || ''), colorName: String(c.colorName || 'grey'),
              /* where the figure sits in the picture — "Left figure [Image 2]" in a MiniMax brief */
              pos: ps ? { x: typeof ps.x === 'number' ? ps.x : null,
                where: ['left', 'centre', 'right', 'out'].indexOf(ps.where) >= 0 ? ps.where : null,
                depth: ps.depth | 0 } : null };
          }),
        text: String(d.text || '').slice(0, 4000),
        lens: +d.lens || 0,
        /* what the frame is (shotFraming in Pose Bench): its type, its size, the camera's angle */
        framing: d.framing && typeof d.framing === 'object' ? { type: String(d.framing.type || ''),
          size: String(d.framing.size || ''), angle: String(d.framing.angle || '') } : null,
        aspect: ASPECTS.indexOf(d.aspect) >= 0 ? d.aspect
          : editor && editor.shotId === shotId ? editor.aspect : (prev && prev.aspect) || '',
        at: Date.now(),
        perf: cleanLink(d.link)
      };
      /* The blocking decides the shot type: it is the latest, most exact decision about the frame. A type the
         board doesn't offer (a removed "Two shot") falls back to the size. */
      let typed = '';
      const fr = sh.pose.framing, offered = (p.settings.shotTypes || []);
      if (fr) {
        const want = offered.indexOf(fr.type) >= 0 ? fr.type : offered.indexOf(fr.size) >= 0 ? fr.size : '';
        if (want && want !== sh.type) { sh.type = want; typed = want; }
      }
      SB.app.changed(true);
      const L = sh.pose.perf;
      SB.toast('Blocking saved on ' + (f.code || 'the card') + (typed ? '. Shot type \u2192 ' + typed + ' (from the blocking)' : '') +
        ' — it now goes first in this card’s references' +
        (L ? '; its clip is ' + L.name + (L.camName ? ', camera ' + L.camName : '') + ', ' +
          (L.out - L.in).toFixed(1) + 's' : '') +
        (prev ? '. Takes made from the old blocking are marked.' : '.'));
      return true;
    }).catch(function (e) {
      SB.toast('The blocking could not be saved: ' + (e.message || e), true);
      return false;
    });
  }

  function clear(shot) {
    if (!shot || !shot.pose) return;
    shot.pose = null;
    SB.app.changed(true);
  }

  /* ---------- passes, rendered on demand ---------- */

  function ensureWorker() {
    if (worker) return worker;
    const fr = frameFor('pose-worker');
    document.body.appendChild(fr);
    worker = { frame: fr, ready: false, queue: [], pending: {} };
    return worker;
  }

  /* Resolves to {depth, openpose, normal, mask} data URLs (or whichever were
     asked for), rendered from the card's saved scene at the board's aspect. */
  function passes(shot, which, longEdge) {
    const p = P();
    const scene = sceneOf(p, shot);
    if (!scene) return Promise.reject(new Error('this card has no blocking'));
    if (!available()) return Promise.reject(new Error('Pose Bench is not in this build'));
    const w = ensureWorker();
    return new Promise(function (resolve, reject) {
      const id = token();
      const msg = { type: 'posebench:passes', token: id, id: id, scene: scene,
        aspect: shot.pose.aspect || SB.Imagine.aspectOf(p), longEdge: longEdge || LONG_EDGE,
        passes: which || PASSES };
      const timer = setTimeout(function () {
        delete w.pending[id]; reject(new Error('Pose Bench did not answer (is three.js reachable?)'));
      }, 30000);
      w.pending[id] = function (d) {
        clearTimeout(timer);
        if (d.error) reject(new Error(d.error)); else resolve(d.images || {});
      };
      if (w.ready) send(w.frame, msg); else w.queue.push(msg);
    });
  }

  /* The card's reference clip: its performance through its camera over its
     range, as mannequins (pass 'beauty') or a control pass ('openpose',
     'depth', ...). Resolves to {blob, ext, frames, W, H, fps}. */
  function clip(shot, opts) {
    opts = opts || {};
    const p = P();
    const L = perfLink(shot), rec = perfOf(p, shot), scene = sceneOf(p, shot);
    if (!L) return Promise.reject(new Error('this card does not use a performance'));
    if (!rec) return Promise.reject(new Error('the performance this card was cut from is gone'));
    if (!scene) return Promise.reject(new Error('this card has no blocking'));
    if (!available()) return Promise.reject(new Error('Pose Bench is not in this build'));
    delete scene.takes;
    const take = readJson(p, rec.data);
    if (!take) return Promise.reject(new Error('the performance could not be read'));
    const w = ensureWorker();
    return new Promise(function (resolve, reject) {
      const id = token();
      const msg = { type: 'posebench:clip', token: id, id: id, scene: scene, take: take, link: L,
        aspect: shot.pose.aspect || SB.Imagine.aspectOf(p), longEdge: opts.longEdge || CLIP_EDGE,
        pass: opts.pass || 'beauty', fps: opts.fps || L.fps || 24 };
      /* a clip is rendered frame by frame; a slow machine takes minutes */
      const timer = setTimeout(function () {
        delete w.pending[id]; reject(new Error('Pose Bench did not finish the clip'));
      }, 600000);
      w.pending[id] = function (d) {
        clearTimeout(timer);
        if (d.error || !d.blob) reject(new Error(d.error || 'no clip came back'));
        else resolve({ blob: d.blob, ext: d.ext || 'mp4', frames: d.frames, W: d.W, H: d.H, fps: d.fps });
      };
      if (w.ready) send(w.frame, msg); else w.queue.push(msg);
    });
  }

  /* ---------- messages ---------- */

  window.addEventListener('message', function (e) {
    const d = e.data;
    if (!d || typeof d !== 'object' || typeof d.type !== 'string' || d.type.indexOf('posebench:') !== 0) return;

    if (editor && e.source === editor.frame.contentWindow) {
      if (d.type === 'posebench:ready') {
        const p = P();
        const f = SB.Model.findShot(p, editor.shotId);
        if (!f) { close(); return; }
        const o = openingFor(p, f);
        send(editor.frame, {
          type: 'posebench:open', token: editor.token, scene: o.scene,
          cast: castFor(p, f.shot), aspect: editor.aspect, aspects: ASPECTS, boardAspect: boardAspect(p),
          longEdge: LONG_EDGE, shot: editor.code,
          takes: o.takes, link: perfLink(f.shot),
          /* Build (build_plan.md) talks to the same local model as the Local writer */
          llm: llmFor(p)
        });
        return;
      }
      if (d.token !== editor.token) return;
      if (d.type === 'posebench:done') {
        const id = editor.shotId;
        save(id, d).then(function (ok) { if (ok) close(); });
      } else if (d.type === 'posebench:cancel') {
        close();
      }
      return;
    }

    if (worker && e.source === worker.frame.contentWindow) {
      if (d.type === 'posebench:ready') {
        worker.ready = true;
        worker.queue.splice(0).forEach(function (m) { send(worker.frame, m); });
        return;
      }
      if ((d.type === 'posebench:passes' || d.type === 'posebench:clip') && worker.pending[d.id]) {
        const done = worker.pending[d.id];
        delete worker.pending[d.id];
        done(d);
      }
    }
  });

  /* ---------- what the rest of the app asks ---------- */

  /* Is this take older than the card's blocking? A take records the serial it
     was made from (imagine.js stamps made.pose); none recorded = made before
     any blocking, which is only "older" if a blocking now exists. */
  function stale(shot, rec) {
    if (!has(shot) || !rec || !rec.made || rec.made.role !== 'image') return false;
    const s = rec.made.pose | 0;
    return s < shot.pose.serial;
  }

  SB.Pose = {
    available: available, has: has, open: open, close: close, clear: clear,
    passes: passes, sceneOf: sceneOf, nameOf: nameOf, stale: stale, PASSES: PASSES,
    clip: clip, perfLink: perfLink, perfOf: perfOf, perfStale: perfStale, perfsOf: perfsOf,
    /* for tests */
    _save: save, _editor: function () { return editor; }
  };

})(window.SB);
