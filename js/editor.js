/* editor.js — a contenteditable "window" onto a slice of a Doc.
 *
 * The browser is never allowed to mutate the DOM: every keystroke is
 * intercepted, turned into a replace(start,end,text) op against the model, and
 * the view is re-rendered from the model. That is what lets several windows
 * share (and overlap on) the same underlying characters.
 */
(function (SB) {
  'use strict';

  /* ---------- offset <-> DOM selection ---------- */

  function walk(el, fn) {
    const it = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null);
    let n;
    while ((n = it.nextNode())) fn(n);
  }

  function textOf(el) {
    let out = '';
    walk(el, function (n) {
      if (n.nodeType === 3) out += n.data;
      else if (n.nodeName === 'BR' && !n.classList.contains('pad')) out += '\n';
    });
    return out;
  }

  function offsetOf(el, node, off) {
    if (node === el) {
      // offset counts child nodes
      let n = 0;
      for (let i = 0; i < off && i < el.childNodes.length; i++) n += textOf2(el.childNodes[i]);
      return n;
    }
    let total = 0, found = -1;
    const it = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null);
    let n;
    while ((n = it.nextNode())) {
      if (n === node) { found = total + (n.nodeType === 3 ? off : 0); break; }
      if (n.nodeType === 3) total += n.data.length;
      else if (n.nodeName === 'BR' && !n.classList.contains('pad')) total += 1;
    }
    return found < 0 ? total : found;
  }

  function textOf2(node) {
    if (node.nodeType === 3) return node.data.length;
    if (node.nodeName === 'BR') return node.classList && node.classList.contains('pad') ? 0 : 1;
    let n = 0;
    for (let i = 0; i < node.childNodes.length; i++) n += textOf2(node.childNodes[i]);
    return n;
  }

  function getSel(el) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    if (!el.contains(r.startContainer) || !el.contains(r.endContainer)) return null;
    let a = offsetOf(el, r.startContainer, r.startOffset);
    let b = offsetOf(el, r.endContainer, r.endOffset);
    return { start: Math.min(a, b), end: Math.max(a, b) };
  }

  function locate(el, target) {
    // find [textNode, offset] for a character offset
    let seen = 0, res = null;
    const it = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let n, last = null;
    while ((n = it.nextNode())) {
      last = n;
      if (seen + n.data.length >= target) { res = [n, target - seen]; break; }
      seen += n.data.length;
    }
    if (res) return res;
    if (last) return [last, last.data.length];
    return [el, 0];
  }

  function setSel(el, start, end) {
    const sel = window.getSelection();
    if (!sel) return;
    const r = document.createRange();
    const a = locate(el, start), b = locate(el, end == null ? start : end);
    try {
      r.setStart(a[0], Math.min(a[1], a[0].nodeType === 3 ? a[0].data.length : 0));
      r.setEnd(b[0], Math.min(b[1], b[0].nodeType === 3 ? b[0].data.length : 0));
    } catch (e) { return; }
    sel.removeAllRanges();
    sel.addRange(r);
  }

  /* ---------- word boundaries ---------- */

  const WORD = /[A-Za-z0-9_'À-ɏ]/;

  function wordBack(s, i) {
    while (i > 0 && /\s/.test(s.charAt(i - 1))) i--;
    if (i > 0 && !WORD.test(s.charAt(i - 1))) return i - 1;
    while (i > 0 && WORD.test(s.charAt(i - 1))) i--;
    return i;
  }

  function wordFwd(s, i) {
    const n = s.length;
    while (i < n && /\s/.test(s.charAt(i))) i++;
    if (i < n && !WORD.test(s.charAt(i))) return i + 1;
    while (i < n && WORD.test(s.charAt(i))) i++;
    return i;
  }

  /* ---------- attach ---------- */

  /* cfg = {
   *   get()            -> {doc, from, to} | null
   *   edit(s,e,text)   -> apply to model (local coords)
   *   toggle(type,s,e) -> toggle a mark (local coords)
   *   after()          -> tell the app to re-render every window
   *   extra(absIdx)    -> extra css class for that master character
   *   readOnly         -> bool
   * } */
  function attach(el, cfg) {
    const api = { el: el, cfg: cfg, composing: false, pending: null };
    el.__sbEditor = api;
    if (!cfg.readOnly) el.setAttribute('contenteditable', 'true');

    function win() { return cfg.get(); }

    api.render = function () {
      const w = win();
      if (!w) { el.innerHTML = ''; return; }
      if (api.composing) return;
      const focused = document.activeElement === el;
      const keep = api.pending || (focused ? getSel(el) : null);
      el.innerHTML = SB.Doc.renderHTML(w.doc, w.from, w.to, cfg.extra || null);
      if (focused && keep) {
        const max = w.to - w.from;
        setSel(el, SB.clamp(keep.start, 0, max), SB.clamp(keep.end == null ? keep.start : keep.end, 0, max));
      }
      api.pending = null;
    };

    if (cfg.readOnly) { api.render(); return api; }

    function doEdit(s, e, text, caret) {
      const w = win();
      if (!w) return;
      const max = w.to - w.from;
      s = SB.clamp(s, 0, max); e = SB.clamp(e, s, max);
      if (s === e && !text) return;
      cfg.edit(s, e, text);
      api.pending = { start: caret == null ? s + (text || '').length : caret };
      cfg.after();
    }

    el.addEventListener('beforeinput', function (ev) {
      const w = win();
      if (!w) { ev.preventDefault(); return; }
      const sel = getSel(el);
      if (!sel) return;
      const t = ev.inputType;
      const text = w.doc.text.slice(w.from, w.to);

      if (t === 'insertCompositionText' || t === 'deleteCompositionText' ||
        t === 'insertFromComposition') return; // handled on compositionend

      ev.preventDefault();

      let s = sel.start, e = sel.end, ins = null;

      switch (t) {
        case 'insertText': ins = ev.data == null ? '' : ev.data; break;
        case 'insertReplacementText': ins = ev.data == null ? '' : ev.data; break;
        case 'insertLineBreak':
        case 'insertParagraph': ins = '\n'; break;
        case 'insertFromPaste':
        case 'insertFromDrop': {
          const dt = ev.dataTransfer;
          ins = dt ? (dt.getData('text/plain') || '') : '';
          break;
        }
        case 'deleteContentBackward':
          if (s === e) s = Math.max(0, s - 1);
          ins = ''; break;
        case 'deleteContentForward':
          if (s === e) e = Math.min(text.length, e + 1);
          ins = ''; break;
        case 'deleteWordBackward':
          if (s === e) s = wordBack(text, s);
          ins = ''; break;
        case 'deleteWordForward':
          if (s === e) e = wordFwd(text, e);
          ins = ''; break;
        case 'deleteSoftLineBackward':
        case 'deleteHardLineBackward':
          if (s === e) s = text.lastIndexOf('\n', Math.max(0, s - 1)) + 1;
          ins = ''; break;
        case 'deleteByCut':
        case 'deleteByDrag':
        case 'deleteContent':
          ins = ''; break;
        case 'formatBold': cfg.toggle('b', s, e); cfg.after(); return;
        case 'formatItalic': cfg.toggle('i', s, e); cfg.after(); return;
        case 'formatUnderline': cfg.toggle('u', s, e); cfg.after(); return;
        default: return;
      }
      if (ins === null) return;
      doEdit(s, e, ins);
    });

    el.addEventListener('paste', function (ev) {
      ev.preventDefault();
      const sel = getSel(el);
      if (!sel) return;
      const txt = (ev.clipboardData && ev.clipboardData.getData('text/plain')) || '';
      if (txt) doEdit(sel.start, sel.end, txt);
    });

    el.addEventListener('keydown', function (ev) {
      if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return;
      const k = ev.key.toLowerCase();
      if (k !== 'b' && k !== 'i' && k !== 'u') return;
      const sel = getSel(el);
      if (!sel || sel.start === sel.end) { ev.preventDefault(); return; }
      ev.preventDefault();
      cfg.toggle(k, sel.start, sel.end);
      api.pending = { start: sel.start, end: sel.end };
      cfg.after();
    });

    el.addEventListener('compositionstart', function () { api.composing = true; });
    el.addEventListener('compositionend', function () {
      api.composing = false;
      reconcile();
    });

    /* safety net: if anything slipped past the interceptors, diff and repair */
    el.addEventListener('input', function () {
      if (api.composing) return;
      setTimeout(reconcile, 0);
    });

    function reconcile() {
      const w = win();
      if (!w || api.composing) return;
      const cur = textOf(el);
      const exp = w.doc.text.slice(w.from, w.to);
      if (cur === exp) return;
      let p = 0;
      const n = Math.min(cur.length, exp.length);
      while (p < n && cur.charAt(p) === exp.charAt(p)) p++;
      let sfx = 0;
      while (sfx < n - p && cur.charAt(cur.length - 1 - sfx) === exp.charAt(exp.length - 1 - sfx)) sfx++;
      const s = p, e = exp.length - sfx, ins = cur.slice(p, cur.length - sfx);
      cfg.edit(s, e, ins);
      api.pending = { start: s + ins.length };
      cfg.after();
    }

    api.render();
    return api;
  }

  SB.Editor = {
    attach: attach, getSel: getSel, setSel: setSel, textOf: textOf
  };

})(window.SB);
