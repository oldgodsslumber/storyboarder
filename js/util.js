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
