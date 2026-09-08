/* refs.js — what the model is shown.
 *
 * An @ in a description is not a spelling convenience. It means: THE MODEL WILL
 * BE SHOWN A PICTURE OF THIS. That is the whole idea, and everything here
 * follows from it —
 *
 *   @a subject  ->  its reference frames go into the feed
 *   @a shot     ->  that shot's rendered frame goes into the feed
 *   the order of the marks in the sentence is the order of the images
 *   no mark     ->  not shown, only described
 *
 * Knowing when to hand a model a reference image is the expertise this replaces.
 * Written down as one rule with a visible consequence — the numbered feed strip
 * on the card — it stops being expertise and becomes a process somebody can
 * follow on their first day.
 *
 * ---- the stored form ----
 *
 * A mark is `@{id|Name}` in the description text. It carries the id AND a
 * readable fallback, which buys three things:
 *
 *   - renaming a subject, or renumbering a shot, rewrites nothing: the chip is
 *     drawn from the id every time it is rendered;
 *   - a description read raw — in another editor, in a diff — still says who it
 *     meant;
 *   - deleting a subject degrades its mentions to that last known name as plain
 *     prose, rather than leaving a dangling reference.
 *
 * Nothing outside this file should read a description for a machine. plain()
 * is the boundary: it resolves marks to the names they now have and hands back
 * ordinary prose.
 */
(function (SB) {
  'use strict';

  /* @{id|fallback} — ids are our own (per_/sh_), so the only thing that needs
   * sanitising on the way in is the closing brace and the pipe. */
  const MARK = /@\{([A-Za-z0-9_]+)\|([^}]*)\}/g;

  function clean(name) {
    return String(name == null ? '' : name).replace(/[|}]/g, '').trim();
  }

  function mark(id, name) { return '@{' + id + '|' + clean(name) + '}'; }

  /* ---- resolving ---- */

  /* What a mark points at, or null if it is gone. Subjects and shots live in
   * different places, so the id prefix decides where to look. */
  function target(p, id) {
    if (!p || !id) return null;
    if (/^sh_/.test(id)) {
      const f = SB.Model.findShot(p, id);
      if (!f) return null;
      return { kind: 'shot', id: id, shot: f.shot, label: f.code, f: f };
    }
    const per = SB.Personas.find(p, id);
    if (!per) return null;
    return { kind: 'subject', id: id, subject: per, label: per.name || 'unnamed' };
  }

  /* Every mark in a piece of text, in the order it appears. `label` is what a
   * reader should see; `dead` marks one whose target no longer exists. */
  function parse(p, text) {
    const out = [];
    const s = String(text == null ? '' : text);
    MARK.lastIndex = 0;
    let m;
    while ((m = MARK.exec(s))) {
      const t = target(p, m[1]);
      out.push({
        id: m[1],
        from: m.index,
        to: m.index + m[0].length,
        raw: m[0],
        fallback: m[2],
        label: t ? t.label : m[2],
        dead: !t,
        kind: t ? t.kind : null,
        target: t
      });
    }
    return out;
  }

  /* The boundary. Prose as a person or a model should read it: every mark
   * becomes the name or shot code it currently points at. */
  function plain(p, text) {
    const s = String(text == null ? '' : text);
    if (s.indexOf('@{') < 0) return s;
    return s.replace(MARK, function (_, id, fallback) {
      const t = target(p, id);
      return t ? t.label : fallback;
    });
  }

  /* Is there a mark for this id in here already? */
  function has(text, id) {
    return parse(null, text).some(function (x) { return x.id === id; });
  }

  /* ---- the feed ----
   *
   * The ordered list of images to hand the model. Marks first, in the order
   * they were written, because that order is the one thing the person writing
   * the sentence actually controls. Anything cast on the card but never
   * mentioned follows, flagged: it is still sent — silently dropping it would
   * change what every board made before this sends — but it is called out,
   * because an unmentioned subject is one whose position in the feed nobody
   * chose.
   */
  function feed(p, shot) {
    const out = [];
    const seen = {};

    parse(p, shot.description).forEach(function (m) {
      if (m.dead || seen[m.id]) return;
      seen[m.id] = 1;
      if (m.kind === 'shot') {
        const img = m.target.shot.image;
        out.push({
          kind: 'shot', id: m.id, label: m.target.label, mentioned: true,
          images: img ? [img] : [],
          why: img ? 'the rendered frame of ' + m.target.label
                   : m.target.label + ' has no frame yet — there is nothing to feed'
        });
        return;
      }
      const imgs = SB.Personas.imagesOf(m.target.subject);
      out.push({
        kind: 'subject', id: m.id, label: m.target.label, mentioned: true,
        subject: m.target.subject, images: imgs,
        why: imgs.length ? null : 'no reference image yet — it will be described in full instead'
      });
    });

    /* cast, but nobody said to show it */
    SB.Personas.forShot(p, shot).forEach(function (per) {
      if (seen[per.id]) return;
      seen[per.id] = 1;
      const imgs = SB.Personas.imagesOf(per);
      out.push({
        kind: 'subject', id: per.id, label: per.name || 'unnamed', mentioned: false,
        subject: per, images: imgs,
        why: 'cast on this card but not mentioned in the description'
      });
    });

    /* image numbers, assigned once across the whole feed — this is the order
       the files go in, and it is what the prompt's mapping promises */
    let n = 0;
    out.forEach(function (e) {
      e.numbers = e.images.map(function () { return ++n; });
    });
    return out;
  }

  /* Just the pictures, in order — what "copy the image set" hands over. */
  function images(p, shot) {
    const list = [];
    feed(p, shot).forEach(function (e) {
      e.images.forEach(function (img, i) {
        list.push({
          img: img, id: e.id, kind: e.kind, label: e.label,
          role: (img.label || ''), n: e.numbers[i]
        });
      });
    });
    return list;
  }

  /* ---- writing marks ---- */

  /* Put a mark in at a position, returning the new text and where the caret
   * should land. Used by the popover and by anything seeding a description. */
  function insert(text, at, until, id, name) {
    const s = String(text == null ? '' : text);
    const tok = mark(id, name);
    return { text: s.slice(0, at) + tok + s.slice(until), caret: at + tok.length };
  }

  /* Marks for names the writer typed but never linked.
   *
   * A model rewrite hands back plain prose, and an old board never had marks at
   * all, so the names are sitting there unlinked — which under the one rule
   * above means no picture is sent for them. This finds them: the longest
   * matching name wins, so "Ops lead" is not matched as "Ops", and a name
   * already inside a mark is skipped. */
  function unlinked(p, text) {
    const s = String(text == null ? '' : text);
    if (!s.trim()) return [];
    const marks = parse(p, s);
    const inside = function (i) {
      return marks.some(function (m) { return i >= m.from && i < m.to; });
    };
    const names = SB.Personas.all(p)
      .filter(function (x) { return (x.name || '').trim().length > 1; })
      .sort(function (a, b) { return b.name.length - a.name.length; });

    const out = [];
    const taken = [];
    names.forEach(function (per) {
      const re = new RegExp('(?<![\\w@{])' +
        per.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w}])', 'g');
      let m;
      while ((m = re.exec(s))) {
        const a = m.index, b = a + m[0].length;
        if (inside(a)) continue;
        if (taken.some(function (t) { return a < t.to && b > t.from; })) continue;
        taken.push({ from: a, to: b });
        out.push({ id: per.id, name: per.name, from: a, to: b });
      }
    });
    return out.sort(function (x, y) { return x.from - y.from; });
  }

  /* Link every unlinked name in one pass, back to front so the offsets hold. */
  function linkAll(p, text) {
    const hits = unlinked(p, text);
    let s = String(text == null ? '' : text);
    for (let i = hits.length - 1; i >= 0; i--) {
      s = s.slice(0, hits[i].from) + mark(hits[i].id, hits[i].name) + s.slice(hits[i].to);
    }
    return s;
  }

  SB.Refs = {
    MARK: MARK, mark: mark, parse: parse, plain: plain, has: has, target: target,
    feed: feed, images: images, insert: insert, unlinked: unlinked, linkAll: linkAll
  };

})(window.SB);
