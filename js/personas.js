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

  /* ---- reference images ----
   *
   * Boards written before this held a single `image`. Reading through here
   * rather than off the record means an unmigrated one — a hand-built test
   * fixture, a snapshot restored out of an old file — still answers. */
  function imagesOf(per) {
    if (!per) return [];
    if (per.images && per.images.length) return per.images;
    return per.image ? [per.image] : [];
  }
  function hero(per) { return imagesOf(per)[0] || null; }
  function hasImage(per) { return !!hero(per); }

  function addImage(per, img, label) {
    if (!per || !img) return null;
    per.images = imagesOf(per).slice();
    delete per.image;
    const rec = { ref: img.ref, w: img.w, h: img.h, label: label || '' };
    per.images.push(rec);
    touch(per);
    return rec;
  }

  function removeImage(per, idx) {
    if (!per) return;
    const list = imagesOf(per).slice();
    if (idx < 0 || idx >= list.length) return;
    list.splice(idx, 1);
    per.images = list;
    delete per.image;
    touch(per);
  }

  /* The first image is the one the board shows and the one a single-reference
   * model gets, so promoting is how you say "this is the shot of them". */
  function makeHero(per, idx) {
    if (!per) return;
    const list = imagesOf(per).slice();
    if (idx <= 0 || idx >= list.length) return;
    list.unshift(list.splice(idx, 1)[0]);
    per.images = list;
    delete per.image;
    touch(per);
  }

  function labelImage(per, idx, label) {
    const list = imagesOf(per);
    if (!list[idx]) return;
    list[idx].label = label || '';
    per.images = list;
    delete per.image;
    touch(per);
  }

  /* A prompt already written into a card is a snapshot of the persona as it read
   * at the time. Editing the persona does not — cannot — reach back into it, so
   * the edit is stamped and the card can say it has fallen behind. */
  function touch(per) {
    if (per) per.updatedAt = Date.now();
  }

  /* The newest edit among the people on this shot, or 0 if none of them has
   * ever been stamped (a board written before this was recorded — unknowable,
   * so it is never reported as stale). */
  function editedAt(p, shot) {
    return forShot(p, shot).reduce(function (a, per) {
      return Math.max(a, per.updatedAt || 0);
    }, 0);
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
  function block(p, shot, model, role) {
    const cast = forShot(p, shot);
    if (!cast.length) return '';

    /* image N -> which subject, assigned before anything is written so the
     * per-kind sections can cite numbers the mapping will agree with */
    const numbered = [];
    cast.forEach(function (per) {
      imagesOf(per).forEach(function (img) { numbered.push({ per: per, img: img }); });
    });
    const rangeFor = function (per) {
      const mine = [];
      numbered.forEach(function (n, i) { if (n.per === per) mine.push(i + 1); });
      if (!mine.length) return '';
      if (mine.length === 1) return 'image ' + mine[0] + ' — ';
      return 'images ' + mine[0] + '–' + mine[mine.length - 1] + ' — ';
    };

    const lines = [];
    let multi = false;
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
        if (imagesOf(per).length > 1) multi = true;
      });
    });

    if (numbered.length) {
      /* An empty string is an answer: this model takes no reference wording, and
       * the Settings box says so ("leave blank for a model that takes no
       * references"). Only a missing field falls back to the default — treating
       * blank as missing made that box impossible to obey. */
      const tpl = (model && typeof model.referenceTemplate === 'string')
        ? model.referenceTemplate : DEFAULT_REF_TEMPLATE;
      const names = cast.filter(hasImage).map(function (x) { return x.name; }).join(', ');
      lines.push(tpl.replace(/\{\{N\}\}/g, function () { return 'N'; })
        .replace(/\{\{NAME\}\}/g, names));
      numbered.forEach(function (n, i) {
        const lbl = (n.img && n.img.label || '').trim();
        lines.push('  image ' + (i + 1) + ' = ' + (n.per.name || 'unnamed') +
          (lbl ? ' (' + lbl + ')' : ''));
      });
      /* Several frames of one subject read as several subjects unless this is
       * said outright — the failure is a second person walking into the shot. */
      if (multi) {
        lines.push('Where more than one image is listed against the same name, they are the SAME ' +
          'subject seen from different angles — not different subjects. Do not add anybody or ' +
          'anything to the shot on account of the extra frames.');
      }
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
    if (late.length && (role === 'video' || role === 'both')) {
      lines.push('ARRIVING DURING THE SHOT: ' +
        late.map(function (x) { return x.name || 'unnamed'; }).join(', ') +
        ' — they enter after the first frame, so their arrival is movement this prompt covers.');
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
    'moves? into (?:the )?(?:frame|shot)', 'into (?:frame|shot)'
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
      name: 'a short label for the board (not a character name in the script — a handle like "Ops lead").',
      desc: 'who they are on camera and, critically, exactly what they look like and are WEARING. ' +
        'Age range, build, hair, skin tone, and a specific outfit described down to fabric and colour. ' +
        'This text is what keeps them identical from shot to shot, so be concrete and complete. ' +
        'No gendered language.'
    },
    place: {
      ask: 'recurring',
      unit: ['location', 'locations'],
      name: 'a short label for the board — a handle like "Server room" or "Loading bay".',
      desc: 'what the place is and exactly what it looks like: architecture, surfaces, furniture, ' +
        'light sources, time of day, and anything fixed that must not drift between shots. ' +
        'Describe the room, not the action in it.'
    },
    thing: {
      ask: 'recurring',
      unit: ['object, product or screen', 'objects, products or screens'],
      name: 'a short label for the board — a handle like "Handset" or "Dashboard".',
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
      if (sh.description) descs.push(sh.description);
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

    const system = SB.Brand.brandOf(p).enabled
      ? 'HOUSE STYLE — the reference frames you describe must obey this.\n\n' + SB.Brand.brandOf(p).text
      : '';

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
    addImage: addImage, removeImage: removeImage, makeHero: makeHero, labelImage: labelImage,
    forShot: forShot, toggleOnShot: toggleOnShot, block: block, generate: generate,
    enters: enters, setEnters: setEnters, toggleEnters: toggleEnters,
    presentAtOpen: presentAtOpen, arriving: arriving, ARRIVAL_RE: ARRIVAL_RE,
    readsAsArrival: readsAsArrival,
    touch: touch, editedAt: editedAt, staleFor: staleFor
  };

  /* The panel, the board and the mentions popover all deal in subjects, not
   * personas. Same object — the honest name for new code to read. */
  SB.Refs = SB.Personas;

})(window.SB);
