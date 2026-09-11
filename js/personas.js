/* personas.js — the recurring subjects of a board: the people, the places and
 * the things that have to come back looking the same shot after shot.
 *
 * One record covers all three. A subject holds a kind, a description, the
 * prompt that makes its reference frame, and the reference images themselves
 * (≤480p proxies, like every other image here) — several of them, because one
 * angle rarely pins a person or a room down. Shots name the subjects that
 * appear in them; the prompt writer then gets both the description AND the
 * phrasing that particular model expects for reference images — Qwen wants
 * "the person in image 1", others want something else.
 *
 * The storage key is still `personas` and shots still carry `personaIds`: the
 * name is historical, the contents are not. Renaming it would churn migration,
 * every frozen version snapshot and the blob walkers for no user-visible gain.
 */
(function (SB) {
  'use strict';

  /* How a model wants to be told about reference images. {{N}} = the image's
   * position, {{NAME}} = the persona's name. */
  const REF_TEMPLATES = {
    numbered: 'Reference images are supplied in order. Refer to each recurring subject as ' +
      '"the person in image {{N}}" and keep their face, hair and wardrobe exactly as in that image.',
    named: 'Reference images are supplied for each named subject. Refer to them by name ' +
      '({{NAME}}) and keep their face, hair and wardrobe exactly as in the reference.',
    none: ''
  };

  const DEFAULT_REF_TEMPLATE = REF_TEMPLATES.numbered;

  /* What every reference frame wants, whatever it is a frame of.
   *
   * Nothing here used to mention focus, so a portrait brief plus a house style
   * that asks for aperture and grade produced "shallow depth of field, f/2.0,
   * subtle cinematic grain" — which softens the fabric and shifts the colour,
   * the two things the frame exists to record. The grade belongs on the shots,
   * not on the reference. */
  const NEUTRAL_REF = 'A reference frame is a neutral record, not a graded shot: ' +
    'everything in sharp focus, deep depth of field, no background blur, accurate colour, ' +
    'no grain and no grade';

  /* The three kinds of recurring subject. They differ only in what you are
   * being asked to write down and how the block addresses them — the record,
   * the reference images and the casting are identical, because to an image
   * model a room that must not change is the same problem as a face that must
   * not change. */
  const KINDS = [
    {
      id: 'person', label: 'Person', plural: 'Cast', one: 'person',
      heading: 'CAST — these people recur across the board. They must look the same every time.',
      descLabel: 'description + wardrobe',
      descHint: 'Age range, build, hair, and the exact outfit — fabric and colour.',
      noImage: 'No reference image — describe this person fully and identically every time.',
      refBrief: 'a clean, front-facing reference frame of this person: plain background, ' +
        'even natural light, neutral expression, full length from head to feet with the whole ' +
        'outfit in frame. ' + NEUTRAL_REF
    },
    {
      id: 'place', label: 'Location', plural: 'Locations', one: 'location',
      heading: 'LOCATIONS — these places recur across the board. They must look the same every time.',
      descLabel: 'the place, and what is fixed about it',
      descHint: 'Architecture, surfaces, furniture, light sources, time of day — what never changes.',
      noImage: 'No reference image — describe this place fully and identically every time.',
      refBrief: 'a clean establishing reference frame of this place: wide, eye level, ' +
        'no people in shot, the light as it normally is there. ' + NEUTRAL_REF
    },
    {
      id: 'thing', label: 'Object', plural: 'Objects', one: 'object',
      heading: 'OBJECTS — these props, products and screens recur across the board. ' +
        'They must look the same every time.',
      descLabel: 'the object, product or screen',
      descHint: 'Form, size, material, finish, colour, and any logo or screen state that must be exact.',
      noImage: 'No reference image — describe this object fully and identically every time.',
      refBrief: 'a clean product-style reference frame of this object: plain background, ' +
        'even light, three-quarter view, the whole object in frame. ' + NEUTRAL_REF
    }
  ];

  function kindOf(per) {
    const k = per && per.kind;
    return KINDS.filter(function (x) { return x.id === k; })[0] || KINDS[0];
  }

  /* More than this on one subject and most image models start averaging the
   * references together instead of reading them. A warning, not a limit. */
  const IMAGE_ADVICE = 4;

  function newPersona(opts) {
    opts = opts || {};
    return {
      id: SB.uid('per'),
      kind: kindOf({ kind: opts.kind }).id,
      name: opts.name || 'New ' + kindOf({ kind: opts.kind }).one,
      description: opts.description || '',
      imagePrompt: opts.imagePrompt || '',
      /* [{ref,w,h,label}] — the reference frames. A lone `image` is still
       * accepted: it is what every caller wrote before there could be more
       * than one, and it costs a line to keep them working. */
      images: (opts.images || []).slice().concat(opts.image ? [opts.image] : []),
      updatedAt: Date.now()
    };
  }

  /* ---- the reference image ----
   *
   * One per subject. It used to be a list, and the whole app was shaped around
   * that list — ranges in the cast block ("images 3–5 — Nat"), a number per
   * photo in the feed, an anchor per photo for H3, promote/label/remove per
   * frame in the panel — but nothing ever sent more than one anywhere. A push
   * carries a single picture, so the extra numbering was a promise made to a
   * person who then dragged the files in by hand, and on a full-reference
   * model the prompt named pictures the call never received.
   *
   * Cutting it to one made a guard sentence disappear rather than be
   * maintained: the cast block had to explain that several images under one
   * name were the same person, which is a workaround for a feature nobody
   * could use. Two angles of a subject are now two subjects — "Nat" and
   * "Nat (back)" — which is what the numbering could always express.
   *
   * `imagesOf` survives as a list of nought or one, so every reader — the
   * feed, the blocks, the export — keeps working unchanged.
   */
  function imagesOf(per) {
    if (!per) return [];
    /* `images` is what an unmigrated board carries — a hand-built fixture, a
     * snapshot restored out of an old file. The live field is `image`. */
    if (per.image) return [per.image];
    if (per.images && per.images.length) return [per.images[0]];
    return [];
  }
  function hero(per) { return imagesOf(per)[0] || null; }
  function hasImage(per) { return !!hero(per); }

  /* Frames a board carried before the cut, kept rather than deleted: since
   * originals live in the .storyboard, dropping them on open would destroy the
   * only copy. They are fed to nothing and exported by nothing, and the panel
   * offers to use one or delete them. */
  function retiredOf(per) {
    return (per && Array.isArray(per.retired)) ? per.retired : [];
  }

  /* Replaces whatever is there. Returns the record, which is what the caller
   * hangs the full-size original on when its encode finishes. */
  function setImage(per, img, label, render) {
    if (!per || !img) return null;
    const rec = { ref: img.ref, w: img.w, h: img.h, label: label || '', render: render || null };
    per.image = rec;
    delete per.images;
    touch(per);
    return rec;
  }

  function clearImage(per) {
    if (!per) return;
    delete per.image;
    delete per.images;
    touch(per);
  }

  function labelImage(per, label) {
    const rec = hero(per);
    if (!rec) return;
    rec.label = label || '';
    per.image = rec;
    delete per.images;
    touch(per);
  }

  /* Swap a retired frame into the slot: the one that is there joins the
   * retired list rather than being thrown away. */
  function useRetired(per, idx) {
    const list = retiredOf(per).slice();
    if (idx < 0 || idx >= list.length) return;
    const pick = list.splice(idx, 1)[0];
    const had = hero(per);
    if (had) list.push(had);
    per.image = pick;
    delete per.images;
    per.retired = list;
    if (!per.retired.length) delete per.retired;
    touch(per);
  }

  function dropRetired(per) {
    if (!per) return;
    delete per.retired;
    touch(per);
  }

  /* A prompt already written into a card is a snapshot of the persona as it read
   * at the time. Editing the persona does not — cannot — reach back into it, so
   * the edit is stamped and the card can say it has fallen behind. */
  function touch(per) {
    if (per) per.updatedAt = Date.now();
  }

  /* The newest edit among everything this shot FEEDS, or 0 if none of it has
   * ever been stamped (a board written before this was recorded — unknowable,
   * so it is never reported as stale).
   *
   * The feed, not the cast, because those two stopped being the same thing:
   * a subject can be marked without being cast, and a shot riffing off another
   * feeds that shot's rendered frame. Both were invisible here — so the two
   * changes most likely to invalidate a derived prompt (a retake of the source
   * frame, an edit to a marked-but-uncast subject) were the two this did not
   * notice. */
  function editedAt(p, shot) {
    let at = 0;
    const seen = {};
    forShot(p, shot).forEach(function (per) {
      seen[per.id] = 1;
      at = Math.max(at, per.updatedAt || 0);
    });
    (SB.Refs ? SB.Refs.feed(p, shot) : []).forEach(function (e) {
      if (e.kind === 'subject' && e.subject && !seen[e.subject.id]) {
        at = Math.max(at, e.subject.updatedAt || 0);
      }
      /* a source frame that has been re-rendered since */
      if (e.kind === 'shot' && e.renders) {
        e.renders.forEach(function (r) { if (r) at = Math.max(at, r.at || 0); });
      }
    });
    return at;
  }

  /* Has this shot's stored prompt fallen behind its cast? `at` is the stamp the
   * prompt was written with (prompts.js store()). */
  function staleFor(p, shot, at) {
    if (!at) return false;
    const ed = editedAt(p, shot);
    return !!ed && ed > at;
  }

  function all(p) { return (p.personas = p.personas || []); }

  function find(p, id) {
    return all(p).filter(function (x) { return x.id === id; })[0] || null;
  }

  function add(p, opts) {
    const per = newPersona(opts);
    all(p).push(per);
    return per;
  }

  function remove(p, id) {
    p.personas = all(p).filter(function (x) { return x.id !== id; });
    SB.Model.eachShot(p, function (sh) {
      sh.personaIds = (sh.personaIds || []).filter(function (x) { return x !== id; });
      sh.castEnters = (sh.castEnters || []).filter(function (x) { return x !== id; });
    });
  }

  /* The subjects in a shot, in the order their reference images should be fed.
   * Deduped: a file written by hand or by another tool can name the same
   * subject twice, which listed them twice in the block and made a nonsense of
   * the image numbering ("images 1–3" for a subject holding images 1 and 3). */
  function forShot(p, shot) {
    const seen = {};
    return (shot.personaIds || []).map(function (id) { return find(p, id); })
      .filter(function (per) {
        if (!per || seen[per.id]) return false;
        seen[per.id] = 1;
        return true;
      });
  }

  function toggleOnShot(p, shot, id) {
    shot.personaIds = shot.personaIds || [];
    const i = shot.personaIds.indexOf(id);
    if (i >= 0) {
      shot.personaIds.splice(i, 1);
      setEnters(shot, id, false);      // taken off the card, so not arriving on it either
    } else shot.personaIds.push(id);
  }

  /* ---- present when the shot opens, or arriving during it ----
   *
   * The first frame is one instant. Everything else about this was the writer
   * being told, in prose, to work out from the description who was already
   * there — and it got it wrong, because the CAST block reads like a guest
   * list. This is the same answer as data, so nothing has to be inferred. */
  function enters(shot, id) {
    return ((shot && shot.castEnters) || []).indexOf(id) >= 0;
  }

  function setEnters(shot, id, on) {
    if (!shot) return;
    const list = shot.castEnters = (shot.castEnters || []).slice();
    const i = list.indexOf(id);
    if (on && i < 0) list.push(id);
    if (!on && i >= 0) list.splice(i, 1);
  }

  function toggleEnters(shot, id) { setEnters(shot, id, !enters(shot, id)); }

  /* The cast as the first frame sees it. */
  function presentAtOpen(p, shot) {
    return forShot(p, shot).filter(function (per) { return !enters(shot, per.id); });
  }
  function arriving(p, shot) {
    return forShot(p, shot).filter(function (per) { return enters(shot, per.id); });
  }

  /* Everything of one kind, in board order. */
  function ofKind(p, kind) {
    return all(p).filter(function (x) { return kindOf(x).id === kind; });
  }

  /* ---- the CAST block appended to the system instruction for one job ----
   *
   * Reference images are numbered once across the whole block, in cast order,
   * because the number is a promise about the order the images are handed to
   * the model — and that order does not restart per kind.
   */
  /* The cast block for a frame-only video job.
   *
   * This block exists to say how subjects LOOK, and on this one job that is
   * the one thing already settled: the first frame is supplied as a picture
   * and everybody in it is in it. Sent in full anyway — descriptions, wardrobe,
   * a numbered mapping for images this call never receives, and a paragraph
   * declaring all of it the authoritative record of their appearance — it read
   * as an instruction to write the appearance down, and the motion got a clause
   * at the end.
   *
   * What the writer still needs is the names to use, and the one group genuinely
   * missing from the picture: whoever arrives after it.
   */
  function videoCastBlock(p, shot, cast) {
    const late = arriving(p, shot);
    const isLate = {};
    late.forEach(function (x) { isLate[x.id] = 1; });
    const present = cast.filter(function (x) { return !isLate[x.id]; });
    const lines = [];

    if (present.length) {
      lines.push('WHO AND WHAT IS IN THE SUPPLIED FRAME — use these names.');
      present.forEach(function (per) {
        lines.push('  ' + (per.name || 'unnamed') + ' (' + kindOf(per).one + ')');
      });
      lines.push('Use the names. Write what they DO, not how they look.');
    }

    /* The exception, and the reason this block is not simply dropped: somebody
     * who walks in after the first frame is not in the picture, so the words
     * are the only record of what they look like there will ever be.
     *
     * What is NOT missing is the entrance. "Bob enters through the far doors
     * behind her" is in the shot description, and this block used to end by
     * asking the writer to say where each one comes from and when — inviting it
     * to invent staging the board had already written down, and to overrule it
     * when the two disagreed. Appearance is the gap here; the entrance never
     * was. */
    if (late.length) {
      lines.push('');
      lines.push('NOT IN THE SUPPLIED FRAME — these arrive during the shot, so the words are the ' +
        'only record of what they look like:');
      late.forEach(function (per) {
        const d = (per.description || '').replace(/\s+/g, ' ').trim();
        lines.push('  ' + (per.name || 'unnamed') + ': ' + (d || '(no description yet)'));
      });
      lines.push('How and when each one enters is in the shot description. Follow it exactly — ' +
        'do not invent a door, a direction or a moment it does not give.');
    }

    return lines.join('\n');
  }

  function block(p, shot, model, role) {
    /* image N -> which subject, assigned before anything is written so the
     * per-kind sections can cite numbers the mapping will agree with */
    const numbered = SB.Refs.images(p, shot);
    /* Every subject in the FEED, in feed order — not just the cast. A subject
     * can be marked without being cast (a mark written by hand, a name linked
     * from the card), and describing only the cast left images numbered in the
     * mapping with no entry above them, under a paragraph claiming the entries
     * above were the complete and authoritative record. */
    const cast = SB.Refs.feed(p, shot)
      .filter(function (e) { return e.kind === 'subject'; })
      .map(function (e) { return e.subject; });
    /* A card can feed images with nobody cast on it — a shot mark from a riff,
     * or a mark written by hand, neither of which casts anyone. Bailing on an
     * empty cast then sent the files with no mapping at all, so the prompt said
     * nothing about images the person was about to hand over. */
    if (!cast.length && !numbered.length) return '';
    /* Frame-only video takes the short block above: no mapping, because this
     * call is shown no reference images, and no appearance, because the frame
     * carries it. A full-reference model keeps the long one — there the
     * appearance lines are the format, binding each label to a picture. */
    if (role === 'video' && SB.Model.videoInherits(model)) {
      return videoCastBlock(p, shot, cast);
    }
    /* One reference per subject, so one number — the ranges this used to
     * write ("images 3–5 — Nat") went with the list. */
    const rangeFor = function (per) {
      const mine = numbered.filter(function (e) { return e.id === per.id; })[0];
      return mine ? 'image ' + mine.n + ' — ' : '';
    };

    const lines = [];
    KINDS.forEach(function (kind) {
      const mine = cast.filter(function (x) { return kindOf(x).id === kind.id; });
      if (!mine.length) return;
      lines.push(kind.heading);
      mine.forEach(function (per, i) {
        const bits = [];
        bits.push(rangeFor(per) + (per.name || 'unnamed'));
        const d = (per.description || '').replace(/\s+/g, ' ').trim();
        bits.push(d || '(no description yet)');
        /* Marked rather than dropped: the image numbering has to mean the same
           thing in both prompts, because it is the order the person feeding the
           model puts their files in. */
        const late = enters(shot, per.id) ? '  [ARRIVES DURING THE SHOT — NOT IN THE FIRST FRAME]' : '';
        lines.push('  ' + (i + 1) + '. ' + bits.join(': ') + late);
        if (!hasImage(per)) lines.push('     ' + kind.noImage);
      });
    });

    const subjectImages = numbered.filter(function (e) { return e.kind === 'subject'; });
    if (numbered.length) {
      /* The per-model wording is about recurring SUBJECTS ("the person in image
       * N"). Sending it when the only image is another shot's whole frame told
       * the model to treat a frame as a face. */
      const tpl = subjectImages.length
        ? ((model && typeof model.referenceTemplate === 'string')
          ? model.referenceTemplate : DEFAULT_REF_TEMPLATE)
        : '';
      const names = cast.filter(hasImage).map(function (x) { return x.name; }).join(', ');
      lines.push(tpl.replace(/\{\{N\}\}/g, function () { return 'N'; })
        .replace(/\{\{NAME\}\}/g, names));
      /* The mapping is the feed's, not this block's: a shot's own rendered
         frame is a reference like any other, and the numbers have to agree
         with the strip on the card and with the files the person is about to
         drop in. */
      SB.Refs.images(p, shot).forEach(function (e) {
        lines.push('  image ' + e.n + ' = ' + e.label + (e.role ? ' (' + e.role + ')' : ''));
      });
    }
    /* The shot description may itself name a wardrobe — older boards baked the
     * subject into every description, and that copy went stale the moment the
     * persona was edited. This block is the live record, so it is declared to
     * win outright rather than deferring to whatever the description says. */
    lines.push('The descriptions above are the CURRENT and AUTHORITATIVE record of how these ' +
      'people, places and things look. Where the shot description says anything different about ' +
      'their appearance, hair, wardrobe or surroundings, it is out of date — follow this block ' +
      'and ignore it. The shot description still governs what they are DOING and where.');

    /* ...and this block was being read as a guest list. It names everyone cast
     * in the shot and hands over a numbered reference image for each, which to
     * a writer looks like a manifest of who is in the picture — so somebody the
     * description had walking in later was drawn standing in the first frame.
     * What it actually answers is "how do they look", never "who is here". */
    const late = arriving(p, shot);
    if (role === 'image' || role === 'both') {
      const who = role === 'both' ? 'In the FIRST-FRAME PROMPT, only' : 'Only';
      lines.push('This block says how these subjects LOOK. It is not a list of who or what is ' +
        'visible in the frame you are writing — the shot description decides that, and a ' +
        'reference image being supplied does not mean the subject is in this frame. ' +
        who + ' draw the ones present at the instant the shot opens. ' +
        'Anything arriving, entering or appearing later is not in the frame yet' +
        (role === 'both' ? ' — it belongs to the video prompt.' : '.'));
      if (late.length) {
        lines.push('MARKED AS ARRIVING, AND THEREFORE ABSENT FROM THE FIRST FRAME: ' +
          late.map(function (x) { return x.name || 'unnamed'; }).join(', ') + '. ' +
          'Do not draw them, and do not hint at them with an opening door, a shadow or a ' +
          'look off-screen. The frame is what the camera sees before they arrive.');
      }
    }
    /* Only true of a frame-only model. Sent unconditionally, it reached the H3
     * job and told it not to use the <Picture N> labels that job's own template
     * demands and its self-check spends a corrective call enforcing — the two
     * halves of one request arguing with each other. With role 'video' now
     * taking the short block above, what is left here is the combined job. */
    if (numbered.length && role === 'both' && SB.Model.videoInherits(model)) {
      lines.push('The image-to-video call is given ONE picture — the first frame — so the video ' +
        'prompt must not refer to image numbers. Name people and things by name there, and do ' +
        'not describe how they look: the frame already shows it.');
    }
    /* role 'video' now says this in videoCastBlock, with the descriptions the
     * arrivals need; what reaches here is 'both' and full-reference. */
    if (late.length && (role === 'video' || role === 'both')) {
      lines.push('ARRIVING DURING THE SHOT: ' +
        late.map(function (x) { return x.name || 'unnamed'; }).join(', ') +
        ' — they enter after the first frame, so their arrival is movement this prompt covers.');
    }
    /* Last, because it overrides what everything above it says.
     *
     * A frame of another shot is not a reference to a face — it is the picture
     * this one is derived FROM, and the prompt has to come out as an edit of
     * it. Told merely how to "treat" the image, the writer ignored image 1
     * entirely and rebuilt the room from scratch, which is the one thing the
     * source frame exists to prevent. So this is a constraint on the OUTPUT,
     * and it says which instructions above it cancels. */
    const shots = SB.Refs.feed(p, shot).filter(function (e) {
      return e.kind === 'shot' && e.images.length;
    });
    if (shots.length && (role === 'image' || role === 'both')) {
      const which = shots.map(function (e) {
        return 'image ' + (e.numbers[0] || '?') + ' is the whole rendered frame of shot ' + e.label;
      }).join('; ');
      lines.push('THE SOURCE FRAME — READ THIS LAST, IT OVERRIDES THE ABOVE');
      lines.push(which + '. It is not a subject and not a face: it is the frame this one is ' +
        'derived from.');
      lines.push('The prompt you write is an EDIT of that frame, not a fresh description of a ' +
        'scene. Open it by naming the image — "Starting from image ' +
        (shots[0].numbers[0] || 1) + ', …" — then state ONLY what changes: the camera, the ' +
        'framing, the moment. Do NOT re-describe the place, the light, the lens, the grade or ' +
        'the wardrobe, and do not re-establish the setting: all of it is inherited from that ' +
        'frame unchanged, and describing it again is what makes the edit come back as a ' +
        'different shot. Any instruction above to describe the setting, the lighting or the ' +
        'lens does not apply to what is inherited.');
    }

    return lines.join('\n');
  }

  /* ---- the description says somebody walks in, but nobody is marked ----
   *
   * The mark is the only thing that makes this deterministic, so it has to be
   * findable. This is the same shape as the wardrobe sweep: the board spots the
   * contradiction and offers the fix, rather than leaving it to be discovered
   * in a rendered frame with an extra person standing in it. */
  const ARRIVAL_RE = new RegExp('\\b(' + [
    'walks? in', 'walks? into', 'steps? in', 'steps? into', 'comes? in', 'enters?', 'entering',
    'arrives?', 'arriving', 'appears?', 'joins?', 'approaches?', 'crosses into',
    /* verb-anchored only: a bare "into frame" matched "a hand comes into
     * frame", which is the commonest insert phrasing there is */
    'moves? into (?:the )?(?:frame|shot)'
  ].join('|') + ')\\b', 'i');

  /* True when the text reads as somebody turning up partway through. */
  function readsAsArrival(desc) {
    return ARRIVAL_RE.test(String(desc || ''));
  }

  /* ---- generate subjects from the brand + the master script ---- */

  /* What the writer is being asked for, per kind. The name is always a board
   * handle rather than whatever the script calls the thing, because the handle
   * is what gets typed after an @ for the rest of the project. */
  const GEN_BRIEF = {
    person: {
      ask: 'recurring on-camera',
      unit: ['person', 'people'],
      name: 'a short label for the board. If the script names this person, USE THAT NAME — it is ' +
        'what somebody will type after an @ for the rest of the project. Only invent a handle ' +
        'like "Ops lead" when the script leaves them unnamed.',
      desc: 'who they are on camera and, critically, exactly what they look like and are WEARING. ' +
        'Age range, build, hair, skin tone, and a specific outfit described down to fabric and colour. ' +
        'This text is what keeps them identical from shot to shot, so be concrete and complete.'
    },
    place: {
      ask: 'recurring',
      unit: ['location', 'locations'],
      name: 'a short label for the board — the script\'s own name for the place if it has one, ' +
        'otherwise a handle like "Server room" or "Loading bay".',
      desc: 'what the place is and exactly what it looks like: architecture, surfaces, furniture, ' +
        'light sources, time of day, and anything fixed that must not drift between shots. ' +
        'Describe the room, not the action in it.'
    },
    thing: {
      ask: 'recurring',
      unit: ['object, product or screen', 'objects, products or screens'],
      name: 'a short label for the board — the script\'s own name for it if it has one, ' +
        'otherwise a handle like "Handset" or "Dashboard".',
      desc: 'what the object is and exactly what it looks like: form, size, material, finish, ' +
        'colour, and any logo, label or on-screen state that has to be identical every time. ' +
        'Do not invent a brand name, logo, model number or asset tag: if the script does not ' +
        'name one, say the surface is unbranded and leave any screen text generic.'
    }
  };

  const GEN_SCHEMA = {
    type: 'OBJECT',
    properties: {
      personas: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING' },
            description: { type: 'STRING' },
            imagePrompt: { type: 'STRING' }
          },
          required: ['name', 'description', 'imagePrompt']
        }
      }
    },
    required: ['personas']
  };

  function generate(p, count, extraNote, kind) {
    const k = kindOf({ kind: kind });
    const brief = GEN_BRIEF[k.id];
    const script = (p.master.text || '').trim();
    const descs = [];
    SB.Model.eachShot(p, function (sh) {
      if (sh.description) descs.push(SB.Refs.plain(p, sh.description));
    });
    if (!script && !descs.length) {
      return Promise.reject(new Error('Nothing to work from yet — write some script or shot descriptions first.'));
    }

    const model = SB.Model.imageModel(p);
    const text = [
      'Read the script below and invent ' + count + ' ' + brief.ask + ' ' +
      (count === 1 ? brief.unit[0] : brief.unit[1]) + ' for this video.',
      '',
      'For each one return:',
      '- name: ' + brief.name,
      '- description: ' + brief.desc,
      '- imagePrompt: a single still-image prompt that would produce ' + k.refBrief +
      ', for ' + (model ? model.name : 'an image model') + '. It must obey the house style.',
      '',
      extraNote ? 'Additional direction: ' + extraNote + '\n' : '',
      script ? 'SCRIPT:\n' + script.slice(0, 12000) : '',
      descs.length ? '\n\nSHOT DESCRIPTIONS:\n- ' + descs.slice(0, 40).join('\n- ') : ''
    ].join('\n');

    /* The exemption comes after the brand, because the last word wins and the
     * brand's Finishing line would otherwise put a grade on every record. */
    const brand = SB.Brand.brandOf(p);
    const system = brand.enabled
      ? 'HOUSE STYLE\n\n' + brand.text + '\n\n' + SB.Brand.REFERENCE_RIDER
      : SB.Brand.REFERENCE_RIDER;

    return SB.Prompts.raw(text, GEN_SCHEMA, system).then(function (out) {
      const made = (out.personas || []).map(function (x) {
        return add(p, {
          kind: k.id, name: x.name, description: x.description, imagePrompt: x.imagePrompt
        });
      });
      if (!made.length) throw new Error('Nothing came back');
      return made;
    });
  }

  SB.Personas = {
    REF_TEMPLATES: REF_TEMPLATES,
    DEFAULT_REF_TEMPLATE: DEFAULT_REF_TEMPLATE,
    KINDS: KINDS, kindOf: kindOf, ofKind: ofKind, IMAGE_ADVICE: IMAGE_ADVICE,
    newPersona: newPersona, all: all, find: find, add: add, remove: remove,
    imagesOf: imagesOf, hero: hero, hasImage: hasImage,
    setImage: setImage, clearImage: clearImage, labelImage: labelImage,
    retiredOf: retiredOf, useRetired: useRetired, dropRetired: dropRetired,
    forShot: forShot, toggleOnShot: toggleOnShot, block: block, generate: generate,
    enters: enters, setEnters: setEnters, toggleEnters: toggleEnters,
    presentAtOpen: presentAtOpen, arriving: arriving, ARRIVAL_RE: ARRIVAL_RE,
    readsAsArrival: readsAsArrival,
    touch: touch, editedAt: editedAt, staleFor: staleFor
  };

})(window.SB);
