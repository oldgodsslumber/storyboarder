/* usagepanel.js — the size readout: what this board weighs, what it moves,
 * and whether it could live on Firebase's free tier. */
(function (SB) {
  'use strict';

  const fmt = function (n) { return SB.Usage.fmt(n); };

  function P() { return SB.app.project; }

  /* the small always-on readout in the top bar */
  function refreshBadge() {
    const el = document.getElementById('sizeState');
    if (!el || !P()) return;
    let m;
    try { m = SB.Usage.measure(P()); } catch (e) { return; }
    el.textContent = fmt(m.total);
    el.title = 'This board is ' + fmt(m.total) + ' — ' +
      Math.round(m.imageBytes / Math.max(1, m.total) * 100) + '% images. Click for the breakdown.';
    el.classList.toggle('over', m.total > SB.Usage.FS_DOC_LIMIT);
  }

  function tile(label, value, note) {
    const d = SB.el('div', 'stat-tile');
    d.appendChild(SB.el('div', 'stat-label', label));
    d.appendChild(SB.el('div', 'stat-value', value));
    if (note) d.appendChild(SB.el('div', 'stat-note', note));
    return d;
  }

  function open() {
    const p = P();
    const m = SB.Usage.measure(p);
    const rate = SB.Store.saveRate();
    const stats = SB.Store.S.stats;
    const fb = SB.Usage.firebase(m, rate);

    const body = SB.el('div', 'usage');

    /* ---- headline numbers ---- */
    const tiles = SB.el('div', 'stat-row');
    tiles.appendChild(tile('This board', fmt(m.total),
      m.counts.shots + ' shots · ' + m.counts.scenes + ' scenes · ' + m.counts.images + ' images'));
    tiles.appendChild(tile('Images are', Math.round(m.imageBytes / Math.max(1, m.total) * 100) + '%',
      fmt(m.imageBytes) + ' of the file'));
    tiles.appendChild(tile('Saved this session', stats.writes.toLocaleString() + '×',
      fmt(stats.bytes) + ' written' + (rate ? ' · ≈' + Math.round(rate.perHour) + '/hour' : '')));
    body.appendChild(tiles);

    /* ---- the breakdown ---- */
    body.appendChild(SB.el('h3', 'usage-h', 'Where the bytes are'));
    const bar = SB.el('div', 'usage-bar');
    m.sections.forEach(function (s) {
      const seg = SB.el('span', 'usage-seg');
      seg.style.background = s.color;
      seg.style.flexGrow = String(Math.max(0.4, s.b / Math.max(1, m.total) * 100));
      seg.title = s.label + ' — ' + fmt(s.b);
      bar.appendChild(seg);
    });
    body.appendChild(bar);

    /* the same numbers as text, because colour alone is never the encoding */
    const table = SB.el('table', 'usage-table');
    const thead = SB.el('tr');
    ['', 'Part of the board', 'Size', 'Share'].forEach(function (h) {
      thead.appendChild(SB.el('th', null, h));
    });
    table.appendChild(thead);
    m.sections.forEach(function (s) {
      const tr = SB.el('tr');
      const sw = SB.el('td');
      const dot = SB.el('span', 'usage-dot');
      dot.style.background = s.color;
      sw.appendChild(dot);
      tr.appendChild(sw);
      tr.appendChild(SB.el('td', null, s.label + (s.n ? ' (' + s.n + ')' : '')));
      tr.appendChild(SB.el('td', 'num', fmt(s.b)));
      tr.appendChild(SB.el('td', 'num', Math.round(s.b / Math.max(1, m.total) * 100) + '%'));
      table.appendChild(tr);
    });
    body.appendChild(table);

    if (m.heaviest.length) {
      body.appendChild(SB.el('h3', 'usage-h', 'Heaviest single items'));
      const h = SB.el('div', 'usage-heavy');
      m.heaviest.forEach(function (x) {
        const row = SB.el('div', 'usage-heavy-row');
        row.appendChild(SB.el('span', null, x.label));
        row.appendChild(SB.el('span', 'num', fmt(x.b)));
        h.appendChild(row);
      });
      body.appendChild(h);
    }

    /* ---- firebase ---- */
    body.appendChild(SB.el('h3', 'usage-h', 'On Firebase’s free (Spark) plan'));
    const tight = fb.checks[0] && fb.checks[0].warn;
    const verdict = SB.el('div', 'usage-verdict' +
      (m.total > SB.Usage.FS_DOC_LIMIT ? ' bad' : (tight ? ' warn' : ' good')), fb.verdict);
    body.appendChild(verdict);

    const checks = SB.el('div', 'usage-checks');
    fb.checks.forEach(function (c) {
      const row = SB.el('div', 'usage-check' + (c.ok ? (c.warn ? ' warn' : '') : ' bad'));
      row.appendChild(SB.el('span', 'usage-mark', c.ok ? (c.warn ? '!' : '✓') : '✕'));
      const txt = SB.el('div');
      txt.appendChild(SB.el('div', 'usage-check-label', c.label));
      txt.appendChild(SB.el('div', 'usage-check-detail', c.detail));
      row.appendChild(txt);
      checks.appendChild(row);
    });
    body.appendChild(checks);

    body.appendChild(SB.el('div', 'pp-note',
      'Limits as published Aug 2026: a Firestore document is capped at 1 MiB (hard, not a quota); ' +
      'Spark gives 1 GiB stored, 20,000 writes and 50,000 reads a day; Cloud Storage — where image ' +
      'files would normally go — is not on Spark at all and needs the Blaze plan. ' +
      'Rates here are measured from this session, extrapolated over an 8-hour day for one editor.'));

    SB.modal({
      title: 'Data in this project',
      width: '760px',
      body: body,
      buttons: [
        {
          label: 'Copy report', onClick: function (close) {
            navigator.clipboard.writeText(report(m, fb, stats, rate))
              .then(function () { SB.toast('Report copied'); })
              .catch(function () { SB.toast('Could not copy', true); });
          }
        },
        { label: 'Close', primary: true }
      ]
    });
  }

  function report(m, fb, stats, rate) {
    const lines = [];
    lines.push('Storyboarder — data report for “' + P().name + '”');
    lines.push('Total board: ' + fmt(m.total));
    m.sections.forEach(function (s) {
      lines.push('  ' + s.label + ': ' + fmt(s.b) +
        ' (' + Math.round(s.b / Math.max(1, m.total) * 100) + '%)');
    });
    lines.push('Images: ' + fmt(m.imageBytes) + ' · text and structure: ' + fmt(m.textBytes));
    lines.push('Saved ' + stats.writes + '× this session, ' + fmt(stats.bytes) + ' written' +
      (rate ? ' (≈' + Math.round(rate.perHour) + '/hour, ≈' + Math.round(rate.perDay) + '/day)' : ''));
    lines.push('');
    lines.push('Firebase Spark:');
    fb.checks.forEach(function (c) {
      lines.push('  [' + (c.ok ? 'ok' : 'NO') + '] ' + c.label + ' — ' + c.detail);
    });
    lines.push('Verdict: ' + fb.verdict);
    return lines.join('\n');
  }

  /* Measuring re-serialises the whole board, so the badge is never recomputed
   * on the keystroke itself. */
  const debouncedBadge = SB.debounce(refreshBadge, 1200);

  SB.UsagePanel = { open: open, refreshBadge: refreshBadge, badgeSoon: debouncedBadge };

})(window.SB);
