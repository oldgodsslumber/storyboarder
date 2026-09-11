/* exportpanel.js — the way back out.
 *
 * Everything a board is made of now lives inside the .storyboard: the ≤480p
 * copies the cards draw, the full-size originals, the clips. That is what
 * makes a board one thing you can hand to someone — and it is also what
 * swallowed the only way the pictures used to get out, which was a folder on
 * disk you could open and drag from.
 *
 * So: one panel that writes files. It is a reader and nothing else — every
 * byte it writes is already in the file, there is no state to migrate, and no
 * export can change a board.
 *
 * ---- the one rule ----
 *
 * A folder is picked inside the click, written to, and forgotten. No handle is
 * stored, nothing is remembered between sessions, and nothing about a machine
 * ever ends up in the project. That is the whole difference between this and
 * the renders folder it replaced, which quietly became a fact about one
 * computer that the board depended on.
 *
 * ---- what is worth having ----
 *
 * The serials are already the names — 0007.webp and 0012.mp4 sort next to each
 * other, so a clip lands beside the frame it came from in whatever folder an
 * editor opens. And because anything generated in here carries what made it,
 * "only what was made in here" is a real filter rather than an eyeball job:
 * eleven stills and four clips, with a manifest saying which model and which
 * prompt produced each one. Nothing can rebuild that from the pictures later.
 */
(function (SB) {
  'use strict';

  function P() { return SB.app.project; }

  /* Chosen once per session, not saved: an export is a thing you do, not a
   * property of the board. */
  const opts = {
    originals: true,
    clips: true,
    proxies: false,
    refsets: false,
    shotlist: false,
    manifest: true,
    scope: 'board',        // 'board' | 'scene' | 'selected'
    madeOnly: false,
    naming: 'serial'       // 'serial' | 'code'
  };

  /* ---------------------------------------------------------------- model */

  function rows(p, scope) {
    const out = [];
    const sel = (SB.Board.selection && SB.Board.selection()) || [];
    p.scenes.forEach(function (sc, si) {
      sc.shots.forEach(function (sh, sj) {
        if (scope === 'scene' && sc.id !== SB.app.selectedSceneId) return;
        if (scope === 'selected' && sel.indexOf(sh.id) < 0) return;
        /* A scene's name is its heading — `.name` does not exist on a scene
           and every other reader in the app knows that. Reading it gave an
           empty Scene column in every CSV row and every manifest entry. */
        out.push({
          scene: sc, shot: sh, code: SB.Model.code(si, sj), si: si, sj: sj,
          sceneName: sc.heading || ''
        });
      });
    });
    return out;
  }

  /* Measured off the data URL that is actually going to be written, never
     off the record — a reference set that fell back to the board copy used to
     report the original's megabyte for a 300-byte file. `rec.bytes` is only
     trusted when the bytes in hand are that record's. */
  function bytesOf(dataUrl) {
    const i = String(dataUrl || '').indexOf(',');
    return i < 0 ? 0 : Math.round((dataUrl.length - i - 1) * 0.75);
  }

  /* UTF-8, not UTF-16 code units: a manifest full of Japanese was reported at
     four fifths of what it weighs. */
  function textBytes(t) {
    try { return new TextEncoder().encode(t).length; } catch (e) { return t.length; }
  }

  function nameFor(code, rec, naming, fallbackExt) {
    const base = rec && rec.serial
      ? SB.Renders.fileName(rec.serial, rec.ext)
      /* No serial: named for its card. A record with no serial but a type of
         its own keeps that type, or it would export as a .jpg that is not one
         and collide with that card's actual board copy. */
      : (SB.Renders.slug(code) || 'shot') + '_board.' +
        ((rec && rec.ext) || fallbackExt || 'jpg');
    if (naming !== 'code') return base;
    const c = SB.Renders.slug(code) || 'shot';
    return base.indexOf(c + '_') === 0 ? base : c + '_' + base;
  }

  function extOfUrl(u) {
    const m = /^data:image\/([a-z0-9+]+)/i.exec(String(u || ''));
    let e = m ? m[1].toLowerCase() : 'jpg';
    if (e === 'jpeg') e = 'jpg';
    return e;
  }

  /* One implementation, in SB.Imagine, because the clip review wants the
     same answer and two copies of a lookup like this drift. */
  function promptFor(p, shot, made) {
    return SB.Imagine.promptFor(p, shot, made);
  }

  /* Everything this export would write, as a list — the panel renders from
   * this, the footer counts it, and the tests check it without a browser. */
  function plan(p, o) {
    o = o || opts;
    const items = [];
    const list = rows(p, o.scope);
    let linkOnly = 0, missing = 0;

    list.forEach(function (r) {
      const sh = r.shot;

      if (o.originals) {
        const rec = sh.render;
        if (rec && SB.Renders.has(p, rec)) {
          if (!o.madeOnly || rec.made) {
            const data = SB.Renders.dataUrl(p, rec);
            items.push({
              name: nameFor(r.code, rec, o.naming), kind: 'original', data: data,
              bytes: bytesOf(data), code: r.code, scene: r.sceneName,
              shot: sh, rec: rec, made: rec.made || null
            });
          }
        } else if (rec && SB.Renders.isMissing(p, rec) && !o.madeOnly) {
          /* A number with no picture behind it — filed when originals lived
           * in a folder, or a reference whose bytes have since gone. Either
           * way it cannot be written, so it is counted and said out loud
           * rather than dropped in silence. */
          missing++;
        }
      }

      if (o.clips && sh.video) {
        if (sh.video.ref && SB.Renders.has(p, sh.video)) {
          if (!o.madeOnly || sh.video.made) {
            const data = SB.Renders.dataUrl(p, sh.video);
            items.push({
              name: nameFor(r.code, sh.video, o.naming, 'mp4'), kind: 'clip', data: data,
              bytes: bytesOf(data), code: r.code, scene: r.sceneName,
              shot: sh, rec: sh.video, made: sh.video.made || null
            });
          }
        } else if (sh.video.url) {
          /* Held as a link, not a file — and links expire. Worth saying
           * before the export runs rather than after. */
          linkOnly++;
        } else if (!o.madeOnly) {
          /* A clip record with neither bytes nor a link left. */
          missing++;
        }
      }

      if (o.proxies && sh.image) {
        if (!o.madeOnly || (sh.render && sh.render.made)) {
          const data = SB.Blobs.src(p, sh.image);
          if (data) {
            items.push({
              name: nameFor(r.code, null, o.naming, extOfUrl(data)), kind: 'board copy',
              data: data, bytes: bytesOf(data), code: r.code,
              scene: r.sceneName, shot: sh, rec: null,
              /* It only passed the made-in-here filter because the frame it is
                 a copy of was generated — so the manifest says so instead of
                 flatly denying it. */
              made: (sh.render && sh.render.made) || null, isProxy: true
            });
          }
        }
      }

      /* A shot's reference set, numbered in feed order, in a folder of its
       * own. The numbers are the promise the prompt's mapping makes, so they
       * lead the filename. */
      if (o.refsets && !o.madeOnly) {
        const feed = SB.Refs.images(p, sh);
        if (feed.length) {
          const dir = 'refs/' + (SB.Renders.slug(r.code) || 'shot');
          feed.forEach(function (e) {
            const orig = SB.Renders.dataUrl(p, e.render);
            const data = orig || SB.Blobs.src(p, e.img);
            if (!data) return;
            /* Falling back to the board copy is fine; doing it silently is
               not. The plan for this panel named this exact failure: an
               export that shipped 854×480 where 4K was promised. */
            if (!orig && e.render) missing++;
            const ext = extOfUrl(data);
            items.push({
              name: e.n + '_' + (SB.Renders.slug(e.label) || 'ref') +
                (e.role ? '_' + SB.Renders.slug(e.role) : '') + '.' + ext,
              sub: dir, kind: orig ? 'reference' : 'reference (board copy)',
              data: data, bytes: bytesOf(data),
              code: r.code, scene: r.sceneName, shot: sh,
              rec: orig ? e.render : null,
              made: (orig && e.render && e.render.made) || null
            });
          });
        }
      }
    });

    if (o.shotlist) {
      items.push({
        name: (SB.Renders.slug(p.name) || 'board') + '-shots.csv', kind: 'list',
        text: csv(p, list), bytes: 0
      });
    }
    /* A manifest of nothing is not an export. With no files to describe, the
       panel says "nothing selected" instead of offering one empty JSON. */
    if (o.manifest && items.length) {
      const text = manifest(p, items);
      items.push({
        name: (SB.Renders.slug(p.name) || 'board') + '-manifest.json', kind: 'list',
        text: text, bytes: textBytes(text)
      });
    }
    items.forEach(function (it) {
      if (!it.bytes && it.text) it.bytes = textBytes(it.text);
    });

    return {
      items: items,
      bytes: items.reduce(function (n, it) { return n + (it.bytes || 0); }, 0),
      linkOnly: linkOnly,
      missing: missing,
      shots: list.length
    };
  }

  /* ---- the two text files ---- */

  function cell(v) {
    let s = String(v == null ? '' : v);
    /* A leading =, +, - or @ makes Excel and Sheets run the cell as a
       formula. A description is text; it is prefixed so it stays text. */
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    /* A lone CR splits the row in Excel just as a LF does. */
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function csv(p, list) {
    const im = SB.Model.imageModel(p), vm = SB.Model.videoModel(p);
    const head = ['Scene', 'Code', 'Type', 'Description',
      'First-frame prompt (' + ((im && im.name) || '—') + ')',
      'Video prompt (' + ((vm && vm.name) || '—') + ')',
      'Original', 'Clip'];
    const lines = [head.map(cell).join(',')];
    list.forEach(function (r) {
      const sh = r.shot;
      const ip = (im && sh.prompts[im.id] && sh.prompts[im.id].imagePrompt) || '';
      const vp = (vm && sh.prompts[vm.id] && sh.prompts[vm.id].videoPrompt) || '';
      lines.push([
        r.sceneName || (r.scene && r.scene.heading) || '', r.code,
        sh.noShot ? 'no shot' : (sh.type || ''),
        SB.Refs.plain(p, sh.description || ''), ip, vp,
        sh.render && sh.render.serial ? SB.Renders.fileName(sh.render.serial, sh.render.ext) : '',
        sh.video && sh.video.serial ? SB.Renders.fileName(sh.video.serial, sh.video.ext) : ''
      ].map(cell).join(','));
    });
    return lines.join('\r\n');
  }

  /* What made each file. This is the half of a generated export that cannot be
   * rebuilt afterwards — the pictures do not say which model produced them,
   * and the prompt on the card moves on. */
  function manifest(p, items) {
    const out = {
      board: p.name || 'Untitled project',
      version: p.versionName || '',
      files: items.filter(function (it) { return it.kind !== 'list'; }).map(function (it) {
        const m = it.made;
        return {
          file: (it.sub ? it.sub + '/' : '') + it.name,
          kind: it.kind,
          shot: it.code,
          scene: it.scene,
          serial: (it.rec && it.rec.serial) || null,
          bytes: it.bytes || 0,
          pixels: it.rec && it.rec.w ? it.rec.w + '×' + it.rec.h : null,
          boardCopy: !!it.isProxy,
          madeHere: !!m,
          model: m ? m.model : null,
          imagineModel: m ? m.slug : null,
          promptOnTheCardNow: m ? promptFor(p, it.shot, m) : null
        };
      })
    };
    return JSON.stringify(out, null, 2);
  }

  /* ---------------------------------------------------------------- writing */

  function dataToBlob(data) {
    return fetch(data).then(function (r) { return r.blob(); });
  }

  function writeTo(dir, it) {
    const step = it.sub ? it.sub.split('/') : [];
    let at = Promise.resolve(dir);
    step.forEach(function (name) {
      at = at.then(function (d) { return d.getDirectoryHandle(name, { create: true }); });
    });
    return at.then(function (d) {
      return d.getFileHandle(it.name, { create: true }).then(function (fh) {
        return fh.createWritable().then(function (w) {
          const body = it.text != null
            ? Promise.resolve(new Blob([it.text], { type: 'text/plain' }))
            : dataToBlob(it.data);
          return body.then(function (b) {
            return w.write(b).then(function () { return w.close(); });
          });
        });
      });
    });
  }

  function download(it) {
    const a = document.createElement('a');
    a.href = it.text != null
      ? URL.createObjectURL(new Blob([it.text], { type: 'text/plain' }))
      : it.data;
    /* One flat folder, so the set still sorts the way it was numbered. */
    a.download = (it.sub ? it.sub.replace(/\//g, '_') + '_' : '') + it.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (it.text != null) setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  /* One at a time: forty writes fired at once is forty open file handles, and
   * the status line is the only thing telling anyone this is still going. */
  function run(dir, list, onEach) {
    let i = 0;
    const next = function () {
      if (i >= list.length) return Promise.resolve(i);
      const it = list[i++];
      const done = dir ? writeTo(dir, it) : Promise.resolve(download(it));
      return done.then(function () {
        if (onEach) onEach(i, list.length, it);
        return next();
      }).catch(function (e) {
        /* Carry how far it got, so the failure can say it. */
        e.wrote = i - 1;
        throw e;
      });
    };
    return next();
  }

  /* ---------------------------------------------------------------- panel */

  let root = null, bodyEl = null, footEl = null, statusEl = null;

  function open() {
    if (root) { render(); return; }
    root = SB.el('div', 'lib-back');
    const box = SB.el('div', 'lib ex-lib');
    const head = SB.el('header', 'lib-head');
    const h = SB.el('div', 'pt-hrow');
    h.appendChild(SB.el('h2', null, 'Export'));
    h.appendChild(SB.el('span', 'spacer'));
    const x = SB.el('button', 'tb lib-x', '✕');
    x.title = 'Close (Esc)';
    x.onclick = close;
    h.appendChild(x);
    head.appendChild(h);
    box.appendChild(head);
    bodyEl = SB.el('section', 'ex-body');
    box.appendChild(bodyEl);
    footEl = SB.el('footer', 'ex-foot');
    box.appendChild(footEl);
    root.appendChild(box);
    root.addEventListener('mousedown', function (ev) { if (ev.target === root) close(); });
    document.addEventListener('keydown', onKey);
    document.getElementById('modalRoot').appendChild(root);
    const btn = document.getElementById('btnExport');
    if (btn) btn.classList.add('on');
    render();
  }

  function onKey(e) {
    if (e.key !== 'Escape' || !root) return;
    if (document.querySelector('.modal-back')) return;
    const backs = document.querySelectorAll('#modalRoot .lib-back');
    if (backs.length && backs[backs.length - 1] !== root) return;
    close();
  }

  function close() {
    if (!root) return;
    root.remove();
    root = null;
    bodyEl = footEl = statusEl = null;
    document.removeEventListener('keydown', onKey);
    const btn = document.getElementById('btnExport');
    if (btn) btn.classList.remove('on');
  }

  function toggle() { root ? close() : open(); }

  function check(key, label, hint, disabled) {
    const l = SB.el('label', 'pp-toggle ex-check' + (disabled ? ' off' : ''));
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.checked = !!opts[key];
    c.disabled = !!disabled;
    c.dataset.opt = key;
    c.onchange = function () { opts[key] = c.checked; render(); };
    l.appendChild(c);
    l.appendChild(document.createTextNode(' ' + label));
    if (hint) l.appendChild(SB.el('span', 'dim', ' — ' + hint));
    if (disabled) l.title = disabled;
    return l;
  }

  function radio(key, value, label, hint) {
    const l = SB.el('label', 'pp-toggle');
    const c = document.createElement('input');
    c.type = 'radio';
    c.name = 'ex-' + key;
    c.checked = opts[key] === value;
    c.onchange = function () { opts[key] = value; render(); };
    l.appendChild(c);
    l.appendChild(document.createTextNode(' ' + label));
    if (hint) l.appendChild(SB.el('span', 'dim', ' — ' + hint));
    return l;
  }

  function group(title, kids) {
    const g = SB.el('div', 'ex-group');
    g.appendChild(SB.el('div', 'ex-t', title));
    const b = SB.el('div', 'ex-opts');
    kids.forEach(function (k) { if (k) b.appendChild(k); });
    g.appendChild(b);
    return g;
  }

  function size(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  function render() {
    if (!root) return;
    const p = P();
    bodyEl.innerHTML = '';

    bodyEl.appendChild(group('what', [
      check('originals', 'full-size originals', 'what a model was fed'),
      check('clips', 'clips'),
      check('proxies', 'board copies', '854×480, what the cards draw'),
      check('refsets', 'reference sets, per shot', 'numbered in feed order',
        opts.madeOnly ? 'Reference sets are what goes IN to a shot, so they are not part of ' +
          '“made in here”.' : ''),
      check('shotlist', 'shot list', 'CSV: code, type, description, both prompts'),
      check('manifest', 'manifest', 'which model and prompt made each file')
    ]));

    bodyEl.appendChild(group('which shots', [
      radio('scope', 'board', 'the whole board'),
      radio('scope', 'scene', 'this scene'),
      radio('scope', 'selected', 'the shots I have selected'),
      SB.el('div', 'ex-rule'),
      check('madeOnly', 'only what was made in here',
        'skips anything dropped in from elsewhere')
    ]));

    bodyEl.appendChild(group('naming', [
      radio('naming', 'serial', '0007.webp', 'the serial — a clip sorts beside its frame'),
      radio('naming', 'code', '1C_0007.webp', 'the shot code first')
    ]));

    const sheet = SB.el('div', 'ex-group');
    sheet.appendChild(SB.el('div', 'ex-t', 'on paper'));
    const sb = SB.el('div', 'ex-opts');
    const pdf = SB.el('button', 'tb', 'Contact sheet (PDF)…');
    pdf.title = 'The print sheets, with their own layout options.';
    pdf.onclick = function () { close(); SB.ExportOptions.open(); };
    sb.appendChild(pdf);
    sheet.appendChild(sb);
    bodyEl.appendChild(sheet);

    drawFoot(plan(p, opts));
  }

  function drawFoot(pl) {
    footEl.innerHTML = '';
    const counts = {};
    pl.items.forEach(function (it) { counts[it.kind] = (counts[it.kind] || 0) + 1; });
    const parts = Object.keys(counts).map(function (k) {
      return counts[k] + ' ' + k + (counts[k] === 1 ? '' : 's');
    });
    const sum = SB.el('div', 'ex-sum',
      pl.items.length
        ? parts.join(' · ') + '  —  ' + size(pl.bytes)
        : 'nothing selected to write');
    footEl.appendChild(sum);

    if (pl.linkOnly) {
      const warn = SB.el('div', 'ex-warn');
      warn.appendChild(document.createTextNode(
        pl.linkOnly + (pl.linkOnly === 1 ? ' clip is' : ' clips are') +
        ' held as a link, not a file — and links expire. '));
      const grab = SB.el('button', 'mini', 'fetch ' +
        (pl.linkOnly === 1 ? 'it' : 'them') + ' now');
      grab.onclick = function () {
        grab.disabled = true;
        grab.textContent = 'fetching…';
        fetchLinkOnly().then(function (n) {
          SB.toast(n ? n + ' clip' + (n === 1 ? '' : 's') + ' brought into the board'
            : 'None of them could be fetched — the links have expired', !n);
          render();
        });
      };
      warn.appendChild(grab);
      footEl.appendChild(warn);
    }

    if (pl.missing) {
      footEl.appendChild(SB.el('div', 'ex-warn',
        pl.missing + (pl.missing === 1 ? ' frame has' : ' frames have') +
        ' no original in this file — they were filed when originals lived in a folder. ' +
        'Drop those pictures in again to bring the originals with them.'));
    }

    statusEl = SB.el('div', 'ex-status', '');
    footEl.appendChild(statusEl);

    const acts = SB.el('div', 'ex-acts');
    const dl = SB.el('button', 'tb', 'Download');
    dl.disabled = !pl.items.length;
    dl.title = 'One file at a time through the browser, into wherever downloads go.';
    dl.onclick = function () { go(null); };
    const pick = SB.el('button', 'tb on', 'Choose a folder…');
    pick.disabled = !pl.items.length || typeof window.showDirectoryPicker !== 'function';
    pick.title = 'Write them into a folder. The folder is used and forgotten — nothing about ' +
      'it is kept in the board.';
    pick.onclick = function () {
      window.showDirectoryPicker({ id: 'sb-export', mode: 'readwrite' })
        .then(function (dir) { go(dir); })
        .catch(function (e) {
          if (e && e.name === 'AbortError') return;
          SB.toast(e.message || String(e), true);
        });
    };
    acts.appendChild(dl);
    acts.appendChild(pick);
    footEl.appendChild(acts);
  }

  function fetchLinkOnly() {
    const p = P();
    const todo = [];
    rows(p, opts.scope).forEach(function (r) {
      if (r.shot.video && !r.shot.video.ref && r.shot.video.url) todo.push(r.shot);
    });
    let ok = 0;
    const next = function (i) {
      if (i >= todo.length) return Promise.resolve(ok);
      return SB.Imagine.fetchClip(todo[i])
        .then(function (did) { if (did) ok++; })
        .catch(function () { })
        .then(function () { return next(i + 1); });
    };
    return next(0);
  }

  let writing = false;

  function go(dir) {
    /* Two presses used to mean two complete exports — every file written
       twice, two "done" toasts, and in folder mode two writables open on the
       same handle. */
    if (writing) return;
    const pl = plan(P(), opts);
    if (!pl.items.length) return;
    writing = true;
    if (footEl) {
      footEl.querySelectorAll('.ex-acts .tb').forEach(function (b) { b.disabled = true; });
    }
    if (statusEl) statusEl.textContent = 'writing 1 of ' + pl.items.length + '…';
    run(dir, pl.items, function (n, total) {
      if (statusEl) {
        statusEl.textContent = n < total
          ? 'writing ' + (n + 1) + ' of ' + total + '…'
          : 'finishing…';
      }
    }).then(function (n) {
      writing = false;
      if (statusEl) statusEl.textContent = '';
      if (root) render();
      SB.toast(n + ' file' + (n === 1 ? '' : 's') + ' written' +
        (dir ? ' to ' + dir.name : '') + ' — ' + size(pl.bytes));
    }).catch(function (e) {
      writing = false;
      if (statusEl) statusEl.textContent = '';
      if (root) render();
      /* Say how far it got: the files already written are on disk and the
         next attempt will overwrite them, which is only safe to do knowingly. */
      SB.toast('Export stopped after ' + (e.wrote || 0) + ' of ' + pl.items.length +
        ': ' + (e.message || e), true);
    });
  }

  SB.ExportPanel = {
    open: open, close: close, toggle: toggle, isOpen: function () { return !!root; },
    /* the pure half, which is what the tests hold on to */
    plan: plan, csv: csv, manifest: manifest, opts: opts, nameFor: nameFor
  };

})(window.SB);
