/* reviewer.js — every take of a shot, judged at full size.
 *
 * The Viewer answers "show me this picture properly". A shot needs a second
 * question answered: "which of these do I keep?" — because rendering a shot
 * several times is the ordinary case, and the takes now survive it. So a
 * shot's frame opens this instead: the highlighted take full size on the
 * left, every take the card holds down the right, and the three verbs that
 * matter — use this one, delete it, make another.
 *
 * The Viewer's contract carries over whole: a picture changes only on an
 * explicit act. Nothing in here swaps a picture as a side effect of looking.
 */
(function (SB) {
  'use strict';

  function fmtWhen(at) {
    if (!at) return 'undated';
    const d = new Date(at);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString().replace(/:\d\d(\s|$)/, '$1');
  }

  function madeLine(t) {
    const made = t.render && t.render.made;
    if (made) return made.model || made.slug || 'made here';
    return 'added from a file';
  }

  function open(p, sh) {
    const takes = SB.Model.stillTakes(sh);
    if (!takes.length) return null;

    /* the chosen one first on screen — it is what the board is showing */
    let cur = takes.map(function (t) { return t.chosen; }).indexOf(true);
    if (cur < 0) cur = takes.length - 1;

    const wrap = SB.el('div', 'reviewer');

    /* ---- left: the take, big enough to judge ---- */
    const stage = SB.el('div', 'rev-stage');
    const img = document.createElement('img');
    stage.appendChild(img);
    const cap = SB.el('div', 'viewer-cap');

    const left = SB.el('div', 'rev-left');
    left.appendChild(stage);
    left.appendChild(cap);
    wrap.appendChild(left);

    /* ---- right: the takes, and what can be done to them ---- */
    const col = SB.el('div', 'rev-col');
    const listEl = SB.el('div', 'rev-takes');
    col.appendChild(listEl);
    const acts = SB.el('div', 'rev-actions');
    col.appendChild(acts);
    wrap.appendChild(col);

    const codeOf = function () {
      const f = SB.Model.findShot(p, sh.id);
      return f ? f.code : '';
    };

    /* Choosing a different take changes the picture the clip animates and
     * the picture the prompts were written about — so the written video
     * prompt is out of date the moment the choice lands, and it says so
     * instead of quietly describing the wrong picture. */
    const staleVideo = function () {
      const vm = SB.Model.videoModel(p);
      const pr = vm && sh.prompts && sh.prompts[vm.id];
      if (pr && pr.videoPrompt) pr.stale = 'the frame changed';
    };

    const onKey = function (e) {
      if (!SB.isTopModal || !SB.isTopModal(m.root)) return;
      if (e.key === 'ArrowDown') { move(1); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { move(-1); e.preventDefault(); }
      else if (e.key === 'Enter') {
        const use = listEl.querySelector('.rev-take.cur button.primary');
        if (use) { use.click(); e.preventDefault(); }
      } else if (e.key === 'Delete') {
        const del = listEl.querySelector('.rev-take.cur button.danger');
        if (del) { del.click(); e.preventDefault(); }
      }
    };

    const m = SB.modal({
      title: 'Shot ' + codeOf() + (sh.type ? ' · ' + sh.type : ''),
      width: 'min(96vw, 1400px)',
      body: wrap,
      buttons: [{ label: 'Close', primary: true }],
      onClose: function () { document.removeEventListener('keydown', onKey); }
    });
    m.root.classList.add('rev-back');
    document.addEventListener('keydown', onKey);

    function move(by) {
      const list = SB.Model.stillTakes(sh);
      if (!list.length) return;
      cur = SB.clamp(cur + by, 0, list.length - 1);
      paint();
    }

    function drawStage(t) {
      const got = SB.Viewer.srcOf(p, { img: t.image, render: t.render });
      img.src = got.src;
      const line = function (el) {
        const bits = ['take ' + t.n + (t.chosen ? ' — chosen' : '')];
        if (el && el.naturalWidth) bits.push(el.naturalWidth + '×' + el.naturalHeight);
        else if (t.image && t.image.w) bits.push(t.image.w + '×' + t.image.h);
        if (got.full) {
          bits.push('full-size original');
          if (got.file) bits.push(got.file);
          if (got.bytes) bits.push(Math.round(got.bytes / 1024) + ' KB');
        } else {
          /* said plainly, same as the Viewer: a board copy is what a model
             would be fed, and that is worth knowing before judging a face */
          bits.push('the board’s own copy — no full-size original in this file');
        }
        cap.textContent = bits.join(' · ');
      };
      img.onload = function () { line(img); };
      line(null);
      stage.classList.toggle('is-proxy', !got.full);
    }

    function row(t, i, count) {
      const r = SB.el('div', 'rev-take' + (i === cur ? ' cur' : '') + (t.chosen ? ' on' : ''));
      r.addEventListener('click', function () { cur = i; paint(); });

      const th = SB.el('span', 'rev-thumb');
      const ti = document.createElement('img');
      ti.src = t.image ? SB.Blobs.src(p, t.image)
        : (t.render ? SB.Renders.dataUrl(p, t.render) : '');
      th.appendChild(ti);
      r.appendChild(th);

      const meta = SB.el('div', 'rev-meta');
      meta.appendChild(SB.el('div', 'rev-n', 'take ' + t.n +
        (t.chosen ? ' · chosen' : '')));
      meta.appendChild(SB.el('div', 'rev-what', madeLine(t) + ' · ' + fmtWhen(t.at)));
      r.appendChild(meta);

      const btns = SB.el('div', 'rev-btns');
      if (!t.chosen) {
        const use = SB.el('button', 'mini primary', 'use this one');
        use.title = 'Make this the take the board shows, the exports pick, and the clip animates.';
        use.onclick = function (ev) {
          ev.stopPropagation();
          SB.Model.useStillTake(sh, t.rec);
          staleVideo();
          SB.app.changed(true);
          SB.toast('Take ' + t.n + ' is the one on ' + (codeOf() || 'the card'));
          paint();
        };
        btns.appendChild(use);
      }
      const del = SB.el('button', 'mini danger', '✕');
      del.title = t.chosen
        ? 'Delete this take. The newest of the rest steps up' +
          (count === 1 ? ' — it is the last, so the card goes empty.' : '.')
        : 'Delete this take. The bytes go with it.';
      SB.armButton(del, 'delete take ' + t.n + '?', function () {
        SB.Model.dropStillTake(sh, t.chosen ? null : t.rec);
        if (t.chosen) staleVideo();
        SB.app.changed(true);
        SB.toast('Take ' + t.n + ' deleted' +
          (t.chosen && count > 1 ? ' — the newest of the rest is chosen now' : ''));
        if (SB.Model.stillTakeCount(sh) === 0) { m.close(); return; }
        cur = 0;
        paint();
      });
      del.addEventListener('click', function (ev) { ev.stopPropagation(); });
      btns.appendChild(del);
      r.appendChild(btns);
      return r;
    }

    function actions() {
      acts.innerHTML = '';
      const IM = SB.Imagine;
      const im = SB.Model.imageModel(p);

      const again = SB.el('button', 'tb',
        SB.Model.stillTakeCount(sh) ? '🖼️ render another take' : '🖼️ render it');
      const why = IM && IM.whyNot ? IM.whyNot(p, sh, im, 'image') : null;
      const busy = IM && IM.busy && IM.busy(sh.id, 'image');
      again.disabled = !!why || !!busy || !IM;
      again.title = why ? why.long
        : busy ? 'ImagineArt is already working on this one.'
          : 'Send the first-frame prompt to ' + (im && im.name) +
            '. What is here is kept as another take.';
      again.onclick = function () {
        again.disabled = true;
        again.textContent = 'sending…';
        IM.run(sh, 'image').then(function () {
          SB.toast('New take is on ' + (codeOf() || 'the card'));
          cur = 0;
          paint();
        }).catch(function (e) {
          SB.toast(e.message, true);
          paint();
        });
      };
      acts.appendChild(again);

      const add = SB.el('button', 'tb', '+ add from file');
      add.title = 'A picture you already have becomes the new chosen take; what is here is kept.';
      add.onclick = function () {
        SB.pickImageFile().then(function (f) {
          if (!f) return;
          return SB.Board.setImage(sh, f).then(function () {
            cur = 0;
            paint();
          });
        });
      };
      acts.appendChild(add);
    }

    function paint() {
      const list = SB.Model.stillTakes(sh);
      if (!list.length) { m.close(); return; }
      /* newest first down the column: the take you just made is the one you
         came to compare */
      list.sort(function (x, y) { return (y.at || 0) - (x.at || 0); });
      cur = SB.clamp(cur, 0, list.length - 1);
      listEl.innerHTML = '';
      list.forEach(function (t, i) { listEl.appendChild(row(t, i, list.length)); });
      drawStage(list[cur]);
      actions();
    }

    paint();
    return m;
  }

  SB.Reviewer = { open: open };

})(window.SB);
