/* reviewer.js — every take of a shot, judged at full size.
 *
 * The Viewer answers "show me this picture properly". A shot needs a second
 * question answered: "which of these do I keep?" — because rendering a shot
 * several times is the ordinary case, and the takes now survive it. So a
 * shot's frame opens this instead: the highlighted take full size on the
 * left, every take the card holds down the right, and the three verbs that
 * matter — use this one, delete it, make another.
 *
 * Both media, one window. A clip is the same question in a different file
 * format: the still and the clip both accumulate takes, and looking at the
 * takes of one in a full-screen column while the takes of the other were a
 * list of text rows in a small dialog was two answers to one question. The
 * shell below is shared; MODES holds everything the two do differently.
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

  function madeOf(rec) {
    const made = rec && rec.made;
    if (made) return made.model || made.slug || 'made here';
    return 'added from a file';
  }

  function save(p, name, src, file) {
    if (!src) return;
    const a = document.createElement('a');
    a.href = src;
    a.download = file || name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /* ---------------------------------------------------------------- modes */

  const MODES = {
    image: {
      title: 'Shot ',
      /* the takes, newest first: the one you just made is the one you came
         to compare */
      takes: function (p, sh) {
        const list = SB.Model.stillTakes(sh);
        list.sort(function (x, y) { return (y.at || 0) - (x.at || 0); });
        return list;
      },
      count: function (sh) { return SB.Model.stillTakeCount(sh); },
      thumb: function (p, t) {
        return t.image ? SB.Blobs.src(p, t.image)
          : (t.render ? SB.Renders.dataUrl(p, t.render) : '');
      },
      use: function (p, sh, t) { return SB.Model.useStillTake(sh, t.rec); },
      drop: function (p, sh, t) { SB.Model.dropStillTake(sh, t.chosen ? null : t.rec); },
      /* Choosing a different still changes the picture the clip animates and
         the picture the prompts were written about, so the written video
         prompt is out of date the moment the choice lands. */
      afterChoose: function (p, sh) {
        const vm = SB.Model.videoModel(p);
        const pr = vm && sh.prompts && sh.prompts[vm.id];
        if (pr && pr.videoPrompt) pr.stale = 'the frame changed';
      },
      stage: function (p, t, stage, cap) {
        const got = SB.Viewer.srcOf(p, { img: t.image, render: t.render });
        const img = document.createElement('img');
        img.src = got.src;
        stage.appendChild(img);
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
      },
      saveTake: function (p, sh, t, code) {
        const got = SB.Viewer.srcOf(p, { img: t.image, render: t.render });
        save(p, (SB.Renders.slug(code || 'shot') || 'shot') + '-take' + t.n +
          (got.full ? '.png' : '-board.jpg'), got.src, got.file);
      },
      makeLabel: function (sh) {
        return SB.Model.stillTakeCount(sh) ? '🖼️ render another take' : '🖼️ render it';
      },
      model: function (p) { return SB.Model.imageModel(p); },
      role: 'image',
      addLabel: '+ add a picture from file',
      addHint: 'A picture you already have becomes the new chosen take; what is here is kept.',
      add: function (p, sh) {
        return SB.pickImageFile().then(function (f) {
          if (!f) return null;
          return SB.Board.setImage(sh, f);
        });
      }
    },

    video: {
      title: 'Clip for shot ',
      takes: function (p, sh) {
        const list = SB.Model.takes(sh);
        list.reverse();                       // takes() is oldest-first
        return list;
      },
      count: function (sh) { return SB.Model.takeCount(sh); },
      thumb: function (p, t, sh) {
        /* The poster ImagineArt hands back. Where there is none, the card's
           own frame stands in — every take of a clip animates that frame, so
           it is the truthful placeholder rather than a decorative one. */
        if (t.rec && t.rec.thumb) return t.rec.thumb;
        if (sh && sh.image) return SB.Blobs.src(p, sh.image);
        if (sh && sh.render) return SB.Renders.dataUrl(p, sh.render);
        return '';
      },
      use: function (p, sh, t) { return SB.Model.useTake(sh, t.rec); },
      drop: function (p, sh, t) { SB.Clip.drop(p, sh, t.rec); },
      afterChoose: function () { },
      stage: function (p, t, stage, cap, sh) {
        const rec = t.rec;
        const src = rec.ref ? SB.Renders.dataUrl(p, rec) : (rec.url || '');
        if (src) {
          const v = document.createElement('video');
          v.src = src;
          v.controls = true;
          v.autoplay = true;
          v.loop = true;
          stage.appendChild(v);
        } else {
          stage.appendChild(SB.el('div', 'rev-gone',
            'This board has no copy of that clip and its link has gone.'));
        }
        const bits = ['take ' + t.n + (t.chosen ? ' — chosen' : '')];
        const lbl = SB.Clip.label(rec);
        if (lbl) bits.push(lbl);
        if (rec.serial) bits.push(SB.Renders.fileName(rec.serial, rec.ext));
        if (!rec.ref && rec.url) {
          bits.push('played from ImagineArt — this board has no copy, and that link expires');
        }
        cap.textContent = bits.join(' · ');
        stage.classList.toggle('is-proxy', !rec.ref);
      },
      saveTake: function (p, sh, t, code) {
        const rec = t.rec;
        if (!rec.ref) { SB.toast('That take is a link, not a file in this board', true); return; }
        save(p, (SB.Renders.slug(code || 'shot') || 'shot') + '-take' + t.n + '.' +
          (rec.ext || 'mp4'), SB.Renders.dataUrl(p, rec),
          SB.Renders.fileName(rec.serial, rec.ext));
      },
      makeLabel: function (sh) {
        return SB.Model.takeCount(sh) ? '📽️ shoot another take' : '📽️ shoot it';
      },
      model: function (p) { return SB.Model.videoModel(p); },
      role: 'video',
      addLabel: '+ add a clip from file',
      addHint: 'A clip you already have becomes the new chosen take; what is here is kept.',
      add: function (p, sh) {
        return SB.pickVideoFile().then(function (f) {
          if (!f) return null;
          return SB.Clip.attach(p, sh, f);
        });
      }
    }
  };

  /* ----------------------------------------------------------- the window */

  function open(p, sh, kind) {
    const M = MODES[kind === 'video' ? 'video' : 'image'];
    const takes = M.takes(p, sh);
    if (!takes.length && kind !== 'video') return null;

    /* the chosen one first on screen — it is what the board is showing */
    let cur = takes.map(function (t) { return t.chosen; }).indexOf(true);
    if (cur < 0) cur = 0;

    const wrap = SB.el('div', 'reviewer');

    const stage = SB.el('div', 'rev-stage');
    const cap = SB.el('div', 'viewer-cap');
    const left = SB.el('div', 'rev-left');
    left.appendChild(stage);
    left.appendChild(cap);
    wrap.appendChild(left);

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

    /* Silence whatever is on the stage before anything replaces or removes
     * it. A media element that is merely detached keeps playing — and with
     * loop set there is no end for it to stop at — so the sound of a clip
     * outlived the window it was in, and came back over the next one. */
    const hush = function () {
      const media = stage.querySelectorAll('video, audio');
      Array.prototype.forEach.call(media, function (el) {
        try {
          el.pause();
          el.removeAttribute('src');
          el.srcObject = null;
          el.load();                     // drops the decoder, not just the tag
        } catch (e) { /* already gone */ }
      });
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
      title: M.title + codeOf() + (sh.type ? ' · ' + sh.type : ''),
      width: 'min(96vw, 1400px)',
      body: wrap,
      buttons: [{ label: 'Close', primary: true }],
      /* Escape, the backdrop and the Close button all arrive here, which is
         why the silencing belongs at this one point rather than on a button. */
      onClose: function () {
        document.removeEventListener('keydown', onKey);
        hush();
      }
    });
    m.root.classList.add('rev-back');
    document.addEventListener('keydown', onKey);

    /* Opening a clip is watching it. Shooting a dozen means coming back to a
       board where every row looks the same, so a clip arrives marked and this
       is where the mark comes off. */
    if (kind === 'video' && sh.video && sh.video.unseen) {
      delete sh.video.unseen;
      SB.Store.touch();
      if (SB.Imagine && SB.Imagine.notifyChange) SB.Imagine.notifyChange();
    }

    function move(by) {
      const list = M.takes(p, sh);
      if (!list.length) return;
      cur = SB.clamp(cur + by, 0, list.length - 1);
      paint();
    }

    function row(t, i, count) {
      const r = SB.el('div', 'rev-take' + (i === cur ? ' cur' : '') + (t.chosen ? ' on' : ''));
      r.addEventListener('click', function () { cur = i; paint(); });

      const th = SB.el('span', 'rev-thumb');
      const src = M.thumb(p, t, sh);
      if (src) {
        const ti = document.createElement('img');
        ti.src = src;
        th.appendChild(ti);
      } else {
        th.classList.add('none');
        th.textContent = kind === 'video' ? '▷' : '?';
      }
      r.appendChild(th);

      const meta = SB.el('div', 'rev-meta');
      meta.appendChild(SB.el('div', 'rev-n', 'take ' + t.n + (t.chosen ? ' · chosen' : '')));
      const at = t.at || (t.rec && t.rec.at) || 0;
      meta.appendChild(SB.el('div', 'rev-what', madeOf(t.rec || t) + ' · ' + fmtWhen(at)));
      r.appendChild(meta);

      const btns = SB.el('div', 'rev-btns');
      if (!t.chosen) {
        const use = SB.el('button', 'mini primary', 'use this one');
        use.title = kind === 'video'
          ? 'Make this the take the board shows and the export picks.'
          : 'Make this the take the board shows, the exports pick, and the clip animates.';
        use.onclick = function (ev) {
          ev.stopPropagation();
          M.use(p, sh, t);
          M.afterChoose(p, sh);
          SB.app.changed(true);
          SB.toast('Take ' + t.n + ' is the one on ' + (codeOf() || 'the card'));
          paint();
        };
        btns.appendChild(use);
      }
      /* The one way a take could leave this app: an export writes the chosen
         one only, so a kept take was weight with no way out. */
      const dl = SB.el('button', 'mini', '⤓');
      dl.title = 'Save this take to a file';
      dl.onclick = function (ev) {
        ev.stopPropagation();
        M.saveTake(p, sh, t, codeOf());
      };
      btns.appendChild(dl);

      const del = SB.el('button', 'mini danger', '✕');
      del.title = t.chosen
        ? 'Delete this take. The newest of the rest steps up' +
          (count === 1 ? ' — it is the last, so the card goes empty.' : '.')
        : 'Delete this take. The bytes go with it.';
      SB.armButton(del, 'delete take ' + t.n + '?', function () {
        const wasChosen = t.chosen;
        M.drop(p, sh, t);
        if (wasChosen) M.afterChoose(p, sh);
        SB.app.changed(true);
        SB.toast('Take ' + t.n + ' deleted' +
          (wasChosen && count > 1 ? ' — the newest of the rest is chosen now' : ''));
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
      const mdl = M.model(p);

      const again = SB.el('button', 'tb', M.makeLabel(sh));
      const why = IM && IM.whyNot ? IM.whyNot(p, sh, mdl, M.role) : null;
      const busy = IM && IM.busy && IM.busy(sh.id, M.role);
      again.disabled = !!why || !!busy || !IM;
      again.title = why ? why.long
        : busy ? 'ImagineArt is already working on this one.'
          : 'Send the ' + (M.role === 'image' ? 'first-frame' : 'video') + ' prompt to ' +
            (mdl && mdl.name) + '. What is here is kept as another take.';
      again.onclick = function () {
        const go = function () {
          again.disabled = true;
          again.textContent = 'sending…';
          IM.run(sh, M.role).then(function () {
            SB.toast('New take is on ' + (codeOf() || 'the card'));
            cur = 0;
            paint();
          }).catch(function (e) {
            SB.toast(e.message, true);
            paint();
          });
        };
        /* A clip costs enough to be worth asking about once per session —
           the same gate the push button goes through. */
        if (M.role === 'video' && SB.Clip && SB.Clip.confirmCost) {
          SB.Clip.confirmCost(p, sh, mdl, go);
          return;
        }
        go();
      };
      acts.appendChild(again);

      const add = SB.el('button', 'tb', M.addLabel);
      add.title = M.addHint;
      add.onclick = function () {
        Promise.resolve(M.add(p, sh)).then(function (r) {
          if (!r) return;
          cur = 0;
          paint();
        }).catch(function (e) { SB.toast(e.message, true); });
      };
      acts.appendChild(add);

      /* A clip whose bytes never arrived is a link, and links expire. */
      const chosen = kind === 'video' ? sh.video : null;
      if (chosen && !chosen.ref && chosen.url && SB.Imagine && SB.Imagine.fetchClip) {
        const grab = SB.el('button', 'tb', 'bring it into the board');
        grab.title = 'ImagineArt still has this one. Fetch the bytes before the link expires.';
        grab.onclick = function () {
          grab.disabled = true;
          grab.textContent = 'fetching…';
          SB.Imagine.fetchClip(sh).then(function (ok) {
            SB.toast(ok ? 'Clip is in the board now' : 'Nothing to fetch');
            paint();
          }).catch(function (e) {
            SB.toast(e.message, true);
            paint();
          });
        };
        acts.appendChild(grab);
      }

      /* what made the one on screen, and the words it was made from */
      const list = M.takes(p, sh);
      const t = list[SB.clamp(cur, 0, Math.max(0, list.length - 1))];
      if (t && SB.Imagine) {
        if (SB.Imagine.describeMade) {
          const note = SB.Imagine.describeMade(p, sh, t.rec || { made: t.render && t.render.made });
          if (note) acts.appendChild(SB.el('div', 'pp-note', note));
        }
        if (SB.Imagine.promptFor) {
          const words = SB.Imagine.promptFor(p, sh, (t.rec || t.render || {}).made);
          if (words) {
            const q = SB.el('div', 'clip-prompt', '“' + words + '”');
            q.title = 'The prompt on this card now — it may have been edited since.';
            acts.appendChild(q);
          }
        }
      }
    }

    function empty() {
      listEl.innerHTML = '';
      hush();
      stage.innerHTML = '';
      stage.appendChild(SB.el('div', 'rev-gone', kind === 'video'
        ? 'No clip on this card yet. Shoot one, or add a file you already have — dropping ' +
          'an mp4 straight onto the card does the same thing.'
        : 'No picture on this card yet.'));
      cap.textContent = '';
      actions();
    }

    function paint() {
      /* The card can go while this is open — deleted from the board behind
         it. Writing to a shot the document no longer holds looks like it
         worked and saves nothing. */
      if (!SB.Model.findShot(p, sh.id)) { m.close(); return; }
      const list = M.takes(p, sh);
      if (!list.length) {
        /* A clip window opens on a card with no clip — that is where you go
           to shoot one. A picture window has nothing to be. */
        if (kind === 'video') { empty(); return; }
        m.close();
        return;
      }
      cur = SB.clamp(cur, 0, list.length - 1);
      listEl.innerHTML = '';
      list.forEach(function (t, i) { listEl.appendChild(row(t, i, list.length)); });
      hush();
      stage.innerHTML = '';
      M.stage(p, list[cur], stage, cap, sh);
      actions();
    }

    paint();
    return m;
  }

  SB.Reviewer = {
    open: function (p, sh) { return open(p, sh, 'image'); },
    openClip: function (p, sh) { return open(p, sh, 'video'); }
  };

})(window.SB);
