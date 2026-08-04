/* comments.js — comment mode: per-shot comment list + transparent-PNG ink layer.
 * Comments and ink belong to the CURRENT version and are frozen into a version
 * when a new one is created (see versions.js).
 */
(function (SB) {
  'use strict';

  function P() { return SB.app.project; }

  function list(sh) {
    const wrap = SB.el('div', 'comments');
    (sh.comments || []).forEach(function (cm) {
      const row = SB.el('div', 'comment');
      row.appendChild(SB.el('span', 'when', new Date(cm.at).toLocaleDateString(undefined,
        { month: 'short', day: 'numeric' })));
      row.appendChild(SB.el('span', 'txt', cm.text));
      const d = SB.el('button', 'del', '✕');
      d.onclick = function () {
        sh.comments = sh.comments.filter(function (x) { return x.id !== cm.id; });
        SB.app.changed(true);
      };
      row.appendChild(d);
      wrap.appendChild(row);
    });

    if (SB.app.commentMode) {
      const add = SB.el('div', 'comment-add');
      const inp = document.createElement('input');
      inp.placeholder = 'Add a comment…';
      const b = SB.el('button', 'mini primary', 'Add');
      function submit() {
        const t = inp.value.trim();
        if (!t) return;
        sh.comments.push({ id: SB.uid('cm'), text: t, at: Date.now() });
        inp.value = '';
        SB.app.changed(true);
      }
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      b.onclick = submit;
      add.appendChild(inp); add.appendChild(b);
      wrap.appendChild(add);
    }
    return wrap;
  }

  /* ---------- ink ---------- */

  function draw(sh) {
    if (!sh.image) { SB.toast('Load an image first', true); return; }

    const body = SB.el('div');
    const wrap = SB.el('div', 'draw-wrap');
    const img = document.createElement('img');
    img.src = SB.Blobs.src(P(), sh.image);
    const cv = document.createElement('canvas');
    cv.width = sh.image.w; cv.height = sh.image.h;
    wrap.appendChild(img); wrap.appendChild(cv);
    body.appendChild(wrap);

    const tools = SB.el('div', 'draw-tools');
    const COLORS = ['#ff3b30', '#ffd60a', '#32d74b', '#0a84ff', '#ffffff', '#000000'];
    let color = COLORS[0], size = 4, erase = false;
    COLORS.forEach(function (c, i) {
      const sw = SB.el('button', 'sw' + (i === 0 ? ' on' : ''));
      sw.style.background = c;
      sw.onclick = function () {
        color = c; erase = false;
        tools.querySelectorAll('.sw').forEach(function (x) { x.classList.remove('on'); });
        sw.classList.add('on');
        eraseBtn.classList.remove('on');
      };
      tools.appendChild(sw);
    });
    const rng = document.createElement('input');
    rng.type = 'range'; rng.min = 1; rng.max = 20; rng.value = size; rng.style.width = '90px';
    rng.oninput = function () { size = +rng.value; };
    tools.appendChild(rng);
    const eraseBtn = SB.el('button', 'tb', 'Erase');
    eraseBtn.onclick = function () {
      erase = !erase;
      eraseBtn.classList.toggle('on', erase);
    };
    tools.appendChild(eraseBtn);
    const clr = SB.el('button', 'tb', 'Clear');
    clr.onclick = function () { ctx.clearRect(0, 0, cv.width, cv.height); };
    tools.appendChild(clr);
    body.appendChild(tools);

    const ctx = cv.getContext('2d');
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    if (sh.annotation) {
      const prev = new Image();
      prev.onload = function () { ctx.drawImage(prev, 0, 0, cv.width, cv.height); };
      prev.src = SB.Blobs.src(P(), sh.annotation);
    }

    let drawing = false, last = null;
    function pos(ev) {
      const r = cv.getBoundingClientRect();
      return {
        x: (ev.clientX - r.left) * (cv.width / r.width),
        y: (ev.clientY - r.top) * (cv.height / r.height)
      };
    }
    cv.addEventListener('pointerdown', function (ev) {
      cv.setPointerCapture(ev.pointerId);
      drawing = true; last = pos(ev);
      stroke(last, last);
    });
    cv.addEventListener('pointermove', function (ev) {
      if (!drawing) return;
      const p = pos(ev);
      stroke(last, p);
      last = p;
    });
    cv.addEventListener('pointerup', function () { drawing = false; });
    cv.addEventListener('pointerleave', function () { drawing = false; });

    function stroke(a, b) {
      ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
      ctx.strokeStyle = color;
      ctx.lineWidth = erase ? size * 2.5 : size;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    SB.modal({
      title: 'Draw over frame',
      body: body,
      buttons: [
        { label: 'Cancel' },
        {
          label: 'Save ink', primary: true, onClick: function (close) {
            const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
            let any = false;
            for (let i = 3; i < data.length; i += 4) { if (data[i] !== 0) { any = true; break; } }
            sh.annotation = any
              ? { ref: SB.Blobs.put(P(), cv.toDataURL('image/png')) }
              : null;
            close();
            SB.app.changed(true);
          }
        }
      ]
    });
  }

  SB.Comments = { list: list, draw: draw };

})(window.SB);
