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
    /* The label goes into prompts and into the printed board, so it is cleaned
     * on the way out: a subject named "Bad}Name" — or, deliberately, "@{x|y}" —
     * must not be able to put mark syntax into a request. */
    return { kind: 'subject', id: id, subject: per, label: clean(per.name) || 'unnamed' };
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

  /* Take one subject's marks out, leaving the name they were showing as plain
   * prose. What a mark whose target is gone actually needs. */
  function unmark(p, text, id) {
    let s = String(text == null ? '' : text);
    const marks = parse(p, s).filter(function (m) { return m.id === id; });
    for (let i = marks.length - 1; i >= 0; i--) {
      s = s.slice(0, marks[i].from) + marks[i].label + s.slice(marks[i].to);
    }
    return s;
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
  /* Everything on this card that can hold a mark, in the order it is read:
   * the description, then the project's own boxes. A mark in a field used to
   * be invisible here, which made its position in the feed a lie. */
  /* Which boxes a lane reads, in the order they are read. The shared
   * description first — it is the sentence the card is about — then the box
   * for this lane, then the project's own fields.
   *
   * `role` is 'image', 'video', or nothing at all. Nothing means the union,
   * which is what the card strip, the export and the printed board want: one
   * list of everything this card touches. A lane wants only its own, because
   * the numbers it hands out are the numbers its prompt will cite. */
  function boxes(shot, role) {
    const out = [shot.description];
    if (role !== 'video') out.push(shot.imageDescription);
    if (role !== 'image') out.push(shot.videoDescription);
    return out;
  }

  /* The three boxes by name, for the two things a caller can want: to READ
   * all of them as one piece of prose, or to REWRITE every one of them the
   * same way. Both existed as `shot.description` before the split, and every
   * bug the first QA pass found was a call site that still said that. */
  const KEYS = ['description', 'imageDescription', 'videoDescription'];

  /* What this card says, as prose, for one lane or for all of it. */
  function text(p, shot, role) {
    return boxes(shot, role)
      .map(function (t) { return plain(p, t || '').trim(); })
      .filter(Boolean).join('\n\n');
  }

  /* Run a repair over every box. Returns how many it changed — a repair that
   * reports success without touching the box the mark was in is worse than
   * one that does nothing, because the toast says it worked. */
  function rewrite(shot, fn) {
    let n = 0;
    KEYS.forEach(function (k) {
      const was = shot[k] || '';
      const now = fn(was, k);
      if (typeof now === 'string' && now !== was) { shot[k] = now; n++; }
    });
    return n;
  }

  function marked(p, shot, role) {
    let out = [];
    boxes(shot, role).forEach(function (t) { out = out.concat(parse(p, t)); });
    if (SB.Fields && SB.Fields.enabled) {
      SB.Fields.enabled(p).forEach(function (f) {
        out = out.concat(parse(p, SB.Fields.value(shot, f.id)));
      });
    }
    return out;
  }

  function feed(p, shot, role) {
    const out = [];
    const seen = {};

    marked(p, shot, role).forEach(function (m) {
      if (seen[m.id]) return;
      seen[m.id] = 1;
      /* A mark whose target is gone feeds nothing, but it is still sitting in
       * the text — so it belongs in the strip, saying so. Left out, the card
       * claimed it had no references while the model was still being handed
       * the words. */
      if (m.dead) {
        out.push({
          kind: 'dead', id: m.id, label: m.label, mentioned: true, images: [],
          why: '“' + m.fallback + '” is gone — this is plain text now'
        });
        return;
      }
      /* A swap can leave a card pointing at itself, and telling a model to
       * derive a frame from that same frame is nonsense. */
      if (m.id === shot.id) return;
      if (m.kind === 'shot') {
        const img = m.target.shot.image;
        out.push({
          kind: 'shot', id: m.id, label: m.target.label, mentioned: true,
          images: img ? [img] : [],
          /* the full-size original, where the board is carrying one */
          renders: img ? [m.target.shot.render || null] : [],
          why: img ? 'the rendered frame of ' + m.target.label
                   : m.target.label + ' has no frame yet — there is nothing to feed'
        });
        return;
      }
      const imgs = SB.Personas.imagesOf(m.target.subject);
      out.push({
        kind: 'subject', id: m.id, label: m.target.label, mentioned: true,
        subject: m.target.subject, images: imgs,
        renders: imgs.map(function (x) { return x.render || null; }),
        why: imgs.length ? null : 'no reference image yet — it will be described in full instead'
      });
    });

    /* Cast, but nobody said to show it — so it joins every lane, because
     * being on the card is not a statement about one half of it.
     *
     * Unless they were named in the OTHER lane. Typing @Beta in the motion
     * box casts Beta, and casting used to drop her into the first frame's
     * feed as well: her photograph uploaded with the still, named image 1 in
     * its prompt, shipped into the shot's refs/ folder — for a frame the
     * description says is an empty corridor. Marking somebody for the clip
     * must not put their face in the picture. */
    const elsewhere = {};
    if (role) {
      const here = {};
      marked(p, shot, role).forEach(function (m) { here[m.id] = 1; });
      marked(p, shot).forEach(function (m) { if (!here[m.id]) elsewhere[m.id] = 1; });
    }
    SB.Personas.forShot(p, shot).forEach(function (per) {
      if (seen[per.id]) return;
      if (elsewhere[per.id]) return;
      seen[per.id] = 1;
      const imgs = SB.Personas.imagesOf(per);
      out.push({
        kind: 'subject', id: per.id, label: per.name || 'unnamed', mentioned: false,
        subject: per, images: imgs,
        renders: imgs.map(function (x) { return x.render || null; }),
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

  /* Just the pictures, in order — what "Download for MXM" hands over. */
  function images(p, shot, role) {
    const list = [];
    feed(p, shot, role).forEach(function (e) {
      e.images.forEach(function (img, i) {
        list.push({
          img: img, id: e.id, kind: e.kind, label: e.label,
          /* null when the board's proxy is all there is */
          render: (e.renders || [])[i] || null,
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
    /* `until` is where the caret was. A caret that could not be read comes
     * back null, which used to slice from the start and paste the whole
     * description in again. */
    const from = Math.max(0, Math.min(at | 0, s.length));
    const to = (until == null || until < from) ? from : Math.min(until, s.length);
    return { text: s.slice(0, from) + tok + s.slice(to), caret: from + tok.length };
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
    /* Everything from an unterminated `@{` to the end is a token being typed,
     * not prose — linking inside it nests one mark in another. */
    let half = -1;
    const open = s.lastIndexOf('@{');
    if (open >= 0 && s.indexOf('}', open) < 0) half = open;
    const inside = function (i) {
      if (half >= 0 && i >= half) return true;
      return marks.some(function (m) { return i >= m.from && i < m.to; });
    };
    const names = SB.Personas.all(p)
      .filter(function (x) { return (x.name || '').trim().length > 1; })
      .sort(function (a, b) { return b.name.length - a.name.length; });

    const out = [];
    const taken = [];
    names.forEach(function (per) {
      /* case-insensitively: the shot generator writes prose, and "the
       * industrial scanner" in a sentence never matched the subject
       * "Industrial Scanner" — so the one thing that would have caught it
       * silently found nothing. */
      const re = new RegExp('(?<![\\w@{])' +
        per.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w}])', 'gi');
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

  /* Where this exact text appears as prose rather than inside a mark. The
   * rename offer needs this: a mark resolves by id and needs no repair, so
   * only the loose copies are worth offering to rewrite. */
  function proseHits(p, text, name) {
    const s = String(text == null ? '' : text);
    const n = String(name || '');
    if (!s || !n) return [];
    const marks = parse(p, s);
    const re = new RegExp('(?<![\\w@{|])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
      '(?![\\w}|])', 'g');
    const out = [];
    let m;
    while ((m = re.exec(s))) {
      const at = m.index;
      if (marks.some(function (k) { return at >= k.from && at < k.to; })) continue;
      out.push({ from: at, to: at + m[0].length });
    }
    return out;
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

  /* Put back the marks a model rewrite flattened.
   *
   * The writer is handed prose and answers with prose, so every mark in the
   * text it replaced is gone. Re-marking every name it happens to mention is
   * wrong twice over: it links names the writer deliberately left plain —
   * overwriting the "no mark, not shown" half of the rule — and it knows
   * nothing about shot codes, so an earlier frame silently drops out of the
   * feed. So only what WAS marked is marked again, matched on the label it
   * carries now, first occurrence only, in the order the marks were written.
   */
  function relink(p, next, prev) {
    let s = String(next == null ? '' : next);
    const was = parse(p, prev);
    if (!was.length) return s;
    const done = {};
    was.forEach(function (m) {
      if (done[m.id] || m.dead) return;
      const hits = proseHits(p, s, m.label);
      if (!hits.length) return;
      done[m.id] = 1;
      const h = hits[0];
      s = s.slice(0, h.from) + mark(m.id, m.label) + s.slice(h.to);
    });
    return s;
  }

  /* Which marks did not survive — what the rewrite dropped on the floor. */
  function lostIn(p, next, prev) {
    const after = {};
    parse(p, next).forEach(function (m) { after[m.id] = 1; });
    return parse(p, prev).filter(function (m) { return !m.dead && !after[m.id]; });
  }

  SB.Refs = {
    mark: mark, parse: parse, plain: plain, target: target, unmark: unmark,
    feed: feed, images: images, insert: insert, boxes: boxes, marked: marked,
    KEYS: KEYS, text: text, rewrite: rewrite,
    unlinked: unlinked, linkAll: linkAll, proseHits: proseHits,
    relink: relink, lostIn: lostIn
  };

})(window.SB);
