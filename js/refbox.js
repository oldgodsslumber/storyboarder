/* refbox.js — a description box where a reference is visibly an object.
 *
 * A textarea can only hold letters, so a mark in one is either invisible or an
 * "@" the writer has to decode. Neither says the thing that matters: THIS WORD
 * IS A PICTURE THE MODEL WILL BE SHOWN. So the box is a contenteditable, and a
 * mark is drawn as a link — themed, underlined, clickable through to whatever
 * it points at. You can see, at a glance across a whole board, which cards are
 * actually feeding references and which only think they are.
 *
 * The chips are contenteditable="false", so a mark behaves like one object:
 * backspace takes the whole thing, not a letter off the end of somebody's name.
 * The text is serialised straight back out of the DOM — chips emit their stored
 * token, text nodes emit themselves — so what is stored is never a guess about
 * what is on screen.
 */
(function (SB) {
  'use strict';

  /* ---- DOM <-> text ---- */

  /* Walk the box and rebuild the stored string. Chips carry their own token, so
   * a rename or a renumber between renders costs nothing here. */
  function read(box) {
    let out = '';
    const walk = function (node) {
      for (let n = node.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3) { out += n.nodeValue; continue; }
        if (n.nodeType !== 1) continue;
        if (n.dataset && n.dataset.mark) { out += n.dataset.mark; continue; }
        if (n.tagName === 'BR') { out += '\n'; continue; }
        /* a pasted block, or the browser's own line wrapper */
        const block = /^(DIV|P|LI)$/.test(n.tagName);
        if (block && out && !/\n$/.test(out)) out += '\n';
        walk(n);
      }
    };
    walk(box);
    return out.replace(/ /g, ' ');
  }

  function chip(p, m) {
    const a = SB.el('a', 'ref-link' + (m.dead ? ' dead' : '') +
      (m.kind === 'shot' ? ' ref-shot' : ''), m.label);
    a.dataset.mark = m.raw;
    a.dataset.ref = m.id;
    a.contentEditable = 'false';
    a.title = m.dead
      ? '“' + m.fallback + '” is gone — this is plain text now'
      : (m.kind === 'shot'
        ? 'Shot ' + m.label + ' — its frame is fed to the model. Click to go to it.'
        : m.label + ' — its reference images are fed to the model. Click to open it.');
    return a;
  }

  function write(box, p, text) {
    box.innerHTML = '';
    const s = String(text == null ? '' : text);
    const marks = SB.Refs.parse(p, s);
    let at = 0;
    const put = function (str) {
      if (str) box.appendChild(document.createTextNode(str));
    };
    marks.forEach(function (m) {
      put(s.slice(at, m.from));
      box.appendChild(chip(p, m));
      at = m.to;
    });
    put(s.slice(at));
    /* An empty contenteditable collapses and cannot be clicked into. */
    if (!box.firstChild) box.appendChild(document.createTextNode(''));
  }

  /* ---- caret ----
   *
   * Re-rendering moves every node, so the caret is remembered as a character
   * offset into the serialised text and put back the same way. A chip counts as
   * its whole token, which is why a caret landing "inside" one lands after it. */
  function caret(box) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !box.contains(sel.anchorNode)) return null;
    const r = sel.getRangeAt(0).cloneRange();
    r.selectNodeContents(box);
    r.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
    const frag = document.createElement('div');
    frag.appendChild(r.cloneContents());
    return read(frag).length;
  }

  function setCaret(box, at) {
    if (at == null) return;
    let left = at;
    const sel = window.getSelection();
    const range = document.createRange();
    let done = false;
    const walk = function (node) {
      for (let n = node.firstChild; n && !done; n = n.nextSibling) {
        if (n.nodeType === 3) {
          const len = n.nodeValue.length;
          if (left <= len) { range.setStart(n, left); done = true; return; }
          left -= len;
          continue;
        }
        if (n.nodeType !== 1) continue;
        if (n.dataset && n.dataset.mark) {
          const len = n.dataset.mark.length;
          if (left <= len) { range.setStartAfter(n); done = true; return; }
          left -= len;
          continue;
        }
        if (n.tagName === 'BR') {
          if (left <= 1) { range.setStartAfter(n); done = true; return; }
          left -= 1;
          continue;
        }
        walk(n);
      }
    };
    walk(box);
    if (!done) range.selectNodeContents(box), range.collapse(false);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /* ---- the box ----
   *
   * opts: { get(), set(text), placeholder, ctx } — ctx is what the @ popover
   * needs to know (which shot this is), if anything.
   */
  function attach(host, opts) {
    const p = function () { return SB.app.project; };
    host.contentEditable = 'true';
    host.spellcheck = true;
    host.classList.add('ref-box');
    if (opts.placeholder) host.dataset.placeholder = opts.placeholder;

    let last = null;

    const paint = function (keepCaret) {
      const at = keepCaret ? caret(host) : null;
      const text = opts.get() || '';
      write(host, p(), text);
      last = text;
      host.classList.toggle('empty', !text);
      if (keepCaret) setCaret(host, at);
    };

    /* Typing only ever changes text nodes, so the box is NOT repainted on every
     * keystroke — that would fight the caret for no gain. It is repainted when
     * a mark could have appeared or changed: after a pick, and on blur. */
    host.addEventListener('input', function () {
      const text = read(host);
      last = text;
      host.classList.toggle('empty', !text);
      opts.set(text);
    });

    host.addEventListener('blur', function () {
      /* a chip deleted mid-sentence can leave a half-token behind */
      const text = read(host);
      if (/@\{[^}]*$/.test(text) || text !== last) { opts.set(text); }
      paint(false);
    });

    /* A link is a link: clicking one goes where it points rather than putting a
     * caret in the middle of somebody's name. */
    host.addEventListener('mousedown', function (ev) {
      const a = ev.target.closest && ev.target.closest('.ref-link');
      if (!a || a.classList.contains('dead')) return;
      ev.preventDefault();
      ev.stopPropagation();
      go(a.dataset.ref);
    });

    if (SB.Mentions) SB.Mentions.attach(host, opts.ctx || {});

    paint(false);
    host.__refPaint = paint;
    return { paint: paint, read: function () { return read(host); } };
  }

  /* Where a chip leads. */
  function go(id) {
    const p = SB.app.project;
    const t = SB.Refs.target(p, id);
    if (!t) return;
    if (t.kind === 'shot') {
      SB.PersonaPanel.close();
      SB.Board.select(t.shot.id);
      const el = document.querySelector('.card[data-shot="' + t.shot.id + '"]');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    SB.PersonaPanel.open();
    setTimeout(function () {
      const el = document.querySelector('.persona[data-id="' + id + '"]');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);
  }

  SB.RefBox = { attach: attach, read: read, write: write, caret: caret, setCaret: setCaret, go: go };

})(window.SB);
