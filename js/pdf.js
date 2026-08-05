/* pdf.js — print sheets via Chrome's Print → Save as PDF.
 *
 * A named preset fixes the paper orientation and the grid; the rest of the
 * sheet — which boxes appear on a card, whether card colour is carried over,
 * whether scenes get a banner or a page of their own — comes from
 * project.settings.export, edited in SB.ExportOptions.
 *
 * Still excludes comments, ink, and "no shot" fragments.
 */
(function (SB) {
  'use strict';

  /* Each preset is one shape of sheet.
   *   orient  — portrait or landscape; also what @page asks the print dialog for
   *   cols/rows — the grid; cols*rows cards per sheet
   *   dir     — 'col' stacks the frame above the words, 'row' puts it beside them
   *   frame   — the frame's fixed dimension: its height in a column cell, its
   *             width in a row cell. 'fill' lets it take whatever is left.
   *   script/desc — -webkit-line-clamp for those boxes; 0 means print it all,
   *             which is only safe where there is room for it.
   * The numbers are tuned against the measured overflow check in ui-scenario.js —
   * if you change a grid, run test-ui.mjs before believing it.
   */
  const PRESETS = [
    {
      id: 'sheet6', label: 'Contact sheet — 6 up (portrait)',
      orient: 'portrait', cols: 2, rows: 3, dir: 'col', frame: '40mm',
      script: 2, desc: 3, font: 11
    },
    {
      id: 'sheet12', label: 'Index sheet — 12 up (portrait)',
      orient: 'portrait', cols: 3, rows: 4, dir: 'col', frame: '34mm',
      script: 1, desc: 1, font: 10
    },
    {
      id: 'notes4', label: 'Script pass — 4 up (portrait)',
      orient: 'portrait', cols: 1, rows: 4, dir: 'row', frame: '96mm',
      script: 4, desc: 5, font: 11
    },
    {
      id: 'wide6', label: 'Wide — 6 up (landscape)',
      orient: 'landscape', cols: 3, rows: 2, dir: 'col', frame: '44mm',
      script: 2, desc: 3, font: 11
    },
    {
      id: 'wide3', label: 'Wide notes — 3 up (landscape)',
      orient: 'landscape', cols: 3, rows: 1, dir: 'col', frame: '48mm',
      script: 8, desc: 12, font: 11
    },
    {
      id: 'show1', label: 'Presentation — 1 up (landscape)',
      orient: 'landscape', cols: 1, rows: 1, dir: 'col', frame: 'fill',
      script: 0, desc: 0, font: 14
    }
  ];

  /* The sheet is sized to fit BOTH A4 and Letter with 12mm margins, so it
   * prints whole on either: portrait takes A4's printable width and Letter's
   * printable height, landscape the other way round. The portrait height used
   * to claim 262mm, more than Letter actually has, which pushed a blank second
   * sheet out for every page — do not round these up.
   */
  const PAPER = {
    portrait: { w: '186mm', h: '251mm' },   // A4 width ∩ Letter height
    landscape: { w: '255mm', h: '186mm' }   // Letter width ∩ A4 height
  };

  /* The fixed part of the palette, also what a colourless card falls back to. */
  const INK = {
    line: '#c3c6cc',
    meta: '#eef0f3',
    soft: '#dfe1e5'
  };

  function P() { return SB.app.project; }

  function preset(id) {
    return PRESETS.filter(function (x) { return x.id === id; })[0] || PRESETS[0];
  }

  /* Normalise into a full options object without touching the caller's copy,
   * so a half-filled object from a test or an old file still prints. */
  function options(o) {
    const base = SB.Model.defaultExport();
    const src = o || (P().settings && P().settings.export) || {};
    const out = {};
    Object.keys(base).forEach(function (k) {
      out[k] = (typeof src[k] === typeof base[k]) ? src[k] : base[k];
    });
    out.silent = !!src.silent;   // a render flag, never stored on the project
    return out;
  }

  /* ---------- colour ---------- */

  function rgb(s) {
    const m = /^#([0-9a-f]{6})$/i.exec(String(s || ''));
    if (!m) return null;
    return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16),
      parseInt(m[1].slice(4, 6), 16)];
  }

  /* CARD_COLORS are mid-tones picked to read on a screen; at full strength on a
   * small printed card they swamp it. Mixing here in JS rather than with CSS
   * color-mix keeps one less thing that could rasterise differently. */
  function mix(a, b, t) {
    const pa = rgb(a), pb = rgb(b);
    if (!pa || !pb) return b;
    return '#' + [0, 1, 2].map(function (i) {
      const v = Math.round(pa[i] + (pb[i] - pa[i]) * t);
      return ('0' + v.toString(16)).slice(-2);
    }).join('');
  }

  /* ---------- the flat list of what prints ---------- */

  function cells() {
    const out = [];
    const p = P();
    p.scenes.forEach(function (sc, si) {
      let first = true;
      sc.shots.forEach(function (sh, sj) {
        if (sh.noShot) return;
        const w = SB.Model.windowFor(p, sh);
        out.push({
          code: SB.Model.code(si, sj),
          scene: sc.heading || '',
          sceneDesc: sc.description || '',
          sceneIdx: si,
          /* the first card of the scene that actually prints — a scene whose
           * opening shots are all "no shot" still gets its banner */
          sceneFirst: first,
          type: sh.type || '',
          color: sh.color || SB.Model.CARD_COLORS[0],
          img: sh.image ? SB.Blobs.src(p, sh.image) : null,
          script: SB.Doc.renderHTML(w.doc, w.from, w.to, null),
          desc: sh.description || ''
        });
        first = false;
      });
    });
    return out;
  }

  /* ---------- pagination ---------- */

  /* Returns [{banner, items}]. A banner is a cell whose scene heading and
   * description head the sheet; it sits in the grid as a full-width item, so it
   * costs one row's worth of cards rather than squeezing the rows shorter and
   * spilling their text. */
  function paginate(list, pr, o) {
    const perPage = pr.cols * pr.rows;
    const pages = [];
    let page = null;

    function add(banner) { page = { banner: banner || null, items: [] }; pages.push(page); }
    function full() { return page.items.length >= perPage - (page.banner ? pr.cols : 0); }

    /* runs of cards that must not share a sheet with the next run */
    const runs = [];
    list.forEach(function (c) {
      if (o.scenePageBreak && (!runs.length || c.sceneFirst)) runs.push([]);
      else if (!runs.length) runs.push([]);
      runs[runs.length - 1].push(c);
    });

    runs.forEach(function (run) {
      page = null;
      run.forEach(function (c) {
        if (o.sceneBanner && c.sceneFirst) {
          /* a 1-up sheet has no room for both, so the banner becomes a title sheet */
          if (pr.cols >= perPage) { pages.push({ banner: c, items: [] }); add(null); }
          else add(c);
        } else if (!page || full()) {
          add(null);
        }
        page.items.push(c);
      });
    });
    return pages;
  }

  function layout(o) {
    o = options(o);
    const pr = preset(o.preset);
    const list = cells();
    return {
      preset: pr, opts: o, perPage: pr.cols * pr.rows,
      paper: PAPER[pr.orient], shots: list.length,
      sheets: paginate(list, pr, o).length
    };
  }

  /* ---------- the sheet ---------- */

  function cellHTML(c, pr, o) {
    const accent = o.color === 'accent';
    const cls = 'cell' + (pr.dir === 'row' ? ' row' : '') + (pr.frame === 'fill' ? ' fill' : '');
    const style = accent ? ' style="border-color:' + mix(c.color, INK.line, .55) + '"' : '';

    /* The meta bar only gets a wash of the colour — the shot type on it is
     * printed in grey, and at anything like full strength it disappeared. The
     * stripe carries the colour itself, so cards stay tellable apart even on a
     * greyscale printer. */
    const metaStyle = accent ? ' style="background:' + mix(c.color, INK.meta, .86) + '"' : '';
    const stripe = accent ? '<div class="stripe" style="background:' + c.color + '"></div>' : '';

    let meta = '<div class="meta"' + metaStyle + '><span class="code">' + SB.esc(c.code) + '</span>';
    if (o.showSceneHeading) meta += '<span class="scene">' + SB.esc(c.scene) + '</span>';
    else meta += '<span class="scene"></span>';
    if (o.showType && c.type) meta += '<span class="type">' + SB.esc(c.type) + '</span>';
    meta += '</div>';

    /* Whichever text box comes last takes the leftover height. It used to be
     * hardcoded to .desc, which left a gap under the script once description
     * was switched off. */
    const boxes = [];
    if (o.showScript) {
      boxes.push({ cls: 'script', inner: c.script || '<i class="dim">(no script)</i>' });
    }
    if (o.showDesc) boxes.push({ cls: 'desc', inner: SB.esc(c.desc) });
    const text = boxes.map(function (b, i) {
      return '<div class="' + b.cls + (i === boxes.length - 1 ? ' grow' : '') + '">' +
        '<div class="clip">' + b.inner + '</div></div>';
    }).join('');

    return '<figure class="' + cls + '"' + style + '>' + stripe +
      '<div class="frame">' +
      (c.img ? '<img src="' + c.img + '">' : '<div class="empty">no frame</div>') +
      '</div>' +
      '<div class="side">' + meta + text + '</div>' +
      '</figure>';
  }

  function bannerHTML(c, o) {
    const accent = o.color === 'accent';
    const style = accent ? ' style="border-left-color:' + c.color + '"' : '';
    return '<div class="banner"' + style + '>' +
      '<div class="bh">' + SB.esc(c.scene || 'Scene') + '</div>' +
      (c.sceneDesc ? '<div class="bd">' + SB.esc(c.sceneDesc) + '</div>' : '') +
      '</div>';
  }

  function sheetCSS(pr, o) {
    const paper = PAPER[pr.orient];
    const css = [
      '@page{size:' + pr.orient + ';margin:12mm}',
      '*{box-sizing:border-box}',
      ':root{--page-w:' + paper.w + ';--page-h:' + paper.h + ';--gap:5mm}',
      'html,body{margin:0;padding:0}',
      'body{font:' + pr.font + 'px/1.4 "Segoe UI",system-ui,sans-serif;color:#111;background:#e9eaee;' +
      '-webkit-print-color-adjust:exact;print-color-adjust:exact}',

      /* one sheet */
      '.page{width:var(--page-w);height:var(--page-h);margin:8mm auto;padding:0;background:#fff;' +
      'display:flex;flex-direction:column;box-shadow:0 1px 8px rgba(0,0,0,.22);break-after:page}',
      '.page:last-child{break-after:auto}',

      /* cells that can never grow past their share of the sheet */
      '.grid{flex:1;min-height:0;display:grid;' +
      'grid-template-columns:repeat(' + pr.cols + ',minmax(0,1fr));' +
      'grid-template-rows:repeat(' + pr.rows + ',minmax(0,1fr));gap:var(--gap)}',
      /* margin:0 matters — a <figure> carries 40px of it by default, which
       * quietly narrowed every cell by 80px */
      '.cell{margin:0;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;' +
      'border:1px solid ' + INK.line + ';border-radius:3px;background:#fff}',
      '.cell.row{flex-direction:row}',
      '.side{flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden}',
      /* in a row cell the stripe becomes the left edge for free */
      '.stripe{flex:0 0 2.5mm}',

      /* A fixed frame dimension, not an aspect-ratio: in a flex box the ratio
       * ends up sized by whatever space the text leaves, so the pictures moved
       * around as descriptions changed length. Any shape letterboxes inside. */
      '.frame{background:#f2f3f5;border-bottom:1px solid ' + INK.soft + ';' +
      'display:flex;align-items:center;justify-content:center;overflow:hidden}',
      pr.frame === 'fill'
        ? '.cell .frame{flex:1 1 auto;min-height:0}'
        : '.cell .frame{flex:0 0 ' + pr.frame + ';height:' + pr.frame + '}',
      '.cell.row .frame{height:auto;border-bottom:none;border-right:1px solid ' + INK.soft + '}',
      pr.dir === 'row' && pr.frame !== 'fill'
        ? '.cell.row .frame{flex:0 0 ' + pr.frame + ';width:' + pr.frame + '}' : '',
      '.frame img{max-width:100%;max-height:100%;width:auto;height:auto;display:block;' +
      'object-fit:contain}',
      '.empty{color:#9aa0aa;font-size:9px;letter-spacing:.4px;text-transform:uppercase}',

      '.meta{flex:0 0 auto;display:flex;gap:6px;align-items:baseline;padding:3px 5px;' +
      'background:' + INK.meta + ';border-bottom:1px solid ' + INK.soft + '}',
      '.code{font-weight:700}',
      '.scene{flex:1;min-width:0;font-size:.9em;color:#333;overflow:hidden;text-overflow:ellipsis;' +
      'white-space:nowrap}',
      '.type{font-size:.82em;text-transform:uppercase;letter-spacing:.4px;color:#666;white-space:nowrap}',

      /* The clamp lives on an inner box: a flex item is blockified, which
       * throws -webkit-box away and leaves text cut through the middle of a
       * line instead of ending in an ellipsis. */
      '.script{flex:0 1 auto;min-height:0;padding:4px 5px;overflow:hidden;' +
      'border-bottom:1px dashed #e3e5e9}',
      '.desc{flex:0 1 auto;min-height:0;padding:4px 5px 5px;color:#333;overflow:hidden}',
      '.grow{flex:1 1 auto}',
      '.script.grow{border-bottom:none}',
      '.clip{display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap}',
      /* clamp 0 means print the lot, and -webkit-box with no clamp would cut
       * the last line in half instead of just ending */
      pr.script ? '.script .clip{-webkit-line-clamp:' + pr.script + '}' : '.script .clip{display:block}',
      pr.desc ? '.desc .clip{-webkit-line-clamp:' + pr.desc + '}' : '.desc .clip{display:block}',
      '.dim{color:#9aa0aa}',

      /* a scene band, sitting in the grid so the rows keep their height */
      '.banner{grid-column:1/-1;min-width:0;overflow:hidden;display:flex;flex-direction:column;' +
      'justify-content:center;gap:3px;padding:4mm 5mm;background:' + INK.meta + ';' +
      'border:1px solid ' + INK.line + ';border-left:3mm solid ' + INK.line + ';border-radius:3px}',
      '.bh{font-size:1.5em;font-weight:700;line-height:1.2}',
      '.bd{color:#333;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;' +
      '-webkit-line-clamp:6;white-space:pre-wrap}',

      'footer{flex:0 0 auto;padding-top:3mm;font-size:9px;color:#666;text-align:center}',

      '@media print{body{background:#fff}' +
      '.page{width:auto;height:var(--page-h);margin:0;box-shadow:none}}'
    ];
    return css.filter(Boolean).join('');
  }

  /* Printing before the frames have decoded is what produced a sheet of
   * collapsed images, so wait for them. */
  const READY = 'window.addEventListener("load",function(){' +
    'var imgs=[].slice.call(document.images);' +
    'Promise.all(imgs.map(function(i){' +
    'return i.decode?i.decode().catch(function(){}):Promise.resolve();}))' +
    '.then(function(){setTimeout(function(){window.print()},120)});});';

  /* opts.silent skips the auto-print script — the options dialog previews the
   * sheet in an iframe and must not open a print dialog while it does. */
  function html(o) {
    const p = P();
    o = options(o);
    const pr = preset(o.preset);
    const list = cells();
    const sheets = paginate(list, pr, o);

    let pages = sheets.map(function (pg, i) {
      const inner = (pg.banner ? bannerHTML(pg.banner, o) : '') +
        pg.items.map(function (c) { return cellHTML(c, pr, o); }).join('');
      /* A band costs a row's worth of cards either way, but letting its row
       * size to its content hands that height back to the cards below instead
       * of leaving a third of the sheet empty. A band with no cards under it is
       * a title sheet, so there it fills. */
      const rows = (pg.banner && pg.items.length && pr.rows > 1)
        ? ' style="grid-template-rows:auto repeat(' + (pr.rows - 1) + ',minmax(0,1fr))"'
        : '';
      const foot = o.footer
        ? '<footer>' + SB.esc(p.name) + ' · ' + SB.esc(p.versionName) + ' · page ' +
        (i + 1) + ' of ' + sheets.length + '</footer>'
        : '';
      return '<section class="page"><div class="grid"' + rows + '>' + inner + '</div>' +
        foot + '</section>';
    }).join('');
    if (!pages) pages = '<section class="page"><p>Nothing to print — every shot is marked “no shot”.</p></section>';

    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + SB.esc(p.name) +
      ' — storyboard</title><style>' + sheetCSS(pr, o) + '</style></head><body>' + pages +
      (o.silent ? '' : '<script>' + READY + '<\/script>') + '</body></html>';
  }

  function exportPdf(o) {
    const w = window.open('', '_blank');
    if (!w) { SB.toast('Allow pop-ups for this page to export the PDF', true); return; }
    w.document.open();
    w.document.write(html(o));
    w.document.close();
  }

  SB.Pdf = {
    exportPdf: exportPdf, html: html, cells: cells,
    PRESETS: PRESETS, PAPER: PAPER, preset: preset, layout: layout, options: options
  };

})(window.SB);
