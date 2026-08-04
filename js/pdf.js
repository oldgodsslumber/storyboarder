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
          '<div class="script">' + (c.script || '<i class="dim">(no script)</i>') + '</div>' +
          '<div class="desc">' + SB.esc(c.desc) + '</div>' +
          '</figure>';
      }).join('') + '</div>' +
        '<footer>' + SB.esc(p.name) + ' · ' + SB.esc(p.versionName) + ' · page ' +
        (Math.floor(i / PER_PAGE) + 1) + ' of ' + Math.ceil(list.length / PER_PAGE) + '</footer></section>';
    }
    if (!pages) pages = '<section class="page"><p>Nothing to print — every shot is marked “no shot”.</p></section>';

    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + SB.esc(p.name) +
      ' — storyboard</title><style>' +
      '@page{size:letter portrait;margin:12mm}' +
      'body{margin:0;font:11px/1.4 "Segoe UI",system-ui,sans-serif;color:#111;background:#fff}' +
      '.page{page-break-after:always;display:flex;flex-direction:column;height:262mm}' +
      '.page:last-child{page-break-after:auto}' +
      '.grid{flex:1;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr 1fr;gap:6mm}' +
      '.cell{margin:0;display:flex;flex-direction:column;border:1px solid #bbb;border-radius:3px;overflow:hidden}' +
      '.frame{background:#000;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center}' +
      '.frame img{width:100%;height:100%;object-fit:contain}' +
      '.empty{color:#777;font-size:10px}' +
      '.meta{display:flex;gap:6px;align-items:baseline;padding:3px 5px;background:#eee;border-bottom:1px solid #ddd}' +
      '.code{font-weight:700}.scene{flex:1;font-size:10px;color:#333}' +
      '.type{font-size:9px;text-transform:uppercase;letter-spacing:.4px;color:#666}' +
      '.script{padding:4px 5px;white-space:pre-wrap;border-bottom:1px dashed #ddd;max-height:22mm;overflow:hidden}' +
      '.desc{padding:4px 5px;color:#333;white-space:pre-wrap;flex:1;overflow:hidden}' +
      '.dim{color:#999}' +
      'footer{padding-top:3mm;font-size:9px;color:#666;text-align:center}' +
      '</style></head><body>' + pages +
      '<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},250)})<\/script>' +
      '</body></html>';
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
