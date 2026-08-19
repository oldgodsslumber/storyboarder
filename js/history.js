/* history.js — undo/redo for script text.
 *
 * The editor suppresses the browser's own undo (we own the DOM), so this
 * supplies it. A step snapshots the script layer only: the master document
 * plus every shot's and scene's link range / freestanding text. Structural changes —
 * adding, deleting or moving shots and scenes — are deliberately NOT undone,
 * so Ctrl+Z can never make a card disappear out from under you.
 *
 * Consecutive typing in the same window coalesces into one step.
 */
(function (SB) {
  'use strict';

  const LIMIT = 200;
  const COALESCE_MS = 700;

  const H = { past: [], future: [], applying: false, lastTag: null, lastAt: 0 };

  function P() { return SB.app && SB.app.project; }

  function snap(p) {
    const shots = [];
    SB.Model.eachShot(p, function (s) {
      shots.push({
        id: s.id,
        link: s.link ? { from: s.link.from, to: s.link.to } : null,
        broken: !!s.broken,
        local: s.local ? SB.clone(s.local) : null
      });
    });
    /* A scene's claim on a stretch of script is anchored into the same text, so
     * it belongs to this layer too — without it, undo puts the old text back
     * while every claim stays mapped forward against text that no longer
     * exists. Which scenes exist is structural and is left alone. */
    const scenes = p.scenes.map(function (sc) {
      return {
        id: sc.id,
        link: sc.link ? { from: sc.link.from, to: sc.link.to } : null,
        broken: !!sc.broken,
        local: sc.local ? SB.clone(sc.local) : null
      };
    });
    return {
      text: p.master.text,
      marks: SB.clone(p.master.marks),
      shots: shots,
      scenes: scenes,
      /* notes are anchored into the same text, so they have to move back with it */
      notes: SB.clone(p.scriptComments || [])
    };
  }

  function apply(p, s) {
    p.master.text = s.text;
    p.master.marks = SB.clone(s.marks);
    if (s.notes) p.scriptComments = SB.clone(s.notes);
    const byId = {};
    s.shots.forEach(function (x) { byId[x.id] = x; });
    SB.Model.eachShot(p, function (sh) {
      const x = byId[sh.id];
      if (!x) return;                    // shot created after this snapshot — leave it alone
      sh.link = x.link ? { from: x.link.from, to: x.link.to } : null;
      sh.broken = x.broken;
      sh.local = x.local ? SB.clone(x.local) : null;
    });
    const scById = {};
    (s.scenes || []).forEach(function (x) { scById[x.id] = x; });
    p.scenes.forEach(function (sc) {
      const x = scById[sc.id];
      if (!x) return;                    // scene created after this snapshot
      sc.link = x.link ? { from: x.link.from, to: x.link.to } : null;
      sc.broken = x.broken;
      sc.local = x.local ? SB.clone(x.local) : null;
    });
  }

  /* Called just BEFORE a script edit lands. tag identifies the window so that
   * a run of keystrokes in one box becomes a single undo step. */
  function push(tag) {
    const p = P();
    if (!p || H.applying) return;
    const now = Date.now();
    if (H.past.length && tag && tag === H.lastTag && (now - H.lastAt) < COALESCE_MS) {
      H.lastAt = now;
      return;                            // already have the pre-typing state
    }
    H.past.push(snap(p));
    if (H.past.length > LIMIT) H.past.shift();
    H.future.length = 0;
    H.lastTag = tag || null;
    H.lastAt = now;
  }

  /* A discrete action (capture, break link, paste) shouldn't merge with typing. */
  function seal() { H.lastTag = null; H.lastAt = 0; }

  function step(from, to) {
    const p = P();
    if (!p || !from.length) return false;
    H.applying = true;
    to.push(snap(p));
    apply(p, from.pop());
    H.applying = false;
    seal();
    SB.app.scriptChanged();
    SB.Board.renderScriptWindows();
    return true;
  }

  function undo() { return step(H.past, H.future); }
  function redo() { return step(H.future, H.past); }

  function reset() {
    H.past.length = 0;
    H.future.length = 0;
    seal();
  }

  SB.History = {
    push: push, undo: undo, redo: redo, reset: reset, seal: seal,
    depth: function () { return H.past.length; },
    redoDepth: function () { return H.future.length; }
  };

})(window.SB);
