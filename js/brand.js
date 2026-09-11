/* brand.js — the house style every written prompt has to obey.
 *
 * This is a separate layer from the per-model templates: templates say HOW a
 * given model likes to be addressed, the brand says what the picture must look
 * and feel like. It rides along on every call as a system instruction.
 *
 * The app also supplies what a style guide can't know by itself — the scene's
 * beats, so "consistent subject / wardrobe / environment across consecutive
 * frames" is something the writer can actually act on.
 */
(function (SB) {
  'use strict';

  const DEFAULT_BRAND = [
    'CONSTRAINTS',
    '- Cinematic + technical: maintain professional photographic detail — focal length, aperture, distance/angle, depth of field, and lighting notes for the frame.',
    '- Vary angles subtly (slight high/low tilt, over-shoulder, profile, foreground obstructions) while staying coherent with the rest of the scene.',
    '- Include tactile props or environmental elements that support the story (fabric, glass, rain, reflections, paper, steam).',
    '- Finishing: "Capture RAW", "muted professional grade", "smooth tonal rolloff", "subtle cinematic grain", "controlled contrast".',
    '',
    'STYLE & TONE',
    '- Authentic, documentary-style realism.',
    '- Natural expressions: relaxed faces, genuine smiles, subtle emotion — never exaggerated.',
    '- Real human gestures: mid-conversation, mid-task, mid-thought.',
    '- Diversity across age, gender presentation, life stage and cultural background.',
    '- Inclusive and global representation appropriate for the region.',
    '- Slight imperfections that feel lived-in (gentle motion, natural falloff, real textures).',
    '- Professional yet approachable tone.',
    '- Colour palette matches real-world lighting — warm neutrals, soft highlights, no artificial gloss.',
    '',
    'CAMERA & TECHNICAL FEEL',
    '- Natural light only: window light, office daylight, practical lamps, soft outdoor light.',
    '- Shallow depth of field with a clear focal point that guides the viewer.',
    '- Clean exposure — avoid harsh highlights, avoid blown-out whites.',
    '- Soft contrast and realistic colour (no HDR, no overly sharp digital edges).',
    '- Subtle grain or film-inspired softness is fine where it supports realism.',
    '- Composition avoids clichés (staged handshakes, pointing at screens, contrived poses).',
    '',
    'ENVIRONMENT & COMPOSITION',
    '- People centred in believable, everyday moments.',
    '- Thriving, confident, efficient individuals — not product-first imagery.',
    '- Open office spaces, home offices, industry environments, outdoor movement.',
    '- Work settings that feel modern, diverse and relatable.',
    '- Industry scenes that show clear context through subtle cues, not overemphasis.',
    '- Well-organised compositions with a single clear focal point.',
    '- Avoid cluttered backgrounds; aim for clean, lived-in realism.',
    '- Depth created through blurred backgrounds, reflections or foreground elements.',
    '',
    'OVERALL MOOD',
    '- Confident, approachable, human.',
    '- Calm, clear and aspirational without being glossy.',
    '- Feels like a real moment you walked into — not staged or overproduced.',
    '- Warm, modern, people-centric storytelling.',
    '- The image communicates authenticity, trust, competence, clarity and human connection.'
  ].join('\n');

  /* Motion inherits the same rules; these are the ones that only make sense once
   * the frame starts moving. */
  /* A first frame is an INSTANT, and a shot description is usually a little
   * story. Nothing used to say so: the template called the job a "first-frame
   * prompt" — a label, not a rule — and then handed over a paragraph in which
   * two or three things happen one after another. A writer with no instruction
   * about time drew all of them at once, so somebody described as walking in
   * later was standing in the opening frame.
   *
   * This is a rider rather than template text on purpose. Templates are stored
   * per project inside the file, so editing the default only reaches boards
   * made afterwards; a rider reaches every board that already exists. */
  const FIRST_FRAME_RIDER = [
    'THE FIRST FRAME IS ONE INSTANT',
    '- You are describing a single photograph: the state of things at the moment this shot ' +
    'opens, before anything the description says happens next has happened.',
    '- A shot description is a short sequence. Words like "then", "after", "as", "walks in", ' +
    '"enters", "arrives", "turns to", "reaches for", "picks up", "reveals", "cuts to" mark what ' +
    'happens AFTER the first frame. None of it is in this image.',
    '- If somebody or something is described as arriving, entering or appearing, the frame is ' +
    'what the camera sees BEFORE they arrive. Do not put them in it, and do not gesture at them ' +
    'with an open door, a shadow or a look off-screen unless the description opens that way.',
    '- If the description opens mid-action, draw the first recognisable instant of that action, ' +
    'not its result.',
    '- Everything you leave out is not lost: the image-to-video prompt covers the movement.'
  ].join('\n');

  /* When a frame of another shot is supplied, the still is an EDIT of it. The
   * template still says "describe subject, setting, composition, lens, lighting
   * and mood", because a board carries its own copy of that wording and most of
   * them were written before any of this existed — so the override travels in
   * the system instruction, where it reaches every board. */
  const DERIVED_RIDER = [
    'THIS FRAME IS DERIVED FROM A SUPPLIED FRAME',
    '- A rendered frame of an earlier shot is supplied with this job. The prompt you write is ' +
    'an EDIT of that frame.',
    '- Name it and start from it. State only what changes: the camera, the framing, the moment.',
    '- Do not re-describe the place, the light, the lens, the grade or the wardrobe, and do not ' +
    're-establish the setting. They are inherited from the frame exactly as they are. Any ' +
    'instruction to describe setting, lighting, lens or mood applies only to what actually ' +
    'changes.',
    '- Rebuilding the scene in words is what makes an edit come back as a different shot.'
  ].join('\n');

  /* A reference frame is a record, not a shot — but the house style says to
   * finish everything with a grade, a grain and a lens, and the model believes
   * the house style over a clause buried in the request. Said as its own rider
   * AFTER the brand, and phrased as an exemption from it, it holds: 5 of 5
   * generated subjects came back "Capture RAW, muted professional grade"
   * before this existed. */
  const REFERENCE_RIDER = [
    'THIS IS A REFERENCE FRAME, AND IT IS EXEMPT FROM THE HOUSE STYLE ABOVE',
    '- The house style describes finished SHOTS. This is a reference: a neutral record of what ' +
    'something looks like, so a model can reproduce it exactly.',
    '- The Finishing, grade, grain, contrast, lens, aperture and depth-of-field rules above do ' +
    'NOT apply here and must not appear in what you write. No "capture RAW", no "muted ' +
    'professional grade", no "cinematic grain", no focal length, no f-number, no shallow focus.',
    '- Everything sharp, evenly lit, true colour, plain background. The subject and its wardrobe ' +
    'or surface is the whole content of the frame.',
    '- Composition, palette and the sense of the world still follow the house style.'
  ].join('\n');

  /* The craft rules for movement. True of every video job, full-reference or
   * not, and independent of the house style — so a board with the brand
   * switched off still gets them.
   *
   * "Hold the natural-light look and the clean exposure through the whole move"
   * used to be the last line here. It reads as a note about continuity and
   * lands as an instruction to describe the lighting, which on a call that is
   * handed the lit frame is the one thing not worth a word. What it was really
   * protecting — the look not drifting mid-shot — is now stated as a thing that
   * does not change rather than a thing to write down. */
  /* "Camera moves are restrained and motivated" is a note about taste, and a
   * writer reads taste as permission: asked to name the move and its speed, it
   * named one on every shot, because the instruction assumed there was one.
   * Every board came back a slow push. The camera is now locked off by
   * default, and a move is something the shot description has to ask for in so
   * many words — which is where the person storyboarding can actually say it.
   * Restraint is not a matter of degree here; it is the absence of a move. */
  const VIDEO_RIDER = [
    'MOTION',
    '- THE CAMERA DOES NOT MOVE. It is locked off on sticks: no push, no pull, no pan, tilt, ' +
    'dolly, track, crane, orbit, zoom, handheld drift, sway, shake, rack or reframe. Do not ' +
    'write one in, and do not describe the camera at all unless the next line applies.',
    '- The ONLY exception is a move the shot description asks for in words — "push in", "pan ' +
    'left", "handheld", "tilt up". If it does, write that move and only that move, and name ' +
    'its speed. Nothing in the house style, the shot type or the scene is such a request.',
    '- Everything that moves, moves inside a still frame: the subject, the hands, the face, the ' +
    'light, the things around them. That is where the shot comes from.',
    '- Movement is documentary-real: the pace of an actual moment, not choreography.',
    '- End the shot somewhere: say what the last beat is and where the action leaves off.'
  ].join('\n');

  /* THE fix for a video prompt that comes back as a second description of the
   * shot. An image-to-video call is handed the first frame as a picture — the
   * same situation DERIVED_RIDER covers for a still derived from another
   * shot's frame, and it was already the proven wording there. Nothing said it
   * for video, so the writer restated the set, the wardrobe and the grade every
   * time and the action got a clause at the end.
   *
   * Not sent to a full-reference model: there the appearance lines are the
   * format, binding a label to a picture, not a repetition. */
  const VIDEO_INHERIT_RIDER = [
    'THE FIRST FRAME IS SUPPLIED TO THE MODEL AS A PICTURE',
    '- Write nothing that is already visible in it: set, architecture, surfaces, furniture, ' +
    'wardrobe, hair, faces, colour, lighting, focal length, aperture, depth of field, grade or ' +
    'grain. Restating any of it re-renders the shot instead of moving it.',
    '- Open on the action. Spend the paragraph on movement: what moves, in what order, how far, ' +
    'how fast, and what the face and the body do. The camera is locked off unless the shot ' +
    'description asks for a move, so it is usually not part of the answer.',
    '- Describe appearance ONLY where it CHANGES during the shot — a coat coming off, a lamp ' +
    'switched on, a screen changing state.',
    '- Whoever arrives after the first frame is not in the picture, so what they LOOK like is ' +
    'yours to write. How and when they enter is not: the shot description gives it, and it is ' +
    'the authority. Follow it, and do not invent an entrance it does not describe.'
  ].join('\n');

  /* Phrased as an exemption and placed after the brand, which is the shape
   * REFERENCE_RIDER had to settle on before the house style stopped winning. */
  const VIDEO_STYLE_EXEMPTION = [
    'THE HOUSE STYLE IS NOT WRITTEN INTO A VIDEO PROMPT',
    '- It describes how a finished frame LOOKS. The frame is already made, under that style, ' +
    'and it is supplied with this call.',
    '- The Finishing, grade, grain, contrast, colour, lens, aperture and depth-of-field rules ' +
    'above must not appear in what you write. No "capture RAW", no "muted professional grade", ' +
    'no "subtle cinematic grain", no focal length, no f-number, no shallow focus.',
    '- What the house style still governs here is the MOVEMENT: restrained, motivated, ' +
    'documentary-real, the pace of an actual moment.'
  ].join('\n');

  /* There was a no-gendered-language rule here, enforced with a word list and
   * a corrective rewrite. It is gone on purpose. Stripping the gender out of a
   * subject's description does not make the picture neutral — it makes the
   * image model guess, and it guesses male. A reference frame has to be
   * allowed to say what the person it is a reference FOR actually looks like.
   */

  /* A board only stores the house style once someone has edited it. Boards on
   * the stock text follow the app, so a correction here reaches them. */
  function brandOf(p) {
    const b = (p.settings && p.settings.brand) || {};
    const custom = !!(b.custom && typeof b.text === 'string' && b.text.trim());
    return {
      enabled: b.enabled !== false,
      custom: custom,
      text: custom ? b.text : DEFAULT_BRAND
    };
  }

  /* Where this frame sits in its scene, so the writer isn't composing in a
   * vacuum. Who is in it — and what they look like and wear — is the personas
   * layer's job, not this one's. */
  function sequenceBlock(p, shot, role) {
    const f = SB.Model.findShot(p, shot.id);
    if (!f) return '';
    const scene = f.scene;
    const beats = scene.shots.filter(function (s) { return !s.noShot; });
    const pos = beats.indexOf(shot) + 1;
    const lines = [];

    lines.push('SCENE CONTEXT');
    lines.push('Scene ' + (f.sceneIdx + 1) + ': ' + (scene.heading || '(untitled)'));
    if (scene.description) lines.push('Scene note: ' + SB.Refs.plain(p, scene.description));
    lines.push('This is shot ' + f.code + (pos > 0 ? ' (beat ' + pos + ' of ' + beats.length + ')' : '') + '.');

    if (beats.length > 1) {
      lines.push('The other beats in this scene, in order:');
      beats.forEach(function (s, i) {
        const sf = SB.Model.findShot(p, s.id);
        const d = SB.Refs.plain(p, s.description).replace(/\s+/g, ' ').trim();
        lines.push('  ' + (i + 1) + '. [' + (sf ? sf.code : '?') + '] ' + (s.type || 'shot') + ' — ' +
          (d ? (d.length > 160 ? d.slice(0, 157) + '…' : d) : '(no description yet)') +
          (s.id === shot.id ? '   <-- the frame you are writing' : ''));
      });
      /* Coherence is something to WRITE INTO a still. On a video job the frame
       * already carries it, so the same sentence reads as one more instruction
       * to describe the light — which is what this job must not do. */
      lines.push(role === 'video'
        ? 'Keep the movement coherent with the beats around it.'
        : 'Keep the location, the lighting mood and the grade coherent across these beats.');
    }
    return lines.join('\n');
  }

  /* The system instruction for one prompt-writing job.
   *
   * The house style is a choice about how a board looks and can be switched
   * off. The riders are not: they are what the two prompts ARE — a still of one
   * instant, and the movement out of it — and a board with no house style needs
   * them just as much. They used to sit behind the same early return, so
   * turning the brand off quietly took the craft rules with it. */
  function systemFor(p, shot, role) {
    const b = brandOf(p);
    const parts = [];
    /* Is a frame of another shot being handed over? Then this still is an edit
     * of it, which changes both what to say and what to leave unsaid. */
    const derived = (role === 'image' || role === 'both') &&
      SB.Refs.feed(p, shot).some(function (e) {
        return e.kind === 'shot' && e.images.length;
      });
    /* On an image job derived from another shot's frame, the house style is
     * NOT sent. It is a list of things to put into the words — the grade, the
     * grain, the lens, the practicals — and the source frame already carries
     * every one of them. Sent anyway, the writer dutifully restates them, and
     * an edit instruction full of "50mm, f/2.8, muted grade" comes back as a
     * re-render of the scene rather than a change to the picture. The frame is
     * the style reference now. (A combined image+video job still gets it: the
     * video half is not derived from anything.) */
    /* A frame-only video job is in exactly the position a derived still is in:
     * the picture it starts from is supplied, so the look is inherited and the
     * house style is a list of things to NOT say. A full-reference model is
     * not — its format asks for appearance on purpose. */
    const inherits = SB.Model.videoInherits(SB.Model.videoModel(p));
    const videoInherits = role === 'video' && inherits;
    const styleInherited = (derived && role === 'image') || videoInherits;
    /* A video job is told nothing about the house style, not even that it is
     * missing. Announcing the absence was a paragraph explaining one of the
     * app's own decisions to a model that has no use for it, and the rider
     * below already carries the only instruction that came out of it. */
    if (b.enabled && !styleInherited) {
      parts.push('HOUSE STYLE — every prompt you write must obey this.', '', b.text);
    } else if (b.enabled && derived) {
      parts.push('THE HOUSE STYLE IS NOT REPEATED HERE.', '',
        'The supplied source frame was made under it and already carries the look — the grade, ' +
        'the grain, the lighting and the lens. Putting any of it back into words is what turns ' +
        'an edit into a re-render. Change what the description asks for; inherit the rest.');
    }
    if (role === 'image' || role === 'both') {
      if (parts.length) parts.push('');
      parts.push(FIRST_FRAME_RIDER);
      if (derived) parts.push('', DERIVED_RIDER);
    }
    if (role === 'video' || role === 'both') {
      if (parts.length) parts.push('');
      parts.push(VIDEO_RIDER);
      /* A combined job writes both prompts in one call, so the style has to be
       * sent for the still — and then scoped, or the video half inherits the
       * instruction to write the look down. */
      if (inherits) {
        parts.push('', VIDEO_INHERIT_RIDER);
        if (b.enabled && role === 'both') parts.push('', VIDEO_STYLE_EXEMPTION);
      }
    }
    const seq = sequenceBlock(p, shot, role);
    if (seq) {
      if (parts.length) parts.push('');
      parts.push(seq);
    }
    if (!parts.length) return '';
    /* The closing instruction is what puts the house style into the words. On a
     * derived frame that is exactly wrong for the half being inherited: told to
     * fold in the grade and the lighting, the writer restated the lens, the
     * practicals and the grain — rebuilding in words what the source frame
     * already carries. So there, the fold-in is scoped to what changes. */
    parts.push('', videoInherits
      /* "as concrete description" is the right noun for a still and the wrong
       * one here — it is the last thing the writer reads before it starts, and
       * it was asking for description on the one job that must not describe. */
      ? 'Fold these requirements into the prompt itself as concrete MOVEMENT — what happens, in ' +
        'what order, at what pace. Nothing that is already visible in the supplied frame. Do not ' +
        'quote the rules back, and do not add headings or commentary.'
      : derived
      ? 'Fold these requirements into the prompt itself as concrete description, but ONLY where ' +
        'they describe what this frame CHANGES. Everything inherited from the supplied source ' +
        'frame — the place, the lighting, the lens, the grade, the wardrobe — is already in that ' +
        'image and must not be restated. Do not quote the rules back, and do not add headings ' +
        'or commentary.'
      : 'Fold these requirements into the prompt itself as concrete description — ' +
        'do not quote the rules back, and do not add headings or commentary.');
    return parts.join('\n');
  }

  SB.Brand = {
    DEFAULT: DEFAULT_BRAND,
    VIDEO_RIDER: VIDEO_RIDER,
    FIRST_FRAME_RIDER: FIRST_FRAME_RIDER,
    DERIVED_RIDER: DERIVED_RIDER,
    REFERENCE_RIDER: REFERENCE_RIDER,
    brandOf: brandOf,
    systemFor: systemFor,
    sequenceBlock: sequenceBlock
  };

})(window.SB);
