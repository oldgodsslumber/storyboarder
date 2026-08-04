/* pdf.js — contact sheet, 6 shots per page, via Chrome's Print → Save as PDF.
 * Excludes comments, ink, and "no shot" fragments.
 */
(function (SB) {
  'use strict';

  const PER_PAGE = 6;

  function P() { return SB.app.project; }

  function cells() {
    const out = [];
    const p = P();
    p.scenes.forEach(function (sc, si) {
      sc.shots.forEach(function (sh, sj) {
        if (sh.noShot) return;
        const w = SB.Model.windowFor(p, sh);
        out.push({
          code: SB.Model.code(si, sj),
          scene: sc.heading || '',
          type: sh.type || '',
          img: sh.image ? SB.Blobs.src(p, sh.image) : null,
          script: SB.Doc.renderHTML(w.doc, w.from, w.to, null),
          desc: sh.description || ''
        });
      });
    });
    return out;
  }

  function html() {
    const p = P();
    const list = cells();
    let pages = '';
    for (let i = 0; i < list.length; i += PER_PAGE) {
      const grp = list.slice(i, i + PER_PAGE);
      pages += '<section class="page"><div class="grid">' + grp.map(function (c) {
        return '<figure class="cell">' +
          '<div class="frame">' + (c.img ? '<img src="' + c.img + '">' : '<div class="empty">no frame</div>') + '</div>' +
          '<div class="meta"><span class="code">' + SB.esc(c.code) + '</span>' +
          '<span class="scene">' + SB.esc(c.scene) + '</span>' +
          (c.type ? '<span class="type">' + SB.esc(c.type) + '</span>' : '') + '</div>' +
          '<div class="script"><div class="clip">' +
          (c.script || '<i class="dim">(no script)</i>') + '</div></div>' +
          '<div class="desc"><div class="clip">' + SB.esc(c.desc) + '</div></div>' +
          '</figure>';
      }).join('') + '</div>' +
        '<footer>' + SB.esc(p.name) + ' · ' + SB.esc(p.versionName) + ' · page ' +
        (Math.floor(i / PER_PAGE) + 1) + ' of ' + Math.ceil(list.length / PER_PAGE) + '</footer></section>';
    }
    if (!pages) pages = '<section class="page"><p>Nothing to print — every shot is marked “no shot”.</p></section>';

    /* The sheet is sized to fit BOTH A4 and Letter with 12mm margins —
     * 186mm is A4's printable width, 251mm is Letter's printable height — so
     * it prints whole on either. It used to claim 262mm, more than Letter
     * actually has, which pushed a second sheet out for every page.
     */
    const CSS = [
      '@page{size:auto;margin:12mm}',
      '*{box-sizing:border-box}',
      ':root{--page-w:186mm;--page-h:251mm;--gap:5mm}',
      'html,body{margin:0;padding:0}',
      'body{font:11px/1.4 "Segoe UI",system-ui,sans-serif;color:#111;background:#e9eaee;' +
      '-webkit-print-color-adjust:exact;print-color-adjust:exact}',

      /* one sheet */
      '.page{width:var(--page-w);height:var(--page-h);margin:8mm auto;padding:0;background:#fff;' +
      'display:flex;flex-direction:column;box-shadow:0 1px 8px rgba(0,0,0,.22);break-after:page}',
      '.page:last-child{break-after:auto}',

      /* six cells that can never grow past their third of the sheet */
      '.grid{flex:1;min-height:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));' +
      'grid-template-rows:repeat(3,minmax(0,1fr));gap:var(--gap)}',
      /* margin:0 matters — a <figure> carries 40px of it by default, which
       * quietly narrowed every cell by 80px */
      '.cell{margin:0;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;' +
      'border:1px solid #c3c6cc;border-radius:3px;background:#fff}',

      /* A fixed frame height, not an aspect-ratio: in a column flex the ratio
       * ends up sized by whatever space the text leaves, so the pictures moved
       * around as descriptions changed length. 40mm x 6 rows is what fits a
       * sheet alongside the words. Any shape of image letterboxes inside it. */
      '.frame{flex:0 0 40mm;height:40mm;background:#f2f3f5;' +
      'border-bottom:1px solid #dfe1e5;display:flex;align-items:center;justify-content:center;' +
      'overflow:hidden}',
      '.frame img{max-width:100%;max-height:100%;width:auto;height:auto;display:block;' +
      'object-fit:contain}',
      '.empty{color:#9aa0aa;font-size:9px;letter-spacing:.4px;text-transform:uppercase}',

      '.meta{flex:0 0 auto;display:flex;gap:6px;align-items:baseline;padding:3px 5px;' +
      'background:#eef0f3;border-bottom:1px solid #dfe1e5}',
      '.code{font-weight:700}',
      '.scene{flex:1;min-width:0;font-size:10px;color:#333;overflow:hidden;text-overflow:ellipsis;' +
      'white-space:nowrap}',
      '.type{font-size:9px;text-transform:uppercase;letter-spacing:.4px;color:#666;white-space:nowrap}',

      /* The clamp lives on an inner box: a flex item is blockified, which
       * throws -webkit-box away and leaves text cut through the middle of a
       * line instead of ending in an ellipsis. */
      '.script{flex:0 1 auto;min-height:0;padding:4px 5px;overflow:hidden;' +
      'border-bottom:1px dashed #e3e5e9}',
      '.desc{flex:1 1 auto;min-height:0;padding:4px 5px 5px;color:#333;overflow:hidden}',
      '.clip{display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap}',
      '.script .clip{-webkit-line-clamp:2}',
      '.desc .clip{-webkit-line-clamp:3}',
      '.dim{color:#9aa0aa}',
      'footer{flex:0 0 auto;padding-top:3mm;font-size:9px;color:#666;text-align:center}',

      '@media print{body{background:#fff}' +
      '.page{width:auto;height:var(--page-h);margin:0;box-shadow:none}}'
    ].join('');

    /* Printing before the frames have decoded is what produced a sheet of
     * collapsed images, so wait for them. */
    const READY = 'window.addEventListener("load",function(){' +
      'var imgs=[].slice.call(document.images);' +
      'Promise.all(imgs.map(function(i){' +
      'return i.decode?i.decode().catch(function(){}):Promise.resolve();}))' +
      '.then(function(){setTimeout(function(){window.print()},120)});});';

    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + SB.esc(p.name) +
      ' — storyboard</title><style>' + CSS + '</style></head><body>' + pages +
      '<script>' + READY + '<\/script></body></html>';
  }

  function exportPdf() {
    const w = window.open('', '_blank');
    if (!w) { SB.toast('Allow pop-ups for this page to export the PDF', true); return; }
    w.document.open();
    w.document.write(html());
    w.document.close();
  }

  SB.Pdf = { exportPdf: exportPdf, html: html, cells: cells };

})(window.SB);
