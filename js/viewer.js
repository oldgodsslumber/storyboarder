/* viewer.js — a picture, big enough to judge.
 *
 * Four places on the board show a picture small and used to open a FILE
 * PICKER when you clicked it: the card's frame, a subject's reference frame,
 * and the thumbnails beside them. Clicking a picture you wanted a better look
 * at replaced it instead, which is a bad trade at 480p and a worse one on a
 * reference frame that is the only copy of somebody's face.
 *
 * So a click opens this, and a picture changes only when you say so: drop a
 * file on it, press Remove, or press Replace in here. An EMPTY frame still
 * opens the picker, because there is nothing to look at and "click to load"
 * is the only affordance it has.
 *
 * What it shows is the FULL-SIZE ORIGINAL where the file holds one and the
 * board's 854x480 copy where it does not — and it says which, because "this
 * looks soft" and "this IS soft" are different problems and the answer is not
 * otherwise anywhere on screen.
 */
(function (SB) {
  'use strict';

  /* One entry: { img, render, label, note } — `img` is the {ref,w,h} the board
   * draws, `render` the full-size record if the file carries one. */
  function srcOf(p, it) {
    const full = it.render ? SB.Renders.dataUrl(p, it.render) : '';
    if (full) {
      return {
        src: full, full: true,
        file: SB.Renders.fileName(it.render.serial, it.render.ext),
        bytes: it.render.bytes || 0
      };
    }
    return { src: it.img ? SB.Blobs.src(p, it.img) : '', full: false };
  }

  function sizeNote(p, it, got, img) {
    const bits = [];
    if (img && img.naturalWidth) bits.push(img.naturalWidth + '×' + img.naturalHeight);
    else if (it.img && it.img.w) bits.push(it.img.w + '×' + it.img.h);
    if (got.full) {
      bits.push('full-size original');
      if (got.file) bits.push(got.file);
      if (got.bytes) bits.push(Math.round(got.bytes / 1024) + ' KB');
    } else {
      /* Said plainly: a board copy is what gets fed to a model when no
         original is held, and that is worth knowing before judging a face. */
      bits.push('the board’s own copy — no full-size original in this file');
    }
    return bits.join(' · ');
  }

  /* items: [{img, render, label, note, onReplace, onRemove}], at: which one */
  function open(p, items, at, opts) {
    const list = (items || []).filter(function (x) { return x && (x.img || x.render); });
    if (!list.length) return null;
    opts = opts || {};
    let i = SB.clamp(at | 0, 0, list.length - 1);

    const stage = SB.el('div', 'viewer');
    const shot = SB.el('div', 'viewer-shot');
    const img = document.createElement('img');
    shot.appendChild(img);
    stage.appendChild(shot);
    const cap = SB.el('div', 'viewer-cap');
    stage.appendChild(cap);

    const onKey = function (e) {
      if (e.key === 'ArrowLeft') { step(-1); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { step(1); e.preventDefault(); }
    };

    const m = SB.modal({
      title: opts.title || 'Picture', width: '820px', body: stage,
      buttons: buttons(),
      /* every way out runs this: Escape, the backdrop, and each button */
      onClose: function () { document.removeEventListener('keydown', onKey); }
    });
    document.addEventListener('keydown', onKey);

    function buttons() {
      const out = [];
      const it = list[i];
      if (it.onReplace) {
        out.push({
          label: 'Replace…',
          onClick: function (close) {
            SB.pickImageFile().then(function (f) {
              if (!f) return;
              close();
              it.onReplace(f);
            });
          }
        });
      }
      if (it.onRemove) {
        out.push({
          label: 'Remove',
          onClick: function (close) { close(); it.onRemove(); }
        });
      }
      out.push({
        label: 'Save a copy',
        onClick: function () {
          const got = srcOf(p, list[i]);
          if (!got.src) return;
          const a = document.createElement('a');
          a.href = got.src;
          a.download = got.file ||
            ((SB.Renders.slug(list[i].label) || 'picture') + (got.full ? '.png' : '-board.jpg'));
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
      });
      out.push({ label: 'Close', primary: true });
      return out;
    }

    function draw() {
      const it = list[i];
      const got = srcOf(p, it);
      img.src = got.src;
      img.onload = function () { cap.textContent = line(got, img); };
      cap.textContent = line(got, null);
      stage.classList.toggle('is-proxy', !got.full);
    }

    function line(got, el) {
      const it = list[i];
      const who = it.label || '';
      const where = list.length > 1 ? '  (' + (i + 1) + ' of ' + list.length + ')' : '';
      return (who ? who + ' — ' : '') + sizeNote(p, it, got, el) +
        (it.note ? ' · ' + it.note : '') + where;
    }

    /* ← → across the other pictures on the same card or the same subject.
     * The buttons belong to the picture on screen, so they are rebuilt with
     * it rather than closed over the one it opened on. */
    function step(by) {
      if (list.length < 2) return;
      i = (i + by + list.length) % list.length;
      draw();
      const foot = m.root.querySelector('.foot');
      if (foot) {
        foot.innerHTML = '';
        buttons().forEach(function (b) {
          const btn = SB.el('button', 'tb' + (b.primary ? ' on' : ''), b.label);
          btn.onclick = function () {
            if (b.onClick) b.onClick(m.close, m.body); else m.close();
          };
          foot.appendChild(btn);
        });
      }
    }

    if (list.length > 1) {
      const prev = SB.el('button', 'viewer-step prev', '‹');
      const next = SB.el('button', 'viewer-step next', '›');
      prev.onclick = function () { step(-1); };
      next.onclick = function () { step(1); };
      shot.appendChild(prev);
      shot.appendChild(next);
    }

    draw();
    return m;
  }

  SB.Viewer = { open: open, srcOf: srcOf };

})(window.SB);
