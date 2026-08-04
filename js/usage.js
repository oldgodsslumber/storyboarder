/* usage.js — how much data a board is, and what it would cost to sync.
 *
 * Everything here is measured, not estimated: the byte counts come from the
 * exact string the app writes to disk, so what you see is what a backend would
 * have to store and move.
 */
(function (SB) {
  'use strict';

  const enc = (typeof TextEncoder === 'function') ? new TextEncoder() : null;

  function bytes(s) {
    if (!s) return 0;
    return enc ? enc.encode(s).length : String(s).length;
  }

  function fmt(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(2) + ' MB';
    return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  /* Fixed order, validated for colour-vision deficiency against both the light
   * and the dark board surface. Never reorder or cycle these. */
  const SECTION_COLORS = ['#3b82f6', '#d97706', '#0d9488', '#c026d3', '#65a30d'];
  const OTHER_COLOR = '#8b93a3';

  function measure(p) {
    const total = bytes(SB.Store.serialize(p));

    let frames = 0, framesN = 0, ink = 0, inkN = 0;
    SB.Model.eachShot(p, function (sh) {
      if (sh.image && sh.image.data) { frames += bytes(sh.image.data); framesN++; }
      if (sh.annotation) { ink += bytes(sh.annotation); inkN++; }
    });

    let refs = 0, refsN = 0;
    (p.personas || []).forEach(function (per) {
      if (per.image && per.image.data) { refs += bytes(per.image.data); refsN++; }
    });

    const versions = (p.versions && p.versions.length) ? bytes(JSON.stringify(p.versions)) : 0;
    const rest = Math.max(0, total - frames - refs - ink - versions);

    let shots = 0;
    SB.Model.eachShot(p, function () { shots++; });

    const sections = [
      { key: 'frames', label: 'Shot frames', n: framesN, b: frames, color: SECTION_COLORS[0] },
      { key: 'refs', label: 'Persona references', n: refsN, b: refs, color: SECTION_COLORS[1] },
      { key: 'ink', label: 'Comment ink', n: inkN, b: ink, color: SECTION_COLORS[2] },
      { key: 'versions', label: 'Saved versions', n: (p.versions || []).length, b: versions, color: SECTION_COLORS[3] },
      { key: 'text', label: 'Script, prompts, structure', n: shots, b: rest, color: SECTION_COLORS[4] }
    ].filter(function (s) { return s.b > 0; });

    /* the individual images worth knowing about */
    const heavy = [];
    SB.Model.eachShot(p, function (sh, sc, i, j) {
      if (sh.image && sh.image.data) {
        heavy.push({ label: SB.Model.code(i, j) + ' frame', b: bytes(sh.image.data) });
      }
      if (sh.annotation) heavy.push({ label: SB.Model.code(i, j) + ' ink', b: bytes(sh.annotation) });
    });
    (p.personas || []).forEach(function (per) {
      if (per.image && per.image.data) {
        heavy.push({ label: (per.name || 'persona') + ' reference', b: bytes(per.image.data) });
      }
    });
    heavy.sort(function (a, b) { return b.b - a.b; });

    return {
      total: total,
      sections: sections,
      heaviest: heavy.slice(0, 6),
      imageBytes: frames + refs + ink,
      textBytes: total - frames - refs - ink - versions,
      versionBytes: versions,
      counts: {
        scenes: p.scenes.length, shots: shots, personas: (p.personas || []).length,
        versions: (p.versions || []).length, images: framesN + refsN + inkN,
        scriptChars: p.master.text.length
      }
    };
  }

  /* ---- what this would mean on Firebase ----
   * Figures checked against Google's docs, Aug 2026:
   *   Firestore document ceiling ....... 1 MiB (1,048,576 bytes), hard
   *   Spark (free) Firestore ........... 1 GiB stored, 20k writes/day,
   *                                      50k reads/day, 20k deletes/day
   *   Cloud Storage .................... not on Spark — needs Blaze
   */
  const FS_DOC_LIMIT = 1048576;
  const SPARK_STORE = 1024 * 1024 * 1024;
  const SPARK_WRITES = 20000;
  const SPARK_READS = 50000;

  function firebase(m, stats) {
    const perDay = stats && stats.perDay ? stats.perDay : null;
    const checks = [];

    const pct = Math.round(m.total / FS_DOC_LIMIT * 100);
    checks.push({
      ok: m.total <= FS_DOC_LIMIT,
      warn: m.total <= FS_DOC_LIMIT && pct >= 75,
      label: 'Fits in one Firestore document',
      detail: fmt(m.total) + ' of the hard 1 MiB ceiling' +
        (m.total > FS_DOC_LIMIT
          ? ' — over by ' + fmt(m.total - FS_DOC_LIMIT) + '. A board this size cannot be one document at any price.'
          : ' (' + pct + '% used)' + (pct >= 75 ? ' — a few more frames and it stops fitting.' : '.'))
    });

    const textOnly = m.textBytes + m.versionBytes;
    checks.push({
      ok: textOnly <= FS_DOC_LIMIT,
      label: 'Fits if the images live elsewhere',
      detail: 'Without images the board is ' + fmt(textOnly) + ' — ' +
        (textOnly <= FS_DOC_LIMIT
          ? 'comfortably inside one document.'
          : 'still over the 1 MiB ceiling; it would have to be split per scene.')
    });

    const boards = m.total > 0 ? Math.floor(SPARK_STORE / m.total) : 0;
    checks.push({
      ok: boards >= 20,
      label: 'Boards inside the free 1 GiB',
      detail: '≈ ' + boards.toLocaleString() + ' boards this size' +
        (boards < 20 ? ' — the free tier fills up fast at this weight.' : '.')
    });

    checks.push({
      ok: perDay === null || perDay <= SPARK_WRITES,
      label: 'Autosave writes inside 20,000/day',
      detail: perDay === null
        ? 'No save activity measured yet in this session.'
        : '≈ ' + Math.round(perDay).toLocaleString() + ' writes/day at the rate you have been working' +
        (perDay > SPARK_WRITES
          ? ' — over the free ceiling on its own.'
          : ' (' + Math.round(perDay / SPARK_WRITES * 100) + '% of it, one editor).')
    });

    const dailyBytes = perDay ? perDay * m.total : 0;
    checks.push({
      ok: true,
      label: 'Data moved per day, one editor',
      detail: perDay
        ? '≈ ' + fmt(dailyBytes) + ' uploaded — every autosave sends the whole board unless writes are made incremental.'
        : 'Nothing measured yet.'
    });

    const verdict = (m.total <= FS_DOC_LIMIT && pct >= 75)
      ? 'It fits today, at ' + pct + '% of the 1 MiB document ceiling — but frames are ' +
      Math.round(m.imageBytes / Math.max(1, m.total) * 100) + '% of this board, so the next few shots break it.'
      : m.total > FS_DOC_LIMIT
      ? 'Not as one document. The images are what break it — Firestore\'s 1 MiB ceiling is hard, and Cloud Storage (the natural home for the frames) is not on the free Spark plan at all.'
      : (perDay && perDay > SPARK_WRITES
        ? 'Storage fits, but autosave-per-pause would burn through the 20,000 free writes a day.'
        : 'This board would fit the free tier as a single document — keep an eye on it as frames get added.');

    return { checks: checks, verdict: verdict, docLimit: FS_DOC_LIMIT, sparkWrites: SPARK_WRITES, sparkReads: SPARK_READS };
  }

  SB.Usage = {
    measure: measure, firebase: firebase, fmt: fmt, bytes: bytes,
    SECTION_COLORS: SECTION_COLORS, OTHER_COLOR: OTHER_COLOR,
    FS_DOC_LIMIT: FS_DOC_LIMIT, SPARK_STORE: SPARK_STORE, SPARK_WRITES: SPARK_WRITES
  };

})(window.SB);
