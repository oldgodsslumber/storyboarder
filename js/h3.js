/* h3.js — the MiniMax H3 (Hailuo) full-reference prompt.
 *
 * H3 does not take a paragraph. Its published guide specifies a six-section
 * rewrite with its own label vocabulary, and the app used to hand all six to
 * the writer model along with 700 words teaching it that vocabulary — then
 * hoped the labels it invented happened to match the order the person drops
 * their files in.
 *
 * They didn't have to be hoped for. By the time a video prompt is written the
 * board already knows every recurring subject, in a fixed order, with the
 * description that is declared authoritative and the exact images that define
 * it. That is subject_definitions and retention_analysis outright — so this
 * module writes them, and the writer model is left with the two sections that
 * are actually prose.
 *
 * The soundscape sections are constants: these boards are silent.
 */
(function (SB) {
  'use strict';

  const NAME = 'MiniMax H3 (Hailuo)';

  /* A silent board. Both sound sections still have to be present and in order —
   * the format is fixed — so they are written, not generated. */
  const SOUNDSCAPE = 'N/A - the target video has no audio.';
  const MUSIC = 'N/A';

  const SECTIONS = ['subject_definitions', 'summary', 'retention_analysis',
    'detailed_description', 'overall_soundscape', 'non_diegetic_music'];

  /* The two sections the model is asked for. The others are known. */
  const WRITTEN = ['summary', 'detailed_description'];

  function isH3(m) { return !!m && m.name === NAME; }

  /* Scaffolding a template the user has rewritten would be answering a
   * question they did not ask: their template is theirs, and it may not be in
   * this format at all. An edited one falls back to the plain path. */
  function stock(m) {
    return isH3(m) && m.videoTemplate === SB.Model.tplsFor(NAME).video;
  }

  function tidy(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

  /* Strip a trailing full stop so a description can be sewn into a sentence. */
  function clause(s) { return tidy(s).replace(/[.\s]+$/, ''); }

  /* ---------------------------------------------------------------- labels
   *
   * <Picture 1> is the first frame when there is one, so the anchor the shot
   * actually begins from carries the number a reader expects. The reference
   * images keep the feed's order underneath it, shifted by one.
   */
  function pictures(p, shot) {
    const out = [];
    let n = 0;
    if (shot.image) {
      out.push({ n: ++n, kind: 'frame', label: 'the first frame of this shot', feedN: null });
    }
    SB.Refs.images(p, shot).forEach(function (e) {
      out.push({
        n: ++n, kind: e.kind, label: e.label, role: e.role || '',
        id: e.id, feedN: e.n
      });
    });
    return out;
  }

  /* Every subject that gets a <Subject N> line, in feed order, with the
   * pictures that define it. A subject with no picture is still a subject —
   * its description is the whole of what the model has to go on. */
  function subjects(p, shot) {
    const pics = pictures(p, shot);
    const out = [];
    SB.Refs.feed(p, shot).forEach(function (e) {
      if (e.kind !== 'subject') return;
      const mine = pics.filter(function (x) { return x.id === e.id; });
      out.push({
        n: out.length + 1,
        label: e.label,
        subject: e.subject,
        pictures: mine,
        description: tidy(e.subject && e.subject.description),
        arrives: SB.Personas.enters ? !!SB.Personas.enters(shot, e.id)
          : ((shot.castEnters || []).indexOf(e.id) >= 0)
      });
    });
    return out;
  }

  /* A frame this shot rides on — a riff's source — is a composition anchor,
   * not a subject. It keeps its picture label and is cited as one. */
  function anchors(p, shot) {
    return pictures(p, shot).filter(function (x) {
      return x.kind === 'frame' || x.kind === 'shot';
    });
  }

  function joinPics(list) {
    const names = list.map(function (x) { return '<Picture ' + x.n + '>'; });
    if (!names.length) return '';
    if (names.length === 1) return names[0];
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }

  /* ---- subject_definitions ---- */
  function definitions(p, shot) {
    const subs = subjects(p, shot);
    const anch = anchors(p, shot);
    const lines = [];

    anch.forEach(function (a) {
      lines.push('<Picture ' + a.n + '> is ' +
        (a.kind === 'frame' ? 'the first frame this shot begins from'
                            : 'the rendered frame of ' + a.label) + '.');
    });

    subs.forEach(function (s) {
      const bits = ['<Subject ' + s.n + '> is ' + (s.label || 'an unnamed subject')];
      if (s.pictures.length) bits.push(', seen in ' + joinPics(s.pictures));
      const d = clause(s.description);
      bits.push(d ? ': ' + d + '.' : '.');
      lines.push(bits.join(''));
    });
    return lines.join('\n');
  }

  /* ---- retention_analysis ----
   *
   * One line per label. A reference frame of a recurring subject is there to
   * be reproduced exactly, so it is fully_preserved; a frame this shot is a
   * riff on is being edited, which is partially_preserved. Nothing here is
   * guesswork, so none of it is worth a model call.
   */
  function retention(p, shot) {
    const lines = [];
    anchors(p, shot).forEach(function (a) {
      lines.push('<Picture ' + a.n + '> (appears in [Shot 1]): ' +
        (a.kind === 'frame'
          ? 'fully_preserved - the shot opens on this frame and its composition, lighting and ' +
            'subject placement carry into the motion.'
          : 'partially_preserved - the frame it supplies is the starting point for this shot ' +
            'and is carried forward with the changes described below.'));
    });
    /* "retained exactly" is about IDENTITY, not about how much of them the shot
     * shows. Written without that clause it read as an order to put the whole
     * description on the screen, so a close-up of a pair of hands carried the
     * wardrobe and the haircut of a man who was, in that frame, two hands. */
    subjects(p, shot).forEach(function (s) {
      const d = clause(s.description);
      lines.push('<Subject ' + s.n + '> (appears in [Shot 1]): fully_preserved - ' +
        (d ? d.charAt(0).toLowerCase() + d.slice(1) + ' are retained exactly wherever this ' +
             'shot’s framing shows them.'
           : 'identity, wardrobe and appearance are retained exactly wherever this shot’s ' +
             'framing shows them.'));
    });
    return lines.join('\n');
  }

  /* ---- the summary's bracketed task type ----
   *
   * Computed from what is actually supplied, which is the rule the guide
   * states and the thing a writer with no view of the file list cannot know.
   */
  function taskTypes(p, shot) {
    const types = [];
    if (shot.image) types.push('keyframe completion');
    const refs = SB.Refs.feed(p, shot).some(function (e) {
      return e.kind === 'subject' && e.images.length;
    });
    const riff = SB.Refs.feed(p, shot).some(function (e) {
      return e.kind === 'shot' && e.images.length;
    });
    if (refs || riff) types.push('reference generation');
    return types;
  }

  /* The label table the writer works from: it never invents a label, it only
   * uses these. */
  function labelTable(p, shot) {
    const lines = [];
    anchors(p, shot).forEach(function (a) {
      lines.push('  <Picture ' + a.n + '> = ' +
        (a.kind === 'frame' ? 'the first frame' : 'the frame of ' + a.label));
    });
    subjects(p, shot).forEach(function (s) {
      lines.push('  <Subject ' + s.n + '> = ' + (s.label || 'unnamed') +
        (s.pictures.length ? ' (' + joinPics(s.pictures) + ')' : ' (no reference image)') +
        (s.arrives ? '  [ARRIVES DURING THE SHOT — not in the first frame]' : ''));
    });
    return lines.join('\n');
  }

  /* Everything the request needs, so the caller does not have to know the
   * shape of any of it. */
  function scaffold(p, shot) {
    const subs = subjects(p, shot);
    const anch = anchors(p, shot);
    return {
      any: !!(subs.length || anch.length),
      subjects: subs,
      anchors: anch,
      definitions: definitions(p, shot),
      retention: retention(p, shot),
      taskTypes: taskTypes(p, shot),
      labels: labelTable(p, shot),
      /* every label that legally exists for this shot */
      names: anch.map(function (a) { return '<Picture ' + a.n + '>'; })
        .concat(subs.map(function (s) { return '<Subject ' + s.n + '>'; }))
    };
  }

  /* ---- assembly ---- */
  function assemble(sc, written) {
    const got = {
      subject_definitions: sc.definitions,
      summary: tidy(written.summary),
      retention_analysis: sc.retention,
      detailed_description: String(written.detailed_description || '').trim(),
      overall_soundscape: SOUNDSCAPE,
      non_diegetic_music: MUSIC
    };
    return SECTIONS.map(function (k) { return k + ':\n' + got[k]; }).join('\n\n');
  }

  /* ---- the check the guide calls a self-check ----
   *
   * Run here rather than asked for: a label the writer invented is the one
   * failure that makes an H3 prompt produce somebody who is not in the cast.
   */
  function problems(sc, written) {
    const out = [];
    const sum = tidy(written.summary);
    const det = String(written.detailed_description || '');
    const used = (sum + '\n' + det).match(/<(?:Subject|Picture|Video|Audio) \d+>/g) || [];
    const unknown = [];
    used.forEach(function (u) {
      if (sc.names.indexOf(u) < 0 && unknown.indexOf(u) < 0) unknown.push(u);
    });
    if (unknown.length) {
      out.push('it uses ' + unknown.join(', ') + ', which no subject_definitions line defines. ' +
        'The only labels that exist for this shot are: ' + sc.names.join(', ') + '.');
    }
    if (sc.taskTypes.length && !/^\s*\[[^\]]+\]/.test(sum)) {
      out.push('summary must open with the bracketed task type "[' +
        sc.taskTypes.join(' + ') + ']".');
    }
    if (/\(S\d+\)/.test(det) || /<d>/i.test(det)) {
      out.push('this video is silent: no speaker IDs and no <d>...</d> dialogue.');
    }
    if (det && det.split(/\s+/).length < 120) {
      out.push('detailed_description is far too short — it needs 350-500 words of shot detail.');
    }
    return out;
  }

  SB.H3 = {
    NAME: NAME, SECTIONS: SECTIONS, WRITTEN: WRITTEN,
    SOUNDSCAPE: SOUNDSCAPE, MUSIC: MUSIC,
    isH3: isH3, stock: stock,
    pictures: pictures, subjects: subjects, scaffold: scaffold,
    assemble: assemble, problems: problems
  };

})(window.SB);
