/* framepicker.js — choose the frame a clip boards with.
 *
 * Automatic frame choice cannot win this. A scout clip off a director's
 * viewfinder opens on a wall while the operator raises the phone, reveals the
 * shot somewhere in the middle, and ends on the app's own slate card — so the
 * first frame is a wall, the last is a slate, and a third of a second in,
 * which is what the drop used to take, is still the wall. Every rule for
 * picking one is wrong on some clip, and the person who shot it knows which
 * frame is the shot.
 *
 * So: show them the clip and let them say. A strip of thumbnails across the
 * whole length to find the moment, a scrubber to land on the exact frame, and
 * one button that puts it on the card.
 *
 * The frame it takes is the one showing, at full resolution — not the
 * thumbnail, which is a 96px proxy for choosing with.
 */
(function (SB) {
  'use strict';

  const STRIP = 12;          /* thumbnails across the clip */
  const NUDGE = 1 / 30;      /* arrow keys: one frame at 30fps, near enough */

  function madeFor(rec) {
    /* A frame off a Getty comp is the comp's pixels, so it carries the comp's
       licence -- setImage files it against the picture, and losing that here
       would be the hole the Getty work spent a day closing. Own footage keeps
       its own provenance; anything else is left to say what it already says. */
    if (rec && rec.made) return rec.made;
    return { by: 'scout', name: (rec && rec.name) || '', at: Date.now() };
  }

  function open(p, shot) {
    const rec = shot && shot.video;
    if (!rec) {
      SB.toast('That card has no clip to take a frame from.', true);
      return;
    }

    const box = SB.el('div', 'fp');
    const stage = SB.el('div', 'fp-stage');
    const v = document.createElement('video');
    v.controls = true;
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    stage.appendChild(v);
    box.appendChild(stage);

    const at = SB.el('div', 'fp-at', 'loading the clip…');
    box.appendChild(at);

    const strip = SB.el('div', 'fp-strip');
    box.appendChild(strip);

    const note = SB.el('div', 'pp-note',
      'Click a thumbnail to jump there, then scrub or use ← → to land on the exact ' +
      'frame. What is showing is what goes on the card, at full size.');
    box.appendChild(note);

    let url = '';
    let ready = false;

    const say = function () {
      if (!ready) return;
      const d = isFinite(v.duration) ? v.duration : 0;
      at.textContent = v.currentTime.toFixed(2) + 's' + (d ? ' of ' + d.toFixed(2) + 's' : '') +
        (v.videoWidth ? '  ·  ' + v.videoWidth + '×' + v.videoHeight : '');
      const atT = v.currentTime;
      Array.prototype.forEach.call(strip.children, function (b) {
        b.classList.toggle('on', Math.abs(Number(b.dataset.t) - atT) < 0.35);
      });
    };
    v.addEventListener('timeupdate', say);
    v.addEventListener('seeked', say);
    v.addEventListener('loadeddata', function () {
      ready = true;
      say();
      buildStrip();
    });
    v.addEventListener('error', function () {
      at.textContent = 'This clip will not play here.';
      note.textContent = 'If it came off an iPhone it is probably HEVC — Settings → Camera → ' +
        'Formats → Most Compatible records H.264 instead, which every browser can read.';
    });

    function buildStrip() {
      const d = isFinite(v.duration) ? v.duration : 0;
      if (!d) return;
      const times = [];
      for (let i = 0; i < STRIP; i++) {
        /* spread across the whole clip, including the ends: a slate at the
           back is worth SEEING so it can be avoided, and on some clips the
           opening frame really is the shot */
        times.push(Math.min(d - 0.01, Math.max(0, d * (i + 0.5) / STRIP)));
      }
      times.forEach(function (t) {
        const b = SB.el('button', 'fp-thumb');
        b.dataset.t = String(t);
        b.title = t.toFixed(2) + 's';
        b.appendChild(SB.el('span', 'fp-t', t.toFixed(1) + 's'));
        b.onclick = function () {
          v.pause();
          v.currentTime = t;
          /* Mark it now rather than when the decoder reports back: the click
             is the answer to "which one am I on", and waiting on a seek to
             say so reads as the click not having registered. */
          say();
        };
        strip.appendChild(b);
      });
      SB.scanFrames(blob, times, function (t, data, i) {
        const b = strip.children[i];
        if (!b) return;
        const im = document.createElement('img');
        im.src = data;
        b.insertBefore(im, b.firstChild);
      }).catch(function () {
        /* the strip is a convenience; the scrubber is the feature */
        strip.classList.add('fp-strip-failed');
      });
    }

    let blob = null;
    const m = SB.modal({
      title: 'Pick the frame',
      width: 'min(94vw, 980px)',
      body: box,
      buttons: [
        {
          label: 'Use this frame', primary: true,
          onClick: function (close) {
            let data = '';
            try { data = SB.frameAtPlayhead(v); } catch (e) { data = ''; }
            if (!data) {
              SB.toast('There is no frame behind that yet — let the clip load a moment.', true);
              return;
            }
            close();
            SB.Board.setImage(shot, data, madeFor(rec)).then(function () {
              const f = SB.Model.findShot(SB.app.project, shot.id);
              SB.toast('Frame at ' + v.currentTime.toFixed(2) + 's is on ' +
                ((f && f.code) || 'the card'));
            }).catch(function (e) {
              SB.toast('That frame could not be placed: ' + (e.message || e), true);
            });
          }
        },
        { label: 'Cancel' }
      ],
      onClose: function () {
        try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) { }
        if (url) { try { URL.revokeObjectURL(url); } catch (e) { } }
        window.removeEventListener('keydown', onKey);
      }
    });

    function onKey(ev) {
      if (!ready) return;
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
        ev.preventDefault();
        v.pause();
        const d = isFinite(v.duration) ? v.duration : 0;
        const step = ev.shiftKey ? NUDGE * 10 : NUDGE;
        v.currentTime = Math.max(0, Math.min(d ? d - 0.01 : 1e9,
          v.currentTime + (ev.key === 'ArrowLeft' ? -step : step)));
      }
    }
    window.addEventListener('keydown', onKey);

    /* The bytes, as a blob and never as the data: URL they are stored in --
       Chrome refuses a data: URL whose declared type it does not claim to
       support, and it does not claim video/quicktime, so a .mov would not
       play here at all. Given a blob it sniffs the container instead. */
    SB.Renders.videoFile(p, rec).then(function (b) {
      if (!b) {
        if (rec.url) { v.src = rec.url; return; }
        at.textContent = 'This board has no copy of that clip.';
        return;
      }
      blob = b;
      url = URL.createObjectURL(b);
      v.src = url;
      v.load();
    }).catch(function (e) {
      at.textContent = 'That clip could not be read: ' + (e.message || e);
    });

    return m;
  }

  SB.FramePicker = { open: open };

})(window.SB);
