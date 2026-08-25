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

  SB.toast = function (msg, isErr) {
    const root = document.getElementById('toastRoot');
    if (!root) return;
    const el = document.createElement('div');
    el.className = 'toast' + (isErr ? ' err' : '');
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(function () { el.remove(); }, isErr ? 6000 : 2600);
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
