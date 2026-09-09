/* mentions.js — the @ popover.
 *
 * @ means one thing: THE MODEL WILL BE SHOWN A PICTURE OF THIS.
 *
 *   @a subject  ->  its reference frames go into the feed
 *   @a shot     ->  that shot's rendered frame goes into the feed
 *   the order of the marks in the sentence is the order of the images
 *
 * Picking from this list writes a mark (refs.js), which the box draws as a
 * link and the card turns into a numbered feed strip. Knowing when to hand a
 * model a reference image is the expertise this replaces; written as one rule
 * with a visible consequence, it is something a person can follow on their
 * first day.
 *
 * The list also carries what a pick will actually feed — "2 frames", "no
 * reference image", "not rendered yet" — because a mark that feeds nothing is
 * the failure this is meant to prevent, and the moment to say so is now.
 *
 * Both kinds of box are driven: a plain textarea, and the contenteditable
 * reference box (refbox.js) that renders marks as links. Not the master script
 * or the tied scene boxes — those are Doc-backed, where every shot anchor is an
 * offset into one shared string, and inserting text behind SB.Doc.replace would
 * desync the file.
 */
(function (SB) {
  'use strict';

  let pop = null, host = null, ctx = null;
  let items = [], active = 0, at = -1, term = '';

  function P() { return SB.app.project; }

  /* A textarea answers with .value and .selectionStart; the reference box has
   * to be read out of the DOM. Everything below goes through these three, so
   * the popover does not care which it is driving. */
  function rich(el) { return el.isContentEditable; }
  function val(el) { return rich(el) ? SB.RefBox.read(el) : el.value; }
  function pos(el) { return rich(el) ? SB.RefBox.caret(el) : el.selectionStart; }
  function put(el, text, at) {
    if (rich(el)) {
      SB.RefBox.write(el, P(), text);
      SB.RefBox.setCaret(el, at);
      el.classList.toggle('empty', !text);
      return;
    }
    el.value = text;
    el.setSelectionRange(at, at);
  }

  /* An @ only opens the popover at the start of a word — mid-word it is an
   * email address or a handle somebody is quoting, and stealing those
   * keystrokes would be worse than not offering the list at all. */
  /* "}" is a boundary because that is where the caret lands after a pick —
   * naming two subjects back to back is ordinary, and used to be dead. */
  function boundary(ch) { return !ch || /[\s(\[\-—"'“‘}]/.test(ch); }

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
    const before = String(val(el)).slice(0, pos(el)).slice(-1);
    if (!boundary(before)) return;
    /* The @ itself is typed as normal; the popover opens on the next tick with
       the caret already past it, so the offsets below are simple. */
    host = el;
    ctx = opts;
    setTimeout(function () {
      const at = pos(el) - 1;
      if (String(val(el)).charAt(at) !== '@') { host = null; return; }
      term = '';
      show(at);
    }, 0);
  }

  /* What has been typed since the @, or null once it stops looking like a name
   * being written (a newline, a second @, or a run long enough that this was
   * plainly not a mention). */
  function typed() {
    if (!host || at < 0) return null;
    const caret = pos(host);
    if (caret == null || caret <= at) return null;
    const s = String(val(host)).slice(at + 1, caret);
    if (/[\n@]/.test(s) || s.length > 40) return null;
    return s;
  }

  /* What picking this would actually feed — said here, because a mark that
   * feeds nothing is the whole failure this is meant to prevent. */
  function note(per) {
    const n = SB.Personas.imagesOf(per).length;
    if (!n) return { text: 'no reference image', warn: true };
    return { text: n === 1 ? '1 frame' : n + ' frames', warn: false };
  }

  function candidates() {
    const p = P();
    const t = term.trim().toLowerCase();
    const out = [];
    SB.Personas.KINDS.forEach(function (kind) {
      SB.Personas.ofKind(p, kind.id).forEach(function (per) {
        const name = (per.name || '').toLowerCase();
        const e = { per: per, kind: kind, id: per.id, label: per.name || 'unnamed', note: note(per) };
        if (!t) { e.rank = 1; out.push(e); return; }
        const i = name.indexOf(t);
        if (i === 0) { e.rank = 0; out.push(e); }
        else if (i > 0) { e.rank = 1; out.push(e); }
        else if ((per.description || '').toLowerCase().indexOf(t) >= 0) { e.rank = 2; out.push(e); }
      });
    });

    /* A shot is a reference image like any other: its rendered frame. This is
       how you riff — "reverse of @1C" says the relation, the feed and the
       prose in one line. The card being written is not offered to itself. */
    SB.Model.eachShot(p, function (sh, sc, si, sj) {
      if (ctx && ctx.shot && sh.id === ctx.shot.id) return;
      const code = SB.Model.code(si, sj);
      const desc = SB.Refs.plain(p, sh.description).replace(/\s+/g, ' ').trim();
      const hay = (code + ' ' + (sh.type || '') + ' ' + desc).toLowerCase();
      if (t && hay.indexOf(t) < 0) return;
      out.push({
        shot: sh, id: sh.id, label: code,
        kind: { id: 'shot', label: 'Shot', one: 'shot' },
        rank: t && code.toLowerCase().indexOf(t) === 0 ? 0 : 3,
        sub: (sh.type ? sh.type + ' — ' : '') + (desc.slice(0, 48) || 'no description'),
        note: sh.image ? { text: 'frame', warn: false }
                       : { text: 'not rendered yet', warn: true }
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
        row.appendChild(SB.el('span', 'men-kind kind-' + it.kind.id, it.kind.label));
        row.appendChild(SB.el('span', 'men-name', it.label));
        if (it.sub) row.appendChild(SB.el('span', 'men-sub', it.sub));
        row.appendChild(SB.el('span', 'men-img' + (it.note.warn ? ' warn' : ''), it.note.text));
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
    /* A contenteditable will tell you where the caret is; a textarea will not,
       which is what the mirror below is for. */
    if (rich(host)) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const r = sel.getRangeAt(0).cloneRange();
        r.collapse(true);
        let rect = r.getClientRects()[0];
        if (!rect) {
          const probe = document.createElement('span');
          probe.textContent = '​';
          r.insertNode(probe);
          rect = probe.getBoundingClientRect();
          probe.remove();
        }
        if (rect) {
          const hb = host.getBoundingClientRect();
          return { x: rect.left - hb.left, y: rect.top - hb.top, h: rect.height || 16 };
        }
      }
      return { x: 0, y: 0, h: 16 };
    }
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
    /* a shot: its frame is the reference, and there is nothing to cast */
    if (it.shot) {
      const el = host;
      const caret = pos(el);
      if (caret == null) { hide(); return; }
      const next = SB.Refs.insert(val(el), at, caret, it.shot.id, it.label);
      hide();
      put(el, next.text, next.caret);
      el.focus();
      el.dispatchEvent(new Event('input', { bubbles: true }));
      SB.Store.touch();
      SB.UsagePanel.badgeSoon();
      if (!it.shot.image) SB.toast(it.label + ' has no frame yet — render it and this feeds it', true);
      return;
    }
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
    const caret = pos(el);
    if (caret == null) { hide(); return; }
    /* A mark, not a name: it carries the id, so renaming the subject or
       renumbering the shot never has to touch a single description. */
    const next = SB.Refs.insert(val(el), at, caret, per.id, name);
    hide();
    put(el, next.text, next.caret);
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
