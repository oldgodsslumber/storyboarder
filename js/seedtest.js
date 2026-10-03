/* seedtest.js — the Seedance reference-mode experiments (clay_reference_prompting_plan.md, E1–E3).
 *
 * Run from the user's own browser, through their own ImagineArt sign-in: nothing here holds a
 * credential. For one card with a performance clip (and, for E2, a still), three pushes:
 *
 *   E1  the clay clip alone, as @Video1                      — do video_url and @-tags get through?
 *   E2  the still as @Image1 (opening frame) + @Video1       — is the opening frame honoured?
 *   E3  a person's reference photo as @Image1 + @Video1      — are real faces refused?
 *
 * Each clip lands on the card as a take (review them in the Reviewer), and every request and answer
 * is logged, for copying back into the plan. Temporary: it goes once reference mode is built.
 */
(function (SB) {
  'use strict';

  function P() { return SB.app.project; }
  function tidy(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

  /* what the tests say about the shot, in the phrasing the research recommends */
  function roles(p, shot, opening, face) {
    const cast = (shot.pose && shot.pose.cast) || [];
    const who = cast.map(function (c) {
      const per = (p.personas || []).filter(function (x) { return x.id === c.personaId; })[0];
      return 'the ' + (c.colorName || 'grey') + ' figure in @Video1 is ' + ((per && per.name) || c.name || 'a person');
    });
    const act = tidy([shot.description, shot.videoDescription].filter(Boolean).map(function (t) {
      return SB.Refs.plain(p, t);
    }).join(' '));
    const lines = ['@Video1 is a grey clay blocking animation of this shot. Copy ONLY its camera path, timing, ' +
      'where each person is and how their body moves. Do not copy its grey material, mannequin figures, floor, ' +
      'grid or lighting.'];
    if (opening) lines.push('@Image1 is the opening frame: the shot starts exactly as it looks.');
    if (face) lines.push('@Image1 shows ' + face + '’s appearance: face, hair, skin tone and build.');
    if (who.length) lines.push(who.join('; ').replace(/^t/, 'T') + '.');
    if (act) lines.push(act);
    lines.push('Photorealistic, natural light. One continuous take.');
    return lines.join(' ');
  }

  function blobOf(u) { return u ? SB.Imagine._dataUrlToBlob(u) : Promise.resolve(null); }

  function run(shot) {
    const p = P();
    const f = SB.Model.findShot(p, shot.id);
    const code = f ? f.code : 'card';
    const L = SB.Pose && SB.Pose.perfLink(shot);
    const vm = SB.Model.videoModel(p);
    const boardSlug = vm ? SB.Imagine.slugOf(vm) : '';
    const slug = /^seedance-2/.test(boardSlug) ? boardSlug : 'seedance-2.5';
    const secs = L ? Math.max(4, Math.min(15, Math.round(L.out - L.in))) : 5;
    const still = SB.Renders.dataUrl(p, shot.render) || SB.Blobs.src(p, shot.image);
    const subj = SB.Refs.feed(p, shot, 'image').filter(function (e) { return e.kind === 'subject' && e.images.length; })[0];
    const facePic = subj ? (SB.Renders.dataUrl(p, subj.renders[0]) || SB.Blobs.src(p, subj.images[0])) : '';

    const body = SB.el('div');
    const log = SB.el('pre', 'seedtest-log');
    log.style.cssText = 'max-height:52vh;overflow:auto;white-space:pre-wrap;font-size:11.5px;margin:0';
    body.appendChild(log);
    const say = function (t) { log.textContent += t + '\n'; log.scrollTop = log.scrollHeight; };
    SB.modal({ title: 'Seedance reference tests — ' + code, width: '720px', body: body, buttons: [
      { label: 'Copy log', onClick: function () {
        try { navigator.clipboard.writeText(log.textContent); SB.toast('Log copied.'); } catch (e) { }
      } },
      { label: 'Close', primary: true }
    ] });
    say('Model ' + slug + ', ' + secs + ' s each, aspect ' + SB.Imagine.aspectFor(p, shot) +
      '. Card ' + code + '. ' + new Date().toISOString());
    if (!L) { say('✕ This card has no performance clip — cut it from a take in Pose Bench first.'); return; }
    say('Rendering the clay clip…');
    return SB.Pose.clip(shot).then(function (c) {
      say('  clay clip: ' + c.frames + ' frames, ' + c.W + '×' + c.H + ', ' + Math.round(c.blob.size / 1024) + ' KB (' + c.ext + ')');
      const clay = { blob: c.blob, name: 'clay.' + c.ext, label: 'the clay clip' };
      const tests = [
        { id: 'E1', what: 'clay clip only (@Video1)', prompt: roles(p, shot, false, null), frame: null },
        { id: 'E2', what: 'still as opening frame (@Image1) + clay clip', prompt: roles(p, shot, true, null), frame: still,
          skip: still ? '' : 'the card has no still' },
        { id: 'E3', what: 'a real person’s reference photo (@Image1) + clay clip', frame: facePic,
          prompt: roles(p, shot, false, subj ? subj.label : null), skip: facePic ? '' : 'nobody on the card has a reference picture' }
      ];
      let chain = Promise.resolve();
      tests.forEach(function (t) {
        chain = chain.then(function () {
          say('\n── ' + t.id + ': ' + t.what);
          if (t.skip) { say('  skipped: ' + t.skip); return; }
          say('  prompt: ' + t.prompt);
          const t0 = Date.now();
          return blobOf(t.frame).then(function (frame) {
            return SB.Imagine.video({
              prompt: t.prompt, slug: slug, aspect: SB.Imagine.aspectFor(p, shot),
              duration: secs, frame: frame || undefined, frameName: 'ref.png', videos: [clay],
              onArgs: function (a) {
                say('  sent: image_url ×' + ((a.image_url || []).length) + ', video_url ×' + ((a.video_url || []).length) +
                  ', model ' + a.model + ', duration ' + a.duration + ', aspect ' + a.aspect_ratio);
              },
              onState: function (st) { if (st === 'waiting') return; say('  ' + st + '…'); }
            });
          }).then(function (got) {
            say('  ✓ made in ' + Math.round((Date.now() - t0) / 1000) + ' s' + (got.url ? ' — ' + got.url : ''));
            const live = SB.Model.findShot(P(), shot.id);
            if (!live) return;
            return SB.Imagine._fileVideo(P(), live.shot, got, { by: 'imagine', role: 'video', model: slug,
              prompt: t.prompt, at: Date.now(), experiment: t.id });
          }).then(function () { say('  filed on ' + code + ' as a take.'); }, function (e) {
            say('  ✕ ' + t.id + ' failed after ' + Math.round((Date.now() - t0) / 1000) + ' s: ' + (e && e.message || e));
          });
        });
      });
      return chain.then(function () {
        say('\nDone. Open ' + code + '’s clips in the Reviewer to compare them with the clay clip, then press Copy log.');
      });
    }).catch(function (e) { say('✕ ' + (e && e.message || e)); });
  }

  SB.SeedTest = { run: run, prompt: roles };

})(window.SB);
