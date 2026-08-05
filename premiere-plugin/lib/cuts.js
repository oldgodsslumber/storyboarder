/* cuts.js — work out where the picture actually changes.
 *
 * A cut is not "a clip boundary on one track". On a stacked timeline the frame
 * changes whenever *anything* enters or leaves the composite: a graphic landing
 * on V7 over a continuous interview on V1 is a shot change, even though V1 never
 * cuts. Premiere renders the composite when it exports a frame, so the cards
 * have to be cut the same way or the boundaries stop matching the pictures.
 *
 * Two modes:
 *
 *   union — every in and out point across the nominated tracks becomes an edit
 *           point. Segments run from one edit point to the next. This is what a
 *           layered timeline needs.
 *   track — clip boundaries on a single track, ignoring everything above it.
 *           For when you deliberately want the base layer only.
 *
 * Input tracks are ordered bottom-up, matching Premiere: index 0 is V1, and a
 * higher index sits on top.
 */
(function (root, factory) {
  const api = factory();
  root.SBCuts = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* minDuration drops short *elements*, not short segments. Folding a brief
   * lower-third into the segment before it would leave two cards either side of
   * it showing an identical picture; ignoring the super outright leaves one. */
  function clipsOf(track, ignoreAdjustment, minDuration) {
    return (track.shots || []).filter(function (c) {
      if (ignoreAdjustment && c.isAdjustment) return false;
      if (minDuration && (c.end - c.start) < minDuration) return false;
      return true;
    });
  }

  /* Tracks the user nominated, minus muted ones — a muted track contributes
   * nothing to the picture, so it must not contribute edit points either. */
  function activeTracks(tracks, opts) {
    const want = opts.trackIndexes;
    return tracks.filter(function (t) {
      if (t.muted && opts.skipMuted !== false) return false;
      if (want && want.indexOf(t.index) === -1) return false;
      return clipsOf(t, opts.ignoreAdjustment, 0).length > 0;
    });
  }

  function covering(track, time, ignoreAdjustment, minDuration) {
    const clips = clipsOf(track, ignoreAdjustment, minDuration);
    for (let i = 0; i < clips.length; i++) {
      if (clips[i].start <= time && time < clips[i].end) return clips[i];
    }
    return null;
  }

  /* The clip a viewer is actually looking at: topmost track with something on it.
   * Its name is the most useful label for the card. */
  function topmostAt(tracks, time, ignoreAdjustment, minDuration) {
    for (let i = tracks.length - 1; i >= 0; i--) {
      const clip = covering(tracks[i], time, ignoreAdjustment, minDuration);
      if (clip) return { clip: clip, track: tracks[i] };
    }
    return null;
  }

  /* Collapse edit points that land on the same frame. Two tracks cutting on the
   * same frame is one cut, not two, and floating-point seconds off a TickTime
   * will not compare equal on their own. */
  function dedupe(times, tolerance) {
    const sorted = times.slice().sort(function (a, b) { return a - b; });
    const out = [];
    for (let i = 0; i < sorted.length; i++) {
      if (!out.length || sorted[i] - out[out.length - 1] > tolerance) out.push(sorted[i]);
    }
    return out;
  }

  /* Dropping a short clip at the very head or tail would leave the storyboard
   * starting late or ending early, losing the script either side of it. Stretch
   * the outer segments back over anything that was ignored. */
  function coverEnds(segments, tracks, ignoreAdjustment) {
    if (!segments.length) return segments;
    let earliest = Infinity, latest = -Infinity;
    tracks.forEach(function (t) {
      clipsOf(t, ignoreAdjustment, 0).forEach(function (c) {
        if (c.start < earliest) earliest = c.start;
        if (c.end > latest) latest = c.end;
      });
    });
    if (earliest < segments[0].start) segments[0].start = earliest;
    if (latest > segments[segments.length - 1].end) segments[segments.length - 1].end = latest;
    return segments;
  }

  /* opts: {mode, trackIndexes, minDuration, ignoreAdjustment, skipMuted, fps, sequenceEnd} */
  function find(tracks, opts) {
    opts = opts || {};
    const fps = opts.fps || 30;
    const tolerance = 0.5 / fps;
    const ignoreAdjustment = opts.ignoreAdjustment !== false;
    const minDuration = opts.minDuration || 0;
    const active = activeTracks(tracks, opts);
    if (!active.length) return [];

    let segments;
    if (opts.mode === 'track') {
      const t = active[active.length - 1];
      segments = clipsOf(t, ignoreAdjustment, minDuration)
        .slice()
        .sort(function (a, b) { return a.start - b.start; })
        .map(function (c) { return { start: c.start, end: c.end }; });
    } else {
      const points = [];
      active.forEach(function (t) {
        clipsOf(t, ignoreAdjustment, minDuration).forEach(function (c) {
          points.push(c.start);
          points.push(c.end);
        });
      });
      const edges = dedupe(points, tolerance);
      segments = [];
      for (let i = 0; i < edges.length - 1; i++) {
        segments.push({ start: edges[i], end: edges[i + 1] });
      }
      // a stretch with nothing on any nominated track is black — not a shot
      segments = segments.filter(function (s) {
        return !!topmostAt(active, (s.start + s.end) / 2, ignoreAdjustment, minDuration);
      });
    }

    segments = coverEnds(segments, active, ignoreAdjustment);

    return segments.map(function (s) {
      const mid = (s.start + s.end) / 2;
      // label from every clip present, including ones too short to cut on
      const top = topmostAt(active, mid, ignoreAdjustment, 0);
      const layers = active.filter(function (t) {
        return !!covering(t, mid, ignoreAdjustment, 0);
      }).map(function (t) { return t.name; });
      return {
        start: s.start,
        end: s.end,
        name: top ? top.clip.name : '',
        track: top ? top.track.name : '',
        layers: layers
      };
    });
  }

  /* Which frame to grab for a shot, as whole frames.
   *
   * Working in frame numbers rather than seconds matters: shot times come back as
   * floating-point seconds, and adding an offset of 1/29.97 lands between frame
   * boundaries. Premiere can refuse to render a frame at a time that is not on
   * the grid, which shows up as an occasional card with no picture.
   *
   * The offset steps past a dissolve sitting on the cut; it is clamped so a short
   * shot cannot grab past its own last frame.
   */
  function grabFrame(shot, offsetFrames, fps) {
    const startFrame = Math.round(shot.start * fps);
    const endFrame = Math.round(shot.end * fps);       // exclusive
    const lastFrame = Math.max(startFrame, endFrame - 1);
    const wanted = startFrame + Math.max(0, Math.round(offsetFrames || 0));
    return Math.min(wanted, lastFrame);
  }

  /* The same thing in seconds, landing exactly on a frame boundary. */
  function grabTime(shot, offsetFrames, fps) {
    return grabFrame(shot, offsetFrames, fps) / fps;
  }

  /* Fallbacks for a frame Premiere will not give us: the middle of the shot, then
   * its first frame, then one frame back from its end. */
  function grabAlternatives(shot, offsetFrames, fps) {
    const startFrame = Math.round(shot.start * fps);
    const endFrame = Math.round(shot.end * fps);
    const lastFrame = Math.max(startFrame, endFrame - 1);
    const mid = Math.floor((startFrame + lastFrame) / 2);
    const first = grabFrame(shot, offsetFrames, fps);
    const out = [];
    [mid, startFrame, lastFrame].forEach(function (f) {
      if (f !== first && out.indexOf(f) === -1) out.push(f);
    });
    return out.map(function (f) { return f / fps; });
  }

  return {
    find: find, dedupe: dedupe, coverEnds: coverEnds, topmostAt: topmostAt,
    grabFrame: grabFrame, grabTime: grabTime, grabAlternatives: grabAlternatives
  };
});
