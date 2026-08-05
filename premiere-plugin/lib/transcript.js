/* transcript.js — turn an exported transcript into a flat, timed word list.
 *
 * Accepts SRT, WebVTT, or Premiere's transcript JSON (Text panel → Export →
 * Transcript .json, or Transcript.exportToJSON from the UXP API).
 *
 * Everything collapses to the same shape:
 *
 *     [{ text: 'Hello', start: 1.20, end: 1.44 }, ...]
 *
 * Cue-level formats (SRT/VTT) have no per-word timing, so a cue's duration is
 * split evenly across its words. That is what lets a cut landing in the middle
 * of a caption still split the sentence at roughly the right word — the same
 * "first word / word after the last word" boundary you would get by eye.
 *
 * Loads as a plain <script> in the UXP panel and as a CommonJS module in node
 * (so test-plugin.mjs can exercise the parsing without Premiere).
 */
(function (root, factory) {
  const api = factory();
  // Set both: UXP loads this as a plain <script> but still defines require, and
  // an either/or here would leave the panel with no global to reach.
  root.SBTranscript = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TICKS_PER_SECOND = 254016000000;

  /* ---------- time helpers ---------- */

  /* "00:01:02,345" / "00:01:02.345" / "1:02.345" -> seconds */
  function parseClockString(s) {
    const m = String(s).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/);
    if (!m) return null;
    const h = Number(m[1] || 0), mi = Number(m[2]), se = Number(m[3]);
    const ms = Number((m[4] || '0').padEnd(3, '0'));
    return h * 3600 + mi * 60 + se + ms / 1000;
  }

  /* A numeric time out of a JSON transcript may be seconds, milliseconds or
   * Premiere ticks. Decide once for the whole file from the largest value seen,
   * so a single stray number can't flip the unit halfway through. */
  function unitScalerFor(maxValue) {
    if (maxValue > 1e11) return function (v) { return v / TICKS_PER_SECOND; };
    if (maxValue > 1e5) return function (v) { return v / 1000; };
    return function (v) { return v; };
  }

  function secondsToTimecode(sec, fps) {
    sec = Math.max(0, sec || 0);
    const f = Math.round(sec * fps);
    const ff = f % Math.round(fps);
    const total = Math.floor(f / Math.round(fps));
    const ss = total % 60, mm = Math.floor(total / 60) % 60, hh = Math.floor(total / 3600);
    const p = function (n) { return String(n).padStart(2, '0'); };
    return p(hh) + ':' + p(mm) + ':' + p(ss) + ':' + p(ff);
  }

  /* ---------- cue -> words ---------- */

  function stripCueMarkup(text) {
    return text
      .replace(/<[^>]*>/g, '')          // VTT <c>, <00:00:01.000> and friends
      .replace(/\{\\[^}]*\}/g, '')      // stray SSA overrides
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* Split one cue into evenly-timed words. A cue with no duration still yields
   * its words (zero-length, all at the same instant) rather than vanishing. */
  function cueToWords(cue) {
    const clean = stripCueMarkup(cue.text || '');
    if (!clean) return [];
    const tokens = clean.split(' ');
    const start = cue.start;
    const dur = Math.max(0, (cue.end == null ? cue.start : cue.end) - cue.start);
    const step = tokens.length ? dur / tokens.length : 0;
    return tokens.map(function (t, i) {
      return { text: t, start: start + step * i, end: start + step * (i + 1) };
    });
  }

  /* ---------- SRT / VTT ---------- */

  const TIME_LINE = /(\d{1,2}:\d{1,2}:\d{1,2}[.,]\d{1,3}|\d{1,2}:\d{1,2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{1,2}:\d{1,2}[.,]\d{1,3}|\d{1,2}:\d{1,2}[.,]\d{1,3})/;

  /* Text is accumulated per line rather than concatenated, so that a cue index
   * belonging to the *next* cue can be taken back off the end. Exports that omit
   * the blank line between cues would otherwise glue "2" onto the previous line
   * of dialogue. Only a line that is nothing but digits is dropped, so a cue
   * legitimately ending in a number survives. */
  function closeCue(cue, cues, dropTrailingIndex) {
    if (!cue) return;
    const lines = cue.lines;
    if (dropTrailingIndex && lines.length > 1 && /^\d+$/.test(lines[lines.length - 1])) {
      lines.pop();
    }
    cue.text = lines.join(' ');
    delete cue.lines;
    cues.push(cue);
  }

  function parseCueList(text) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    const cues = [];
    let cur = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = line.match(TIME_LINE);
      if (m) {
        closeCue(cur, cues, true);            // no blank line: last line was the next index
        cur = { start: parseClockString(m[1]), end: parseClockString(m[2]), lines: [] };
        continue;
      }
      if (!cur) continue;                     // header, cue numbers, NOTE blocks
      if (!line.trim()) { closeCue(cur, cues, false); cur = null; continue; }
      cur.lines.push(line);
    }
    closeCue(cur, cues, false);
    return cues.filter(function (c) { return c.start != null && c.end != null; });
  }

  /* ---------- Premiere transcript JSON ---------- */

  const TEXT_KEYS = ['text', 'word', 'content', 'value', 'transcript', 'displayText'];
  const START_KEYS = ['start', 'startTime', 'startTimeSeconds', 'begin', 'in', 'inPoint', 'from', 's'];
  const END_KEYS = ['end', 'endTime', 'endTimeSeconds', 'stop', 'out', 'outPoint', 'to', 'e'];

  function pick(obj, keys) {
    for (let i = 0; i < keys.length; i++) {
      if (Object.prototype.hasOwnProperty.call(obj, keys[i])) {
        const v = obj[keys[i]];
        if (v !== null && v !== undefined && v !== '') return v;
      }
    }
    return undefined;
  }

  function toNumberTime(v) {
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string') {
      const clock = parseClockString(v);
      if (clock != null) return clock;
      const n = Number(v);
      if (isFinite(n)) return n;
    }
    return null;
  }

  /* Adobe has shipped more than one transcript JSON layout, so rather than
   * hard-coding a schema we walk the tree and collect every object that looks
   * like a timed text segment. The deepest such level wins — that is the
   * word-level one when it exists, and the cue level when it doesn't. */
  function collectSegments(node, depth, out) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(function (n) { collectSegments(n, depth, out); });
      return;
    }
    const text = pick(node, TEXT_KEYS);
    const start = toNumberTime(pick(node, START_KEYS));
    const end = toNumberTime(pick(node, END_KEYS));
    if (typeof text === 'string' && start != null) {
      out.push({ depth: depth, text: text, start: start, end: end == null ? start : end });
    }
    Object.keys(node).forEach(function (k) {
      const v = node[k];
      if (v && typeof v === 'object') collectSegments(v, depth + 1, out);
    });
  }

  function parseTranscriptJSON(text) {
    let json;
    try { json = JSON.parse(text); } catch (e) { throw new Error('That .json file is not valid JSON.'); }
    const found = [];
    collectSegments(json, 0, found);
    if (!found.length) throw new Error('No timed text segments found in that JSON.');

    // deepest level = finest granularity available
    const maxDepth = found.reduce(function (a, s) { return Math.max(a, s.depth); }, 0);
    let segs = found.filter(function (s) { return s.depth === maxDepth; });
    if (segs.length < 2) segs = found;          // a single deep hit is noise, not the transcript

    const maxT = segs.reduce(function (a, s) { return Math.max(a, s.end, s.start); }, 0);
    const scale = unitScalerFor(maxT);
    return segs
      .map(function (s) { return { text: s.text, start: scale(s.start), end: scale(s.end) }; })
      .sort(function (a, b) { return a.start - b.start; });
  }

  /* ---------- entry point ---------- */

  /* filename is only used to prefer the JSON reader; content sniffing decides. */
  function parse(text, filename) {
    const trimmed = String(text || '').trim();
    if (!trimmed) throw new Error('That transcript file is empty.');

    const looksJson = /\.json$/i.test(filename || '') || trimmed[0] === '{' || trimmed[0] === '[';
    const cues = looksJson ? parseTranscriptJSON(trimmed) : parseCueList(trimmed);

    if (!cues.length) {
      throw new Error(
        'No timed cues found. Export from the Text panel as SRT, VTT or transcript JSON — ' +
        'a plain text script has no timings to line up with the cuts.'
      );
    }

    const words = [];
    cues.forEach(function (c) { cueToWords(c).forEach(function (w) { words.push(w); }); });
    if (!words.length) throw new Error('That transcript has timings but no words in it.');
    words.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
    return words;
  }

  /* ---------- mapping words onto shots ---------- */

  /* A word belongs to the shot its midpoint sits in. Anything before the first
   * cut or after the last one is pulled into the nearest shot so no line of the
   * script is silently dropped. */
  function assignWordsToShots(words, shots) {
    const buckets = shots.map(function () { return []; });
    if (!shots.length) return buckets;

    let si = 0;
    for (let i = 0; i < words.length; i++) {
      const mid = (words[i].start + words[i].end) / 2;
      while (si < shots.length - 1 && mid >= shots[si].end) si++;
      let target = si;
      if (mid < shots[0].start) target = 0;
      else if (mid >= shots[shots.length - 1].end) target = shots.length - 1;
      buckets[target].push(words[i]);
    }
    return buckets;
  }

  return {
    parse: parse,
    parseCueList: parseCueList,
    parseTranscriptJSON: parseTranscriptJSON,
    cueToWords: cueToWords,
    assignWordsToShots: assignWordsToShots,
    parseClockString: parseClockString,
    secondsToTimecode: secondsToTimecode,
    TICKS_PER_SECOND: TICKS_PER_SECOND
  };
});
