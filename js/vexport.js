/* vexport.js — video models, exported.
 *
 * Every video model is offered twice in the Create panel: "Send from
 * Storyboarder" (the ImagineArt push, which hands a clip ONE picture, the
 * card's first frame, so its prompt is motion only) and "Export" (you upload
 * the files to the tool yourself). An exported clip isn't limited to one
 * picture: it gets the blocking (the clay clip if a performance is linked,
 * else the clay still), the first frame if the card has one, and each
 * subject's photo, all uploaded in order. So its prompt is written against
 * that numbered list, and nothing about it assumes a single frame.
 *
 * The export twin is not stored anywhere: it is the base model seen through an
 * id with EXPORT on the end (model.js), with its prompts kept under that id so
 * the two versions never overwrite each other. The file list is the MiniMax
 * package's manifest (mxm.js), relabelled in plain "image N / video N". */
(function (SB) {
  'use strict';

  function isExport(m) { return !!(m && m.export); }

  /* The files, in upload order, labelled the way the prompt cites them. */
  function assets(p, shot) {
    if (!SB.Mxm) return [];
    const m = SB.Mxm.manifest(p, shot, 'video');
    let pic = 0, vid = 0;
    return m.assets.map(function (a) {
      const video = a.kind === 'clay-clip';
      return Object.assign({}, a, { cite: video ? 'video ' + (++vid) : 'image ' + (++pic), video: video, manifest: m });
    });
  }

  /* The cast and reference block the writer gets for an exported clip. */
  function castBlock(p, shot, cast) {
    const list = assets(p, shot);
    const fr = SB.Personas.framing ? SB.Personas.framing(p, shot) : { arrives: function () { return false; } };
    const lines = ['FILES UPLOADED WITH THIS CLIP, IN THIS ORDER (the person making it uploads each one by hand):'];
    const clay = list.filter(function (a) { return a.kind === 'clay-clip' || a.kind === 'clay-still'; })[0];
    const first = list.filter(function (a) { return a.kind === 'first-frame'; })[0];
    list.forEach(function (a) {
      lines.push('  ' + a.cite + ' = ' + (a.kind === 'subject' ? a.role : a.role) +
        (a.kind === 'subject' && fr.arrives(a.subjectId) ? ' [ARRIVES DURING THE SHOT]' : ''));
    });
    if (!list.length) lines.push('  (none; the clip is made from these words alone)');
    if (clay) {
      lines.push(clay.cite.charAt(0).toUpperCase() + clay.cite.slice(1) + ' is a 3D BLOCKING of this exact shot: grey ' +
        'mannequins stand in for the people and grey shapes for the set. Take ONLY the layout, the camera' +
        (clay.video ? ', the timing and every movement' : ' and the poses') + ' from it. Say plainly that its grey ' +
        'material, mannequins, floor and grid must not appear. Do not otherwise describe the blocking.');
    }
    if (first) lines.push(first.cite.charAt(0).toUpperCase() + first.cite.slice(1) + ' is the approved first frame: the clip opens exactly on it.');
    else lines.push('No first frame is supplied, so give the setting in one short sentence from the shot description.');
    const withPic = list.filter(function (a) { return a.kind === 'subject'; });
    if (withPic.length) {
      lines.push('Each person or thing with a picture keeps its face, hair, build and wardrobe EXACTLY as in its picture. ' +
        'The first time you name one, cite its file ("Gus (image 2)"); after that, the name alone.');
    }
    // cast with no picture: described in words, since the words are all the tool gets
    const pictured = {};
    withPic.forEach(function (a) { pictured[a.subjectId] = 1; });
    const bare = cast.filter(function (x) { return !pictured[x.id]; });
    if (bare.length) {
      lines.push('NO PICTURE, DESCRIBE IN WORDS:');
      bare.forEach(function (x) {
        const d = (x.description || '').replace(/\s+/g, ' ').trim();
        lines.push('  ' + (x.name || 'unnamed') + ': ' + (d || '(no description yet)') +
          (fr.arrives(x.id) ? ' [ARRIVES DURING THE SHOT]' : ''));
      });
    }
    lines.push('Anyone marked as arriving is not there when the clip opens: their entrance is movement this prompt covers.');
    return lines.join('\n');
  }

  function toBytes(d) {
    if (d instanceof Blob) return d.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    if (typeof d === 'string' && /^data:/.test(d)) return Promise.resolve(SB.Zip.fromDataUrl(d));
    return Promise.resolve(new TextEncoder().encode(String(d)));
  }

  /* One zip: <code>_<model>/01_clay.mp4 … prompt.txt ORDER.txt */
  function zip(p, shot, model) {
    const list = assets(p, shot);
    const pr = ((shot.prompts || {})[model.id] || {}).videoPrompt || '';
    const f = SB.Model.findShot(p, shot.id);
    const dir = ((f && f.code) || 'shot') + '_' + String(model.name || 'video').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toLowerCase();
    const m = list[0] ? list[0].manifest : null;
    const out = [];
    return list.reduce(function (chain, a) {
      return chain.then(function () {
        return SB.Mxm.assetData(p, shot, a, m).then(function (d) {
          if (!d) throw new Error('the file for ' + a.cite + ' (' + a.role + ') is missing');
          out.push({ name: a.file, data: d });
        });
      });
    }, Promise.resolve()).then(function () {
      out.push({ name: 'prompt.txt', data: pr + '\n' });
      out.push({ name: 'ORDER.txt', data: list.map(function (a) { return a.file + '  =  ' + a.cite + ': ' + a.role; }).join('\n') +
        (list.length ? '\n' : '(no files: the prompt is the whole call)\n') });
      return Promise.all(out.map(function (x) { return toBytes(x.data).then(function (b) { return { name: dir + '/' + x.name, data: b }; }); }));
    }).then(function (entries) { return { blob: SB.Zip.store(entries), name: dir + '.zip' }; });
  }

  function save(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  /* A still, exported: every reference picture, in the feed's order (the
     numbers its prompt uses), full size where the board carries the original. */
  function imageFiles(p, shot) {
    return SB.Refs.images(p, shot, 'image').map(function (e) {
      const u = (e.render && SB.Renders.dataUrl(p, e.render)) || SB.Blobs.src(p, e.img);
      const ext = /^data:image\/png/i.test(u) ? 'png' : /^data:image\/webp/i.test(u) ? 'webp' : 'jpg';
      const name = e.kind === 'pose' ? 'blocking' : String(e.label || 'ref').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toLowerCase();
      return { n: e.n, id: e.id, cite: 'image ' + e.n, url: u, kind: e.kind, label: e.kind === 'pose' ? 'the blocking (clay render)' : e.label,
        file: (e.n < 10 ? '0' : '') + e.n + '_' + (name || 'ref') + '.' + ext };
    });
  }
  function zipImage(p, shot, model) {
    const list = imageFiles(p, shot);
    const pr = ((shot.prompts || {})[model.id] || {}).imagePrompt || '';
    const f = SB.Model.findShot(p, shot.id);
    const dir = ((f && f.code) || 'shot') + '_' + String(model.name || 'still').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toLowerCase();
    return Promise.all(list.map(function (x) {
      return fetch(x.url).then(function (r) { return r.arrayBuffer(); }).then(function (b) { return { name: dir + '/' + x.file, data: new Uint8Array(b) }; });
    })).then(function (entries) {
      const enc = new TextEncoder();
      entries.push({ name: dir + '/prompt.txt', data: enc.encode(pr + '\n') });
      entries.push({ name: dir + '/ORDER.txt', data: enc.encode(list.map(function (x) { return x.file + '  =  ' + x.cite + ': ' + x.label; }).join('\n') +
        (list.length ? '\n' : '(no files: the prompt is the whole call)\n')) });
      return { blob: SB.Zip.store(entries), name: dir + '.zip' };
    });
  }

  SB.VExport = { isExport: isExport, assets: assets, castBlock: castBlock, zip: zip, save: save, imageFiles: imageFiles, zipImage: zipImage };
})(window.SB);
