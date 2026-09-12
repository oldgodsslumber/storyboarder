/* focus.js — nothing the app does in the background may take the caret.
 *
 * The panels here are rebuilt by throwing their DOM away and making it again:
 * board.render(), promptpanel.render() and the rest all start with
 * innerHTML = ''. That is fine when YOU asked for it — you clicked something
 * and you are looking at the result. It is not fine when a clip comes back
 * from ImagineArt, or a writer model finishes a prompt, forty seconds after
 * you clicked it, while you are in the middle of a sentence in a different
 * box. The box being typed in is destroyed and made again, so the caret goes
 * to <body>: the rest of the sentence goes nowhere, and a space bar pressed
 * afterwards is a space bar pressed on whatever the browser focused instead —
 * which, if that was a "generate" button, writes the prompt again over the one
 * that had just been fixed by hand. There is no undo for a prompt.
 *
 * Two rules, and every rebuild goes through one of them:
 *
 *   keep(fn)         rebuild, then put the caret back exactly where it was —
 *                    same box, same offset, same selection, same scroll.
 *   defer(key, fn)   a rebuild nobody asked for waits until the typing stops.
 *
 * keep() alone would cover the caret, because a rebuild is synchronous and no
 * keystroke can land inside one. defer() is for everything a snapshot cannot
 * carry across: an open @ popover, an IME mid-word, and the plain fact that
 * watching the page shudder while you write is unpleasant.
 */
(function (SB) {
  'use strict';

  /* How long after the last keystroke a box still counts as being written in.
   * Long enough to cover the gap between words, short enough that a rebuild
   * never feels withheld. */
  const QUIET = 1500;

  /* A deferred rebuild is delayed, not dropped. If someone types without ever
   * stopping it still has to land, or a finished clip never appears and the
   * button that made it sits at "…" forever. keep() is what makes landing
   * harmless, so these are backstops rather than deadlines. */
  const MAX_WAIT = 4000;
  const MAX_WAIT_POPUP = 15000;

  let lastKey = 0;

  /* The headless test harnesses run these modules against a handful of DOM
   * stubs. There is no caret in a stub, so every rule here stands down and a
   * rebuild simply happens. */
  const DOM = typeof document !== 'undefined' &&
    typeof document.querySelector === 'function' &&
    typeof document.addEventListener === 'function';

  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.tagName === 'TEXTAREA') return !el.disabled && !el.readOnly;
    if (el.tagName === 'INPUT') {
      return !el.disabled && !el.readOnly &&
        !/^(button|submit|reset|checkbox|radio|range|file|color|image)$/i.test(el.type || 'text');
    }
    return !!el.isContentEditable;
  }

  /* Is the caret in a box right now? */
  function typing() { return DOM && isEditable(document.activeElement); }

  /* The @ popover is anchored to a box a rebuild would replace, so it cannot
   * survive one — while it is up, nothing rebuilds. */
  function popup() { return DOM && !!document.querySelector('.men-pop'); }

  function busy() {
    if (!typing()) return false;
    return popup() || (Date.now() - lastKey < QUIET);
  }

  if (DOM) {
    document.addEventListener('keydown', function (ev) {
      if (isEditable(ev.target)) lastKey = Date.now();
    }, true);
    document.addEventListener('input', function (ev) {
      if (isEditable(ev.target)) lastKey = Date.now();
    }, true);
  }

  /* ------------------------------------------------------------- the caret
   *
   * The box itself is gone after a rebuild, so it is found again rather than
   * held: a selector built out of the tag, the classes, and the data-
   * attributes the app already puts on everything it can name (data-shot,
   * data-scene, data-model, data-field). Those are stable across a rebuild by
   * design — they are how the rest of the app finds a card again too. */
  const KEYS = ['shot', 'scene', 'model', 'field', 'persona', 'push', 'row'];

  function anchored(el) {
    if (el.id) return true;
    return KEYS.some(function (k) { return el.dataset && el.dataset[k] != null; });
  }

  function stepFor(el) {
    let s = el.tagName.toLowerCase();
    if (el.id && /^[A-Za-z_][\w-]*$/.test(el.id)) return s + '#' + el.id;
    String(el.className || '').trim().split(/\s+/).forEach(function (c) {
      if (/^[A-Za-z_][\w-]*$/.test(c)) s += '.' + c;
    });
    KEYS.forEach(function (k) {
      const v = el.dataset ? el.dataset[k] : null;
      if (v != null && !/["\\]/.test(v)) s += '[data-' + k + '="' + v + '"]';
    });
    return s;
  }

  function pathOf(el) {
    const parts = [];
    let cur = el, depth = 0;
    while (cur && cur.nodeType === 1 && cur !== document.body && depth < 6) {
      parts.unshift(stepFor(cur));
      if (anchored(cur)) break;
      cur = cur.parentElement;
      depth++;
    }
    if (!parts.length) return null;
    /* descendant, not child: a wrapper div that appears between two rebuilds
     * must not be what loses somebody their sentence */
    const q = parts.join(' ');
    let idx = 0;
    try {
      const all = document.querySelectorAll(q);
      for (let i = 0; i < all.length; i++) { if (all[i] === el) { idx = i; break; } }
    } catch (e) { return null; }
    return { q: q, idx: idx };
  }

  function snapshot() {
    if (!DOM) return null;
    const el = document.activeElement;
    if (!isEditable(el)) return null;
    const path = pathOf(el);
    if (!path) return null;
    const s = { q: path.q, idx: path.idx, scroll: el.scrollTop || 0 };
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      s.kind = 'field';
      try {
        s.start = el.selectionStart;
        s.end = el.selectionEnd;
        s.dir = el.selectionDirection || 'none';
      } catch (e) { /* an input type with no selection to speak of */ }
    } else {
      s.kind = 'rich';
      /* a reference box counts a chip as one object, and the offset is into
       * the text the box READS as — which is what survives being rebuilt.
       * Both ends: a rebuild used to hand back a collapsed caret, so a phrase
       * selected for replacing was typed over rather than replaced. */
      try {
        const at = SB.RefBox && SB.RefBox.offsets ? SB.RefBox.offsets(el) : null;
        s.at = at ? at.end : (SB.RefBox ? SB.RefBox.caret(el) : null);
        s.from = at ? at.start : null;
      } catch (e) { s.at = null; s.from = null; }
    }
    return s;
  }

  function restore(s) {
    if (!s || !DOM) return;
    /* Only ever put back what was LOST. If the rebuild deliberately moved the
     * caret — a new card opening with its description ready to type into, a
     * dialog taking over — that is the app answering the user, and dragging
     * focus back out of it would be this module causing the very bug it is
     * here to stop. */
    const live = document.activeElement;
    if (live && live !== document.body && document.body.contains(live)) return;
    let el = null;
    try {
      const all = document.querySelectorAll(s.q);
      el = all[s.idx] || all[0] || null;
    } catch (e) { return; }
    if (!isEditable(el)) return;
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    if (s.scroll) el.scrollTop = s.scroll;
    if (s.kind === 'field' && s.start != null) {
      /* The text can have changed underneath — a prompt rewritten by the model
       * is the whole point of some of these rebuilds. Clamp rather than give
       * up: the end of a shorter string is where the caret belongs. */
      const max = (el.value || '').length;
      const a = Math.min(s.start, max);
      const b = Math.min(s.end == null ? s.start : s.end, max);
      try { el.setSelectionRange(a, b, s.dir); } catch (e) { }
    } else if (s.kind === 'rich' && s.at != null && SB.RefBox) {
      try {
        if (s.from != null && s.from !== s.at && SB.RefBox.setRange) {
          SB.RefBox.setRange(el, s.from, s.at);
        } else {
          SB.RefBox.setCaret(el, s.at);
        }
      } catch (e) { }
    }
  }

  /* Rebuild, and give the caret back. */
  function keep(fn) {
    const s = snapshot();
    try { return fn(); }
    finally { restore(s); }
  }

  /* ----------------------------------------------------------- the waiting */

  const pending = new Map();      // key -> { fn, since }
  let timer = null;

  function arm() {
    if (timer) return;
    timer = setInterval(function () {
      const now = Date.now();
      const cap = popup() ? MAX_WAIT_POPUP : MAX_WAIT;
      const free = !busy();
      const due = [];
      pending.forEach(function (job, key) {
        if (free || now - job.since >= cap) due.push(key);
      });
      due.forEach(function (key) {
        const job = pending.get(key);
        pending.delete(key);
        try { job.fn(); } catch (e) { console.error('[storyboarder] deferred rebuild failed', e); }
      });
      if (!pending.size) { clearInterval(timer); timer = null; }
    }, 200);
  }

  /* A rebuild that arrived on its own — a finished clip, a written prompt —
   * rather than from a click. One job per key: a second clip landing while the
   * first is still waiting replaces it rather than queueing another, and the
   * wait is measured from the first, so nothing is starved by a busy board. */
  function defer(key, fn) {
    if (!busy()) { fn(); return; }
    const had = pending.get(key);
    pending.set(key, { fn: fn, since: had ? had.since : Date.now() });
    arm();
  }

  /* Everything waiting, now — for a test, or for anything that has to see the
   * DOM it asked for. */
  function flush() {
    const jobs = Array.from(pending.values());
    pending.clear();
    if (timer) { clearInterval(timer); timer = null; }
    jobs.forEach(function (j) { try { j.fn(); } catch (e) { console.error(e); } });
  }

  /* --------------------------------------------------- the loaded space bar
   *
   * A mouse click leaves a button focused, and the space bar presses whatever
   * button is focused. On a button whose whole job is to overwrite text a
   * person wrote by hand — with no undo behind it — that is one stray space
   * away from losing the work. So a button marked costly gives the keyboard
   * back after a POINTER press. A keyboard press keeps it: there, focus is
   * the only way back to the button, and nobody reaches it by accident. */
  function costly(btn) {
    if (!btn || !btn.addEventListener) return btn;
    btn.addEventListener('click', function (ev) {
      if (ev.detail > 0) btn.blur();          // detail 0 = keyboard, or synthetic
    });
    return btn;
  }

  SB.Focus = {
    keep: keep, defer: defer, flush: flush, costly: costly,
    typing: typing, busy: busy, isEditable: isEditable,
    snapshot: snapshot, restore: restore
  };

})(window.SB);
