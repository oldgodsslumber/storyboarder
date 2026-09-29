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
  /* WHAT THIS FRAME SHOWS — the thing the prompt never said.
   *
   * "Shot type: Close-up." was the whole of it, against a cast block that
   * described a man from his hair to his jeans and called itself authoritative.
   * A type is only a word; what it MEANS — what a close-up leaves outside
   * itself — had no representation anywhere, so the block won and a shot of
   * somebody's hands came back with their stubble in it.
   *
   * Two rules travel with the line, and they are the ones that were missing:
   * the description may crop tighter but never wider, and somebody acting
   * where the frame cannot see them is still acting. */
  function framingBlock(p, shot) {
    const type = (shot && shot.type) || '';
    const line = SB.Model.framingFor(p, type);
    const out = ['WHAT THIS FRAME SHOWS'];
    out.push(type
      ? '- Shot type: ' + type + '.' + (line ? ' ' + line : '')
      : '- No shot type is set on this card. Take the framing from the shot description, and ' +
        'if it does not say, frame it as tightly as the action allows.');
    out.push('- The shot description may narrow this further — to a pair of hands, a screen, ' +
      'one eye. It never widens it. Nothing outside this framing is in the picture, however ' +
      'fully any block in this instruction describes it.');
    out.push('- Anyone the description has DOING something who does not fit inside this frame is ' +
      'doing it off camera. The action is real and still happening — write it only where ' +
      'the frame can see it, or in what it does to what the frame CAN see. Do not widen the shot ' +
      'to fit them in, and do not draw them at its edge.');
    return out.join('\n');
  }

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
    '- The block headed THE FIRST FRAME THIS CLIP ANIMATES says what is in that picture. ' +
    'It is settled fact. Whoever is standing is standing, whoever is holding something is ' +
    'holding it, and the shot opens exactly there \u2014 never write an action that starts ' +
    'from a different arrangement. If the description reads as though someone is elsewhere, ' +
    'the picture wins.',
    '- Write nothing that is already visible in it: set, architecture, surfaces, furniture, ' +
    'wardrobe, hair, faces, colour, lighting, focal length, aperture, depth of field, grade or ' +
    'grain. Knowing what is in the frame is not licence to describe it \u2014 restating any of ' +
    'it re-renders the shot instead of moving it.',
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
    '- What the house style still governs here is the MOVEMENT: documentary-real, the pace of ' +
    'an actual moment, and a camera that holds unless the shot description asks for a move.'
  ].join('\n');

  /* ---------------- gender is cast, not guessed ----------------
   *
   * There was a flat no-gendered-language rule here once, and it was removed
   * because it backfired exactly where it mattered: a persona description with
   * the gender stripped out does not produce a neutral picture, it produces
   * whatever the image model assumes, and it assumes a man. The people in the
   * library came back as men who were not the people in the library.
   *
   * The half worth keeping is the other one. Where the board HAS cast someone,
   * their gender is a fact of the board and the prompt must carry it. Where it
   * has not — a passer-by, a second figure at the desk, a pair of hands — the
   * writer invents one, and what it invents is not a decision anybody made.
   *
   * So the word list is back, and the cast is the authority: a term is fine if
   * the people on this card, or the description itself, already say it. A term
   * on a card that casts nobody is an invention, and buys one rewrite. */
  const FEMININE = ['she', 'her', 'hers', 'herself', 'woman', 'women', "woman's",
    'female', 'females', 'girl', 'girls', 'gal', 'gals', 'lady', 'ladies',
    'mrs', 'ms', 'miss', 'madam', "ma'am",
    'wife', 'mother', 'mom', 'mum', 'daughter', 'sister', 'aunt', 'niece',
    'businesswoman', 'businesswomen', 'saleswoman', 'spokeswoman', 'chairwoman',
    'actress', 'waitress', 'hostess', 'stewardess'];
  const MASCULINE = ['he', 'him', 'his', 'himself', 'man', 'men', "man's",
    'male', 'males', 'boy', 'boys', 'guy', 'guys', 'gentleman', 'gentlemen',
    'mr', 'sir',
    'husband', 'father', 'dad', 'son', 'brother', 'uncle', 'nephew',
    'businessman', 'businessmen', 'salesman', 'spokesman', 'chairman'];

  /* Word-bounded, so "human", "manager", "therapist" and "history" are safe.
   * The apostrophes are the curly one too — a model writes "woman’s". */
  function listRe(words) {
    const esc = words.map(function (w) {
      return w.replace(/'/g, "['\u2019]").replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });
    return new RegExp('\\b(' + esc.join('|') + ')\\b', 'gi');
  }
  const FEM_RE = listRe(FEMININE);
  const MASC_RE = listRe(MASCULINE);

  function hits(re, text) {
    const found = String(text || '').match(re);
    if (!found) return [];
    const seen = {}, out = [];
    found.forEach(function (h) {
      const k = h.toLowerCase().replace(/\u2019/g, "'");
      if (!seen[k]) { seen[k] = 1; out.push(k); }
    });
    return out;
  }

  /* Which gendered words a piece of text used, whichever side they are on. */
  function genderedTerms(text) {
    return hits(FEM_RE, text).concat(hits(MASC_RE, text));
  }

  /* Which sides a piece of text commits to. */
  function sidesIn(text) {
    return { f: hits(FEM_RE, text).length > 0, m: hits(MASC_RE, text).length > 0 };
  }

  /* What this card has actually cast: every persona on it — their name, their
   * description, the prompt written for their reference frame — plus whatever
   * the person storyboarding wrote in the description and the extra fields.
   * All of it is the board's own word on who these people are. */
  function castSides(p, shot) {
    const out = { f: false, m: false };
    if (!shot) return out;
    const bits = [shot.description, shot.imageDescription, shot.videoDescription, shot.type];
    if (shot.fields) {
      Object.keys(shot.fields).forEach(function (k) { bits.push(shot.fields[k]); });
    }
    /* The same people the CAST block describes: every subject in the feed, not
     * only the ones formally cast — a subject can be marked without being
     * cast, and the writer is told about them either way. */
    let people = [];
    try {
      people = SB.Refs.feed(p, shot)
        .filter(function (e) { return e.kind === 'subject'; })
        .map(function (e) { return e.subject; })
        .filter(Boolean);
    } catch (e) { people = []; }
    if (!people.length && SB.Personas.forShot) people = SB.Personas.forShot(p, shot) || [];
    people.forEach(function (per) {
      bits.push(per.name, per.description, per.imagePrompt);
      (SB.Personas.imagesOf(per) || []).forEach(function (im) { bits.push(im.label); });
    });
    const text = bits.filter(function (x) { return typeof x === 'string' && x; }).join('. ');
    const s = sidesIn(text);
    out.f = s.f; out.m = s.m;
    return out;
  }

  /* [] when every gendered word in the prompt is one the board already said;
   * otherwise one sentence naming the invented ones. */
  function genderProblems(p, shot, prompt) {
    const allowed = castSides(p, shot);
    const bad = [];
    if (!allowed.f) hits(FEM_RE, prompt).forEach(function (w) { bad.push(w); });
    if (!allowed.m) hits(MASC_RE, prompt).forEach(function (w) { bad.push(w); });
    if (!bad.length) return [];
    const cast = allowed.f || allowed.m;
    return ['You decided someone\u2019s gender: "' + bad.join('", "') + '". ' +
      (cast
        ? 'The people this card casts are described in the CAST block, and nobody there is ' +
          'that. Whoever you used those words for is not cast, so their gender is not yours ' +
          'to pick. '
        : 'Nobody on this card is cast, and nothing in the shot description says it, so that ' +
          'is a guess. ') +
      'Write them again neutrally \u2014 "the subject", "the person", "they", "a figure", or ' +
      'no pronoun at all. Everyone the CAST block does describe keeps exactly the words it ' +
      'uses for them. Change nothing else.'];
  }

  /* Said to the writer up front, so the rewrite above is the exception rather
   * than the routine. Not sent to the reference-frame writer, which has the
   * opposite job: there, saying what the person looks like IS the work. */
  const GENDER_RIDER = [
    'WHO THESE PEOPLE ARE',
    '- Anyone the CAST block describes is exactly who it says they are: use its words for ' +
    'them, gendered or not. Never neutralise a person the board has cast.',
    '- Anyone it does NOT describe — a passer-by, a second figure, a pair of hands, a face in ' +
    'the background — has no gender until somebody decides one, and that is not your decision. ' +
    'Write them as "the subject", "the person", "a figure", "they", or with no pronoun at all.',
    '- The shot description is the board\u2019s own word too: if it says who someone is, follow it.'
  ].join('\n');

  /* ---------------- invented details, checked rather than asked ----------------
   *
   * Coats, jackets, hats and bags that no description asked for were the most
   * common thing a written prompt added (clay_reference_prompting_plan.md).
   * Neither GPT Image nor Seedance takes a negative prompt, so the only defence
   * is the words: the writer is told (NO_INVENT_RIDER), the answer is checked
   * (inventedProblems) and gets one rewrite, and the app appends a wardrobe
   * lock it writes itself (wardrobeLock).
   *
   * The check is a list of the things writers add — layers, headwear,
   * eyewear, jewellery, bags, and the props that come with a coat — each one
   * allowed the moment anything on the card says it. "No coat" is not a coat. */
  const INVENT_TERMS = [
    'trench ?coats?', 'overcoats?', 'raincoats?', 'coats?', 'parkas?', 'anoraks?', 'jackets?', 'blazers?',
    'cardigans?', 'sweaters?', 'jumpers?', 'hoodies?', 'waistcoats?', 'vests?', 'scarf', 'scarves', 'shawls?',
    'hats?', 'caps?', 'beanies?', 'berets?', 'fedoras?', 'gloves?', 'mittens?',
    'sunglasses', 'glasses', 'spectacles', 'goggles',
    'wristwatch(?:es)?', '(?:a|his|her|their) watch', 'bracelets?', 'necklaces?', 'earrings?', 'pendants?',
    'jewell?ery', 'jewelry', 'necktie', 'bow ?tie', '(?:a|his|her|their) tie',
    'lanyards?', 'id badges?', 'badges?', 'headphones', 'earbuds', 'backpacks?', 'handbags?', 'purses?',
    'tote(?: bag)?s?', 'briefcases?', 'shoulder bags?', 'bags?', 'umbrellas?', 'aprons?'
  ];
  const INVENT_RE = new RegExp('\\b(?:' + INVENT_TERMS.join('|') + ')\\b', 'gi');
  /* what a word counts as, so "blazers" is allowed by "blazer" and "trench coat" by "coat" */
  function inventStem(w) {
    const t = String(w).toLowerCase().replace(/^(?:a|his|her|their) /, '').replace(/\s+/g, ' ');
    const last = t.split(' ').pop();
    if (/^(?:scarf|scarves)$/.test(last)) return 'scarf';
    if (/^jewell?ery|jewelry$/.test(last)) return 'jewellery';
    if (/^(?:glasses|sunglasses|spectacles|goggles)$/.test(last)) return last === 'sunglasses' ? 'sunglasses' : 'glasses';
    if (last === 'watches' || last === 'wristwatches' || last === 'wristwatch') return 'watch';
    if (last === 'tie' || last === 'necktie') return 'tie';
    if (/(?:ches|shes|sses)$/.test(last)) return last.slice(0, -2);
    if (/s$/.test(last) && !/ss$/.test(last)) return last.slice(0, -1);
    return last;
  }
  /* A hit preceded, in the same clause, by a negation is a thing ruled out, not put in. */
  const NEG = /\b(?:no|not|without|never|nor|none|free of|instead of|rather than|removes?|takes? off|minus)\b/i;
  function negated(text, at) {
    const segs = text.slice(Math.max(0, at - 64), at).split(/[.;:!?\n]/).pop().split(',');
    /* the negation's reach stops at a comma — "without a jacket, a watch on his wrist" wears the watch — unless the
       comma is only carrying a list along: "no coat, hat or scarf" rules out all three */
    for (let i = segs.length - 1; i >= 0; i--) {
      if (i === segs.length - 1) { if (NEG.test(segs[i])) return true; continue; }
      const listy = /^\s*(?:(?:or|and|nor)\s+)?(?:an?\s+|the\s+)?[a-z-]+(?:\s+[a-z-]+)?\s*$/i.test(segs[i]);
      if (!listy) return false;
      if (NEG.test(segs[i])) return true;
    }
    return false;
  }
  /* Everything this card says: its three boxes and fields, the scene, every
     subject in its feed (description, the prompt of their reference frame, the
     labels of their pictures) and the blocking in words. */
  function cardText(p, shot) {
    const bits = [shot.description, shot.imageDescription, shot.videoDescription, shot.type];
    if (shot.fields) Object.keys(shot.fields).forEach(function (k) { bits.push(shot.fields[k]); });
    try {
      const f = SB.Model.findShot(p, shot.id);
      if (f) bits.push(f.scene.heading, f.scene.description);
    } catch (e) { }
    let people = [];
    try {
      people = SB.Refs.feed(p, shot).concat(SB.Refs.feed(p, shot, 'video'))
        .filter(function (e) { return e.kind === 'subject'; })
        .map(function (e) { return e.subject; }).filter(Boolean);
    } catch (e) { people = []; }
    if (!people.length && SB.Personas.forShot) people = SB.Personas.forShot(p, shot) || [];
    people.forEach(function (per) {
      bits.push(per.name, per.description, per.imagePrompt);
      (SB.Personas.imagesOf(per) || []).forEach(function (im) { bits.push(im.label); });
    });
    if (shot.pose && shot.pose.text) bits.push(shot.pose.text);
    return bits.filter(function (x) { return typeof x === 'string' && x; })
      .map(function (x) { return SB.Refs && SB.Refs.plain ? SB.Refs.plain(p, x) : x; }).join('. ');
  }
  /* The added things a prompt names that nothing on the card does, as written. */
  function inventedTerms(p, shot, prompt) {
    const text = String(prompt || '');
    const allowed = {};
    const card = cardText(p, shot);
    (card.match(INVENT_RE) || []).forEach(function (w) { allowed[inventStem(w)] = 1; });
    const out = [], seen = {};
    let m;
    INVENT_RE.lastIndex = 0;
    while ((m = INVENT_RE.exec(text))) {
      const w = m[0], st = inventStem(w);
      if (allowed[st] || seen[st] || negated(text, m.index)) continue;
      seen[st] = 1;
      out.push(w.toLowerCase());
    }
    return out;
  }
  function inventedProblems(p, shot, prompt) {
    const bad = inventedTerms(p, shot, prompt);
    if (!bad.length) return [];
    return ['You added things nobody described: "' + bad.join('", "') + '". Every garment, ' +
      'accessory and prop comes from the subject descriptions and the shot text and from nowhere ' +
      'else — nothing on this card mentions ' + (bad.length === 1 ? 'that' : 'those') + '. Take ' +
      (bad.length === 1 ? 'it' : 'them') + ' out, and do not replace ' +
      (bad.length === 1 ? 'it' : 'them') + ' with something similar. Change nothing else.'];
  }

  const NO_INVENT_RIDER = [
    'ADD NOTHING THAT IS NOT DESCRIBED',
    '- Every garment, accessory and prop comes ONLY from the subject descriptions and the shot text. ' +
    'If they do not mention it, it is not there.',
    '- Never add clothing layers (coat, jacket, blazer, cardigan, sweater, hoodie, scarf), headwear, ' +
    'glasses, jewellery, watches, bags, lanyards, headphones, umbrellas, extra props or extra people.',
    '- Where a description is silent, the answer is nothing: plain and unadorned is correct. Weather, ' +
    'season, a location or a job are not reasons to dress someone.',
    '- Do not describe clothing in more detail than the description gives — no invented colours, ' +
    'fabrics, logos or brands.'
  ].join('\n');

  /* ---------------- the wardrobe lock ----------------
   *
   * Written by the app and appended to the prompt the writer returns, so it is
   * there whatever the writer did: each person in the picture, wearing exactly
   * what their description says, and a line ruling out the usual additions.
   * The clothing is the part of the description that names garments — the
   * rest (hair, build, age) is the reference picture's job. */
  const GARMENT_RE = new RegExp('\\b(?:' + INVENT_TERMS.concat([
    'shirts?', 't-shirts?', 'tees?', 'blouses?', 'tops?', 'tank tops?', 'camisoles?', 'polo', 'turtlenecks?',
    'suits?', 'tuxedos?', 'dress(?:es)?', 'gowns?', 'skirts?', 'trousers', 'pants', 'slacks', 'jeans', 'chinos',
    'shorts', 'leggings', 'joggers', 'sweatpants', 'uniforms?', 'overalls', 'scrubs', 'jumpsuits?', 'robes?',
    'shoes', 'sneakers', 'trainers', 'boots', 'heels', 'loafers', 'sandals', 'flats', 'socks', 'belts?',
    'headsets?', 'hijabs?', 'turbans?', 'veils?', 'rings?'
  ]).join('|') + ')\\b', 'i');
  function wardrobeOf(desc) {
    const text = String(desc || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    const keep = [];
    text.split(/(?<=[.;!?])\s+/).forEach(function (sentence) {
      if (!GARMENT_RE.test(sentence)) return;
      // "A man in a white shirt, …" / "She wears …" / "Dressed in …": the clothes start after the verb
      let t = sentence.replace(/[.;!?]+$/, '');
      const lead = /^.{0,48}?\b(?:wearing|wears|dressed in|clad in|in)\b\s+/i.exec(t);
      if (lead) t = t.slice(lead[0].length);
      const parts = t.split(/,\s*|\s+and\s+(?=[a-z-]+\s)/i).filter(function (x) { return GARMENT_RE.test(x); });
      if (parts.length) keep.push(parts.join(', '));
    });
    return keep.join('; ');
  }
  function lockOn(p) { return !(p && p.settings && p.settings.wardrobeLock === false); }
  const LOCK_OUT = 'No coats, jackets, hats, scarves, glasses, jewellery, watches, bags, extra props or ' +
    'extra people beyond those described.';
  /* role 'image': everyone in the first frame, by name, wearing exactly their
     clothes. role 'video' on a frame-only model: the frame shows the clothes,
     so the lock is that nothing changes. '' when turned off or nobody's cast. */
  function wardrobeLock(p, shot, role) {
    if (!lockOn(p) || !shot) return '';
    if (role === 'video') {
      if (!SB.Model.videoInherits(SB.Model.videoModel(p))) return '';
      return 'Everyone\u2019s clothing stays exactly as in the first frame — nothing is put on, taken ' +
        'off or added. ' + LOCK_OUT;
    }
    let people = [];
    try {
      const fr = SB.Personas.framing ? SB.Personas.framing(p, shot) : null;
      people = SB.Refs.feed(p, shot, 'image').filter(function (e) {
        return e.kind === 'subject' && SB.Personas.kindOf(e.subject).id === 'person' && !(fr && fr.arrives(e.id));
      }).map(function (e) { return e.subject; });
    } catch (e) { people = []; }
    const lines = [];
    people.forEach(function (per) {
      const w = wardrobeOf(per.description);
      if (w) lines.push((per.name || 'They') + ' wears exactly: ' + w.replace(/[.\s]+$/, '') + '. Nothing else.');
    });
    lines.push(LOCK_OUT);
    return lines.join('\n');
  }

  /* ---------------- the camera, checked rather than asked ----------------
   *
   * Telling the writer not to move the camera is not enough on its own. Given
   * a description whose point is a detail — the chipped mug, the shaking hands
   * — it reaches for the camera to point at it, and writes a slow push in or a
   * dolly toward the thing. The detail is the subject; moving the camera is
   * its own idea.
   *
   * So the answer is read back. Anything here that the description did not ask
   * for buys one corrective rewrite naming the words, and if it survives that,
   * the prompt is badged rather than silently shipped.
   *
   * Two lists, because the risk is a false accusation: STRONG is vocabulary
   * that is only ever a camera ("dolly in", "whip pan", "rack focus"), and the
   * second pass catches anything the camera itself is SAID to do. A sentence
   * saying the camera holds is the thing we asked for, so a negation anywhere
   * near a hit clears it. */
  const STRONG = [
    /\b(?:slow|quick|gentle|subtle|smooth|steady)?\s*(?:push|pull)\s+(?:in|out|back)\b(?:\s+(?:on|to|toward|towards)\b)?/gi,
    /\bdoll(?:y|ies|ying)\s+(?:in|out|forward|back|backward|backwards|left|right|toward|towards|along|past)\b/gi,
    /\b(?:track(?:s|ing)?|truck(?:s|ing)?)\s+(?:in|out|left|right|forward|back|with|alongside|past)\b/gi,
    /\bcrane\s+(?:up|down|over)\b|\bjib\s+(?:up|down)\b/gi,
    /\b(?:whip\s+)?pan(?:s|ning)?\s+(?:left|right|across|away|over|up|down|to|toward|towards)\b/gi,
    /\btilt(?:s|ing)?\s+(?:up|down)\b/gi,
    /\bzoom(?:s|ing)?\s+(?:in|out)\b|\b(?:slow|gentle|subtle)\s+zoom\b/gi,
    /\borbit(?:s|ing)?\b|\barc(?:s|ing)?\s+(?:around|past)\b|\bcircl(?:es|ing)\s+(?:around|the subject)\b/gi,
    /\brack(?:s|ing)?\s+focus\b|\bfocus\s+rack\b/gi,
    /\bhandheld\b|\bsteadicam\b|\bgimbal\b|\bdolly\s+shot\b|\btracking\s+shot\b/gi,
    /\bre-?frames?\b|\bre-?framing\b/gi,
    /\bcamera\s+(?:shake|sway|drift|float|movement|move)\b/gi
  ];

  /* "the camera <does something>" — anything at all, within the same clause */
  const CAMERA_DOES = new RegExp(
    '\\b(?:the |a )?(?:camera|lens|frame|viewpoint|point of view)\\b[^.;!?]{0,70}?' +
    '\\b(?:moves?|moving|moved|drifts?|drifting|glides?|gliding|floats?|floating|creeps?|' +
    'creeping|eases?|easing|pushes?|pushing|pulls?|pulling|tracks?|tracking|doll(?:y|ies|ying)|' +
    'pans?|panning|tilts?|tilting|zooms?|zooming|rises?|rising|descends?|descending|lowers?|' +
    'circles?|circling|orbits?|orbiting|sways?|swaying|shakes?|shaking|slides?|sliding|' +
    'follows?|following|swings?|swinging|arcs?|arcing|cranes?|craning|closes? in|travels?|' +
    'settles?|settling|comes? to rest)\\b',
    'gi');

  /* A hit inside a sentence that says the camera does NOT do it is the answer
   * we asked for, not a breach. */
  const NEGATED = /\b(?:not|never|no|without|holds?|held|holding|static|locked|lock-?off|fixed|unmoving|motionless|remains?|stays?|still)\b/i;

  function context(text, at, len) {
    return text.slice(Math.max(0, at - 60), at + len + 20);
  }

  function movesIn(text) {
    const s = String(text || '');
    const out = [];
    const seen = {};
    const take = function (re) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(s))) {
        const hit = m[0].trim();
        if (!hit) { re.lastIndex++; continue; }
        if (!NEGATED.test(context(s, m.index, hit.length))) {
          const k = hit.toLowerCase();
          if (!seen[k]) { seen[k] = 1; out.push(hit); }
        }
        if (re.lastIndex === m.index) re.lastIndex++;
      }
      re.lastIndex = 0;
    };
    STRONG.forEach(take);
    take(CAMERA_DOES);
    return out;
  }

  /* What the person storyboarding wrote is the authority: if the description
   * asks for a move, the prompt is allowed to have one, and nothing here
   * second-guesses which one. */
  function moveAsked(p, shot) {
    if (!shot) return false;
    /* Everything the person storyboarding wrote about this shot counts: the
     * description, the shot type (somebody who picks "Tracking shot" has
     * asked), and any extra field they added to say it in. */
    const extra = shot.fields ? Object.keys(shot.fields).map(function (k) {
      return shot.fields[k];
    }) : [];
    const src = [shot.description, shot.imageDescription, shot.videoDescription, shot.type]
      .concat(extra)
      .filter(function (x) { return typeof x === 'string' && x; }).join('. ');
    return movesIn(p && SB.Refs ? SB.Refs.plain(p, src) : src).length > 0;
  }

  /* [] when the prompt is clean or the move was asked for; otherwise one
   * sentence naming the words, in the shape verify() wants. */
  function moveProblems(p, shot, prompt) {
    if (moveAsked(p, shot)) return [];
    const found = movesIn(prompt);
    if (!found.length) return [];
    return ['You moved the camera: "' + found.join('", "') +
      '". Nothing in the shot description asks for a camera move, so there is none — ' +
      'the frame is locked off. Rewrite it with the camera held still, keeping every other ' +
      'detail, and give the same beats as movement WITHIN the frame (the subject, the hands, ' +
      'the face, the light). Do not mention the camera at all.'];
  }

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
        /* This lane's words for every beat. The union leaked the first-frame
           box into the video job through the back door, which is the one
           thing splitting the boxes was for. */
        const d = SB.Refs.text(p, s, role).replace(/\s+/g, ' ').trim();
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
      SB.Refs.feed(p, shot, role).some(function (e) {
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
    if (role === 'image' || role === 'video' || role === 'both') {
      if (parts.length) parts.push('');
      parts.push(GENDER_RIDER);
      parts.push('', NO_INVENT_RIDER);
    }
    /* A frame-only video job is shown the picture, so it can SEE the framing —
       telling it in words is the same mistake as repeating the house style at
       it. Every other job is told. */
    if (role === 'image' || role === 'both' || (role === 'video' && !inherits)) {
      if (parts.length) parts.push('');
      parts.push(framingBlock(p, shot));
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
    movesIn: movesIn, moveAsked: moveAsked, moveProblems: moveProblems,
    genderedTerms: genderedTerms, castSides: castSides,
    genderProblems: genderProblems, GENDER_RIDER: GENDER_RIDER,
    inventedTerms: inventedTerms, inventedProblems: inventedProblems, NO_INVENT_RIDER: NO_INVENT_RIDER,
    wardrobeOf: wardrobeOf, wardrobeLock: wardrobeLock, LOCK_OUT: LOCK_OUT,
    VIDEO_RIDER: VIDEO_RIDER,
    FIRST_FRAME_RIDER: FIRST_FRAME_RIDER,
    DERIVED_RIDER: DERIVED_RIDER,
    REFERENCE_RIDER: REFERENCE_RIDER,
    brandOf: brandOf,
    systemFor: systemFor,
    sequenceBlock: sequenceBlock
  };

})(window.SB);
