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
  /* Whoever this card has chosen to send a picture of, if the model takes
   * them. Asked of imagine.js, which owns the answer; empty where it is not
   * loaded, which is every node test that does not need it. */
  function sentArrivals(p, shot) {
    const IM = SB.Imagine;
    if (!IM || !IM.arrivalRefs || !IM.slugOf) return [];
    const m = SB.Model.videoModel(p);
    if (!m) return [];
    const a = IM.arrivalRefs(p, shot, IM.slugOf(m));
    return (a.on && a.can) ? a.people : [];
  }

  function pictures(p, shot) {
    /* The pictures the CALL carries, in the order it carries them.
     *
     * The frame first, always. Then whoever the card has chosen to send with
     * it: somebody who arrives partway through is in no frame, so their
     * picture is the only thing the model can match them to — and a picture
     * sent without a <Picture N> beside it is exactly what this format exists
     * to prevent.
     *
     * Everything else a card marks stays out. The still was built from those
     * and approved; naming them here would bind subjects to photographs the
     * video call never receives.
     *
     * (the old note, still true of the marked references:)
     * One picture, because one picture is what is sent: this card's frame.
     * The marked references built the still and were approved in it; naming
     * them here as <Picture 2>… bound subjects to photographs the call never
     * carries, and invited the model to rebuild the shot from them instead of
     * moving the frame it was handed. The subjects are still named and still
     * described — in words, which is what a clip needs. */
    const out = [];
    /* The same test the upload makes. Gating on shot.image alone missed the
     * board that holds an original with no proxy — a real legacy state — and
     * imagine.js uploads that original as image 1 regardless. The frame went
     * up with no <Picture 1> naming it, and any arrival riding with it went
     * up unnamed too. */
    if (shot.render || shot.image) {
      out.push({ n: 1, kind: 'frame', label: 'the first frame of this shot', feedN: null });
    }
    if (!out.length) return out;        // nothing to anchor the rest to
    sentArrivals(p, shot).forEach(function (a) {
      out.push({ n: out.length + 1, kind: 'arrival', label: a.label, id: a.id, feedN: null });
    });
    return out;
  }

  /* Every subject that gets a <Subject N> line, in feed order, with the
   * pictures that define it. A subject with no picture is still a subject —
   * its description is the whole of what the model has to go on. */
  function subjects(p, shot) {
    const pics = pictures(p, shot);
    const fr = SB.Personas.framing ? SB.Personas.framing(p, shot) : {
      inFrame: function (id) {
        return !(SB.Personas.enters ? SB.Personas.enters(shot, id)
          : (shot.castEnters || []).indexOf(id) >= 0);
      },
      arrives: function (id) {
        return SB.Personas.enters ? !!SB.Personas.enters(shot, id)
          : (shot.castEnters || []).indexOf(id) >= 0;
      }
    };
    const out = [];
    SB.Refs.feed(p, shot, 'video').forEach(function (e) {
      if (e.kind !== 'subject') return;
      const mine = pics.filter(function (x) { return x.id === e.id; });
      out.push({
        n: out.length + 1,
        label: e.label,
        subject: e.subject,
        pictures: mine,
        description: tidy(e.subject && e.subject.description),
        /* The first-frame lane decides, not the arrival tick — the same
         * answer personas.js gives its own cast block. Reading only the tick
         * meant the ordinary way of writing an entrance (name them in the
         * motion box) still claimed they were preserved from a frame they are
         * not in, while somebody written INTO the frame and also ticked was
         * declared absent from the picture built around them. */
        arrives: fr.arrives(e.id),
        /* separately from arriving: whether the opening picture holds them,
         * which is the only thing that makes "preserved from <Picture 1>" a
         * true sentence */
        inFrame: fr.inFrame(e.id)
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

  /* The pictures of people, which are bound to a <Subject N> rather than
   * standing on their own. */
  function arrivalPics(p, shot) {
    return pictures(p, shot).filter(function (x) { return x.kind === 'arrival'; });
  }

  /* <Picture N> for a subject, when their picture is in the call. */
  function picFor(p, shot, id) {
    const hit = arrivalPics(p, shot).filter(function (x) { return x.id === id; })[0];
    return hit ? hit.n : 0;
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
      const what = d ? d.charAt(0).toLowerCase() + d.slice(1) : 'identity, wardrobe and appearance';
      /* fully_preserved is a claim about a SOURCE. It is true of somebody in
       * the frame, and true of somebody whose picture is in the call — and it
       * is a claim about nothing for an arrival described only in words, who
       * is in no frame and has no picture. Saying it anyway taught the format
       * to preserve something it had never been shown. */
      if (s.pictures.length) {
        lines.push('<Subject ' + s.n + '> (appears in [Shot 1]): fully_preserved - ' + what +
          ' are retained exactly from ' + joinPics(s.pictures) + ', wherever this shot’s ' +
          'framing shows them.');
      } else if (s.inFrame && anchors(p, shot).length) {
        lines.push('<Subject ' + s.n + '> (appears in [Shot 1]): fully_preserved - ' + what +
          ' are retained exactly from <Picture 1>, wherever this shot’s framing shows them.');
      } else {
        /* No picture of them anywhere in the call — either they walk in after
         * the frame, or this card has no frame at all. Citing <Picture 1>
         * here named a label the table does not define, which the format
         * forbids and this module's own problems() flags; the writer was then
         * asked to obey a request that broke its own rule. */
        lines.push('<Subject ' + s.n + '> (appears in [Shot 1]): newly_introduced - not in ' +
          'any supplied picture. ' + what.charAt(0).toUpperCase() + what.slice(1) +
          ' are given here in words and are the only record of them: follow them exactly, ' +
          'and keep them identical ' + (s.arrives
            ? 'from the moment they enter to the end of the shot.'
            : 'from the first frame to the last.'));
      }
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
    /* the same test pictures() makes, and the same one the upload makes: a
       board can hold an original with no proxy */
    if (shot.render || shot.image) types.push('keyframe completion');
    /* "reference generation" is true only when a reference photograph is
       actually in the call — which is now possible again, for somebody who
       arrives partway through and would otherwise be in no picture at all. */
    if (arrivalPics(p, shot).length) types.push('reference generation');
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
      names: pictures(p, shot).map(function (a) { return '<Picture ' + a.n + '>'; })
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
