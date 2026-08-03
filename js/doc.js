/* doc.js — the shared-document engine.
 *
 * A Doc is { text: string, marks: { b:[[s,e]..], i:[...], u:[...] } }.
 * Every edit anywhere in the app is funnelled through a single primitive:
 *
 *     replace(doc, start, end, insertedText)
 *
 * Positions (shot link anchors, marks) are *transformed* through that
 * primitive rather than re-found by string matching, so they survive edits
 * elsewhere in the document. Gravity decides what happens when an edit lands
 * exactly on an anchor.
 */
(function (SB) {
  'use strict';

  const TYPES = ['b', 'i', 'u'];
  const BIT = { b: 1, i: 2, u: 4 };

  function make(text) {
    return { text: text || '', marks: { b: [], i: [], u: [] } };
  }

  function normalize(list) {
    if (!list || !list.length) return [];
    const l = list.filter(function (r) { return r[1] > r[0]; })
      .sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    const out = [];
    for (let k = 0; k < l.length; k++) {
      const last = out[out.length - 1];
      if (last && l[k][0] <= last[1]) last[1] = Math.max(last[1], l[k][1]);
      else out.push([l[k][0], l[k][1]]);
    }
    return out;
  }

  /* Transform position p through replace(start,end,len).
   * leftGravity=true  -> anchor stays to the LEFT of inserted text
   * leftGravity=false -> anchor moves to the RIGHT of inserted text
   */
  function mapPos(p, start, end, len, leftGravity) {
    // 1. deletion of [start,end)
    let q;
    if (p <= start) q = p;
    else if (p >= end) q = p - (end - start);
    else q = start;
    // 2. insertion of len at start
    if (q < start) return q;
    if (q > start) return q + len;
    return leftGravity ? start : start + len;
  }

  function mapList(list, start, end, len) {
    const out = [];
    for (let k = 0; k < list.length; k++) {
      // marks: don't grab text typed before them, do extend when typed at their end
      const a = mapPos(list[k][0], start, end, len, false);
      const b = mapPos(list[k][1], start, end, len, false);
      if (b > a) out.push([a, b]);
    }
    return normalize(out);
  }

  /* Apply a replacement to a doc's text + marks. Returns the raw op. */
  function replace(doc, start, end, text) {
    start = SB.clamp(start | 0, 0, doc.text.length);
    end = SB.clamp(end | 0, start, doc.text.length);
    text = text == null ? '' : String(text);
    doc.text = doc.text.slice(0, start) + text + doc.text.slice(end);
    for (let k = 0; k < TYPES.length; k++) {
      const t = TYPES[k];
      doc.marks[t] = mapList(doc.marks[t] || [], start, end, text.length);
    }
    return { start: start, end: end, len: text.length };
  }

  /* Does [s,e) carry the mark entirely? */
  function hasMark(doc, type, s, e) {
    if (e <= s) return false;
    const list = doc.marks[type] || [];
    let cur = s;
    for (let k = 0; k < list.length && cur < e; k++) {
      if (list[k][1] <= cur) continue;
      if (list[k][0] > cur) return false;
      cur = list[k][1];
    }
    return cur >= e;
  }

  function addMark(doc, type, s, e) {
    if (e <= s) return;
    doc.marks[type] = normalize((doc.marks[type] || []).concat([[s, e]]));
  }

  function removeMark(doc, type, s, e) {
    if (e <= s) return;
    const out = [];
    const list = doc.marks[type] || [];
    for (let k = 0; k < list.length; k++) {
      const a = list[k][0], b = list[k][1];
      if (b <= s || a >= e) { out.push([a, b]); continue; }
      if (a < s) out.push([a, s]);
      if (b > e) out.push([e, b]);
    }
    doc.marks[type] = normalize(out);
  }

  function toggleMark(doc, type, s, e) {
    if (e <= s || !BIT[type]) return;
    if (hasMark(doc, type, s, e)) removeMark(doc, type, s, e);
    else addMark(doc, type, s, e);
  }

  /* Per-character style bitfield for [from,to) */
  function flags(doc, from, to) {
    const n = Math.max(0, to - from);
    const f = new Uint8Array(n);
    for (let k = 0; k < TYPES.length; k++) {
      const t = TYPES[k], bit = BIT[t], list = doc.marks[t] || [];
      for (let j = 0; j < list.length; j++) {
        const a = Math.max(from, list[j][0]), b = Math.min(to, list[j][1]);
        for (let i = a; i < b; i++) f[i - from] |= bit;
      }
    }
    return f;
  }

  /* Marks inside [from,to) rebased to 0 (used when breaking a link). */
  function sliceMarks(doc, from, to) {
    const out = { b: [], i: [], u: [] };
    for (let k = 0; k < TYPES.length; k++) {
      const t = TYPES[k], list = doc.marks[t] || [];
      for (let j = 0; j < list.length; j++) {
        const a = Math.max(from, list[j][0]), b = Math.min(to, list[j][1]);
        if (b > a) out[t].push([a - from, b - from]);
      }
      out[t] = normalize(out[t]);
    }
    return out;
  }

  /* Render [from,to) as HTML. extraFn(absoluteIndex) -> extra class string (or ''). */
  function renderHTML(doc, from, to, extraFn) {
    from = SB.clamp(from | 0, 0, doc.text.length);
    to = SB.clamp(to | 0, from, doc.text.length);
    const slice = doc.text.slice(from, to);
    if (!slice) return '';
    const f = flags(doc, from, to);
    let html = '';
    let runStart = 0, runFlag = f[0], runExtra = extraFn ? extraFn(from) : '';
    function emit(a, b, fl, ex) {
      let s = SB.esc(slice.slice(a, b));
      if (fl & BIT.b) s = '<b>' + s + '</b>';
      if (fl & BIT.i) s = '<i>' + s + '</i>';
      if (fl & BIT.u) s = '<u>' + s + '</u>';
      if (ex) s = '<span class="' + ex + '">' + s + '</span>';
      html += s;
    }
    for (let i = 1; i < slice.length; i++) {
      const ex = extraFn ? extraFn(from + i) : '';
      if (f[i] !== runFlag || ex !== runExtra) {
        emit(runStart, i, runFlag, runExtra);
        runStart = i; runFlag = f[i]; runExtra = ex;
      }
    }
    emit(runStart, slice.length, runFlag, runExtra);
    if (slice.charAt(slice.length - 1) === '\n') html += '<br class="pad">';
    return html;
  }

  SB.Doc = {
    TYPES: TYPES, BIT: BIT,
    make: make, normalize: normalize, mapPos: mapPos, mapList: mapList,
    replace: replace, hasMark: hasMark, toggleMark: toggleMark,
    addMark: addMark, removeMark: removeMark,
    flags: flags, sliceMarks: sliceMarks, renderHTML: renderHTML
  };

})(window.SB);
