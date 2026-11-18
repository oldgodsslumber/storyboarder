/* util.js — small shared helpers */
window.SB = window.SB || {};
(function (SB) {
  'use strict';

  let _seq = 0;
  SB.uid = function (p) {
    _seq++;
    return (p || 'id') + '_' + Date.now().toString(36) + '_' + _seq.toString(36) +
      Math.random().toString(36).slice(2, 6);
  };

  SB.debounce = function (fn, ms) {
    let t = null;
    const wrapped = function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { t = null; fn.apply(self, args); }, ms);
    };
    wrapped.flush = function () { if (t) { clearTimeout(t); t = null; fn(); } };
    return wrapped;
  };

  SB.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };

  SB.clone = function (o) { return JSON.parse(JSON.stringify(o)); };

  SB.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };

  /* A, B, ... Z, AA, AB ... */
  SB.letters = function (i) {
    let s = '';
    i = i | 0;
    do { s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26) - 1; }
    while (i >= 0);
    return s;
  };

  SB.fmtDate = function (ts) {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  /* A toast says what happened. Occasionally what happened has one obvious
   * answer — "no folder is set, choose one" — and making the user go and find
   * it in Settings is how a thing quietly never gets done. So a toast can
   * carry one button, and a toast with a button waits long enough to be read
   * and pressed rather than the two seconds an announcement gets.
   *
   *   SB.toast(msg, isErr, { action: { label, onClick }, ms })
   */
  SB.toast = function (msg, isErr, opts) {
    const root = document.getElementById('toastRoot');
    if (!root) return null;
    opts = opts || {};
    const el = document.createElement('div');
    el.className = 'toast' + (isErr ? ' err' : '');
    el.appendChild(document.createTextNode(msg));
    let ms = opts.ms || (isErr ? 6000 : 2600);
    if (opts.action) {
      const b = document.createElement('button');
      b.className = 'toast-act';
      b.textContent = opts.action.label;
      b.onclick = function () {
        el.remove();
        opts.action.onClick();
      };
      el.appendChild(b);
      if (!opts.ms) ms = 14000;
    }
    root.appendChild(el);
    const timer = setTimeout(function () { el.remove(); }, ms);
    return { el: el, close: function () { clearTimeout(timer); el.remove(); } };
  };

  /* ---- ask in place ----
   *
   * confirm() stops the whole app dead for something as ordinary as dropping
   * a card. Instead the button itself becomes the question: one click arms it
   * and relabels it, a second click within a few seconds does the job, and
   * anything else — Esc, a click elsewhere, waiting — quietly disarms it.
   */
  SB.armButton = function (btn, label, run) {
    const was = { text: btn.textContent, cls: btn.className, title: btn.title };
    let armed = false, timer = null;
    function disarm() {
      if (!armed) return;
      armed = false;
      clearTimeout(timer);
      btn.textContent = was.text; btn.className = was.cls; btn.title = was.title;
      document.removeEventListener('mousedown', away, true);
      document.removeEventListener('keydown', esc, true);
    }
    function away(ev) { if (ev.target !== btn) disarm(); }
    function esc(ev) { if (ev.key === 'Escape') disarm(); }
    btn.onclick = function (ev) {
      ev.stopPropagation();
      if (armed) { disarm(); run(); return; }
      armed = true;
      btn.textContent = label;
      btn.className = was.cls + ' arm';
      btn.title = 'Click again to confirm — or press Esc';
      document.addEventListener('mousedown', away, true);
      document.addEventListener('keydown', esc, true);
      timer = setTimeout(disarm, 4000);
    };
    return disarm;
  };

  /* ---- the request that never left the browser ----
   *
   * A corporate proxy blocking generativelanguage.googleapis.com looks nothing
   * like a Gemini error: fetch rejects with a TypeError, no status, no body,
   * and the user gets "Failed to fetch" — which explains nothing and suggests
   * no fix. On this network the fix is always the same one click, so the
   * failure is classified here and answered with it.
   */
  SB.AISTUDIO_URL = 'https://aistudio.google.com/';

  const BLOCKED_MSG = 'Google’s API could not be reached — the request was blocked before it ' +
    'left the browser. On the Pega network this happens until AI Studio has been opened once ' +
    'in this browser and accepted.';
  const OFFLINE_MSG = 'No network — the request never left the browser. Reconnect, then try again.';

  /* 'blocked' | 'offline' | null (an ordinary error, handle it normally) */
  SB.netKind = function (e) {
    if (!e) return null;
    /* A local model server that isn't answering fails exactly like a proxied
     * request — same TypeError, same "Failed to fetch" — but the fix has
     * nothing to do with AI Studio. Providers mark those, and they are never
     * classified as a network block. */
    if (e.localApi) return null;
    if (e.blocked) return e.netKind || 'blocked';
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
    /* fetch itself rejecting — CORS, a proxy, DNS. No response ever arrived. */
    if (typeof TypeError !== 'undefined' && e instanceof TypeError) return 'blocked';
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(String(e.message || e))) {
      return 'blocked';
    }
    /* An interception page answering with HTML where JSON was due. Kept narrow:
     * a real "API key not valid" 403 is JSON and must keep reporting itself. */
    if (e.interception) return 'blocked';
    return null;
  };

  /* Does this response body look like a proxy's own page rather than Google's? */
  SB.isInterception = function (status, body) {
    if ([403, 407, 451, 502].indexOf(status) < 0) return false;
    const t = String(body || '').trim();
    if (!t) return false;
    if (/^[[{]/.test(t)) return false;                 // JSON — Google answered
    return /^<|<html|<!doctype/i.test(t);
  };

  SB.netError = function (kind) {
    const err = new Error(kind === 'offline' ? OFFLINE_MSG : BLOCKED_MSG);
    err.blocked = true;
    err.netKind = kind === 'offline' ? 'offline' : 'blocked';
    return err;
  };

  /* Show the way out and offer to run the failed thing again. Returns false for
   * anything that is not a network block, so callers keep their own handling:
   *
   *   .catch(function (e) { if (SB.apiBlocked(e, again)) return; failed(e); });
   *
   * Shown every time it happens — the fix is one click, and hiding it behind
   * "don't show again" would just move the confusion later.
   */
  let openBlock = null;

  SB.apiBlocked = function (err, retry) {
    const kind = SB.netKind(err);
    if (!kind) return false;
    /* Already on screen: keep the newer way back rather than stacking dialogs. */
    if (openBlock) { openBlock.retry = retry || openBlock.retry; return true; }

    const state = { retry: retry || null };
    const body = SB.el('div', 'blocked-body');
    body.appendChild(SB.el('p', null, kind === 'offline' ? OFFLINE_MSG : BLOCKED_MSG));

    if (kind !== 'offline') {
      const a = document.createElement('a');
      a.className = 'blocked-link';
      a.href = SB.AISTUDIO_URL;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'Open AI Studio ↗';
      body.appendChild(a);
      body.appendChild(SB.el('p', 'pp-note',
        'It opens in a new tab. Accept there, come back, and try again — it only has to be ' +
        'done once in this browser.'));

      const help = SB.el('p', 'pp-note');
      help.appendChild(document.createTextNode('No key yet? '));
      const link = SB.el('button', 'linkish', 'Settings → API');
      link.onclick = function () {
        if (openBlock) openBlock.close();
        SB.Settings.open('api');
      };
      help.appendChild(link);
      help.appendChild(document.createTextNode(' walks through making one.'));
      body.appendChild(help);
    }

    const m = SB.modal({
      title: kind === 'offline' ? 'No network' : 'Google’s API is being blocked',
      width: '460px',
      body: body,
      buttons: [
        { label: 'Close' },
        {
          label: 'Try again', primary: true, onClick: function (close) {
            const again = state.retry;
            close();
            if (again) again();
          }
        }
      ],
      onClose: function () { openBlock = null; }
    });
    state.close = m.close;
    openBlock = state;
    return true;
  };

  /* ---- images: downscale to <=480p proxy, base64 JPEG ---- */
  const MAX_W = 854, MAX_H = 480;

  SB.downscaleImage = function (blobOrDataUrl) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      /* A picture loaded from another origin TAINTS the canvas, and then
       * toDataURL throws — inside this onload, where an uncaught throw used to
       * mean the promise neither resolved nor rejected. The caller waited
       * forever: no picture, no error, no toast, a button stuck on "placing…".
       * Two fixes, because either alone is not enough:
       *   - ask for the picture in CORS mode, so a host that allows it (Getty's
       *     media host does) can be drawn and exported;
       *   - and catch anyway, so a host that does not is a rejection rather
       *     than a hang. Everything in here is wrapped: a canvas that cannot
       *     be allocated throws from createElement/getContext too. */
      const remote = typeof blobOrDataUrl === 'string' && /^https?:/i.test(blobOrDataUrl);
      if (remote) img.crossOrigin = 'anonymous';
      img.onload = function () {
        try {
          let w = img.naturalWidth, h = img.naturalHeight;
          if (!w || !h) { reject(new Error('bad image')); return; }
          const scale = Math.min(1, MAX_W / w, MAX_H / h);
          w = Math.max(1, Math.round(w * scale));
          h = Math.max(1, Math.round(h * scale));
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve({ data: c.toDataURL('image/jpeg', 0.82), w: w, h: h });
        } catch (e) {
          reject(new Error(remote
            ? 'that picture could not be read off the canvas — the server did not allow it ' +
              '(' + (e && e.message || e) + ')'
            : (e && e.message) || 'could not read the image'));
        }
      };
      img.onerror = function () {
        reject(new Error(remote
          ? 'could not load that picture from ' + (function () {
            try { return new URL(blobOrDataUrl).host; } catch (x) { return 'that address'; }
          })()
          : 'could not decode image'));
      };
      try {
        if (typeof blobOrDataUrl === 'string') img.src = blobOrDataUrl;
        else img.src = URL.createObjectURL(blobOrDataUrl);
      } catch (e) { reject(e); }
    });
  };

  /* The same picture as JPEG bytes, at most `maxEdge` on its long side.
   *
   * For the one place that needs a specific format rather than a proxy: the
   * by-image search upload, which Getty declares as image/jpeg or image/png
   * only — and originals in this file are usually WebP, because WebP is
   * smaller (renders.js). Sending one under a .jpg name is a 400. */
  SB.toJpegBlob = function (blobOrDataUrl, maxEdge) {
    const cap = maxEdge || 1600;
    return new Promise(function (resolve, reject) {
      const img = new Image();
      const remote = typeof blobOrDataUrl === 'string' && /^https?:/i.test(blobOrDataUrl);
      if (remote) img.crossOrigin = 'anonymous';
      img.onload = function () {
        try {
          let w = img.naturalWidth, h = img.naturalHeight;
          if (!w || !h) { reject(new Error('bad image')); return; }
          const scale = Math.min(1, cap / w, cap / h);
          w = Math.max(1, Math.round(w * scale));
          h = Math.max(1, Math.round(h * scale));
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          if (c.toBlob) {
            c.toBlob(function (b) {
              b ? resolve(b) : reject(new Error('could not encode that picture as JPEG'));
            }, 'image/jpeg', 0.9);
          } else {
            const data = c.toDataURL('image/jpeg', 0.9);
            fetch(data).then(function (r) { return r.blob(); }).then(resolve, reject);
          }
        } catch (e) { reject(e); }
      };
      img.onerror = function () { reject(new Error('could not decode that picture')); };
      try {
        if (typeof blobOrDataUrl === 'string') img.src = blobOrDataUrl;
        else img.src = URL.createObjectURL(blobOrDataUrl);
      } catch (e) { reject(e); }
    });
  };

  /* Pull an image out of a drop / paste event. Returns Promise<Blob|string|null> */
  SB.imageFromTransfer = function (dt) {
    if (!dt) return Promise.resolve(null);
    const files = dt.files;
    if (files && files.length) {
      for (let i = 0; i < files.length; i++) {
        if (/^image\//.test(files[i].type)) return Promise.resolve(files[i]);
      }
    }
    if (dt.items) {
      for (let i = 0; i < dt.items.length; i++) {
        const it = dt.items[i];
        if (it.kind === 'file' && /^image\//.test(it.type)) {
          const f = it.getAsFile();
          if (f) return Promise.resolve(f);
        }
      }
    }
    const uri = dt.getData && (dt.getData('text/uri-list') || dt.getData('text/plain'));
    if (uri && /^(https?:|data:image)/i.test(uri.trim())) {
      const u = uri.trim().split(/\s+/)[0];
      if (/^data:image/i.test(u)) return Promise.resolve(u);
      return fetch(u, { mode: 'cors' }).then(function (r) { return r.blob(); })
        .catch(function () { return null; });
    }
    const html = dt.getData && dt.getData('text/html');
    if (html) {
      const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (m) {
        const u = m[1];
        if (/^data:image/i.test(u)) return Promise.resolve(u);
        return fetch(u, { mode: 'cors' }).then(function (r) { return r.blob(); })
          .catch(function () { return null; });
      }
    }
    return Promise.resolve(null);
  };

  /* Every image in a drop, not just the first. Dragging a selection out of
     Explorer is one gesture and means several pictures; the single-image
     fallbacks (a URL, an <img> lifted out of a page) can only ever describe
     one, so they come back as a list of one. Returns Promise<Array>. */
  SB.imagesFromTransfer = function (dt) {
    if (!dt) return Promise.resolve([]);
    const out = [];
    const files = dt.files;
    if (files && files.length) {
      for (let i = 0; i < files.length; i++) {
        if (/^image\//.test(files[i].type)) out.push(files[i]);
      }
    }
    if (!out.length && dt.items) {
      for (let i = 0; i < dt.items.length; i++) {
        const it = dt.items[i];
        if (it.kind === 'file' && /^image\//.test(it.type)) {
          const f = it.getAsFile();
          if (f) out.push(f);
        }
      }
    }
    if (out.length) return Promise.resolve(out);
    return SB.imageFromTransfer(dt).then(function (one) { return one ? [one] : []; });
  };

  /* A clip out of a drop or a paste. Kept apart from imageFromTransfer rather
   * than folded into it: a drop carrying both should put the picture on the
   * card and the clip beside it, and the caller decides that. */
  /* Every clip in a drop, in name order.
   *
   * This used to hand back the first one and drop the rest on the floor, so
   * dragging three mp4s onto a card put one of them somewhere and said
   * nothing about the other two — which reads exactly like "they stacked up
   * and I cannot see them". A card holds one clip; the caller asks which. */
  SB.videosFromTransfer = function (dt) {
    if (!dt) return [];
    const out = [];
    const seen = {};
    const take = function (f) {
      if (!f || !/^video\//.test(f.type || '')) return;
      const key = (f.name || '') + ':' + f.size;
      if (seen[key]) return;
      seen[key] = 1;
      out.push(f);
    };
    const files = dt.files;
    if (files) for (let i = 0; i < files.length; i++) take(files[i]);
    if (dt.items) {
      for (let i = 0; i < dt.items.length; i++) {
        const it = dt.items[i];
        if (it.kind === 'file' && /^video\//.test(it.type)) take(it.getAsFile());
      }
    }
    out.sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true });
    });
    return out;
  };

  SB.videoFromTransfer = function (dt) { return SB.videosFromTransfer(dt)[0] || null; };

  SB.pickVideoFile = function () {
    return new Promise(function (resolve) {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'video/*';
      inp.onchange = function () { resolve(inp.files && inp.files[0] ? inp.files[0] : null); };
      inp.click();
    });
  };

  SB.pickImageFile = function () {
    return new Promise(function (resolve) {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/*';
      inp.onchange = function () { resolve(inp.files && inp.files[0] ? inp.files[0] : null); };
      inp.click();
    });
  };

  /* ---- modal ---- */
  /* Every modal used to listen for Escape on the document, so one press
   * closed all of them — Settings behind a report, and every unsaved edit in
   * it. A modal answers only when it is the last one in the root. */
  function topmostModal() {
    const all = document.querySelectorAll('#modalRoot .modal-back');
    return all.length ? all[all.length - 1] : null;
  }

  /* Which dialog is in front. The modal's own Escape has always needed this;
   * so does anything else that listens on the document while open. */
  SB.isTopModal = function (back) { return topmostModal() === back; };

  SB.modal = function (opts) {
    const back = SB.el('div', 'modal-back');
    const m = SB.el('div', 'modal');
    if (opts.width) m.style.minWidth = opts.width;
    const h = SB.el('h2', null, opts.title || '');
    const body = SB.el('div', 'body');
    if (opts.body) body.appendChild(opts.body);
    const foot = SB.el('div', 'foot');
    m.appendChild(h); m.appendChild(body); m.appendChild(foot);
    back.appendChild(m);

    function close() {
      back.remove();
      document.removeEventListener('keydown', onKey);
      if (opts.onClose) opts.onClose();
    }
    function onKey(e) {
      if (e.key !== 'Escape') return;
      /* only the one in front answers, or one press closes the dialog behind
         it too and takes every unsaved edit in it */
      if (topmostModal() !== back) return;
      e.stopPropagation();
      close();
    }
    document.addEventListener('keydown', onKey);
    back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });

    (opts.buttons || [{ label: 'Close' }]).forEach(function (b) {
      const btn = SB.el('button', 'tb' + (b.primary ? ' on' : ''), b.label);
      btn.onclick = function () { if (b.onClick) b.onClick(close, body); else close(); };
      foot.appendChild(btn);
    });

    document.getElementById('modalRoot').appendChild(back);
    return { close: close, body: body, root: back };
  };

  /* tiny DOM helper */
  SB.el = function (tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  /* ---------------- a frame out of a video file ---------------------------
   *
   * The bytes are already in hand, so they go in as an object URL: the
   * <video> reading it is same-origin, which means the canvas can never be
   * tainted and CORS cannot break the extraction. That was the one way this
   * could have been fragile and it is designed out rather than handled.
   *
   * Seeking is the fiddly part. `currentTime = 0` on a freshly loaded video
   * does not always have a decoded frame behind it, so this waits for a seek
   * to land and then checks the canvas is not uniformly blank before
   * believing it; a blank frame (a clip that fades up from black is a real
   * thing) gets one nudge forward rather than a black card.
   *
   * `at` is a WISH, in seconds, and 0 means the first frame. A Getty comp
   * starts clean and asks for 0. A handheld scout clip does not: frame zero
   * is usually a hand still on the record button with the exposure settling,
   * so that path asks for a little way in. It is clamped to a quarter of the
   * duration, because "a little way in" must not mean "past the end" on a
   * two-second clip.
   *
   * This lived in getty.js, where the Getty client still calls it. It is not
   * Getty's: it is the same question whether the bytes came from a media host
   * or off a camera card.
   */
  SB.frameFromVideo = function (blob, at) {
    return new Promise(function (resolve, reject) {
      let url = '', done = false, tries = 0, target = 0;
      const want = Math.max(0, Number(at) || 0);
      const v = document.createElement('video');
      const finish = function (data, err) {
        if (done) return;
        done = true;
        clearTimeout(cap);
        try { v.removeAttribute('src'); v.load(); } catch (e) { }
        if (url) URL.revokeObjectURL(url);
        if (data) resolve(data); else reject(err || new Error('no frame'));
      };
      const grab = function () {
        try {
          const w = v.videoWidth, h = v.videoHeight;
          if (!w || !h) { finish(null, new Error('the clip reported no size')); return; }
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const ctx = c.getContext('2d');
          ctx.drawImage(v, 0, 0, w, h);
          /* A clip that opens on black would board as a black card. One
             nudge forward, once -- this is not a hunt for a good frame, it is
             a guard against the degenerate one. */
          const dur = isFinite(v.duration) ? v.duration : 0;
          if (tries === 0 && SB.blankFrame(ctx, w, h) && dur > 0.2) {
            tries++;
            v.currentTime = Math.min(target + 0.25, dur / 2);
            return;
          }
          finish(c.toDataURL('image/png'));
        } catch (e) { finish(null, e); }
      };
      const cap = setTimeout(function () {
        finish(null, new Error('the clip did not decode in time'));
      }, 15000);
      v.muted = true;
      v.preload = 'auto';
      v.playsInline = true;
      v.onerror = function () { finish(null, new Error('the clip could not be decoded here')); };
      v.onseeked = grab;
      v.onloadeddata = function () {
        const dur = isFinite(v.duration) ? v.duration : 0;
        target = (want > 0 && dur > 0) ? Math.min(want, dur / 4) : want;
        if (target > 0) { v.currentTime = target; return; }
        /* already at zero on most builds, in which case no seeked fires */
        if (v.currentTime === 0 && v.readyState >= 2) grab();
        else v.currentTime = 0;
      };
      try {
        url = URL.createObjectURL(blob);
        v.src = url;
        v.load();
      } catch (e) { finish(null, e); }
    });
  };

  /* Uniform to the eye: every sampled pixel within a few levels of the first.
   * Sampled rather than scanned -- this runs on a 1080p frame. */
  SB.blankFrame = function (ctx, w, h) {
    try {
      const step = Math.max(1, Math.floor(Math.min(w, h) / 16));
      const d = ctx.getImageData(0, 0, w, h).data;
      const at = function (x, y) { return (y * w + x) * 4; };
      const i0 = at(0, 0);
      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          const i = at(x, y);
          if (Math.abs(d[i] - d[i0]) > 6 || Math.abs(d[i + 1] - d[i0 + 1]) > 6 ||
            Math.abs(d[i + 2] - d[i0 + 2]) > 6) return false;
        }
      }
      return true;
    } catch (e) { return false; }     // a read that throws is not a blank frame
  };

  /* A frame off a <video> that is already playing, at wherever it has got to.
   * Same-origin bytes, so no taint; a cross-origin one would throw here and
   * the caller reports it. */
  SB.frameAtPlayhead = function (v) {
    if (!v || !v.videoWidth || !v.videoHeight) return '';
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  };

  /* ---------------- auto-scroll while something is being dragged ----------
   *
   * A browser will not scroll a container for a custom drag, so the board has
   * to scroll itself while a card -- or a Getty tile -- is held at its edges.
   *
   * There were two copies of this, one for each kind of drag, and both did the
   * same wrong thing: move the board 18px per `dragover` event. `dragover`
   * fires every few milliseconds for as long as a drag is live, whether or not
   * the pointer has moved at all, so that is something over a thousand pixels
   * a second, at a rate set by the machine rather than by anybody's intent.
   * And the band reached 60-70px up from the BOTTOM of the board -- which is
   * exactly the strip of screen a drag out of the bottom drawer must cross on
   * its way to a card. The board bolted away from under every thumbnail.
   *
   * The rule now: a drag has to ASK for a scroll by parking in the band, and
   * does not get one merely for passing through. Nothing moves until the
   * pointer has settled -- DWELL_MS having travelled less than SLOP -- which
   * is never true of a pointer on its way somewhere else. Once armed it
   * scrolls on the frame clock rather than the event clock, eased by how deep
   * into the band it sits, and a decisive move disarms it again.
   */
  const DS = {
    TOP: 64,        /* how far up from the bottom / down from the top it reaches */
    BOTTOM: 52,     /* shallower: it abuts the drawer and is crossed constantly */
    DWELL_MS: 220,  /* park this long before anything moves... */
    SLOP: 10,       /* ...having travelled less than this while parked */
    BREAK: 26,      /* a move this big means "I am going somewhere", not "scroll" */
    SLOW: 90,       /* px/s at the outer limit of the band */
    FAST: 620       /* px/s hard against the edge */
  };
  const ds = {
    x: 0, y: 0, ax: 0, ay: 0, since: 0, last: 0,
    inBand: false, armed: false, live: false, raf: 0
  };
  const dsWants = [];

  function dsNow() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }

  /* 0 outside the band, and towards -1 or +1 the harder it is pressed */
  function dsPush(r, x, y) {
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return 0;
    if (y < r.top + DS.TOP) return -(1 - (y - r.top) / DS.TOP);
    if (y > r.bottom - DS.BOTTOM) return 1 - (r.bottom - y) / DS.BOTTOM;
    return 0;
  }

  function dsStop() {
    ds.armed = false; ds.inBand = false; ds.live = false;
    if (ds.raf && window.cancelAnimationFrame) cancelAnimationFrame(ds.raf);
    ds.raf = 0;
  }

  function dsMove(ev, now) {
    const p = document.getElementById('boardPanel');
    let want = false;
    for (let i = 0; i < dsWants.length && !want; i++) {
      try { want = !!dsWants[i](ev); } catch (e) { /* a claim must not break a drag */ }
    }
    if (!p || !want) return dsStop();
    ds.live = true;
    now = now == null ? dsNow() : now;
    const push = dsPush(p.getBoundingClientRect(), ev.clientX, ev.clientY);
    ds.x = ev.clientX; ds.y = ev.clientY;
    if (!push) { ds.armed = false; ds.inBand = false; return; }
    const travel = Math.abs(ev.clientX - ds.ax) + Math.abs(ev.clientY - ds.ay);
    if (!ds.inBand) {
      /* just arrived: start the clock, and do not scroll yet */
      ds.inBand = true; ds.armed = false; ds.since = now;
      ds.ax = ev.clientX; ds.ay = ev.clientY;
    } else if (travel > (ds.armed ? DS.BREAK : DS.SLOP)) {
      /* still travelling -- start the clock again from where it is now */
      ds.armed = false; ds.since = now; ds.ax = ev.clientX; ds.ay = ev.clientY;
    } else if (!ds.armed && now - ds.since >= DS.DWELL_MS) {
      ds.armed = true; ds.last = now;
    }
    if (ds.armed && !ds.raf && window.requestAnimationFrame) {
      ds.raf = requestAnimationFrame(dsTick);
    }
  }

  function dsTick(now) {
    ds.raf = 0;
    const p = document.getElementById('boardPanel');
    if (!p || !ds.live || !ds.armed) return;
    now = now == null ? dsNow() : now;
    const push = dsPush(p.getBoundingClientRect(), ds.x, ds.y);
    if (!push) { ds.armed = false; return; }
    /* a tab that was in the background must come back and resume, not lurch */
    const dt = Math.min(64, Math.max(0, now - ds.last));
    ds.last = now;
    /* eased: the first pixels of the band are a nudge, the last are a sweep */
    const speed = DS.SLOW + (DS.FAST - DS.SLOW) * push * push;
    const step = (push < 0 ? -1 : 1) * speed * dt / 1000;
    const was = p.scrollTop;
    p.scrollTop = was + step;
    /* at the end of the board: stop, rather than asking for a frame for ever */
    if (Math.abs(step) > 0.5 && p.scrollTop === was) { ds.armed = false; return; }
    if (window.requestAnimationFrame) ds.raf = requestAnimationFrame(dsTick);
  }

  /* the node suites run these files against a stub document, which has no
     event plumbing and needs none: the two halves below are what they test */
  if (document && document.addEventListener) {
    document.addEventListener('dragover', function (ev) { dsMove(ev); });
    document.addEventListener('dragend', dsStop);
    document.addEventListener('drop', dsStop);
  }

  SB.dragScroll = {
    /* the board and the Getty drawer each say when a live drag is theirs */
    claim: function (fn) { dsWants.push(fn); },
    /* The tick runs on requestAnimationFrame, which never fires under the
       headless suite's virtual clock, and the dwell is a question about time.
       So both halves are reachable directly and take the `now` they are given
       -- the behaviour is testable without waiting on a real clock. */
    _move: dsMove, _tick: dsTick, _stop: dsStop, _state: ds, _tune: DS
  };

})(window.SB);
