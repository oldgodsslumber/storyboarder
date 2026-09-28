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
 * shot.pose = { serial, scene, image{ref,w,h}, render{ref,w,h}, cast[], text,
 *               lens, aspect, at }
 */
(function (SB) {
  'use strict';

  function P() { return SB.app.project; }
  const LONG_EDGE = 1536;
  const PASSES = ['depth', 'openpose', 'normal', 'mask'];

  let editor = null;     // {shotId, token, back, frame, code}
  let worker = null;     // hidden instance rendering passes: {frame, ready, queue}

  function available() { return typeof window.SB_POSEBENCH_SRC === 'string' && !!window.SB_POSEBENCH_SRC; }
  function token() { return 'pb_' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
  function has(shot) { return !!(shot && shot.pose && shot.pose.image && shot.pose.scene); }

  /* ---------- the scene blob ---------- */

  /* ASCII-safe (Blobs hashes bytes as ASCII): percent-encoded JSON. */
  function putScene(p, scene) {
    return SB.Blobs.put(p, 'data:application/json,' + encodeURIComponent(JSON.stringify(scene)));
  }
  function sceneOf(p, shot) {
    if (!has(shot)) return null;
    const u = SB.Blobs.get(p, shot.pose.scene);
    const i = u.indexOf(',');
    if (i < 0) return null;
    try { return JSON.parse(decodeURIComponent(u.slice(i + 1))); } catch (e) { return null; }
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
    fr.setAttribute('allow', 'clipboard-write');
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
      aspect: SB.Imagine && SB.Imagine.aspectOf ? SB.Imagine.aspectOf(p) : '16:9' };
  }

  function close() {
    if (!editor) return;
    editor.back.remove();
    editor = null;
  }

  function send(fr, msg) {
    try { fr.contentWindow.postMessage(msg, '*'); } catch (e) { /* frame gone */ }
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
      sh.pose = {
        serial: ((prev && prev.serial) | 0) + 1,
        scene: putScene(p, d.scene),
        image: SB.Blobs.image(p, proxy.data, proxy.w, proxy.h),
        render: { ref: SB.Blobs.put(p, orig.data), w: orig.w, h: orig.h },
        cast: (Array.isArray(d.cast) ? d.cast : []).filter(function (c) { return c && c.personaId; })
          .map(function (c) {
            return { fig: String(c.fig || ''), personaId: String(c.personaId), name: String(c.name || ''),
              color: String(c.color || ''), colorName: String(c.colorName || 'grey') };
          }),
        text: String(d.text || '').slice(0, 4000),
        lens: +d.lens || 0,
        aspect: editor && editor.shotId === shotId ? editor.aspect : (prev && prev.aspect) || '',
        at: Date.now()
      };
      SB.app.changed(true);
      SB.toast('Blocking saved on ' + (f.code || 'the card') + ' — it now goes first in this card’s references' +
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

  /* ---------- messages ---------- */

  window.addEventListener('message', function (e) {
    const d = e.data;
    if (!d || typeof d !== 'object' || typeof d.type !== 'string' || d.type.indexOf('posebench:') !== 0) return;

    if (editor && e.source === editor.frame.contentWindow) {
      if (d.type === 'posebench:ready') {
        const p = P();
        const f = SB.Model.findShot(p, editor.shotId);
        if (!f) { close(); return; }
        send(editor.frame, {
          type: 'posebench:open', token: editor.token, scene: sceneOf(p, f.shot),
          cast: castFor(p, f.shot), aspect: editor.aspect, longEdge: LONG_EDGE, shot: editor.code
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
      if (d.type === 'posebench:passes' && worker.pending[d.id]) {
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
    /* for tests */
    _save: save, _editor: function () { return editor; }
  };

})(window.SB);
