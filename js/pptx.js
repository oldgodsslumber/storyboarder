/* pptx.js — the board as a PowerPoint deck, three or six frames a slide.
 *
 * Every other document the board makes is either print (pdf.js, through
 * Chrome's Save as PDF) or loose files (exportpanel.js). A deck is the thing a
 * director projects in a review and the client edits afterwards — drags a
 * frame, retypes a caption, drops a slide in — so it is a real .pptx, not a
 * picture of one.
 *
 * A .pptx is a zip of XML parts plus the pictures. Most of those parts are the
 * same for every deck and are written here as fixed strings; what varies is
 * the slide list, each slide's shapes, and the media. zip.js already writes a
 * store-only zip, which PowerPoint, Keynote and Google Slides all open, so no
 * library comes with this.
 *
 * The pipeline is three pure steps and one that needs a browser:
 *
 *   plan(o)            -> slides: the cards chunked into slides, as shapes in EMU
 *   resolve(slides)    -> media: each picture decoded, re-encoded where needed  (browser)
 *   parts(slides, media, o) -> [{name, data}] — the whole package
 *   SB.Zip.store(parts)     -> Blob
 *
 * The preview draws the same shapes in HTML, so the arrangement on screen is
 * the arrangement in the file.
 */
(function (SB) {
  'use strict';

  /* ---------------------------------------------------------------- geometry
   *
   * 914400 EMU to the inch. 16:9 at 13.333 × 7.5 in — PowerPoint's own default,
   * so the deck opens full-bleed with nothing to reformat. */
  const EMU = 914400;
  const SLIDE = { w: 12192000, h: 6858000 };
  const IN = function (n) { return Math.round(n * EMU); };

  /* The two shapes of slide.
   *   cols/rows — panels per slide
   *   caption   — the text box under each frame, in inches; 0 = whatever the
   *               row has left
   *   meta/body — font sizes, points
   */
  const PRESETS = [
    { id: 'six', label: 'Six panels — 3 across × 2 down', cols: 3, rows: 2, caption: 0, meta: 11, body: 9 },
    { id: 'three', label: 'Three panels — 3 across, one row', cols: 3, rows: 1, caption: 2.4, meta: 13, body: 11 }
  ];

  function preset(id) {
    return PRESETS.filter(function (x) { return x.id === id; })[0] || PRESETS[0];
  }

  const MARGIN = IN(0.35);
  const GAP = IN(0.25);
  const FOOT = IN(0.32);
  const CAP_GAP = IN(0.08);

  function P() { return SB.app.project; }

  function options(o) {
    const base = SB.Model.defaultExport();
    const src = o || (P().settings && P().settings.export) || {};
    const out = {};
    Object.keys(base).forEach(function (k) {
      out[k] = (typeof src[k] === typeof base[k]) ? src[k] : base[k];
    });
    return out;
  }

  /* The panel boxes of one slide, in EMU. Both presets share a column width so
   * a frame is the same size in either — the three-up just spends its spare
   * height on words, and sits centred rather than hanging off the top. */
  function grid(pr, o) {
    const top = MARGIN;
    const bottom = SLIDE.h - MARGIN - (o.slideFooter ? FOOT : 0);
    const availW = SLIDE.w - 2 * MARGIN;
    const availH = bottom - top;
    const cellW = Math.floor((availW - GAP * (pr.cols - 1)) / pr.cols);
    const frameH = Math.round(cellW * 9 / 16);
    let capH, y0;
    if (pr.caption) {
      capH = IN(pr.caption);
      const block = pr.rows * (frameH + CAP_GAP + capH) + (pr.rows - 1) * GAP;
      y0 = top + Math.max(0, Math.round((availH - block) / 2));
    } else {
      const cellH = Math.floor((availH - GAP * (pr.rows - 1)) / pr.rows);
      capH = cellH - frameH - CAP_GAP;
      y0 = top;
    }
    const boxes = [];
    for (let r = 0; r < pr.rows; r++) {
      for (let c = 0; c < pr.cols; c++) {
        const x = MARGIN + c * (cellW + GAP);
        const y = y0 + r * (frameH + CAP_GAP + capH + GAP);
        boxes.push({
          frame: { x: x, y: y, w: cellW, h: frameH },
          cap: { x: x, y: y + frameH + CAP_GAP, w: cellW, h: capH }
        });
      }
    }
    return { boxes: boxes, perSlide: pr.cols * pr.rows, cellW: cellW, frameH: frameH, capH: capH };
  }

  /* ---------------------------------------------------------------- text */

  /* XML 1.0 cannot carry most C0 controls at all — one stray \x0b pasted into
   * a description and PowerPoint refuses the whole file as corrupt. They go,
   * along with lone surrogates. Tabs and line ends are kept; lines are split
   * into paragraphs before this runs anyway. */
  function clean(s) {
    return String(s == null ? '' : s)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
      /* a lookbehind, so two lone low halves in a row both go */
      .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '');
  }

  function xml(s) {
    return clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* PowerPoint does not shrink text on open — normAutofit is a request it only
   * acts on once somebody edits the box — so words that do not fit are cut
   * here, at a line, with an ellipsis, the way the sheets clamp.
   *
   * Widths are measured in ems, per character, not counted: Segoe UI has no
   * CJK, so PowerPoint draws those in a fallback face a full em wide, and a
   * count that treated them as half that let a Japanese caption run twice its
   * box, into the next row. Capitals are wider than the average too. A line
   * is 1.36 em — Segoe UI's own metrics come to 1.33. Pessimistic on
   * purpose: a caption a line short is fine; one over the next frame is not. */
  const LINE = 1.36;

  function charEm(c) {
    const n = c.codePointAt(0);
    if (n > 0xffff) return 1.05;                           // emoji and the astral planes
    if ((n >= 0x1100 && n <= 0x115f) || (n >= 0x2e80 && n <= 0xa4cf) ||
      (n >= 0xac00 && n <= 0xd7a3) || (n >= 0xf900 && n <= 0xfaff) ||
      (n >= 0xfe30 && n <= 0xfe4f) || (n >= 0xff00 && n <= 0xff60) ||
      (n >= 0xffe0 && n <= 0xffe6)) return 1.02;          // full width
    if (/[A-Z0-9@#%&MW]/.test(c)) return 0.64;
    if (c === ' ') return 0.3;
    return 0.54;
  }

  function ems(t) {
    let w = 0;
    for (const c of String(t)) w += charEm(c);
    return w;
  }

  function lineCount(pa, wPt) {
    const perLine = wPt / pa.size;                         // ems a line holds
    const w = pa.runs.reduce(function (n, r) { return n + ems(r.t) * (r.b ? 1.06 : 1); }, 0);
    /* word wrap wastes the end of every line; a fifth of a line is plenty */
    return Math.max(1, Math.ceil(w / (perLine * 0.85)));
  }

  function fit(paras, boxW, boxH) {
    const wPt = boxW / 12700 - 10;        // the box's insets
    const hPt = boxH / 12700 - 7;
    let used = 0;
    const out = [];
    for (let i = 0; i < paras.length; i++) {
      const pa = paras[i];
      const lineH = pa.size * LINE;
      const left = Math.floor((hPt - used) / lineH + 1e-9);
      if (left <= 0) { markCut(out); break; }
      const need = lineCount(pa, wPt);
      if (need <= left) {
        out.push(pa);
        used += need * lineH;
        continue;
      }
      /* Cut the last paragraph that fits at all, on a word, and stop. A run
         list is cut from its end, so the bold code at the front survives. */
      const cut = cutTo(pa, left * (wPt / pa.size) * 0.85 - 1.2);
      if (cut) out.push(cut);
      else markCut(out);
      break;
    }
    return out;
  }

  /* Something after the last kept paragraph was dropped: say so on it. */
  function markCut(out) {
    const last = out[out.length - 1];
    if (!last || !last.runs.length) return;
    const runs = last.runs.slice();
    const r = runs[runs.length - 1];
    if (/…$/.test(r.t)) return;
    runs[runs.length - 1] = Object.assign({}, r, { t: r.t.replace(/[\s,.;:–—-]+$/, '') + '…' });
    out[out.length - 1] = Object.assign({}, last, { runs: runs });
  }

  /* The paragraph cut to `room` ems with an ellipsis, or null when what would
     be left is not even a word — the caller then ends the one before it. */
  function cutTo(pa, room) {
    const runs = [];
    let left = room;
    for (let i = 0; i < pa.runs.length; i++) {
      const r = pa.runs[i];
      const k = r.b ? 1.06 : 1;
      const w = ems(r.t) * k;
      if (w <= left && i < pa.runs.length - 1) { runs.push(r); left -= w; continue; }
      if (w <= left) { runs.push(r); break; }              // cannot happen for a paragraph that overflowed, kept for safety
      let t = '', acc = 0;
      for (const c of r.t) {
        const cw = charEm(c) * k;
        if (acc + cw > left) break;
        t += c; acc += cw;
      }
      const sp = t.lastIndexOf(' ');
      if (sp > t.length * 0.6) t = t.slice(0, sp);
      t = t.replace(/[\s,.;:–—-]+$/, '');
      if (t) runs.push(Object.assign({}, r, { t: t }));
      break;
    }
    if (!runs.length) return null;
    const text = runs.map(function (r) { return r.t; }).join('');
    if (!/[\p{L}\p{N}]/u.test(text)) return null;
    const last = runs[runs.length - 1];
    runs[runs.length - 1] = Object.assign({}, last,
      { t: last.t.replace(/[\s,.;:–—-]+$/, '') + '…' });
    return Object.assign({}, pa, { runs: runs });
  }

  /* A paragraph reads right to left when its first strong letter is Hebrew or
     Arabic script. */
  function isRtl(pa) {
    const t = pa.runs.map(function (r) { return r.t; }).join('');
    const m = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ֐-ࣿיִ-﷿ﹰ-﻿]/.exec(t);
    return !!m && /[֐-ࣿיִ-﷿ﹰ-﻿]/.test(m[0]);
  }

  function lines(text) {
    return clean(text).replace(/\r\n?/g, '\n').split('\n')
      .map(function (s) { return s.replace(/\s+$/, ''); });
  }

  /* ---------------------------------------------------------------- the cards */

  /* The same list the contact sheet prints, plus what a deck needs that a
   * sheet does not: the script as text rather than HTML, the original where
   * one was asked for, and the card's colour. Walked beside SB.Pdf.cells() in
   * the same order and with the same skip, so the two can never disagree about
   * which cards are on the board. */
  function cards(o) {
    const p = P();
    const base = SB.Pdf.cells();
    const shots = [];
    p.scenes.forEach(function (sc) {
      sc.shots.forEach(function (sh) { if (!sh.noShot) shots.push(sh); });
    });
    return base.map(function (c, i) {
      const sh = shots[i];
      const w = SB.Model.windowFor(p, sh);
      const script = w && w.doc ? String(w.doc.text || '').slice(w.from, w.to) : '';
      let img = c.img;
      let original = false;
      if (o.slideOriginals && sh.image && !c.blocked && sh.render) {
        const full = SB.Renders.dataUrl(p, sh.render);
        if (full && /^data:image\//i.test(full)) { img = full; original = true; }
      }
      return Object.assign({}, c, {
        scriptText: script.trim(), img: img, original: original, shotId: sh.id
      });
    });
  }

  /* ---------------------------------------------------------------- plan */

  function caption(c, pr, o) {
    const paras = [];
    const meta = [{ t: c.code, b: true }];
    if (o.showType && c.type) meta.push({ t: '  ' + c.type.toUpperCase(), color: '666666' });
    if (o.showSceneHeading && c.scene) meta.push({ t: '  ·  ' + c.scene, color: '555555' });
    paras.push({ size: pr.meta, runs: meta });
    if (o.showScript && c.scriptText) {
      lines(c.scriptText).filter(Boolean).forEach(function (l) {
        paras.push({ size: pr.body, runs: [{ t: l, i: true, color: '222222' }] });
      });
    }
    if (o.showDesc && c.desc) {
      lines(c.desc).filter(Boolean).forEach(function (l) {
        paras.push({ size: pr.body, runs: [{ t: l, color: '333333' }] });
      });
    }
    return paras;
  }

  function panelShapes(c, box, pr, o) {
    const out = [];
    const f = box.frame;
    out.push({ kind: 'rect', x: f.x, y: f.y, w: f.w, h: f.h, fill: 'F2F3F5', line: 'C3C6CC' });
    if (c.img) {
      out.push({ kind: 'pic', x: f.x, y: f.y, w: f.w, h: f.h, url: c.img, name: c.code });
    } else {
      out.push({ kind: 'text', x: f.x, y: f.y, w: f.w, h: f.h, anchor: 'ctr', align: 'ctr',
        paras: [{ size: 9, runs: [{ t: 'NO FRAME', color: '9AA0AA' }] }] });
    }
    /* clay is not a frame and a comp is not footage — both say so on the
       picture, where nobody can crop the label away from it */
    const tag = c.img && c.blocked ? 'blocking'
      : c.img && c.stock ? 'Getty ' + c.stock.id + ' · comp' : '';
    if (tag) {
      const tw = Math.min(f.w - IN(0.1), IN(0.12 + tag.length * 0.065));
      out.push({ kind: 'text', x: f.x + IN(0.05), y: f.y + f.h - IN(0.27), w: tw, h: IN(0.22),
        fill: 'FFFFFF', alpha: 85, anchor: 'ctr', inset: IN(0.04),
        paras: [{ size: 7, runs: [{ t: tag.toUpperCase(), color: '555555' }] }] });
    }
    const cap = box.cap;
    let tx = cap.x, tw2 = cap.w;
    if (o.color === 'accent') {
      out.push({ kind: 'rect', x: cap.x, y: cap.y, w: IN(0.05), h: cap.h, fill: hex(c.color) });
      tx += IN(0.09); tw2 -= IN(0.09);
    }
    const paras = fit(caption(c, pr, o), tw2, cap.h);
    if (paras.length) {
      out.push({ kind: 'text', x: tx, y: cap.y, w: tw2, h: cap.h, anchor: 't', paras: paras });
    }
    return out;
  }

  function hex(s) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(s || ''));
    return m ? m[1].toUpperCase() : '6B7280';
  }

  function sectionShapes(c, o) {
    const out = [];
    const x = IN(1.1), w = SLIDE.w - IN(2.2);
    if (o.color === 'accent') {
      out.push({ kind: 'rect', x: IN(0.8), y: IN(2.3), w: IN(0.09), h: IN(2.6), fill: hex(c.color) });
    }
    const paras = [{ size: 32, runs: [{ t: c.scene || 'Scene ' + (c.sceneIdx + 1), b: true, color: '111111' }] }];
    lines(c.sceneDesc).filter(Boolean).forEach(function (l) {
      paras.push({ size: 16, runs: [{ t: l, color: '444444' }] });
    });
    out.push({ kind: 'text', x: x, y: IN(2.3), w: w, h: IN(2.6), anchor: 'ctr',
      paras: fit(paras, w, IN(2.6)) });
    return out;
  }

  function footerName(p, tail, boxW) {
    const who = clean([p.name || 'Untitled', p.versionName || ''].filter(Boolean).join(' · '))
      .replace(/\s+/g, ' ');
    const room = (boxW / 12700 - 10) / 9 * 0.8 - ems(tail);
    if (ems(who) <= room) return who;
    let t = '', acc = 0;
    for (const c of who) {
      if (acc + charEm(c) > room - 1.2) break;
      t += c; acc += charEm(c);
    }
    return t.replace(/\s+$/, '') + '…';
  }

  /* Cards → slides. A section slide is its own slide, so a scene that gets one
   * always starts a fresh slide of panels after it; scenePageBreak on its own
   * starts one without the title. */
  function plan(o) {
    const p = P();
    o = options(o);
    const pr = preset(o.slidePreset);
    const g = grid(pr, o);
    const list = cards(o);
    const slides = [];
    let cur = null;
    list.forEach(function (c) {
      if (c.sceneFirst && o.sceneBanner) {
        slides.push({ kind: 'section', scene: c.scene, shapes: sectionShapes(c, o) });
        cur = null;
      } else if (c.sceneFirst && o.scenePageBreak) {
        cur = null;
      }
      if (!cur || cur.cards.length >= g.perSlide) {
        cur = { kind: 'panels', cards: [], shapes: [] };
        slides.push(cur);
      }
      cur.shapes = cur.shapes.concat(panelShapes(c, g.boxes[cur.cards.length], pr, o));
      cur.cards.push(c.code);
    });
    if (!slides.length) {
      /* "every shot is marked no shot" is only true when there are shots */
      const any = p.scenes.some(function (sc) { return sc.shots.length; });
      slides.push({ kind: 'empty', shapes: [{ kind: 'text', x: IN(1), y: IN(3), w: SLIDE.w - IN(2), h: IN(1),
        anchor: 'ctr', align: 'ctr',
        paras: [{ size: 18, runs: [{ t: any
          ? 'Nothing to show — every shot is marked “no shot”.'
          : 'Nothing to show — this board has no shots yet.', color: '666666' }] }] }] });
    }
    if (o.slideFooter) {
      const fw = SLIDE.w - 2 * MARGIN, fh = FOOT - IN(0.04);
      slides.forEach(function (s, i) {
        /* One line, always. The box sits on the bottom edge, so a second line
           would grow UP into the captions; it is the name that gives way,
           never the slide number. */
        const tail = ' · ' + (i + 1) + ' of ' + slides.length;
        s.shapes.push({ kind: 'text', x: MARGIN, y: SLIDE.h - MARGIN - FOOT + IN(0.04),
          w: fw, h: fh, anchor: 'b', align: 'ctr',
          paras: [{ size: 9, runs: [{ t: footerName(p, tail, fw), color: '777777' }, { t: tail, color: '777777' }] }] });
      });
    }
    return {
      slides: slides, preset: pr, opts: o,
      shots: list.length,
      originals: list.filter(function (c) { return c.original; }).length
    };
  }

  /* ---------------------------------------------------------------- media
   *
   * Every distinct picture once, as bytes PowerPoint can open. Board copies
   * are usually WebP, which PowerPoint before 2019/365 shows as a red cross,
   * so anything that is not JPEG or PNG is redrawn as JPEG. JPEG and PNG are
   * kept byte for byte — re-encoding a frame somebody is about to project only
   * loses quality — but still decoded, because placing it needs its shape. */
  const MAX_SIDE = 2560;

  function urls(pl) {
    const seen = {}, out = [];
    pl.slides.forEach(function (s) {
      s.shapes.forEach(function (sh) {
        if (sh.kind === 'pic' && !seen[sh.url]) { seen[sh.url] = 1; out.push(sh.url); }
      });
    });
    return out;
  }

  function mimeOf(u) {
    const m = /^data:([^;,]+)/i.exec(String(u || ''));
    return m ? m[1].toLowerCase() : '';
  }

  function decodeInBrowser(url) {
    return new Promise(function (resolve, reject) {
      const im = new Image();
      /* anything thrown in here would leave the promise hanging and the
         export silent forever, so every failure becomes a rejection */
      im.onload = function () {
        try { onload(); } catch (e) { reject(e); }
      };
      function onload() {
        const w = im.naturalWidth, h = im.naturalHeight;
        if (!w || !h) { reject(new Error('a frame decoded to nothing')); return; }
        const mime = mimeOf(url);
        const keep = (mime === 'image/jpeg' || mime === 'image/png') && Math.max(w, h) <= MAX_SIDE;
        if (keep) {
          resolve({ bytes: SB.Zip.fromDataUrl(url), w: w, h: h, ext: mime === 'image/png' ? 'png' : 'jpeg' });
          return;
        }
        const s = Math.min(1, MAX_SIDE / Math.max(w, h));
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(w * s));
        cv.height = Math.max(1, Math.round(h * s));
        const cx = cv.getContext('2d');
        /* a transparent PNG or WebP would go black as JPEG */
        cx.fillStyle = '#ffffff';
        cx.fillRect(0, 0, cv.width, cv.height);
        cx.drawImage(im, 0, 0, cv.width, cv.height);
        resolve({ bytes: SB.Zip.fromDataUrl(cv.toDataURL('image/jpeg', 0.88)), w: cv.width, h: cv.height, ext: 'jpeg' });
      }
      im.onerror = function () { reject(new Error('a frame could not be read')); };
      im.src = url;
    });
  }

  /* url -> {name, bytes, w, h, ext}. One that will not decode is left out and
   * its panel says so, rather than shipping a deck with a broken picture in it
   * or failing the whole export over one card. `decode` is injectable so the
   * tests can run with no canvas. */
  function resolve(pl, decode) {
    decode = decode || decodeInBrowser;
    const list = urls(pl);
    const media = {};
    let n = 0, failed = 0;
    /* `failed` counts PANELS, which is what the toast and the slides say:
       one bad picture used on four cards is four frames that could not be read */
    const panels = function () {
      let k = 0;
      pl.slides.forEach(function (s) {
        s.shapes.forEach(function (sh) { if (sh.kind === 'pic' && !media[sh.url]) k++; });
      });
      return k;
    };
    const step = function (i) {
      if (i >= list.length) return Promise.resolve({ media: media, failed: panels(), badPictures: failed });
      return Promise.resolve().then(function () { return decode(list[i]); })
        .then(function (m) {
          if (m && m.bytes && m.bytes.length && m.w && m.h) {
            n++;
            media[list[i]] = { name: 'image' + n + '.' + (m.ext === 'png' ? 'png' : 'jpeg'),
              bytes: m.bytes, w: m.w, h: m.h };
          } else failed++;
        }, function () { failed++; })
        .then(function () { return step(i + 1); });
    };
    return step(0);
  }

  /* ---------------------------------------------------------------- XML */

  const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  const CT = 'application/vnd.openxmlformats-officedocument.presentationml.';
  const FONT = 'Segoe UI';

  const GROUP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/>' +
    '<a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

  function xfrm(x, y, w, h) {
    return '<a:xfrm><a:off x="' + Math.round(x) + '" y="' + Math.round(y) + '"/>' +
      '<a:ext cx="' + Math.max(1, Math.round(w)) + '" cy="' + Math.max(1, Math.round(h)) + '"/></a:xfrm>';
  }

  function fillXml(color, alpha) {
    if (!color) return '<a:noFill/>';
    return '<a:solidFill><a:srgbClr val="' + color + '">' +
      (alpha != null && alpha < 100 ? '<a:alpha val="' + Math.round(alpha * 1000) + '"/>' : '') +
      '</a:srgbClr></a:solidFill>';
  }

  function runXml(r, size) {
    return '<a:r><a:rPr lang="en-US" sz="' + Math.round(size * 100) + '"' +
      (r.b ? ' b="1"' : '') + (r.i ? ' i="1"' : '') + ' dirty="0">' +
      fillXml(r.color || '111111') +
      '<a:latin typeface="' + FONT + '"/><a:cs typeface="' + FONT + '"/></a:rPr>' +
      '<a:t>' + xml(r.t) + '</a:t></a:r>';
  }

  function textXml(sh, id) {
    const ins = sh.inset != null ? sh.inset : IN(0.05);
    const body = sh.paras.map(function (pa) {
      const rtl = isRtl(pa);
      const algn = sh.align || (rtl ? 'r' : '');
      return '<a:p>' + (algn || rtl
        ? '<a:pPr' + (algn ? ' algn="' + algn + '"' : '') + (rtl ? ' rtl="1"' : '') + '/>' : '') +
        pa.runs.filter(function (r) { return r.t; }).map(function (r) { return runXml(r, pa.size); }).join('') +
        '<a:endParaRPr lang="en-US" sz="' + Math.round(pa.size * 100) + '" dirty="0"/></a:p>';
    }).join('') || '<a:p><a:endParaRPr lang="en-US" dirty="0"/></a:p>';
    return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="Text ' + id + '"/>' +
      '<p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>' +
      '<p:spPr>' + xfrm(sh.x, sh.y, sh.w, sh.h) + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
      fillXml(sh.fill, sh.alpha) + '</p:spPr>' +
      '<p:txBody><a:bodyPr wrap="square" lIns="' + ins + '" tIns="' + ins + '" rIns="' + ins +
      '" bIns="' + ins + '" anchor="' + (sh.anchor || 't') + '" rtlCol="0"><a:normAutofit/></a:bodyPr>' +
      '<a:lstStyle/>' + body + '</p:txBody></p:sp>';
  }

  function rectXml(sh, id) {
    return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="Box ' + id + '"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
      '<p:spPr>' + xfrm(sh.x, sh.y, sh.w, sh.h) + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
      fillXml(sh.fill, sh.alpha) +
      (sh.line ? '<a:ln w="9525"><a:solidFill><a:srgbClr val="' + sh.line + '"/></a:solidFill></a:ln>'
        : '<a:ln><a:noFill/></a:ln>') +
      '</p:spPr></p:sp>';
  }

  /* contain: the whole frame, letterboxed inside its box, centred */
  function contain(sh, m) {
    const s = Math.min(sh.w / m.w, sh.h / m.h);
    const w = m.w * s, h = m.h * s;
    return { x: sh.x + (sh.w - w) / 2, y: sh.y + (sh.h - h) / 2, w: w, h: h };
  }

  function picXml(sh, id, rid, m) {
    const r = contain(sh, m);
    return '<p:pic><p:nvPicPr><p:cNvPr id="' + id + '" name="Frame ' + xml(sh.name || id) +
      '" descr="' + xml(sh.name || '') + '"/>' +
      '<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>' +
      '<p:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
      '<p:spPr>' + xfrm(r.x, r.y, r.w, r.h) + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';
  }

  /* One slide and its relationships. A picture whose media did not resolve
   * becomes the same "no frame" text an empty card gets. */
  function slideXml(slide, media) {
    const rels = [{ id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' }];
    const byUrl = {};
    let id = 2;
    const shapes = slide.shapes.map(function (sh) {
      const sid = id++;
      if (sh.kind === 'rect') return rectXml(sh, sid);
      if (sh.kind === 'text') return textXml(sh, sid);
      const m = media[sh.url];
      if (!m) {
        return textXml({ x: sh.x, y: sh.y, w: sh.w, h: sh.h, anchor: 'ctr', align: 'ctr',
          paras: [{ size: 9, runs: [{ t: 'FRAME COULD NOT BE READ', color: 'A4442C' }] }] }, sid);
      }
      let rid = byUrl[sh.url];
      if (!rid) {
        rid = byUrl[sh.url] = 'rId' + (rels.length + 1);
        rels.push({ id: rid, type: 'image', target: '../media/' + m.name });
      }
      return picXml(sh, sid, rid, m);
    }).join('');
    const body = HEAD + '<p:sld ' + NS + '><p:cSld><p:spTree>' + GROUP + shapes +
      '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
    return { xml: body, rels: relsXml(rels) };
  }

  function relsXml(list) {
    return HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      list.map(function (r) {
        const type = /^http/.test(r.type) ? r.type : REL + r.type;
        return '<Relationship Id="' + r.id + '" Type="' + type + '" Target="' + r.target + '"/>';
      }).join('') + '</Relationships>';
  }

  /* ---- the fixed parts ---- */

  function theme() {
    const font = function (tag) {
      return '<a:' + tag + '><a:latin typeface="' + FONT + '"/><a:ea typeface=""/><a:cs typeface=""/></a:' + tag + '>';
    };
    const solid = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
    const line = function (w) {
      return '<a:ln w="' + w + '" cap="flat" cmpd="sng" algn="ctr">' + solid +
        '<a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>';
    };
    const clr = function (n, v) { return '<a:' + n + '><a:srgbClr val="' + v + '"/></a:' + n + '>'; };
    return HEAD + '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Storyboarder">' +
      '<a:themeElements><a:clrScheme name="Storyboarder">' +
      '<a:dk1><a:srgbClr val="111111"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>' +
      clr('dk2', '333F48') + clr('lt2', 'EEF0F3') +
      clr('accent1', '3B82F6') + clr('accent2', '0D9488') + clr('accent3', 'CA8A04') +
      clr('accent4', 'EA580C') + clr('accent5', 'DC2626') + clr('accent6', '7C3AED') +
      clr('hlink', '2563EB') + clr('folHlink', '7C3AED') +
      '</a:clrScheme><a:fontScheme name="Storyboarder">' + font('majorFont') + font('minorFont') +
      '</a:fontScheme><a:fmtScheme name="Storyboarder">' +
      '<a:fillStyleLst>' + solid + solid + solid + '</a:fillStyleLst>' +
      '<a:lnStyleLst>' + line(6350) + line(12700) + line(19050) + '</a:lnStyleLst>' +
      '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/>' +
      '</a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
      '<a:bgFillStyleLst>' + solid + solid + solid + '</a:bgFillStyleLst>' +
      '</a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';
  }

  function master() {
    return HEAD + '<p:sldMaster ' + NS + '><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/>' +
      '</a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>' + GROUP + '</p:spTree></p:cSld>' +
      '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" ' +
      'accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
      '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
      '<p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>';
  }

  function layoutXml() {
    return HEAD + '<p:sldLayout ' + NS + ' type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>' +
      GROUP + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';
  }

  function isoNow() {
    return new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  }

  /* The whole package, as the part list zip.js takes. Pure: the media come in
   * resolved, so this is what the tests take apart. */
  function parts(pl, media) {
    const p = P();
    const out = [];
    const n = pl.slides.length;
    const slideParts = pl.slides.map(function (s) { return slideXml(s, media); });

    const exts = {};
    Object.keys(media).forEach(function (u) { exts[media[u].name.split('.').pop()] = 1; });

    out.push({ name: '[Content_Types].xml', data: HEAD +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/ppt/presentation.xml" ContentType="' + CT + 'presentation.main+xml"/>' +
      '<Override PartName="/ppt/presProps.xml" ContentType="' + CT + 'presProps+xml"/>' +
      '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="' + CT + 'slideMaster+xml"/>' +
      '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="' + CT + 'slideLayout+xml"/>' +
      '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      slideParts.map(function (s, i) {
        return '<Override PartName="/ppt/slides/slide' + (i + 1) + '.xml" ContentType="' + CT + 'slide+xml"/>';
      }).join('') + '</Types>' });

    out.push({ name: '_rels/.rels', data: relsXml([
      { id: 'rId1', type: 'officeDocument', target: 'ppt/presentation.xml' },
      { id: 'rId2', type: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', target: 'docProps/core.xml' },
      { id: 'rId3', type: 'extended-properties', target: 'docProps/app.xml' }
    ]) });

    out.push({ name: 'docProps/core.xml', data: HEAD +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
      'xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + xml(p.name || 'Storyboard') + '</dc:title><dc:creator>Storyboarder</dc:creator>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + isoNow() + '</dcterms:created>' +
      '<dcterms:modified xsi:type="dcterms:W3CDTF">' + isoNow() + '</dcterms:modified>' +
      '</cp:coreProperties>' });

    out.push({ name: 'docProps/app.xml', data: HEAD +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">' +
      '<Application>Storyboarder</Application><Slides>' + n + '</Slides></Properties>' });

    const presRels = [
      { id: 'rId1', type: 'slideMaster', target: 'slideMasters/slideMaster1.xml' },
      { id: 'rId2', type: 'theme', target: 'theme/theme1.xml' },
      { id: 'rId3', type: 'presProps', target: 'presProps.xml' }
    ];
    slideParts.forEach(function (s, i) {
      presRels.push({ id: 'rId' + (i + 4), type: 'slide', target: 'slides/slide' + (i + 1) + '.xml' });
    });
    out.push({ name: 'ppt/presentation.xml', data: HEAD + '<p:presentation ' + NS + ' saveSubsetFonts="1">' +
      '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
      '<p:sldIdLst>' + slideParts.map(function (s, i) {
        return '<p:sldId id="' + (256 + i) + '" r:id="rId' + (i + 4) + '"/>';
      }).join('') + '</p:sldIdLst>' +
      '<p:sldSz cx="' + SLIDE.w + '" cy="' + SLIDE.h + '"/><p:notesSz cx="6858000" cy="9144000"/>' +
      '</p:presentation>' });
    out.push({ name: 'ppt/_rels/presentation.xml.rels', data: relsXml(presRels) });
    out.push({ name: 'ppt/presProps.xml', data: HEAD + '<p:presentationPr ' + NS + '/>' });
    out.push({ name: 'ppt/theme/theme1.xml', data: theme() });
    out.push({ name: 'ppt/slideMasters/slideMaster1.xml', data: master() });
    out.push({ name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: relsXml([
      { id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' },
      { id: 'rId2', type: 'theme', target: '../theme/theme1.xml' }
    ]) });
    out.push({ name: 'ppt/slideLayouts/slideLayout1.xml', data: layoutXml() });
    out.push({ name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: relsXml([
      { id: 'rId1', type: 'slideMaster', target: '../slideMasters/slideMaster1.xml' }
    ]) });
    slideParts.forEach(function (s, i) {
      out.push({ name: 'ppt/slides/slide' + (i + 1) + '.xml', data: s.xml });
      out.push({ name: 'ppt/slides/_rels/slide' + (i + 1) + '.xml.rels', data: s.rels });
    });
    /* only media some slide actually uses — all of them, as resolve() is fed
       from the slides, but said rather than assumed */
    const used = {};
    slideParts.forEach(function (s) {
      s.rels.replace(/Target="\.\.\/media\/([^"]+)"/g, function (_, f) { used[f] = 1; return _; });
    });
    Object.keys(media).forEach(function (u) {
      const m = media[u];
      if (used[m.name]) out.push({ name: 'ppt/media/' + m.name, data: m.bytes });
    });
    return out;
  }

  /* ---------------------------------------------------------------- the file */

  function fileName(p) {
    return (SB.Renders.slug(p.name) || 'storyboard') + '.pptx';
  }

  /* -> {blob, slides, failed}. `decode` only for tests. */
  function build(o, decode) {
    const pl = plan(o);
    return resolve(pl, decode).then(function (r) {
      const blob = SB.Zip.store(parts(pl, r.media));
      return { blob: blob, slides: pl.slides.length, failed: r.failed, plan: pl };
    });
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([blob],
      { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  function exportPptx(o) {
    const p = P();
    return build(o).then(function (r) {
      download(r.blob, fileName(p));
      SB.toast(r.slides + (r.slides === 1 ? ' slide' : ' slides') + ' written to ' + fileName(p) +
        (r.failed ? ' — ' + r.failed + (r.failed === 1 ? ' frame' : ' frames') +
          ' could not be read and say so on the slide' : ''), !!r.failed);
      return r;
    });
  }

  /* ---------------------------------------------------------------- preview
   *
   * The same shapes, drawn in HTML at 1px = 12700 EMU (a 960×540 slide). The
   * picture uses object-fit: contain, which is what contain() works out in
   * the file. Only the font metrics are PowerPoint's own. */
  const PX = 12700;

  function previewHTML(pl, limit) {
    const max = limit || 60;
    const css = '*{box-sizing:border-box}body{margin:0;padding:10px;background:#e9eaee;' +
      'font-family:"Segoe UI",system-ui,sans-serif}' +
      '.sl{position:relative;width:960px;height:540px;background:#fff;margin:0 auto 14px;' +
      'box-shadow:0 1px 6px rgba(0,0,0,.25);overflow:hidden}' +
      '.sh{position:absolute;overflow:hidden}' +
      '.sh img{width:100%;height:100%;object-fit:contain;display:block}' +
      /* Segoe UI's own single spacing, which is what PowerPoint uses */
      '.tx{display:flex;flex-direction:column;line-height:1.33}' +
      '.bad{display:flex;align-items:center;justify-content:center}' +
      '.bad::after{content:"FRAME COULD NOT BE READ";color:#a4442c;font-size:9px}' +
      '.tx p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}' +
      '.more{text-align:center;color:#555;font-size:22px;padding:10px}';
    /* 960px across 13.333in is 72px an inch, so a point is a pixel */
    const pt = function (n) { return n + 'px'; };
    const box = function (s) {
      return 'left:' + (s.x / PX).toFixed(1) + 'px;top:' + (s.y / PX).toFixed(1) + 'px;width:' +
        (s.w / PX).toFixed(1) + 'px;height:' + (s.h / PX).toFixed(1) + 'px;';
    };
    const slides = pl.slides.slice(0, max).map(function (sl) {
      return '<div class="sl">' + sl.shapes.map(function (s) {
        if (s.kind === 'rect') {
          return '<div class="sh" style="' + box(s) + 'background:#' + s.fill +
            (s.line ? ';border:1px solid #' + s.line : '') + '"></div>';
        }
        if (s.kind === 'pic') {
          /* a frame that will not decode shows what the file will say there */
          return '<div class="sh" style="' + box(s) + '"><img src="' + s.url + '" onerror="' +
            'this.parentNode.className=\'sh bad\';this.remove()"></div>';
        }
        const ins = ((s.inset != null ? s.inset : IN(0.05)) / PX).toFixed(1) + 'px';
        const just = s.anchor === 'ctr' ? 'center' : s.anchor === 'b' ? 'flex-end' : 'flex-start';
        return '<div class="sh tx" style="' + box(s) + 'padding:' + ins + ';justify-content:' + just +
          ';text-align:' + (s.align === 'ctr' ? 'center' : 'left') +
          (s.fill ? ';background:rgba(255,255,255,' + ((s.alpha || 100) / 100) + ')' : '') + '">' +
          s.paras.map(function (pa) {
            return '<p' + (isRtl(pa) ? ' dir="rtl"' : '') + ' style="font-size:' + pt(pa.size) + '">' + pa.runs.map(function (r) {
              return '<span style="color:#' + (r.color || '111111') +
                (r.b ? ';font-weight:700' : '') + (r.i ? ';font-style:italic' : '') + '">' +
                SB.esc(r.t) + '</span>';
            }).join('') + '</p>';
          }).join('') + '</div>';
      }).join('') + '</div>';
    }).join('');
    const more = pl.slides.length > max
      ? '<div class="more">+ ' + (pl.slides.length - max) + ' more slides</div>' : '';
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + css + '</style></head><body>' +
      slides + more + '</body></html>';
  }

  SB.Pptx = {
    PRESETS: PRESETS, SLIDE: SLIDE, preset: preset, options: options, grid: grid,
    plan: plan, resolve: resolve, parts: parts, build: build, exportPptx: exportPptx,
    previewHTML: previewHTML, fileName: fileName, fit: fit, clean: clean, contain: contain
  };

})(window.SB);
