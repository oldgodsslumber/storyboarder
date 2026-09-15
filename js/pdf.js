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

  /* The reference sheets. Same grid idea as a contact sheet, but a reference
   * is mostly picture: the whole point of the page is what somebody has to
   * match, so the frame takes the room and the words sit under it.
   *
   *   frame — the picture's height in the cell; 'fill' hands it what is left
   *   desc  — line clamp on the description; 0 prints all of it
   */
  const REF_PRESETS = [
    {
      id: 'refs4', label: 'References — 4 up (portrait)',
      orient: 'portrait', cols: 2, rows: 2, frame: '78mm', desc: 6, font: 11
    },
    {
      id: 'refs6', label: 'References — 6 up (portrait)',
      orient: 'portrait', cols: 2, rows: 3, frame: '52mm', desc: 4, font: 10
    },
    {
      id: 'refs9', label: 'Reference index — 9 up (portrait)',
      orient: 'portrait', cols: 3, rows: 3, frame: '40mm', desc: 2, font: 9
    },
    {
      id: 'refs1', label: 'One reference a sheet (portrait)',
      orient: 'portrait', cols: 1, rows: 1, frame: 'fill', desc: 0, font: 13
    },
    {
      id: 'refs3w', label: 'References — 3 up (landscape)',
      orient: 'landscape', cols: 3, rows: 1, frame: '74mm', desc: 6, font: 11
    }
  ];

  function refPreset(id) {
    return REF_PRESETS.filter(function (x) { return x.id === id; })[0] || REF_PRESETS[0];
  }

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
          sceneDesc: SB.Refs.plain(p, sc.description),
          sceneIdx: si,
          /* the first card of the scene that actually prints — a scene whose
           * opening shots are all "no shot" still gets its banner */
          sceneFirst: first,
          type: sh.type || '',
          color: sh.color || SB.Model.CARD_COLORS[0],
          img: sh.image ? SB.Blobs.src(p, sh.image) : null,
          script: SB.Doc.renderHTML(w.doc, w.from, w.to, null),
          /* every box: a card written only in a lane box printed as
             "(no description yet)" on the deliverable */
          desc: SB.Refs.text(p, sh)
        });
        first = false;
      });
    });
    return out;
  }

  /* ---------- the references ----------
   *
   * Every recurring subject the board carries, in library order: cast, then
   * locations, then objects. The picture is the ORIGINAL where the board has
   * one -- a reference exists to be matched, and the 854x480 proxy that is
   * plenty for a card on screen is not plenty for somebody holding the page.
   */
  function refCells(o) {
    const p = P();
    o = options(o);
    const used = {};
    /* which cards each subject turns up on, by code, mentioned or merely cast */
    p.scenes.forEach(function (sc, si) {
      sc.shots.forEach(function (sh, sj) {
        if (sh.noShot) return;
        const code = SB.Model.code(si, sj);
        SB.Refs.feed(p, sh).forEach(function (e) {
          if (e.kind !== 'subject') return;
          (used[e.id] = used[e.id] || []).push(code);
        });
      });
    });

    const out = [];
    SB.Personas.KINDS.forEach(function (kind) {
      const mine = SB.Personas.all(p).filter(function (per) {
        return SB.Personas.kindOf(per).id === kind.id;
      });
      mine.forEach(function (per, i) {
        const shots = used[per.id] || [];
        if (!shots.length && !o.refUnused) return;
        const hero = SB.Personas.hero(per);
        const full = hero && hero.render ? SB.Renders.dataUrl(p, hero.render) : '';
        out.push({
          id: per.id,
          name: per.name || 'unnamed',
          kind: kind.label,
          kindId: kind.id,
          group: kind.plural,
          groupFirst: i === 0,
          role: (hero && hero.label) || '',
          desc: (per.description || '').replace(/\s+/g, ' ').trim(),
          img: full || (hero ? SB.Blobs.src(p, hero) : ''),
          /* said on the page, because a page of references that quietly shows
             the board copy is the export bug this app has had twice */
          proxy: !full && !!hero,
          none: !hero,
          shots: shots,
          serial: (hero && hero.render && hero.render.serial) || 0
        });
      });
    });
    return out;
  }

  /* The mapping each card hands over, in feed order -- the order somebody
   * dropping the files into a model by hand has to use. Only cards that feed
   * anything appear. */
  function feedRows() {
    const p = P();
    const out = [];
    p.scenes.forEach(function (sc, si) {
      sc.shots.forEach(function (sh, sj) {
        if (sh.noShot) return;
        /* One row while both calls are handed the same pictures; a row each
           when they are not, because the number printed here is the number
           one prompt names and the other does not. */
        const agree = SB.Refs.lanesAgree(p, sh);
        (agree ? [{ role: undefined, lane: '' }]
          : [{ role: 'image', lane: 'first frame' }, { role: 'video', lane: 'video' }]
        ).forEach(function (set) {
          const list = SB.Refs.images(p, sh, set.role);
          if (!list.length) return;
          out.push({
            code: SB.Model.code(si, sj), lane: set.lane,
            items: list.map(function (e) {
              return { n: e.n, label: e.label, role: e.role || '', kind: e.kind };
            })
          });
        });
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

  /* One page per grid-full, broken at each kind so cast, locations and objects
   * never share a sheet -- the page is a thing somebody flips through looking
   * for one subject, and a heading halfway down a mixed sheet is not findable. */
  function paginateRefs(list, pr) {
    const perPage = pr.cols * pr.rows;
    const pages = [];
    let page = null;
    list.forEach(function (c) {
      if (!page || page.group !== c.group || page.items.length >= perPage) {
        page = { group: c.group, items: [], first: !pages.some(function (x) {
          return x.group === c.group;
        }) };
        pages.push(page);
      }
      page.items.push(c);
    });
    return pages;
  }

  function refCellHTML(c, pr, o) {
    const pic = c.img
      ? '<img src="' + c.img + '">'
      : '<div class="empty">no reference frame</div>';
    const tags = [];
    if (c.role) tags.push('<span class="role">' + SB.esc(c.role) + '</span>');
    if (c.serial) tags.push('<span class="ser">' + SB.Renders.pad(c.serial) + '</span>');
    if (c.proxy) tags.push('<span class="warn">board copy only</span>');
    if (c.none) tags.push('<span class="warn">described in words only</span>');
    const where = !o.refShots ? ''
      : c.shots.length
        ? '<div class="on">' + SB.esc(c.shots.join(', ')) + '</div>'
        : '<div class="on none">on no card</div>';
    return '<figure class="rcell">' +
      '<div class="frame">' + pic + '</div>' +
      '<div class="side">' +
      '<div class="meta"><span class="nm">' + SB.esc(c.name) + '</span>' +
      tags.join('') + '</div>' +
      '<div class="desc grow"><div class="clip">' +
      (c.desc ? SB.esc(c.desc) : '<i class="dim">(no description yet)</i>') +
      '</div></div>' + where +
      '</div></figure>';
  }

  function feedHTML(rows) {
    if (!rows.length) return '';
    const body = rows.map(function (r) {
      return '<tr><td class="c">' + SB.esc(r.code) +
        (r.lane ? '<i class="lane">' + SB.esc(r.lane) + '</i>' : '') + '</td><td>' +
        r.items.map(function (i) {
          return '<span class="fi"><b>' + i.n + '</b> ' + SB.esc(i.label) +
            (i.role ? ' <i>(' + SB.esc(i.role) + ')</i>' : '') + '</span>';
        }).join('') + '</td></tr>';
    }).join('');
    return '<section class="page"><div class="feedwrap">' +
      '<h2>What each card hands over</h2>' +
      '<p class="lead">In this order. The number is the position the prompt names, ' +
      'so a model fed them out of order is being told about different pictures.</p>' +
      '<table class="feed"><thead><tr><th>Shot</th><th>References, in order</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table></div></section>';
  }

  function refCSS(pr) {
    const paper = PAPER[pr.orient];
    return [
      '@page{size:' + pr.orient + ';margin:12mm}',
      '*{box-sizing:border-box}',
      ':root{--page-w:' + paper.w + ';--page-h:' + paper.h + ';--gap:5mm}',
      'html,body{margin:0;padding:0}',
      'body{font:' + pr.font + 'px/1.45 "Segoe UI",system-ui,sans-serif;color:#111;' +
      'background:#e9eaee;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
      '.page{width:var(--page-w);height:var(--page-h);margin:8mm auto;background:#fff;' +
      'display:flex;flex-direction:column;box-shadow:0 1px 8px rgba(0,0,0,.22);break-after:page}',
      '.page:last-child{break-after:auto}',
      '.rhead{flex:0 0 auto;display:flex;align-items:baseline;gap:8px;padding:0 0 3mm;' +
      'border-bottom:2px solid #111;margin-bottom:4mm}',
      '.rhead h1{margin:0;font-size:1.7em;letter-spacing:.3px}',
      '.rhead .sub{color:#555}',
      '.grid{flex:1;min-height:0;display:grid;' +
      'grid-template-columns:repeat(' + pr.cols + ',minmax(0,1fr));' +
      'grid-template-rows:repeat(' + pr.rows + ',minmax(0,1fr));gap:var(--gap)}',
      '.rcell{margin:0;min-width:0;min-height:0;display:flex;flex-direction:column;' +
      'overflow:hidden;border:1px solid ' + INK.line + ';border-radius:3px;background:#fff}',
      '.frame{background:#f2f3f5;border-bottom:1px solid ' + INK.soft + ';display:flex;' +
      'align-items:center;justify-content:center;overflow:hidden}',
      pr.frame === 'fill'
        ? '.rcell .frame{flex:1 1 auto;min-height:0}'
        : '.rcell .frame{flex:0 0 ' + pr.frame + ';height:' + pr.frame + '}',
      '.frame img{max-width:100%;max-height:100%;width:auto;height:auto;display:block;' +
      'object-fit:contain}',
      '.empty{color:#9aa0aa;font-size:9px;letter-spacing:.4px;text-transform:uppercase}',
      '.side{flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column;' +
      'overflow:hidden}',
      '.meta{flex:0 0 auto;display:flex;gap:6px;align-items:baseline;flex-wrap:wrap;' +
      'padding:3px 5px;background:' + INK.meta + ';border-bottom:1px solid ' + INK.soft + '}',
      '.nm{font-weight:700;font-size:1.1em}',
      '.role,.ser{font-size:.82em;color:#666;text-transform:uppercase;letter-spacing:.4px}',
      '.ser{font-variant-numeric:tabular-nums}',
      '.warn{font-size:.8em;color:#a4442c;text-transform:uppercase;letter-spacing:.4px}',
      '.desc{flex:0 1 auto;min-height:0;padding:4px 5px;color:#333;overflow:hidden}',
      '.grow{flex:1 1 auto}',
      '.clip{display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap}',
      pr.desc ? '.desc .clip{-webkit-line-clamp:' + pr.desc + '}' : '.desc .clip{display:block}',
      '.on{flex:0 0 auto;padding:3px 5px 4px;border-top:1px dashed #e3e5e9;color:#555;' +
      'font-size:.85em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.on.none{color:#9aa0aa;font-style:italic}',
      '.dim{color:#9aa0aa}',
      /* the mapping page */
      '.feedwrap{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column}',
      '.feedwrap h2{margin:0 0 1mm;font-size:1.4em}',
      '.lead{margin:0 0 4mm;color:#555}',
      'table.feed{width:100%;border-collapse:collapse}',
      'table.feed th{text-align:left;font-size:.8em;text-transform:uppercase;letter-spacing:.5px;' +
      'color:#666;border-bottom:1px solid ' + INK.line + ';padding:2mm 1mm}',
      'table.feed td{vertical-align:top;padding:1.6mm 1mm;border-bottom:1px solid #eef0f3}',
      'table.feed td.c{font-weight:700;width:18mm;white-space:nowrap}',
      '.fi{display:inline-block;margin:0 4mm 1mm 0}',
      '.fi b{display:inline-block;min-width:4mm;color:#666}',
      'footer{flex:0 0 auto;padding-top:3mm;font-size:9px;color:#666;text-align:center}',
      '@media print{body{background:#fff}.page{width:auto;height:var(--page-h);margin:0;' +
      'box-shadow:none}}'
    ].filter(Boolean).join('');
  }

  /* The reference document: a cover-less gallery of what everything on this
   * board is supposed to look like, and optionally the per-card mapping. */
  function refPages(o) {
    const p = P();
    o = options(o);
    const pr = refPreset(o.refPreset);
    const list = refCells(o);
    const pages = paginateRefs(list, pr);
    let out = pages.map(function (pg, i) {
      const head = '<div class="rhead"><h1>' + SB.esc(pg.group) + '</h1>' +
        '<span class="sub">' + SB.esc(p.name || 'Untitled') +
        ' \u00b7 ' + SB.esc(p.versionName || '') + '</span></div>';
      const foot = o.footer
        ? '<footer>references \u00b7 ' + SB.esc(pg.group) + ' \u00b7 page ' + (i + 1) +
          ' of ' + pages.length + '</footer>'
        : '';
      return '<section class="page">' + head + '<div class="grid">' +
        pg.items.map(function (c) { return refCellHTML(c, pr, o); }).join('') +
        '</div>' + foot + '</section>';
    }).join('');
    if (!out) {
      out = '<section class="page"><p>This board has no references yet. ' +
        'Add them in the References panel.</p></section>';
    }
    if (o.refFeeds) out += feedHTML(feedRows());
    return { html: out, css: refCSS(pr), preset: pr, count: list.length, sheets: pages.length };
  }

  function layout(o) {
    o = options(o);
    const pr = preset(o.preset);
    const list = cells();
    const board = o.doc === 'refs' ? 0 : paginate(list, pr, o).length;
    const refs = o.doc === 'board' ? null : refPages(o);
    const shown = o.doc === 'refs' ? refs.preset : pr;
    return {
      preset: shown, boardPreset: pr, opts: o, perPage: shown.cols * shown.rows,
      paper: PAPER[shown.orient],
      shots: list.length,
      refs: refs ? refs.count : 0,
      sheets: board + (refs ? refs.sheets + (o.refFeeds ? 1 : 0) : 0),
      boardSheets: board,
      refSheets: refs ? refs.sheets + (o.refFeeds ? 1 : 0) : 0
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

    /* Two documents out of one button.
     *
     * The board is the storyboard; the references are what the subjects on it
     * are supposed to LOOK like, which is a different page and a different
     * job -- it is the thing you hand somebody who has to match them, and
     * until now the only way to see a board's references together was to open
     * them one at a time in the References panel.
     *
     * Both prints the references after the board, in one file, because that is
     * one thing to send rather than two. The two halves have their own paper
     * and their own grid, so each rule is scoped to its own pages rather than
     * one stylesheet trying to be both. */
    if (o.doc === 'refs' || o.doc === 'both') {
      const refs = refPages(o);
      const boardPart = o.doc === 'both' ? boardPages(o) : null;
      const css = (boardPart ? scope('.bd', boardPart.css) : '') + scope('.rf', refs.css);
      const body =
        (boardPart ? '<div class="bd">' + boardPart.html + '</div>' : '') +
        '<div class="rf">' + refs.html + '</div>';
      return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + SB.esc(p.name) +
        ' \u2014 ' + (o.doc === 'both' ? 'storyboard and references' : 'references') +
        '</title><style>' + css + '</style></head><body>' + body +
        (o.silent ? '' : '<script>' + READY + '<\/script>') + '</body></html>';
    }
    const built = boardPages(o);
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + SB.esc(p.name) +
      ' \u2014 storyboard</title><style>' + built.css + '</style></head><body>' + built.html +
      (o.silent ? '' : '<script>' + READY + '<\/script>') + '</body></html>';
  }

  /* Both halves carry rules for .page, .grid, .frame and .meta, and the shapes
   * behind those names are not the same. Rather than rename one set -- which
   * would make every selector in the board sheet read as though the reference
   * sheet were the reason for it -- each set is prefixed with the wrapper its
   * own pages sit in. @page and @media are left alone: they are not selectors
   * and there is only one paper per half anyway. */
  function scope(sel, css) {
    return String(css).replace(/(^|\})([^{}@]+)\{/g, function (all, close, heads) {
      const out = heads.split(',').map(function (h) {
        const t = h.trim();
        if (!t) return t;
        if (/^(html|body|:root)$/.test(t)) return t;          // document-wide, leave them
        if (/^\d/.test(t)) return t;                          // a keyframe stop
        return sel + ' ' + t;
      }).join(',');
      return close + out + '{';
    });
  }

  function boardPages(o) {
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
    return { html: pages, css: sheetCSS(pr, o) };
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
    PRESETS: PRESETS, REF_PRESETS: REF_PRESETS, PAPER: PAPER,
    preset: preset, refPreset: refPreset,
    refCells: refCells, feedRows: feedRows, refPages: refPages,
    layout: layout, options: options
  };

})(window.SB);
