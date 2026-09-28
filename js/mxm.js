/* mxm.js — a MiniMax package for one card, per lane (minimax_export_plan.md).
 *
 * Most of the team feeds MiniMax by hand: upload files, paste a prompt. That
 * works only when the prompt's labels, the order the files go up in, and which
 * grey figure is which person all agree — and the board already knows all
 * three. So everything here is written from ONE list, the manifest's assets:
 * the file names and the prompt's labels come from the same entries, and
 * cannot disagree.
 *
 *   image lane  -> MiniMax Image: the clay blocking render + each subject's
 *                  picture; the team's brief ("[Image 1] is an untextured grey
 *                  clay render…"), assembled here with no writer model.
 *   video lane  -> MiniMax H3 full reference: the performance clip (or the
 *                  clay still), the approved first frame, each subject's
 *                  picture; the six-section H3 rewrite (the
 *                  minimax-h3-r2v-prompt skill). The two prose sections come
 *                  from the writer when one is set up (SB.Prompts.writeMxm),
 *                  or are assembled here when not.
 *
 * The ImagineArt push is a different route (frame only) and h3.js keeps
 * writing for it untouched; nothing here is sent anywhere.
 */
(function (SB) {
  'use strict';

  /* MiniMax H3: whole seconds; up to 9 images, 3 videos, 12 files. The shortest
     and longest clip depend on the setup (MiniMax's own site starts at 4 s; the
     team's goes down to 3), so those two are board settings, defaulting here. */
  const H3 = { minS: 3, maxS: 15, images: 9, videos: 3, files: 12 };

  const DEFAULT_STYLE = 'photorealistic cinematic, documentary-style realism, natural light, ' +
    'shallow depth of field, soft contrast, subtle film grain';
  /* Phrases without the "no": the brief lists them as "no X, no Y", H3 as one sentence. */
  const NEG_IMAGE = ['clay, mannequin or grey untextured surfaces', 'grey studio floor or grid',
    'on-screen text', 'watermark', 'extra people', 'deformed hands'];
  const NEG_VIDEO = ['on-screen text', 'watermark', 'extra people', 'camera cuts',
    'morphing or deformed hands', 'empty or unrendered frames', 'clay, mannequin or grey untextured surfaces'];

  function P() { return SB.app && SB.app.project; }
  function tidy(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function clause(s) { return tidy(s).replace(/[.\s]+$/, ''); }
  function sentence(s) { const c = clause(s); return c ? c.charAt(0).toUpperCase() + c.slice(1) + '.' : ''; }
  /* "Red blazer, short hair" sewn into a sentence: lower-case its first letter,
     unless it is an acronym or a name-like word ("NASA", "iPhone" stay). */
  function inline(s) {
    const c = clause(s);
    if (!c || !/^(?:[A-Z][a-z]|A )/.test(c)) return c;
    return c.charAt(0).toLowerCase() + c.slice(1);
  }
  function plain(p, t) { return SB.Refs && SB.Refs.plain ? SB.Refs.plain(p, t || '') : String(t || ''); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function slug(t) { return (SB.Renders && SB.Renders.slug) ? (SB.Renders.slug(t) || 'ref') : 'ref'; }

  /* the board's MiniMax settings, with the defaults filled in */
  function settings(p) {
    const m = (p && p.settings && p.settings.mxm) || {};
    const num = function (v, d) { v = Math.round(+v); return isFinite(v) && v > 0 ? v : d; };
    const minS = num(m.minS, H3.minS);
    return {
      minS: minS, maxS: Math.max(minS, num(m.maxS, H3.maxS)),
      style: tidy(m.style) || DEFAULT_STYLE,
      negImage: Array.isArray(m.negImage) && m.negImage.length ? m.negImage : NEG_IMAGE,
      negVideo: Array.isArray(m.negVideo) && m.negVideo.length ? m.negVideo : NEG_VIDEO
    };
  }

  function listJoin(a, last) {
    if (a.length <= 1) return a.join('');
    return a.slice(0, -1).join(', ') + (last || ' and ') + a[a.length - 1];
  }

  /* ------------------------------------------------------------- manifest */

  function poseOK(shot) { return !!(shot && shot.pose && shot.pose.scene && (shot.pose.render || shot.pose.image)); }

  /* The subjects this lane shows, in feed order, one picture each (the first:
     the one the subject is known by). A still leaves out whoever arrives later
     — their picture would put them in the frame. */
  function subjectsFor(p, shot, lane) {
    const out = [], seen = {};
    const roles = lane === 'image' ? ['image'] : ['image', 'video'];
    const fr = SB.Personas.framing ? SB.Personas.framing(p, shot) : null;
    roles.forEach(function (role) {
      SB.Refs.feed(p, shot, role).forEach(function (e) {
        if (e.kind !== 'subject' || seen[e.id]) return;
        seen[e.id] = 1;
        const arrives = fr ? fr.arrives(e.id) : SB.Personas.enters(shot, e.id);
        if (lane === 'image' && arrives) return;
        out.push({
          id: e.id, name: e.label || 'unnamed', subject: e.subject,
          kind: SB.Personas.kindOf(e.subject).id,
          description: tidy(e.subject && e.subject.description),
          img: e.images[0] || null, render: (e.renders || [])[0] || null,
          arrives: !!arrives, inFrame: fr ? fr.inFrame(e.id) : !arrives
        });
      });
    });
    return out;
  }

  /* which clay figure is which subject, from the blocking's cast */
  function figureOf(shot, id) {
    const c = ((shot.pose && shot.pose.cast) || []).filter(function (x) { return x.personaId === id; })[0];
    if (!c) return null;
    return { colour: c.colorName || 'grey', where: (c.pos && c.pos.where) || null, x: c.pos ? c.pos.x : null };
  }

  function perfInfo(p, shot) {
    const L = SB.Pose && SB.Pose.perfLink ? SB.Pose.perfLink(shot) : null;
    if (!L) return null;
    const rec = SB.Pose.perfOf(p, shot);
    return { link: L, rec: rec, dur: Math.max(0, L.out - L.in), stale: SB.Pose.perfStale(p, shot) };
  }

  function manifest(p, shot, lane) {
    const f = SB.Model.findShot(p, shot.id);
    const st = settings(p);
    const code = f ? f.code : '';
    const perf = lane === 'video' ? perfInfo(p, shot) : null;
    const clip = !!(perf && perf.rec);
    const assets = [];
    const add = function (a) { a.n = assets.length + 1; assets.push(a); return a; };

    if (lane === 'video' && clip) {
      add({ kind: 'clay-clip', ext: 'mp4', name: 'clay', role: 'the grey clay render of this shot, animated' });
    } else if (poseOK(shot)) {
      add({ kind: 'clay-still', ext: 'png', name: 'clay', role: 'the grey clay render of this shot' });
    }
    if (lane === 'video' && (shot.render || shot.image)) {
      add({ kind: 'first-frame', ext: 'png', name: 'first_frame', role: 'the approved first frame' });
    }
    const subs = subjectsFor(p, shot, lane);
    subs.forEach(function (s) {
      if (!s.img) return;
      s.asset = add({ kind: 'subject', ext: 'jpg', name: slug(s.name), role: s.name, subjectId: s.id });
    });

    const figures = subs.map(function (s, i) {
      return Object.assign({}, s, { n: i + 1, h3: '<Subject ' + (i + 1) + '>', fig: figureOf(shot, s.id) });
    });

    /* H3 numbers pictures and videos separately. A picture goes up as PNG if
       it is one and as JPEG otherwise — originals are often WebP, which not
       every MiniMax upload takes — so every name is known before any bytes
       are touched. */
    let pic = 0, vid = 0;
    assets.forEach(function (a) {
      if (a.kind === 'clay-clip') { vid++; a.h3 = '<Video ' + vid + '>'; }
      else {
        pic++; a.h3 = '<Picture ' + pic + '>';
        a.ext = /^data:image\/png/i.test(stillUrl(p, shot, a, figures)) ? 'png' : 'jpg';
      }
      a.label = '[Image ' + a.n + ']';
      a.file = pad(a.n) + '_' + a.name + '.' + a.ext;
    });

    const boxes = {
      shared: tidy(plain(p, shot.description)),
      first: tidy(plain(p, shot.imageDescription)),
      motion: tidy(plain(p, shot.videoDescription))
    };
    const dur = perf ? perf.dur : null;
    const m = {
      lane: lane, code: code, target: lane === 'image' ? 'MiniMax Image' : 'MiniMax H3',
      shotType: shot.type || '', scene: f ? tidy(f.scene.heading) : '',
      assets: assets, figures: figures, boxes: boxes, perf: perf, clip: clip,
      blocked: poseOK(shot), frame: !!(shot.render || shot.image),
      style: st.style, negatives: lane === 'image' ? st.negImage : st.negVideo,
      aspect: (shot.pose && shot.pose.aspect) || (SB.Imagine && SB.Imagine.aspectOf ? SB.Imagine.aspectOf(p) : '16:9'),
      minS: st.minS, maxS: st.maxS,
      duration: dur == null ? null : Math.min(st.maxS, Math.max(st.minS, Math.round(dur))),
      clipSeconds: dur
    };
    m.warnings = warnings(p, shot, m);
    m.sig = signature(m);
    return m;
  }

  /* What the prompt was written from: if any of it changes, a stored prompt
     is out of date. */
  function signature(m) {
    const s = JSON.stringify({
      a: m.assets.map(function (a) { return [a.kind, a.subjectId || '', a.n]; }),
      f: m.figures.map(function (x) { return [x.id, x.name, x.description, x.fig, x.arrives]; }),
      b: m.boxes, t: m.shotType, st: m.style, ng: m.negatives,
      pf: m.perf ? [m.perf.link.id, m.perf.link.version, m.perf.link.in, m.perf.link.out, m.perf.link.cam] : null
    });
    return SB.Blobs && SB.Blobs.hash ? SB.Blobs.hash(s) : String(s.length);
  }

  /* Says what is out of order; never stops the export. */
  function warnings(p, shot, m) {
    const w = [];
    const fig = function (x) { return x.fig; };
    if (!m.blocked) {
      w.push('No 3D blocking on this card — there is no clay render, so the layout is in words only.');
    } else {
      m.figures.filter(function (x) { return x.kind === 'person' && !fig(x) && x.inFrame; }).forEach(function (x) {
        w.push(x.name + ' is on the card but no mannequin in the blocking is linked to them — link one in Pose Bench.');
      });
    }
    m.figures.filter(function (x) { return !x.img; }).forEach(function (x) {
      w.push(x.name + ' has no reference picture — they are described in words only.');
    });
    if (m.lane === 'video') {
      if (!m.frame) w.push('No approved still yet. The recommended order is the image lane first, then the video with that still as its first frame.');
      else if (SB.Pose && SB.Pose.stale && SB.Pose.stale(shot, shot.render)) {
        w.push('The still was made from an earlier blocking — render the first frame again before the video.');
      }
      if (m.perf && !m.perf.rec) w.push('The performance this card was cut from is gone — reopen the blocking and pick one.');
      else if (m.perf && m.perf.stale) w.push('The performance changed since this card was cut (🎞 older) — reopen the blocking and Use again.');
      if (m.perf && m.perf.rec && Math.abs((m.perf.link.at || 0) - (m.perf.link.in || 0)) > 0.02) {
        w.push('The still was taken ' + (m.perf.link.at - m.perf.link.in).toFixed(1) + ' s into the clip, not at its start — reopen the blocking and Use again so the first frame and the clip begin together.');
      }
      if (m.clipSeconds != null && m.clipSeconds < m.minS - 0.5) {
        w.push('The clip is ' + m.clipSeconds.toFixed(1) + ' s; this board’s MiniMax H3 makes ' + m.minS + ' s at least, so set ' + m.minS + ' s and the action finishes early — or lengthen the range in Pose Bench.');
      } else if (m.clipSeconds != null && m.clipSeconds > m.maxS + 0.5) {
        w.push('The clip is ' + m.clipSeconds.toFixed(1) + ' s; this board’s MiniMax H3 makes ' + m.maxS + ' s at most — split the card or trim the range in Pose Bench.');
      }
      const imgs = m.assets.filter(function (a) { return a.ext !== 'mp4'; }).length;
      if (imgs > H3.images) w.push(imgs + ' pictures; MiniMax H3 takes ' + H3.images + ' at most.');
      if (m.assets.length > H3.files) w.push(m.assets.length + ' files; MiniMax H3 takes ' + H3.files + ' at most.');
    } else if (m.blocked && SB.Pose && SB.Pose.stale && SB.Pose.stale(shot, shot.render)) {
      w.push('The still on this card was made from an earlier blocking.');
    }
    return w;
  }

  /* ------------------------------------------------------ the image brief */

  function whereWord(fig) {
    if (!fig || !fig.where || fig.where === 'out') return '';
    return fig.where === 'centre' ? 'Centre' : fig.where === 'left' ? 'Left' : 'Right';
  }

  function brief(m) {
    const L = [];
    const clay = m.assets.filter(function (a) { return a.kind === 'clay-still'; })[0];
    const people = m.figures.filter(function (x) { return x.asset; });
    if (clay) {
      const binds = m.figures.filter(function (x) { return x.fig; }).map(function (x) {
        return 'the ' + x.fig.colour + ' figure is ' + x.name + (x.asset ? ' ' + x.asset.label : '');
      });
      L.push(clay.label + ' is an untextured grey clay render of this exact shot. It defines layout, ' +
        'staging and camera. Follow its composition, framing, subject positions and poses exactly. ' +
        'Keep geometry and layout unchanged; add only material, colour and lighting.' +
        (binds.length ? ' The clay figures are placeholders: ' + binds.join('; ') + '.' : ''));
    }
    people.forEach(function (x) {
      L.push(x.asset.label + ' is ' + (x.kind === 'place' ? 'the location, ' + x.name
        : x.kind === 'thing' ? 'an object, ' + x.name : x.name) + '.');
    });
    L.push('');
    const scene = m.boxes.shared || m.boxes.first;
    if (scene) L.push('Scene: ' + sentence(scene));
    m.figures.forEach(function (x) {
      const d = clause(x.description);
      const head = x.kind === 'place' ? 'Setting' : x.kind === 'thing' ? 'Object'
        : ((whereWord(x.fig) ? whereWord(x.fig) + ' figure' : 'Figure'));
      L.push(head + (x.asset ? ' ' + x.asset.label : '') + ': ' + x.name + (d ? ', ' + inline(d) : '') + '.');
    });
    L.push('Moment: ' + (m.boxes.first && m.boxes.shared ? sentence(m.boxes.first)
      : 'the first instant of the shot, before anything it describes as happening next has happened.'));
    L.push('Camera: ' + (clay ? 'comes entirely from ' + clay.label + '. Match its framing, angle and lens exactly.'
      : (m.shotType ? m.shotType + '.' : 'as the scene describes.')));
    L.push('Style: ' + sentence(m.style));
    L.push('Negative: ' + m.negatives.map(function (x) { return 'no ' + x; }).join(', ') + '.');
    return L.join('\n');
  }

  /* --------------------------------------------------------- the H3 prompt */

  /* The label table, definitions and retention lines, computed — the same
     division of labour as h3.js, for the full-reference call. */
  function h3Scaffold(m) {
    const clip = m.assets.filter(function (a) { return a.kind === 'clay-clip'; })[0];
    const clay = m.assets.filter(function (a) { return a.kind === 'clay-still'; })[0];
    const frame = m.assets.filter(function (a) { return a.kind === 'first-frame'; })[0];
    const motion = clip || clay;
    const defs = [], ret = [], labels = [];
    if (clip) {
      defs.push(clip.h3 + ' is an untextured grey clay render of this exact shot. It defines layout, staging, ' +
        'camera and animation: where each subject is, how they are posed, how they move and when, frame by frame.');
      ret.push(clip.h3 + ' (appears in [Shot 1]): fully_preserved - its camera path, framing, subject positions, ' +
        'poses, movement and timing are followed exactly, frame by frame; only its grey untextured surfaces are ' +
        'replaced, by the subjects’ real appearance, materials, colour and lighting.');
      labels.push('  ' + clip.h3 + ' = the grey clay render of this shot, animated (camera, staging and motion)');
    }
    if (clay) {
      defs.push(clay.h3 + ' is an untextured grey clay render of this exact shot, a storyboard reference for ' +
        '[Shot 1] defining its viewpoint, framing, subject placement and poses.');
      ret.push(clay.h3 + ' (appears in [Shot 1]): fully_preserved - its viewpoint, framing, subject placement and ' +
        'poses are kept; the grey clay surfaces are replaced by the subjects’ real appearance, materials and lighting.');
      labels.push('  ' + clay.h3 + ' = the grey clay render of this shot (layout and camera)');
    }
    if (frame) {
      defs.push(frame.h3 + ' is the first frame this shot begins from.');
      ret.push(frame.h3 + ' (appears in [Shot 1]): fully_preserved - the shot opens on this frame and its ' +
        'composition, lighting and subject placement carry into the motion.');
      labels.push('  ' + frame.h3 + ' = the first frame');
    }
    m.figures.forEach(function (x) {
      const d = clause(x.description);
      let line = x.h3 + ' is ' + (x.kind === 'place' ? 'the location ' : x.kind === 'thing' ? 'the object ' : '') +
        x.name + (x.asset ? ', seen in ' + x.asset.h3 : '') + (d ? ': ' + inline(d) + '.' : '.');
      if (x.fig && motion) {
        line += ' In ' + motion.h3 + ', ' + x.name + ' is the ' + x.fig.colour + ' figure' +
          (x.fig.where && x.fig.where !== 'out' ? ' ' + (x.fig.where === 'centre' ? 'in the centre' : 'on the ' + x.fig.where) + ' of frame' : '') + '.';
      }
      defs.push(line);
      const what = (x.kind === 'person' ? 'identity, face and wardrobe' : 'appearance') + (d ? ' (' + inline(d) + ')' : '');
      if (x.asset) {
        ret.push(x.h3 + ' (appears in [Shot 1]): fully_preserved - ' + what + ' are retained exactly from ' +
          x.asset.h3 + ', wherever this shot’s framing shows them.');
      } else if (frame && x.inFrame) {
        ret.push(x.h3 + ' (appears in [Shot 1]): fully_preserved - ' + what + ' are retained exactly from ' +
          frame.h3 + ', wherever this shot’s framing shows them.');
      } else {
        ret.push(x.h3 + ' (appears in [Shot 1]): weak_reference - there is no picture of them in this call; ' +
          what + ' are given here in words: follow them exactly and keep them identical ' +
          (x.arrives ? 'from the moment they enter to the end of the shot.' : 'from the first frame to the last.'));
      }
      labels.push('  ' + x.h3 + ' = ' + x.name + (x.asset ? ' (' + x.asset.h3 + ')' : ' (no reference image)') +
        (x.fig && motion ? ' — the ' + x.fig.colour + ' figure in ' + motion.h3 : '') +
        (x.arrives ? '  [ARRIVES DURING THE SHOT — not in the first frame]' : ''));
    });
    const types = [];
    if (frame) types.push('keyframe completion');
    if (clip || clay || m.figures.some(function (x) { return x.asset; })) types.push('reference generation');
    return {
      any: true, clip: clip, clay: clay, frame: frame, motion: motion,
      definitions: defs.join('\n'), retention: ret.join('\n'), labels: labels.join('\n'),
      taskTypes: types,
      names: m.assets.map(function (a) { return a.h3; }).concat(m.figures.map(function (x) { return x.h3; }))
    };
  }

  /* What the writer is told on top of the stock H3 template, for this call. */
  function h3Rider(m, sc) {
    const L = ['=== THE MINIMAX FULL-REFERENCE CALL ===',
      'This prompt goes to MiniMax H3 with these files, in this order: ' +
        m.assets.map(function (a) { return a.h3 + ' = ' + a.role; }).join('; ') + '.'];
    if (sc.clip) {
      L.push('- ' + sc.clip.h3 + ' is a grey clay render of THIS shot. The camera, framing, positions, poses, ' +
        'movement and timing all come from it: describe the action as it happens in it, in order. Never describe ' +
        'clay, mannequins or grey surfaces — the subjects replace them. This overrides anything above about a ' +
        'locked-off camera: the camera does exactly what ' + sc.clip.h3 + ' does, and you say so.');
    } else if (sc.clay) {
      L.push('- ' + sc.clay.h3 + ' is a grey clay render of THIS shot, fixing its camera, framing and positions. ' +
        'The motion comes from the shot description. Never describe clay or mannequins.');
    }
    if (sc.frame) L.push('- State that the shot begins from ' + sc.frame.h3 + '.');
    else L.push('- There is no first-frame picture: do NOT write "begins from <Picture 1>"' +
      (sc.clip ? '; say the shot follows ' + sc.clip.h3 + ' from its first frame.' : '.'));
    const binds = m.figures.filter(function (x) { return x.fig; });
    if (binds.length && sc.motion) {
      L.push('- The clay figures: ' + binds.map(function (x) {
        return 'the ' + x.fig.colour + ' figure is ' + x.h3 + ' (' + x.name + ')';
      }).join('; ') + '. Any other figure is an extra.');
    }
    if (m.clipSeconds != null) {
      L.push('- The clip is ' + m.clipSeconds.toFixed(1) + ' s long and the video is ' + m.duration +
        ' s: time the action to it.');
    }
    L.push('- Style: ' + clause(m.style) + '. Put this, and the following, as plain sentences in the style ' +
      'opening before [Shot 1]: ' + negSentence(m.negatives));
    return L.join('\n');
  }

  function negSentence(list) {
    return 'It is one continuous take and contains ' + listJoin(list.map(function (x) { return 'no ' + x; }), ', and ') + '.';
  }

  /* The two prose sections without a writer: shorter than the guide's 350-500
     words, and the package says so. */
  function h3Fallback(m, sc) {
    const scene = m.boxes.shared || m.boxes.first;
    const action = [m.boxes.first && m.boxes.shared ? m.boxes.first : '', m.boxes.motion].filter(Boolean).join(' ');
    const sum = '[' + sc.taskTypes.join(' + ') + '] ' + (scene ? 'In the target video, ' + inline(scene) : 'The target video is the shot described below') +
      '.' + (sc.motion ? ' ' + sc.motion.h3 + ' supplies the camera, staging' + (sc.clip ? ' and motion' : '') + '.' : '') +
      (m.figures.length ? ' ' + m.figures.map(function (x) {
        return x.h3 + ' is ' + x.name + (x.asset ? ', from ' + x.asset.h3 : '');
      }).join('; ') + '.' : '');
    const det = [];
    det.push('The target video is in this style: ' + inline(m.style) + '. ' + negSentence(m.negatives));
    let shot = '[Shot 1] ' + (sc.frame ? 'The shot begins from ' + sc.frame.h3 +
      (sc.clip ? ' and follows ' + sc.clip.h3 + ' exactly: its camera, framing, subject positions, poses, movement and timing.' : '.')
      : sc.clip ? 'The shot follows ' + sc.clip.h3 + ' exactly from its first frame: its camera, framing, subject positions, poses, movement and timing.'
        : sc.clay ? 'The camera, framing and subject positions come from ' + sc.clay.h3 + '.' : '');
    m.figures.forEach(function (x) {
      const d = clause(x.description);
      shot += ' ' + x.h3 + ', ' + x.name + (x.fig && x.fig.where && x.fig.where !== 'out'
        ? ', is ' + (x.fig.where === 'centre' ? 'in the centre' : 'on the ' + x.fig.where) + ' of frame' : '') +
        (d ? ': ' + inline(d) : '') + '.';
    });
    if (scene) shot += ' ' + sentence(scene);
    if (action) shot += ' ' + sentence(action);
    if (sc.motion) shot += ' The camera comes entirely from ' + sc.motion.h3 + ' and nothing else moves it.';
    det.push(shot.trim());
    return { summary: sum, detailed_description: det.join('\n') };
  }

  function h3Prompt(m, written) {
    const sc = h3Scaffold(m);
    return SB.H3.assemble(sc, written || h3Fallback(m, sc));
  }

  /* ------------------------------------------------ the stored prompts */

  /* shot.mxm = {image: {prompt, sig, edited, written, at}, video: {...}} */
  function stored(shot, lane) { return (shot.mxm && shot.mxm[lane]) || null; }

  function remember(shot, lane, rec) {
    shot.mxm = shot.mxm && typeof shot.mxm === 'object' ? shot.mxm : {};
    shot.mxm[lane] = Object.assign({ at: Date.now() }, rec);
  }

  /* The prompt the package carries, and where it came from. */
  function promptFor(p, shot, lane, m) {
    m = m || manifest(p, shot, lane);
    const s = stored(shot, lane);
    const fresh = lane === 'image' ? brief(m) : h3Prompt(m, null);
    if (s && s.prompt && s.sig === m.sig) {
      return { text: s.prompt, source: s.edited ? 'edited' : s.written ? 'writer' : 'assembled', current: true };
    }
    if (s && s.prompt && s.edited) {
      return { text: s.prompt, source: 'edited', current: false };
    }
    return { text: fresh, source: 'assembled', current: true };
  }

  /* ------------------------------------------------------- the package */

  function orderText(m, pr) {
    const L = [];
    L.push('MiniMax package — ' + (m.code || 'shot') + ', ' + (m.lane === 'image' ? 'first frame' : 'video'));
    L.push('Model: ' + (m.lane === 'image' ? 'MiniMax Image' : 'MiniMax H3 (full reference)'));
    L.push('Aspect: ' + m.aspect);
    if (m.lane === 'video') {
      L.push('Duration: ' + (m.duration != null ? m.duration + ' s' +
        (Math.abs(m.clipSeconds - m.duration) > 0.05 ? ' (the clip is ' + m.clipSeconds.toFixed(1) + ' s)' : '')
        : 'your choice (' + m.minS + '–' + m.maxS + ' s) — this card has no performance clip'));
    }
    L.push('');
    L.push('Upload in this order:');
    m.assets.forEach(function (a) {
      L.push('  ' + a.n + '. ' + a.file + '  —  ' + (m.lane === 'image' ? a.label : a.h3) + ' ' + a.role);
    });
    if (!m.assets.length) L.push('  (no files — the prompt is words only)');
    L.push('');
    L.push('Then paste prompt.txt.' + (pr.source === 'assembled' && m.lane === 'video'
      ? ' (Assembled without the writer model — open Export for MiniMax on the card and press Write for the full description.)' : ''));
    if (m.warnings.length) {
      L.push('');
      L.push('Check first:');
      m.warnings.forEach(function (w) { L.push('  - ' + w); });
    }
    if (!pr.current) {
      L.push('  - This prompt was edited by hand before the card last changed; read it against the files.');
    }
    return L.join('\n') + '\n';
  }

  /* The picture behind a still asset: the full-size original where the board
     holds one, the board copy otherwise. */
  function stillUrl(p, shot, a, figures) {
    if (a.kind === 'clay-still') return SB.Renders.dataUrl(p, shot.pose.render) || SB.Blobs.src(p, shot.pose.image);
    if (a.kind === 'first-frame') return SB.Renders.dataUrl(p, shot.render) || SB.Blobs.src(p, shot.image);
    const x = (figures || []).filter(function (f) { return f.asset === a; })[0];
    return x ? (SB.Renders.dataUrl(p, x.render) || SB.Blobs.src(p, x.img)) : '';
  }

  /* anything that is neither PNG nor JPEG goes up as JPEG */
  function asJpeg(u) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.onload = function () {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const x = c.getContext('2d');
        x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
        x.drawImage(img, 0, 0);
        resolve(c.toDataURL('image/jpeg', 0.95));
      };
      img.onerror = function () { reject(new Error('a picture could not be decoded')); };
      img.src = u;
    });
  }

  /* data URL or Blob for one asset, in the type its name says */
  function assetData(p, shot, a, m) {
    if (a.kind === 'clay-clip') {
      return SB.Pose.clip(shot, { pass: 'beauty' }).then(function (r) { return r.blob; });
    }
    const u = stillUrl(p, shot, a, m.figures);
    if (!u) return Promise.resolve('');
    if (a.ext === 'png' || /^data:image\/jpe?g/i.test(u)) return Promise.resolve(u);
    return asJpeg(u);
  }

  /* Everything, resolved: [{name, data (Blob | dataURL | text)}], in upload order,
     plus prompt.txt and ORDER.txt. Names follow the real bytes' type. */
  function files(p, shot, lane) {
    const m = manifest(p, shot, lane);
    const pr = promptFor(p, shot, lane, m);
    const out = [];
    return m.assets.reduce(function (chain, a) {
      return chain.then(function () {
        return assetData(p, shot, a, m).then(function (d) {
          if (!d) throw new Error('the file for ' + a.label + ' (' + a.role + ') is missing');
          out.push({ name: a.file, data: d, asset: a });
        });
      });
    }, Promise.resolve()).then(function () {
      out.push({ name: 'prompt.txt', data: pr.text + '\n' });
      out.push({ name: 'ORDER.txt', data: orderText(m, pr) });
      return { manifest: m, prompt: pr, files: out };
    });
  }

  function toBytes(d) {
    if (typeof d === 'string') {
      if (/^data:/.test(d)) return Promise.resolve(SB.Zip.fromDataUrl(d));
      return Promise.resolve(new TextEncoder().encode(d));
    }
    if (d && typeof d.arrayBuffer === 'function') return d.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    return Promise.resolve(new Uint8Array(0));
  }

  function zipName(m) { return (slug(m.code) || 'shot') + '_minimax_' + (m.lane === 'image' ? 'still' : 'video'); }

  /* One zip: <code>_minimax_<lane>/01_clay.png … prompt.txt ORDER.txt */
  function zip(p, shot, lane) {
    return files(p, shot, lane).then(function (pk) {
      const dir = zipName(pk.manifest) + '/';
      return Promise.all(pk.files.map(function (f) {
        return toBytes(f.data).then(function (b) { return { name: dir + f.name, data: b }; });
      })).then(function (entries) {
        return { blob: SB.Zip.store(entries), name: zipName(pk.manifest) + '.zip', pk: pk };
      });
    });
  }

  function save(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  function copy(text) {
    try { return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; }); }
    catch (e) { return Promise.resolve(false); }
  }

  /* ------------------------------------------------------------ the dialog */

  function open(shot, lane) {
    const p = P();
    const f = SB.Model.findShot(p, shot.id);
    if (!f) return;
    const body = SB.el('div', 'mxm');
    let dlg = null;
    const render = function () {
      body.innerHTML = '';
      const m = manifest(p, shot, lane);
      const pr = promptFor(p, shot, lane, m);
      const top = SB.el('div', 'mxm-row');
      top.appendChild(SB.el('span', 'mxm-k', 'Model'));
      top.appendChild(SB.el('span', null, lane === 'image' ? 'MiniMax Image' : 'MiniMax H3, full reference' +
        (m.duration != null ? ' · ' + m.duration + ' s' : '') + ' · ' + m.aspect));
      body.appendChild(top);

      body.appendChild(SB.el('div', 'mxm-h', 'Upload in this order'));
      const list = SB.el('ol', 'mxm-files');
      m.assets.forEach(function (a) {
        const li = SB.el('li');
        li.appendChild(SB.el('code', null, a.file));
        li.appendChild(SB.el('span', 'mxm-lab', lane === 'image' ? a.label : a.h3));
        li.appendChild(SB.el('span', 'mxm-role', a.role));
        list.appendChild(li);
      });
      if (!m.assets.length) list.appendChild(SB.el('li', 'mxm-none', 'No files — the prompt is words only.'));
      body.appendChild(list);

      if (m.warnings.length || !pr.current) {
        const w = SB.el('ul', 'mxm-warn');
        m.warnings.forEach(function (x) { w.appendChild(SB.el('li', null, x)); });
        if (!pr.current) w.appendChild(SB.el('li', null, 'This prompt was edited by hand before the card last changed — read it against the files, or Reset it.'));
        body.appendChild(w);
      }

      const hrow = SB.el('div', 'mxm-h', 'prompt.txt');
      hrow.appendChild(SB.el('span', 'mxm-src', pr.source === 'writer' ? 'written by the writer model'
        : pr.source === 'edited' ? 'edited by hand' : lane === 'video' ? 'assembled — Write for the full description' : 'assembled from the board'));
      body.appendChild(hrow);
      const ta = SB.el('textarea', 'mxm-prompt');
      ta.value = pr.text;
      ta.rows = lane === 'image' ? 12 : 18;
      ta.spellcheck = false;
      ta.addEventListener('change', function () {
        if (ta.value === pr.text) return;
        remember(shot, lane, { prompt: ta.value, sig: m.sig, edited: true });
        SB.app.changed(true);
        render();
      });
      body.appendChild(ta);

      const st = SB.el('details', 'mxm-style');
      st.appendChild(SB.el('summary', null, 'Style and negatives (this board)'));
      const s0 = settings(p);
      const sIn = SB.el('input'); sIn.type = 'text'; sIn.value = s0.style;
      const nIn = SB.el('input'); nIn.type = 'text';
      nIn.value = (lane === 'image' ? s0.negImage : s0.negVideo).join(', ');
      const lab = function (t, el) { const l = SB.el('label', 'field'); l.appendChild(SB.el('span', null, t)); l.appendChild(el); return l; };
      st.appendChild(lab('Style', sIn));
      const minIn = SB.el('input'), maxIn = SB.el('input');
      minIn.type = maxIn.type = 'text'; minIn.size = maxIn.size = 4;
      minIn.value = s0.minS; maxIn.value = s0.maxS;
      if (lane === 'video') {
        const row = SB.el('div', 'mxm-dur');
        row.appendChild(lab('Shortest clip your H3 makes (s)', minIn));
        row.appendChild(lab('Longest (s)', maxIn));
        st.appendChild(row);
      }
      st.appendChild(lab(lane === 'image' ? 'Negatives — first frame (comma-separated, without “no”)' : 'Negatives — video (comma-separated, without “no”)', nIn));
      const saveSt = function () {
        const cur = p.settings.mxm = Object.assign({}, p.settings.mxm || {});
        cur.style = tidy(sIn.value) === DEFAULT_STYLE ? '' : tidy(sIn.value);
        const list2 = nIn.value.split(',').map(tidy).filter(Boolean);
        cur[lane === 'image' ? 'negImage' : 'negVideo'] = list2;
        if (lane === 'video') { cur.minS = Math.round(+minIn.value) || 0; cur.maxS = Math.round(+maxIn.value) || 0; }
        SB.app.changed(true);
        render();
      };
      [sIn, nIn, minIn, maxIn].forEach(function (el) { el.addEventListener('change', saveSt); });
      body.appendChild(st);
      body.dataset.sig = m.sig;
    };
    render();

    const status = function (t, bad) { SB.toast(t, !!bad); };
    const buttons = [];
    if (lane === 'video') {
      buttons.push({ label: 'Write', onClick: function (close, b) {
        const btn = [].slice.call(dlg.root.querySelectorAll('.foot .tb')).filter(function (x) { return x.textContent.indexOf('Write') === 0; })[0];
        if (btn) { btn.disabled = true; btn.textContent = 'Writing…'; }
        SB.Prompts.writeMxm(shot).then(function () {
          status('Video prompt written for ' + f.code + '.');
        }).catch(function (e) {
          status('Could not write it: ' + (e.message || e), true);
        }).then(function () {
          if (btn) { btn.disabled = false; btn.textContent = 'Write'; }
          render();
        });
      } });
    }
    buttons.push({ label: 'Reset prompt', onClick: function () {
      if (shot.mxm) { delete shot.mxm[lane]; SB.app.changed(true); }
      render();
    } });
    buttons.push({ label: 'Copy prompt', onClick: function () {
      const ta = body.querySelector('.mxm-prompt');
      copy(ta ? ta.value : '').then(function (ok) { status(ok ? 'Prompt copied.' : 'Copy failed — select the text and copy it.', !ok); });
    } });
    buttons.push({ label: 'Download zip', primary: true, onClick: function () {
      const btn = [].slice.call(dlg.root.querySelectorAll('.foot .tb')).filter(function (x) { return x.textContent === 'Download zip'; })[0];
      if (btn) { btn.disabled = true; btn.textContent = 'Packing…'; }
      zip(p, shot, lane).then(function (z) {
        save(z.blob, z.name);
        return copy(z.pk.prompt.text).then(function (ok) {
          status(z.name + ': ' + z.pk.manifest.assets.length + ' file' + (z.pk.manifest.assets.length === 1 ? '' : 's') +
            ', prompt.txt and ORDER.txt' + (ok ? ' — the prompt is on the clipboard too.' : '.'));
        });
      }).catch(function (e) {
        status('The package could not be made: ' + (e.message || e), true);
      }).then(function () { if (btn) { btn.disabled = false; btn.textContent = 'Download zip'; } });
    } });
    buttons.push({ label: 'Close' });
    dlg = SB.modal({ title: 'MiniMax — ' + f.code + ' ' + (lane === 'image' ? 'first frame' : 'video'), body: body, width: '640px', buttons: buttons });
    dlg.root.classList.add('mxm-back');
    return dlg;
  }

  SB.Mxm = {
    H3_LIMITS: H3, DEFAULT_STYLE: DEFAULT_STYLE, NEG_IMAGE: NEG_IMAGE, NEG_VIDEO: NEG_VIDEO,
    settings: settings, manifest: manifest, brief: brief,
    h3Scaffold: h3Scaffold, h3Rider: h3Rider, h3Fallback: h3Fallback, h3Prompt: h3Prompt,
    promptFor: promptFor, remember: remember, stored: stored,
    orderText: orderText, files: files, zip: zip, zipName: zipName, open: open,
    assetData: assetData
  };

})(window.SB);
