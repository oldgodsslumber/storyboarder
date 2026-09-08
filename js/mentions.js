/* mentions.js — type @ to name somebody, somewhere or something.
 *
 * Picking from the popover does two things, and the second one is the point:
 *
 *   1. it writes the plain name into the text, so the description reads as
 *      prose — "Ops lead crouches beside the cabinet", not @[Ops lead](per_7).
 *      A sentinel would leak into every prompt and would have to be stripped
 *      out again in three places.
 *   2. it casts that subject on the shot.
 *
 * (2) is what tells the model anything. The name in the description says who
 * is doing what; the cast block (personas.js) is what carries their face,
 * their wardrobe and the "image N" mapping, and it is declared authoritative
 * over the description precisely so the two cannot disagree. So @ is not a
 * link — it is the fastest way to attach the record that already exists.
 *
 * Only plain textareas are wired up. The master script and the tied scene
 * boxes are Doc-backed contenteditable, where every shot anchor is an offset
 * into the same string: inserting text behind SB.Doc.replace would desync the
 * whole file. That wants doing through the Doc primitive, and is its own job.
 */
(function (SB) {
  'use strict';

  let pop = null, host = null, ctx = null;
  let items = [], active = 0, at = -1, term = '';

  function P() { return SB.app.project; }

  /* An @ only opens the popover at the start of a word — mid-word it is an
   * email address or a handle somebody is quoting, and stealing those
   * keystrokes would be worse than not offering the list at all. */
  function boundary(ch) { return !ch || /[\s(\[\-—"'“‘]/.test(ch); }

  function attach(el, opts) {
    if (!el) return;
    el.addEventListener('keydown', function (ev) { onKey(ev, el, opts || {}); }, true);
    el.addEventListener('input', function () { if (pop && host === el) update(); });
    /* Deferred so a click on a row lands first — but only ever closing this
       box's own popover. Unconditional, it reached across and killed a list
       that had already been opened in whichever box was focused next. */
    el.addEventListener('blur', function () {
      setTimeout(function () { if (host === el) hide(); }, 120);
    });
  }

  function onKey(ev, el, opts) {
    if (pop && host === el) {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); move(1); return; }
      if (ev.key === 'ArrowUp') { ev.preventDefault(); move(-1); return; }
      if (ev.key === 'Enter' || ev.key === 'Tab') {
        if (items.length) { ev.preventDefault(); ev.stopPropagation(); choose(items[active]); }
        return;
      }
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); hide(); return; }
      /* A second @ is somebody starting again — naming a second person in the
         same sentence, or giving up on the first attempt. Fall through and
         re-anchor to it. Without this the list died on the new @ and would not
         come back until the character was deleted and retyped. */
      if (ev.key !== '@') return;
    }
    if (ev.key !== '@') return;
    const before = el.value.slice(0, el.selectionStart).slice(-1);
    if (!boundary(before)) return;
    /* The @ itself is typed as normal; the popover opens on the next tick with
       the caret already past it, so the offsets below are simple. */
    host = el;
    ctx = opts;
    setTimeout(function () {
      const pos = el.selectionStart - 1;
      if (el.value.charAt(pos) !== '@') { host = null; return; }
      term = '';
      show(pos);
    }, 0);
  }

  /* What has been typed since the @, or null once it stops looking like a name
   * being written (a newline, a second @, or a run long enough that this was
   * plainly not a mention). */
  function typed() {
    if (!host || at < 0) return null;
    const caret = host.selectionStart;
    if (caret <= at) return null;
    const s = host.value.slice(at + 1, caret);
    if (/[\n@]/.test(s) || s.length > 40) return null;
    return s;
  }

  function candidates() {
    const p = P();
    const t = term.trim().toLowerCase();
    const out = [];
    SB.Personas.KINDS.forEach(function (kind) {
      SB.Personas.ofKind(p, kind.id).forEach(function (per) {
        const name = (per.name || '').toLowerCase();
        if (!t) { out.push({ per: per, kind: kind, rank: 1 }); return; }
        const i = name.indexOf(t);
        if (i === 0) out.push({ per: per, kind: kind, rank: 0 });
        else if (i > 0) out.push({ per: per, kind: kind, rank: 1 });
        else if ((per.description || '').toLowerCase().indexOf(t) >= 0) {
          out.push({ per: per, kind: kind, rank: 2 });
        }
      });
    });
    out.sort(function (a, b) { return a.rank - b.rank; });
    const list = out.slice(0, 8);
    /* Writing is when you find out somebody is missing, so minting one is on
       the list rather than behind a trip to the library. */
    if (t) {
      SB.Personas.KINDS.forEach(function (kind) {
        list.push({ make: kind, kind: kind });
      });
    }
    return list;
  }

  /* The @ position is set after the teardown, not before it: hide() forgets
     where the last one was, and that includes the one being opened. */
  /* Any scroll between the caret and the viewport moves the box — the board,
   * the takeover's own panes, the textarea itself. Captured, because scroll
   * does not bubble, and the popover is stranded at a stale position
   * otherwise: it stays put while the box it belongs to slides away. */
  function onScroll() {
    if (!pop || !host) return;
    const r = host.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) { hide(); return; }
    place();
  }

  function show(pos) {
    hide(true);
    at = pos;
    pop = SB.el('div', 'men-pop');
    pop.addEventListener('mousedown', function (ev) { ev.preventDefault(); });   // keep the caret
    document.body.appendChild(pop);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    active = 0;
    update();
  }

  function update() {
    if (!pop) return;
    const t = typed();
    if (t === null) { hide(); return; }
    term = t;
    items = candidates();
    if (!items.length) { hide(); return; }
    if (active >= items.length) active = items.length - 1;

    pop.innerHTML = '';
    items.forEach(function (it, i) {
      const row = SB.el('div', 'men-row' + (i === active ? ' on' : ''));
      if (it.make) {
        row.classList.add('make');
        row.appendChild(SB.el('span', 'men-kind', '+'));
        row.appendChild(SB.el('span', 'men-name', 'new ' + it.kind.one + ' “' + term.trim() + '”'));
      } else {
        const n = SB.Personas.imagesOf(it.per).length;
        row.appendChild(SB.el('span', 'men-kind kind-' + it.kind.id, it.kind.label));
        row.appendChild(SB.el('span', 'men-name', it.per.name || 'unnamed'));
        if (n) row.appendChild(SB.el('span', 'men-img', n > 1 ? '◉ ×' + n : '◉'));
      }
      row.addEventListener('mouseenter', function () {
        active = i;
        pop.querySelectorAll('.men-row').forEach(function (r, j) { r.classList.toggle('on', i === j); });
      });
      row.addEventListener('click', function () { choose(it); });
      pop.appendChild(row);
    });
    place();
  }

  function move(d) {
    if (!items.length) return;
    active = (active + d + items.length) % items.length;
    pop.querySelectorAll('.men-row').forEach(function (r, i) { r.classList.toggle('on', i === active); });
    const on = pop.querySelector('.men-row.on');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
  }

  /* Anchored to the caret, which a textarea will not tell you about — so the
   * text up to the caret is measured in a mirror styled like the box. */
  function place() {
    const r = host.getBoundingClientRect();
    const c = caretPoint();
    let left = r.left + c.x;
    let top = r.top + c.y + c.h;
    left = Math.min(left, window.innerWidth - pop.offsetWidth - 8);
    if (top + pop.offsetHeight > window.innerHeight - 8) top = r.top + c.y - pop.offsetHeight - 2;
    pop.style.left = Math.max(8, left) + 'px';
    pop.style.top = Math.max(8, top) + 'px';
  }

  function caretPoint() {
    const cs = window.getComputedStyle(host);
    const mirror = SB.el('div', 'men-mirror');
    ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'borderTopWidth', 'borderLeftWidth', 'whiteSpace', 'wordWrap'].forEach(function (k) {
        mirror.style[k] = cs[k];
      });
    mirror.style.width = host.clientWidth + 'px';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.wordWrap = 'break-word';
    mirror.textContent = host.value.slice(0, at + 1);
    const dot = SB.el('span', null, '​');
    mirror.appendChild(dot);
    document.body.appendChild(mirror);
    const mb = mirror.getBoundingClientRect(), db = dot.getBoundingClientRect();
    const out = {
      x: db.left - mb.left,
      y: db.top - mb.top - host.scrollTop,
      h: parseFloat(cs.lineHeight) || 16
    };
    mirror.remove();
    return out;
  }

  function choose(it) {
    if (!host) return;
    const p = P();
    let per = it.per;
    if (it.make) {
      const nm = term.trim();
      if (!nm) return;
      per = SB.Personas.add(p, { kind: it.kind.id, name: nm });
      SB.toast('Added ' + it.kind.one + ' “' + nm + '” — give it a description in the library');
    }

    /* hide() forgets which box this was, so hold on to it first. */
    const el = host, where = ctx;
    const name = per.name || 'unnamed';
    const caret = el.selectionStart;
    const before = el.value.slice(0, at);
    const after = el.value.slice(caret);
    el.value = before + name + after;
    const pos = before.length + name.length;
    hide();
    el.setSelectionRange(pos, pos);
    el.focus();

    /* Fire the box's own input handler so whatever it writes to — a shot
       description, a custom field, a scene — stores the text the same way it
       would have if this had been typed. */
    el.dispatchEvent(new Event('input', { bubbles: true }));

    /* And the part that actually reaches the model. */
    if (where && where.shot) {
      const ids = where.shot.personaIds = where.shot.personaIds || [];
      if (ids.indexOf(per.id) < 0) {
        ids.push(per.id);
        SB.Board.refreshCastRows();
        SB.toast(name + ' cast on ' + (where.code || 'this card'));
      }
    }
    /* Never app.changed(true) from here: a structural change rebuilds every
       card, and the box this was typed into is one of them. The cast rows are
       refreshed by hand above precisely so the caret can stay where it is. */
    SB.PersonaPanel.refreshRefs();
    SB.Store.touch();
    SB.UsagePanel.badgeSoon();
  }

  function hide(keepHost) {
    if (pop) {
      pop.remove();
      pop = null;
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    }
    items = [];
    at = -1;
    if (!keepHost) { host = null; ctx = null; }
  }

  SB.Mentions = { attach: attach, hide: hide };

})(window.SB);
