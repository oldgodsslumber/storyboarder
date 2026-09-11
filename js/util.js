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
      img.onload = function () {
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
      };
      img.onerror = function () { reject(new Error('could not decode image')); };
      if (typeof blobOrDataUrl === 'string') img.src = blobOrDataUrl;
      else img.src = URL.createObjectURL(blobOrDataUrl);
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
    function onKey(e) { if (e.key === 'Escape') close(); }
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

})(window.SB);
