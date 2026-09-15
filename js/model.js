/* model.js — project schema, numbering, and all structural mutations. */
(function (SB) {
  'use strict';

  const FILE_VERSION = 1;

  const DEFAULT_SHOT_TYPES = [
    'Wide', 'Medium', 'Close-up', 'Extreme close-up', 'Over the shoulder',
    'Two shot', 'Insert', 'Cutaway', 'POV', 'Screen capture', 'Talking head'
  ];

  /* What each shot type actually SHOWS.
   *
   * The type was a word in a line of the template and nothing else — "Shot
   * type: Close-up." — with no statement anywhere of what a close-up excludes.
   * So a cast block describing a man from his hair to his jeans, declared
   * authoritative, outvoted it every time: a close-up of somebody's hands came
   * back with his stubble and his henley in it, because nothing in the prompt
   * had ever said that a frame can leave a person out of itself.
   *
   * These are that statement. One line per type, sent with the prompt, and
   * editable per board in Settings because a board's idea of "Medium" is its
   * own business. */
  const DEFAULT_FRAMING = {
    'Wide':
      'The whole figure, or the whole space, with room around it. Wardrobe, posture and ' +
      'setting all read; a face is small and carries little detail.',
    'Medium':
      'From roughly the waist up. Wardrobe above the waist, hands when they come up, and ' +
      'enough room behind to place the person. Nothing below the waist is in shot.',
    'Close-up':
      'A head and shoulders, or the single thing the description names — a pair of hands, ' +
      'a screen, an object. Almost none of the room is in shot, and nothing below the chest.',
    'Extreme close-up':
      'One detail fills the frame. Nothing around it is visible: no face unless the face IS ' +
      'the detail, no wardrobe, no room.',
    'Over the shoulder':
      'Past the near figure — the back of a head and one shoulder, soft and unread — ' +
      'onto what they are looking at. The near figure is a silhouette, not a portrait.',
    'Two shot':
      'Two figures sharing the frame, from roughly the waist up. Both read; the space around ' +
      'them barely does.',
    'Insert':
      'An object, a screen, a document or a detail, filling the frame. No person is in shot ' +
      'unless a part of them — a hand, a sleeve — is holding or touching the thing.',
    'Cutaway':
      'Something other than the main action, in its own frame. Whoever the scene is about is ' +
      'not in this one.',
    'POV':
      'What the character sees, from where their eyes are. They are not in the frame — at ' +
      'most their own hands or feet at its edge.',
    'Screen capture':
      'The screen itself, filling the frame — the interface as it would be captured, not ' +
      'photographed. No room, no person, no reflection unless the description asks for one.',
    'Talking head':
      'One person to camera, head and shoulders, plain and centred. Face and wardrobe above ' +
      'the chest read; the room behind is soft and incidental.'
  };

  /* The line for a shot's type, or '' — a type somebody added by hand has none
   * until they write one, and saying nothing is better than guessing. */
  function framingFor(p, type) {
    const map = (p && p.settings && p.settings.shotFraming) || {};
    const v = map[type];
    return typeof v === 'string' ? v.trim() : '';
  }

  /* Which shot type a description is describing, if it says.
   *
   * The type comes from the dropdown and stays there — this is only for
   * noticing that the two disagree, which is worth a badge and one click, not
   * a silent correction. Longest names first, so "extreme close-up" is not
   * read as "close-up". */
  /* [type, pattern, strict]
   *
   * `strict` marks the ones that are also ordinary English -- wide, insert,
   * cutaway, over the shoulder. Those have to be followed by the kind of thing
   * a slug line follows them with; the rest carry their own preposition or are
   * not words anybody uses by accident. */
  const FRAMING_WORDS = [
    ['Extreme close-up', '(?:extreme|tight)\\s+close[\\s-]?ups?|ecus?|xcus?', false],
    ['Over the shoulder', 'over[\\s-]the[\\s-]shoulders?|ots', true],
    ['Screen capture', 'screen\\s?(?:capture|grab|recording)|screencaps?', false],
    ['Talking head', 'talking[\\s-]heads?|piece to camera|straight to camera', false],
    ['Close-up', 'close[\\s-]?ups?|close on|tight on', false],
    ['Two shot', 'two[\\s-]?shots?|2[\\s-]?shots?', false],
    ['Cutaway', 'cut[\\s-]?aways?', true],
    ['Insert', 'inserts?', true],
    ['POV', 'pov|point[\\s-]of[\\s-]view', false],
    ['Medium', 'medium\\s+(?:shot|close)|mid[\\s-]?shots?', false],
    ['Wide', 'wide\\s+shots?|wides?|establishing(?:\\s+shot)?', true]
  ];

  /* A framing is how a description OPENS, not a word that appears in it.
   *
   * Bare word patterns read ordinary English as a shot type: "she is wide
   * awake" became Wide, "insert the key into the lock" became Insert, "a
   * cutaway sofa in the showroom" became Cutaway -- and the badge then offered
   * one click to set the card to the wrong framing, which every prompt written
   * afterwards is written to. Nothing about that is visible on the card.
   *
   * So the word has to lead the description, and -- where it is a word people
   * use for other things -- be followed by what a slug line follows it with
   * rather than by an object. "Insert of the manifest" is a framing; "insert
   * the key" is an instruction. "Wide of the bay" is a framing; "wide-eyed"
   * is not. */
  const STRICT_TAIL = '(?=$|\\s*[,.:;\\u2014\\u2013]|\\s+(?:of|on|as|shot)\\b)';

  function framingRe(body, strict) {
    return new RegExp('^\\s*(?:a|an|the)?\\s*(?:' + body + ')\\b' +
      (strict ? STRICT_TAIL : ''), 'i');
  }

  /* Only ever a type the board actually offers, matched by name however it is
   * capitalised — a renamed or trimmed list must not produce a badge offering
   * a type that is not in the dropdown. */
  function guessFraming(p, text) {
    const t = String(text == null ? '' : text);
    if (!t.trim()) return '';
    const offered = (p && p.settings && p.settings.shotTypes) || [];
    for (let i = 0; i < FRAMING_WORDS.length; i++) {
      if (!framingRe(FRAMING_WORDS[i][1], FRAMING_WORDS[i][2]).test(t)) continue;
      const want = FRAMING_WORDS[i][0].toLowerCase();
      const match = offered.filter(function (x) { return String(x).toLowerCase() === want; })[0];
      if (match) return match;
    }
    return '';
  }

  /* The wording every board was written with, kept so a template nobody has
   * touched can be brought up to date without overwriting one somebody has. */
  const IMG_TPL_V1 =
    'Write a single first-frame still-image prompt for {{MODEL}}.\n' +
    'Shot type: {{SHOT_TYPE}}. Scene: {{SCENE}}.\n' +
    'Describe subject, setting, composition, lens, lighting and mood in one dense paragraph. ' +
    'No camera motion, no narration, no preamble.\n\n' +
    'SHOT DESCRIPTION:\n{{DESCRIPTION}}';

  const IMG_TPL =
    'Write a single first-frame still-image prompt for {{MODEL}}.\n' +
    'Shot type: {{SHOT_TYPE}}. Scene: {{SCENE}}.\n' +
    'The description below is a short sequence. You are writing only its FIRST INSTANT — the ' +
    'state of things as the shot opens, before anything it says happens next has happened. ' +
    'Anyone or anything described as arriving, entering or appearing later is not in this frame.\n' +
    'Describe subject, setting, composition, lens, lighting and mood in one dense paragraph. ' +
    'No camera motion, no narration, no preamble.\n\n' +
    'SHOT DESCRIPTION:\n{{DESCRIPTION}}';

  const VID_TPL_V1 =
    'Write a single image-to-video prompt for {{MODEL}}, starting from the first frame described below.\n' +
    'Shot type: {{SHOT_TYPE}}. Scene: {{SCENE}}.\n' +
    'Describe only what MOVES: subject action, camera move, pacing, and how the shot ends. ' +
    'Keep it one paragraph, no preamble.\n\n' +
    'SHOT DESCRIPTION:\n{{DESCRIPTION}}';

  /* "Describe only what MOVES" was one line arguing with the house style, the
   * cast block and a rider that all asked for the look — and the look won. The
   * frame is SUPPLIED to an image-to-video call, so none of it needs writing
   * down; saying that outright, and saying what to write instead, is the
   * difference between a motion prompt and a second description of the shot. */
  const VID_TPL_V2 =
    'Write a single image-to-video prompt for {{MODEL}}. The first frame is supplied with the ' +
    'call as a picture — the model can already see the set, the wardrobe, the faces, the light ' +
    'and the grade, so none of that is yours to write.\n' +
    'Shot type: {{SHOT_TYPE}}. Scene: {{SCENE}}.\n' +
    'Write the MOTION out of that frame, in order: what moves first, what follows, at what pace, ' +
    'and where the shot ends. Be specific about the action — which hand, which direction, how ' +
    'far, how fast, what the body and the face are doing. Name the camera move and its speed.\n' +
    'Open on the action, not on the scene. Do not re-describe anything already in the frame.\n' +
    'Keep it one paragraph, no preamble.\n\n' +
    'SHOT DESCRIPTION:\n{{DESCRIPTION}}';

  /* "Name the camera move and its speed" is an order to produce one, and it
   * was obeyed: every shot came back with a slow push nobody had asked for.
   * The camera holds unless the description asks for a move. */
  const VID_TPL =
    'Write a single image-to-video prompt for {{MODEL}}. The first frame is supplied with the ' +
    'call as a picture — the model can already see the set, the wardrobe, the faces, the light ' +
    'and the grade, so none of that is yours to write.\n' +
    'Shot type: {{SHOT_TYPE}}. Scene: {{SCENE}}.\n' +
    'Write the MOTION out of that frame, in order: what moves first, what follows, at what pace, ' +
    'and where the shot ends. Be specific about the action — which hand, which direction, how ' +
    'far, how fast, what the body and the face are doing.\n' +
    'THE CAMERA IS LOCKED OFF — a static frame on sticks. Write no push, pan, tilt, dolly, ' +
    'zoom, orbit, handheld drift or reframe unless the shot description below asks for one in ' +
    'words; if it does, write that move and name its speed, and no other. Otherwise say nothing ' +
    'about the camera at all: the subject moves, the frame does not.\n' +
    'Open on the action, not on the scene. Do not re-describe anything already in the frame.\n' +
    'Keep it one paragraph, no preamble.\n\n' +
    'SHOT DESCRIPTION:\n{{DESCRIPTION}}';

  /* MiniMax H3 does not take a paragraph. Its published prompt guide
   * (VIDEO_PROMPT_WRITING_GUIDE_ref_en.md) specifies a six-section rewrite with
   * its own reference labels, relationship markers and shot syntax; a prose
   * prompt is simply the wrong shape for it. Everything below is that format. */
  const H3_VID_TPL_V2 =
    'Write the prose of a MiniMax H3 full-reference video prompt, starting from the first frame ' +
    'described below.\n' +
    'The app has already written subject_definitions and retention_analysis from the board, so ' +
    'the labels below are FIXED. Use them exactly; never invent a <Subject N>, <Picture N>, ' +
    '<Video N> or <Audio N> that is not in this table, and never redefine one.\n\n' +
    'LABELS\n{{H3_LABELS}}\n\n' +
    'Return JSON with exactly two keys:\n' +
    '- "summary": one short paragraph opening with the bracketed task type {{H3_TASK}} exactly as ' +
    'written, then what the target video shows and the main reference relationships, in the ' +
    'labels above. Introduce nothing new here.\n' +
    '- "detailed_description": one or two sentences of overall style and look FIRST, then ' +
    '"[Shot 1]" and the shot itself. Treat this as one continuous shot with no cut unless the ' +
    'description below calls for one; a later shot opens "[Shot N] At MM:SS.mmm, ...". State that ' +
    'the shot begins from <Picture 1>, then give composition, each subject\'s appearance and ' +
    'position, environment and lighting, the action and every state change, and the camera move ' +
    '(type, amplitude and speed, in natural English). Say where each reference takes effect. ' +
    'Introduce each subject at its first clear appearance by its label, then reuse the label. ' +
    '350-500 words.\n\n' +
    'THIS VIDEO IS SILENT. There is no dialogue, no speaker IDs, no <d>...</d>, and nothing about ' +
    'sound in either key — the sound sections are written by the app.\n' +
    'English throughout. No preamble, no commentary, no markdown fences, and do not write the ' +
    'section names — return the two values only.\n\n' +
    'Shot type: {{SHOT_TYPE}}. Scene: {{SCENE}}.\n\n' +
    'SHOT DESCRIPTION:\n{{DESCRIPTION}}\n\n' +
    'THE SCRIPT THIS SHOT COVERS — what is happening, for action and timing only. The video is ' +
    'silent, so none of it is spoken aloud in what you write:\n{{SCRIPT}}';

  /* One clause of the H3 format, under the same rule as the paragraph above.
   * Written as a replacement rather than a second copy so the two versions
   * cannot drift apart in anything but the sentence that changed. */
  const H3_CAM_V2 = 'and the camera move ' +
    '(type, amplitude and speed, in natural English). ';
  const H3_CAM = 'The camera is LOCKED OFF unless the shot description asks for a move ' +
    'in words — then, and only then, give its type, amplitude and speed in natural English; ' +
    'otherwise state that the camera holds. ';
  const H3_VID_TPL = H3_VID_TPL_V2.replace(H3_CAM_V2, H3_CAM);

  const H3_REF_TPL =
    'Reference images are supplied in the numbered order above. Their <Picture N> labels and the ' +
    '<Subject N> each one defines have already been assigned by the app and are listed in the ' +
    'LABELS table — use those labels exactly, and keep face, hair and wardrobe as the image and ' +
    'the description above have them. Named subjects: {{NAME}}.';

  /* What an image-to-video call is actually shown.
   *
   *   'frame-only'     — one picture, the first frame. Everything in it is
   *                      inherited: set, wardrobe, faces, light, lens, grade.
   *                      The prompt is motion and nothing else.
   *   'full-reference' — the frame AND the subject reference images, under a
   *                      label vocabulary. Appearance is part of the format
   *                      here, not a repetition, because the model is being
   *                      asked to bind each label to a picture.
   *
   * This is the one fact about a target model that changes what the prompt
   * should CONTAIN rather than how it is worded, which is why it is a field
   * and not a sentence inside referenceTemplate. Everything ships frame-only;
   * H3 is the only full-reference model the app knows about. */
  const FRAME_ONLY = 'frame-only';
  const FULL_REFERENCE = 'full-reference';

  /* Templates a specific model needs instead of the generic pair, keyed by the
   * name it ships under in defaultModels(). */
  const MODEL_TPLS = {
    'MiniMax H3 (Hailuo)': {
      video: H3_VID_TPL, reference: H3_REF_TPL, videoRefs: FULL_REFERENCE
    }
  };

  function tplsFor(name) {
    const o = MODEL_TPLS[name] || {};
    return {
      image: o.image || IMG_TPL,
      video: o.video || VID_TPL,
      reference: typeof o.reference === 'string' ? o.reference : SB.Personas.DEFAULT_REF_TEMPLATE,
      videoRefs: o.videoRefs || FRAME_ONLY
    };
  }

  /* Does this model's video prompt inherit the look from the supplied frame?
   * True for everything except a full-reference model. Called on a null model
   * — no video target picked yet — it answers true, which is the safe way
   * round: the worst case is a prompt that leaves out a description nobody
   * needed. */
  function videoInherits(m) { return !m || m.videoRefs !== FULL_REFERENCE; }

  /* Which ImagineArt model a board model is pointed at. The knowledge lives in
   * imagine.js, which is not loaded by the node tests, so it is asked for
   * rather than assumed — an unmapped model simply has no slug, which is what
   * Settings shows and what stops a push before it starts. */
  function guessSlug(name) {
    return (SB.Imagine && SB.Imagine.guessSlug) ? SB.Imagine.guessSlug(name) : '';
  }

  function guessRestSlug(name) {
    return (SB.Imagine && SB.Imagine.guessRestSlug) ? SB.Imagine.guessRestSlug(name) : '';
  }

  function model(name, kind) {
    const t = tplsFor(name);
    return {
      id: SB.uid('m'), name: name, kind: kind,
      imageTemplate: t.image, videoTemplate: t.video,
      referenceTemplate: t.reference, videoRefs: t.videoRefs,
      /* what the account's tools call it, and what the v2 REST API calls it */
      imagineSlug: guessSlug(name),
      restSlug: guessRestSlug(name)
    };
  }

  function defaultModels() {
    return [
      model('Wan', 'video'), model('LTX (LTXV 2.3)', 'video'), model('Veo', 'video'),
      model('Kling', 'video'), model('Sora', 'video'), model('Runway', 'video'),
      model('MiniMax H3 (Hailuo)', 'video'), model('Seedance', 'video'),
      model('Flux 3', 'video'),
      model('Nano Banana (Gemini Image)', 'image'), model('Qwen-Image', 'image'),
      model('FLUX', 'image'), model('GPT Image', 'image'), model('Imagen', 'image'),
      model('Ideogram', 'image'), model('Midjourney', 'image')
    ];
  }

  /* Mid-tone hues, each legible as a card edge on both the light and dark board. */
  const CARD_COLORS = [
    '#6b7280', // slate
    '#3b82f6', // blue
    '#0891b2', // cyan
    '#0d9488', // teal
    '#16a34a', // green
    '#ca8a04', // gold
    '#ea580c', // orange
    '#dc2626', // red
    '#db2777', // pink
    '#7c3aed'  // violet
  ];

  /* ---- takes ----
   *
   * A clip that is MOSTLY right is the ordinary case, not the exception: you
   * shoot it again, and until now the second one overwrote the first, so the
   * only way to keep both was to save one out of the app by hand and remember
   * what it was. A card holds its takes now.
   *
   * `shot.video` is still the CHOSEN take and still the only thing every
   * reader in the app looks at -- the card badge, the export, the PDF, the
   * prompt table, the push. `videoAlts` is the rest of them, and it is purely
   * additive: a board that has never kept one behaves exactly as it did.
   *
   * Numbered by when they were made rather than by where they sit, because a
   * take number is a fact about the shoot and the chosen one moves. */
  function takes(shot) {
    const out = [];
    if (shot && shot.video) out.push({ rec: shot.video, chosen: true });
    ((shot && shot.videoAlts) || []).forEach(function (r) {
      if (r) out.push({ rec: r, chosen: false });
    });
    out.sort(function (x, y) { return (x.rec.at || 0) - (y.rec.at || 0); });
    out.forEach(function (x, i) { x.n = i + 1; });
    return out;
  }

  function takeCount(shot) {
    return (shot && shot.video ? 1 : 0) + (((shot && shot.videoAlts) || []).length);
  }

  /* A new take arrives: the one that was chosen joins the rest, and the new
   * one takes its place. In ONE step.
   *
   * This was two -- empty the slot, then fill it -- and anything that failed
   * in between left a card holding every take it had and none of them chosen.
   * Every reader is gated on shot.video, so they vanished from the card, the
   * clip window and the export while their bytes stayed in the file; the
   * Remove button is only built when there IS a chosen take, so they could not
   * even be deleted. A zero-byte file dropped on a card did it. */
  function addTake(shot, rec) {
    if (!shot || !rec) return null;
    if (shot.video && shot.video !== rec) {
      shot.videoAlts = (shot.videoAlts || []).concat([shot.video]);
    }
    shot.video = rec;
    return rec;
  }

  /* A card with takes and no chosen one cannot show, export or delete any of
   * them. addTake makes it unreachable; this repairs a board written by the
   * build where it was not. */
  function repairTakes(sh) {
    if (!sh || sh.video || !(sh.videoAlts && sh.videoAlts.length)) return false;
    const rest = sh.videoAlts.slice()
      .sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    sh.video = rest.shift() || null;
    sh.videoAlts = rest;
    return true;
  }

  /* Swap a take into the chosen slot. The one that was chosen joins the rest
   * rather than being thrown away -- this is a choice, not a deletion. */
  function useTake(shot, rec) {
    if (!shot || !rec || rec === shot.video) return false;
    const alts = (shot.videoAlts || []).slice();
    const i = alts.indexOf(rec);
    if (i < 0) return false;
    alts.splice(i, 1);
    if (shot.video) alts.push(shot.video);
    shot.videoAlts = alts;
    shot.video = rec;
    return true;
  }

  /* One take, gone. Removing the chosen one promotes the most recent of what
   * is left, so a card with takes never ends up holding none while still
   * carrying three. */
  function dropTake(shot, rec) {
    if (!shot || !rec) return false;
    if (rec === shot.video) {
      const rest = (shot.videoAlts || []).slice()
        .sort(function (x, y) { return (y.at || 0) - (x.at || 0); });
      shot.video = rest.shift() || null;
      shot.videoAlts = rest;
      return true;
    }
    const alts = (shot.videoAlts || []).slice();
    const i = alts.indexOf(rec);
    if (i < 0) return false;
    alts.splice(i, 1);
    shot.videoAlts = alts;
    return true;
  }

  function newShot(opts) {
    opts = opts || {};
    return {
      id: SB.uid('sh'),
      type: opts.type || '',
      noShot: !!opts.noShot,
      color: opts.color || CARD_COLORS[0],
      link: opts.link || null,          // {from,to} into master, or null = freestanding
      local: opts.link ? null : SB.Doc.make(opts.text || ''),
      personaIds: [],                   // who appears in this shot
      /* ...and which of them are not there yet when it opens. A first frame is
       * one instant, so somebody who walks in during the shot must not be drawn
       * standing in it. A subset of personaIds, never anything else. */
      castEnters: [],
      broken: false,
      description: '',
      /* The still and the clip are different jobs and want different words.
       * `description` is what we see and feeds both; these two are optional
       * and feed one each. A mark written in one of them is a reference that
       * lane hands over and the other never sees — which is the whole point,
       * since a reference IS a mark in the text it was written in. */
      imageDescription: '',
      videoDescription: '',
      fields: {},                       // extra text boxes, keyed by field id
      image: null,                      // {ref,w,h} into project.blobs
      /* Every other take of this shot, oldest kept first. `video` above is
       * the chosen one and stays the only thing the rest of the app reads. */
      videoAlts: [],
      annotation: null,                 // {ref} — transparent PNG overlay
      /* {ref,serial,ext,w,h,bytes} — the full-size original, in this file.
       * The board draws the proxy above; this is the copy a model is fed, and
       * it rides with the content. */
      render: null,
      /* {ref,serial,ext,bytes,at,url} — the clip ImagineArt made from this
       * frame, kept in this file like everything else. A clip is the heaviest
       * thing a board can carry, which is why Settings counts them. Null on
       * every shot that has none. */
      video: null,
      comments: [],
      prompts: {}                       // modelName -> {imagePrompt, videoPrompt}
    };
  }

  /* A scene can claim a stretch of the master script of its own — the loose,
   * early pass, before anyone knows what the shots are. It is independent of
   * whatever its shots point at: they may overlap it, or sit outside it, or not
   * exist yet. Unlike a shot, a scene starts with NO script at all — an empty
   * local doc here would have every scene claiming to have one. */
  /* A new scene has no name.
   *
   * It used to be called "Scene 3", which is true exactly until somebody drags
   * it — and then the board has a scene called "Scene 3" sitting second, which
   * is worse than no name at all. The number is where a scene SITS: the
   * navigator, the banner, the organizer and the prompt table all draw it from
   * the position, so it is right by construction and never has to be kept in
   * step. What the heading is for is what the scene IS. */
  function newScene(heading) {
    return {
      id: SB.uid('sc'),
      heading: heading || '',
      description: '',
      link: null,          // {from,to} into master
      local: null,         // its own doc once the link is broken; null = untied
      broken: false,
      shots: []
    };
  }

  /* How this board prints. Kept in the file rather than in localStorage so a
   * board carries its own print setup wherever it is opened. The preset ids
   * belong to SB.Pdf.PRESETS, but this default is spelled out here so model.js
   * stays loadable without pdf.js (the node tests load neither). */
  function defaultExport() {
    return {
      /* Which document the PDF button makes. The board is the storyboard
       * sheets; the references are what the subjects on it LOOK like, which is
       * a different thing on paper and the thing you hand somebody who has to
       * match them. 'both' prints the references after the board. */
      doc: 'board',              // 'board' | 'refs' | 'both'
      refPreset: 'refs4',
      refShots: true,            // which cards each subject appears on
      refUnused: true,           // subjects no card uses
      refFeeds: false,           // the per-card mapping, in feed order
      preset: 'sheet6',
      showType: true,
      showScript: true,
      showDesc: true,
      showSceneHeading: true,   // scene name on each card's meta line
      sceneBanner: false,       // heading + description as a band where a scene starts
      scenePageBreak: false,    // each scene starts a fresh sheet
      color: 'accent',          // 'off' | 'accent' — carry shot.color onto paper
      footer: true              // name · version · page N of M
    };
  }

  function byName(models, name) {
    const m = models.filter(function (x) { return x.name === name; })[0];
    return m ? m.id : null;
  }

  function firstOfKind(models, kind) {
    const m = models.filter(function (x) { return x.kind === kind; })[0] || models[0];
    return m ? m.id : null;
  }

  function newProject() {
    const p = {
      fileVersion: FILE_VERSION,
      id: SB.uid('prj'),
      name: 'Untitled project',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      master: SB.Doc.make(''),
      blobs: {},                        // hash -> data URL; images live here once
      scriptComments: [],               // notes anchored to ranges of the master
      personas: [],
      /* High-water mark for render serials. Only ever goes up: a number
       * belonging to a deleted shot is never handed out again, so a file that
       * has already left the app never comes to mean something else. */
      renderSeq: 0,
      scenes: [newScene()],
      versionNumber: 1,
      versionName: 'v1',
      versions: [],
      settings: {
        shotTypes: DEFAULT_SHOT_TYPES.slice(),
        shotFraming: Object.assign({}, DEFAULT_FRAMING),
        fields: SB.Fields.defaults(),
        models: defaultModels(),
        imageModelId: null,
        videoModelId: null,
        aiProvider: 'gemini',
        geminiModel: SB.GeminiModels.DEFAULT,
        /* What shape ImagineArt is asked for. A storyboard is nearly always
         * widescreen, and it belongs to the board rather than the browser. */
        imagineAspect: '16:9',
        /* 'best'    — the largest each model offers
         * '1080p'   — 1080p where it is offered, the best below it otherwise
         * 'default' — whatever the model falls back to, which is its FLOOR:
         *             480p on Seedance, 720p on Veo, 1K and "low" quality on
         *             the stills. Sending nothing is not sending "normal". */
        imagineResolution: 'best',
        /* Whether the organization travels in the file. It is not a secret
         * and a team shares one, so it saves everybody a step — but a board
         * can travel further than the team that made it. */
        imagineShareOrg: true,
        /* Written by Settings: the catalog, the measured prices and the org
         * this board was set up against, for whoever opens it next. Never a
         * token and never a key. */
        imagine: null,
        /* 'webp'   — originals re-encoded at native size (16x smaller, and
         *            still far past what a reference needs)
         * 'source' — the bytes exactly as they arrived, and the file it makes */
        originals: 'webp',
        brand: { enabled: true, custom: false },
        // prompt boxes stay off the cards until the user asks for them
        showImagePrompt: false,
        showVideoPrompt: false,
        export: defaultExport()
      }
    };
    /* The two a new board opens on. Named rather than taken from the top of
     * the list, because the order of that list is about nothing in
     * particular and these are a decision: GPT Image for stills, LTX 2.3 for
     * clips. Both fall back to the first of their kind if somebody edits the
     * names out from under them. */
    p.settings.imageModelId = byName(p.settings.models, 'GPT Image') ||
      firstOfKind(p.settings.models, 'image');
    p.settings.videoModelId = byName(p.settings.models, 'LTX (LTXV 2.3)') ||
      firstOfKind(p.settings.models, 'video');
    p.scenes[0].shots.push(newShot({ type: DEFAULT_SHOT_TYPES[0] }));
    return p;
  }

  /* Boards written before the fold were saved with the CRs still in them, and
   * their links are already anchored against those longer offsets. Folding the
   * text without dragging every anchor through the same map would move each
   * card's text instead of repairing it, so both happen together.
   * `core` is {master, scenes, scriptComments} — the shape of a project and of
   * a frozen version alike, so a restore does not bring the CRs back. */
  function foldLineEndings(core) {
    if (!core || !core.master || typeof core.master.text !== 'string') return;
    const at = SB.Doc.foldEOL(core.master);
    if (at) {
      (core.scenes || []).forEach(function (sc) {
        if (sc && sc.link && typeof sc.link.from === 'number') {
          sc.link.from = at(sc.link.from);
          sc.link.to = at(sc.link.to);
          if (sc.link.to <= sc.link.from) sc.broken = true;
        }
        (sc.shots || []).forEach(function (sh) {
          if (!sh || !sh.link || typeof sh.link.from !== 'number') return;
          sh.link.from = at(sh.link.from);
          sh.link.to = at(sh.link.to);
          if (sh.link.to <= sh.link.from) sh.broken = true;
        });
      });
      (core.scriptComments || []).forEach(function (c) {
        c.from = at(c.from);
        c.to = at(c.to);
        c.quote = SB.Doc.eol(c.quote);
        if (c.to <= c.from) c.broken = true;
      });
    }
    /* A freestanding card or scene owns its own text, with no anchors into it. */
    (core.scenes || []).forEach(function (sc) {
      if (sc && !sc.link && sc.local) SB.Doc.foldEOL(sc.local);
      (sc.shots || []).forEach(function (sh) {
        if (sh && !sh.link && sh.local) SB.Doc.foldEOL(sh.local);
      });
    });
  }

  /* A render record, or null. The serial is a filename on somebody's disk and
   * the promise that a number is never reused, so anything that is not a whole
   * positive number is not one: "abc" padded to 0000, and two such records
   * collided on the same file. */
  function goodRender(r) {
    if (!r) return null;
    const n = typeof r.serial === 'number' ? r.serial : parseFloat(r.serial);
    if (!isFinite(n) || n < 1 || Math.floor(n) !== n) return null;
    r.serial = n;
    return r;
  }

  /* One recurring subject, brought up to date.
   *
   * Two things moved after the first boards were written: a subject is now a
   * person, a place or a thing, and it carries several reference frames rather
   * than one. Boards predating either are the common case — everything ever
   * written as a persona is a person, and its lone `image` becomes the first
   * frame. Frozen version snapshots come through here too, so nothing
   * downstream has to know which era a record was written in. */
  function migratePersona(p, x) {
    x.id = x.id || SB.uid('per');
    x.kind = SB.Personas.kindOf(x).id;
    x.name = x.name || 'Persona';
    x.description = x.description || '';
    x.imagePrompt = x.imagePrompt || '';
    /* Left at 0 when a board predates the stamp: unknown, not "just edited",
     * so no card is falsely flagged as behind. */
    x.updatedAt = typeof x.updatedAt === 'number' ? x.updatedAt : 0;

    /* One reference per subject. A board that carried several keeps the first
     * and the rest move to `retired` — fed to nothing, exported by nothing,
     * but not deleted: the .storyboard is the only copy of those originals
     * now, and throwing them away on open would destroy work in silence. The
     * persona panel offers to use one or be rid of them. */
    const imgs = [];
    if (x.image) imgs.push(x.image);
    (Array.isArray(x.images) ? x.images : []).forEach(function (i) { imgs.push(i); });
    (Array.isArray(x.retired) ? x.retired : []).forEach(function (i) { imgs.push(i); });
    const kept = imgs.map(function (img) {
      const a = SB.Blobs.adopt(p, img);
      if (!a) return null;
      a.label = typeof img.label === 'string' ? img.label : (a.label || '');
      a.render = goodRender(img.render) || goodRender(a.render);
      if (a.render) p.renderSeq = Math.max(p.renderSeq | 0, a.render.serial);
      return a;
    }).filter(Boolean);
    delete x.images;
    delete x.image;
    delete x.retired;
    if (kept.length) x.image = kept[0];
    if (kept.length > 1) x.retired = kept.slice(1);
  }

  /* Fill in anything an older/hand-edited file is missing. */
  function migrate(p) {
    if (!p || typeof p !== 'object') throw new Error('not a Storyboarder project');
    p.fileVersion = FILE_VERSION;
    p.id = p.id || SB.uid('prj');
    p.name = p.name || 'Untitled project';
    p.createdAt = p.createdAt || Date.now();
    p.master = p.master && typeof p.master.text === 'string' ? p.master : SB.Doc.make('');
    p.master.marks = p.master.marks || { b: [], i: [], u: [] };
    ['b', 'i', 'u'].forEach(function (t) { p.master.marks[t] = p.master.marks[t] || []; });
    /* Images used to sit inline on each shot, which meant every version froze
     * its own copy of every frame. They are now stored once under a hash. */
    p.blobs = (p.blobs && typeof p.blobs === 'object') ? p.blobs : {};

    p.scriptComments = Array.isArray(p.scriptComments) ? p.scriptComments : [];
    p.scriptComments.forEach(function (c) {
      c.id = c.id || SB.uid('sc');
      c.from = SB.clamp(c.from | 0, 0, p.master.text.length);
      c.to = SB.clamp(c.to | 0, c.from, p.master.text.length);
      c.text = c.text || '';
      c.quote = c.quote || '';
      c.at = c.at || Date.now();
      c.broken = !!c.broken || c.to <= c.from;
    });
    p.personas = Array.isArray(p.personas) ? p.personas : [];
    p.personas.forEach(function (x) { migratePersona(p, x); });
    p.scenes = Array.isArray(p.scenes) ? p.scenes : [];
    /* "Scene 3" sitting second is a number somebody never typed and cannot be
     * kept true. Only the app's own defaults are cleared — anything a person
     * actually wrote is theirs, whatever it says. */
    p.scenes.forEach(function (sc) {
      if (sc && /^scene (?:\d+|one)$/i.test(String(sc.heading || '').trim())) sc.heading = '';
    });
    if (!p.scenes.length) p.scenes.push(newScene());
    p.renderSeq = Math.max(p.renderSeq | 0, 0);
    p.versionNumber = p.versionNumber || 1;
    p.versionName = p.versionName || ('v' + p.versionNumber);
    p.versions = Array.isArray(p.versions) ? p.versions : [];
    /* Frozen versions carried their own copy of every frame — the same bytes
     * hash to the same reference, so migrating them collapses the duplicates. */
    p.versions.forEach(function (v) {
      if (!v || !v.snapshot) return;
      /* Versions written before the cast froze with them hold cards that name
       * subjects the snapshot never carried. What that cast looked like at the
       * time is not recorded anywhere and cannot be recovered — so the closest
       * true thing is used: the cast as it stands now. That keeps every
       * restored card's personaIds resolvable, and keeps the reference frames
       * referenced, which is what stopped them being collected as orphans.
       * A snapshot that already has its own cast is left alone. */
      if (!Array.isArray(v.snapshot.personas)) {
        v.snapshot.personas = SB.clone(p.personas);
      }
      (v.snapshot.scenes || []).forEach(function (sc) {
        (sc.shots || []).forEach(function (sh) {
          /* the arrival marks are a subset of the cast here too */
          sh.render = goodRender(sh.render);
        if (sh.render) p.renderSeq = Math.max(p.renderSeq | 0, sh.render.serial);
        /* A clip claims from the same counter, so a board whose counter is
           behind would hand a new one a serial that is already taken — and
           the whole point of a serial is that it never repeats. */
        sh.video = goodRender(sh.video);
        if (sh.video) p.renderSeq = Math.max(p.renderSeq | 0, sh.video.serial);
        /* The other takes claim from that counter too, and are the one record
           list this sweep used to walk past. Left out, a board whose counter
           was behind handed a new clip a serial an alternate already owned. */
        sh.videoAlts = (Array.isArray(sh.videoAlts) ? sh.videoAlts : [])
          .map(goodRender).filter(Boolean);
        sh.videoAlts.forEach(function (r) {
          p.renderSeq = Math.max(p.renderSeq | 0, r.serial);
        });
        repairTakes(sh);
        sh.personaIds = Array.isArray(sh.personaIds) ? sh.personaIds : [];
          sh.castEnters = (Array.isArray(sh.castEnters) ? sh.castEnters : [])
            .filter(function (id) { return sh.personaIds.indexOf(id) >= 0; });
          sh.image = SB.Blobs.adopt(p, sh.image);
          sh.annotation = SB.Blobs.adopt(p, sh.annotation);
        });
      });
      (v.snapshot.personas || []).forEach(function (per) { migratePersona(p, per); });
    });
    const s = p.settings = p.settings || {};
    s.shotTypes = (s.shotTypes && s.shotTypes.length) ? s.shotTypes : DEFAULT_SHOT_TYPES.slice();
    /* Absent is empty is exactly how every board behaved before takes. Walked
       by hand rather than through eachShot, because migrate runs over shapes
       that have not been normalised yet -- a scene with no shots array at all
       is a fixture, a hand-built snapshot, and it must not throw here. */
    (p.scenes || []).forEach(function (sc) {
      (sc.shots || []).forEach(function (sh) {
        if (!Array.isArray(sh.videoAlts)) sh.videoAlts = [];
        repairTakes(sh);
      });
    });
    /* Only what is missing: a line somebody has deliberately emptied stays
       empty, and one they have rewritten stays theirs. */
    s.shotFraming = s.shotFraming || {};
    Object.keys(DEFAULT_FRAMING).forEach(function (k) {
      if (!(k in s.shotFraming)) s.shotFraming[k] = DEFAULT_FRAMING[k];
    });
    SB.Fields.migrate(p);
    s.models = (s.models && s.models.length) ? s.models : defaultModels();
    /* The MiniMax entry shipped under its platform name with the generic
     * templates. Rename it and hand it the H3 format — but only where the
     * templates are still untouched, so an edited one stays the user's. */
    s.models.forEach(function (m) {
      if (m.name !== 'Hailuo (MiniMax)') return;
      m.name = 'MiniMax H3 (Hailuo)';
      const t = tplsFor(m.name);
      if (!m.videoTemplate || m.videoTemplate === VID_TPL) m.videoTemplate = t.video;
      if (typeof m.referenceTemplate !== 'string' ||
          m.referenceTemplate === SB.Personas.DEFAULT_REF_TEMPLATE) {
        m.referenceTemplate = t.reference;
      }
    });
    s.modelSeeds = (s.modelSeeds || []).map(function (n) {
      return n === 'Hailuo (MiniMax)' ? 'MiniMax H3 (Hailuo)' : n;
    });

    /* A first frame is one instant, and the old template never said so — it
     * called the job a first-frame prompt and then handed over a paragraph in
     * which three things happen. Boards carry their own copy of that wording,
     * so it is replaced here; anything edited by hand is left exactly alone. */
    s.models.forEach(function (m) {
      if (m.imageTemplate === IMG_TPL_V1) m.imageTemplate = IMG_TPL;
    });

    /* The old video template asked for motion in one line while the house
     * style, the cast block and the rider all asked for the look — so the
     * prompts came back re-describing the frame that was sitting right there.
     * Same rule as the still above: an untouched copy is brought up to date,
     * an edited one is the user's and is left exactly alone. */
    s.models.forEach(function (m) {
      if (m.videoTemplate === VID_TPL_V1) m.videoTemplate = VID_TPL;
    });

    /* Telling the writer to name the camera move is telling it there is one,
     * and it duly invented one for every shot. Same rule as above: a board
     * carrying the untouched wording is brought up to date, an edited one is
     * the user's and is left alone. */
    s.models.forEach(function (m) {
      if (m.videoTemplate === VID_TPL_V2) m.videoTemplate = VID_TPL;
      if (m.videoTemplate === H3_VID_TPL_V2) m.videoTemplate = H3_VID_TPL;
    });

    s.models.forEach(function (m) {
      m.id = m.id || SB.uid('m');
      m.kind = m.kind || 'video';
      const t = tplsFor(m.name);
      m.imageTemplate = m.imageTemplate || t.image;
      m.videoTemplate = m.videoTemplate || t.video;
      if (typeof m.referenceTemplate !== 'string') {
        m.referenceTemplate = t.reference;
      }
      /* Keyed off the name, not the template: a full-reference model whose
       * wording somebody has edited is still full-reference. */
      if (m.videoRefs !== FRAME_ONLY && m.videoRefs !== FULL_REFERENCE) {
        m.videoRefs = t.videoRefs;
      }
      /* Blank is a real answer — "not pointed at anything on ImagineArt yet" —
       * so only a missing field is filled in, never an emptied one. */
      if (typeof m.imagineSlug !== 'string') m.imagineSlug = guessSlug(m.name);
      /* A board from before the two names: whatever is in imagineSlug was
       * typed for the REST API, because that is all there was. It moves to
       * the field that means that, and the account-side name is filled in
       * from the same table a new board uses — nothing the user chose is
       * overwritten, and the REST transport keeps working exactly as it
       * did. Recognised by being in the published REST list. */
      if (typeof m.restSlug !== 'string') {
        const looksRest = m.imagineSlug &&
          (/-(text|image)-to-video$/.test(m.imagineSlug) ||
            (SB.Imagine && SB.Imagine.isRestSlug && SB.Imagine.isRestSlug(m.imagineSlug)));
        if (looksRest) {
          m.restSlug = m.imagineSlug;
          m.imagineSlug = guessSlug(m.name);
        } else {
          m.restSlug = guessRestSlug(m.name);
        }
      }
    });
    /* A board keeps its own model list, so a model added to the app later
     * would never reach an existing project. Offer each shipped model once:
     * after that it is recorded, so one you delete stays deleted. */
    s.modelSeeds = Array.isArray(s.modelSeeds) ? s.modelSeeds : [];
    defaultModels().forEach(function (d) {
      if (s.modelSeeds.indexOf(d.name) >= 0) return;
      s.modelSeeds.push(d.name);
      if (!s.models.some(function (m) { return m.name === d.name; })) s.models.push(d);
    });

    const has = function (id) { return s.models.some(function (m) { return m.id === id; }); };
    // older files carried a single activeModelId
    if (s.activeModelId && has(s.activeModelId)) {
      const old = s.models.filter(function (m) { return m.id === s.activeModelId; })[0];
      if (old.kind === 'image' && !s.imageModelId) s.imageModelId = old.id;
      if (old.kind === 'video' && !s.videoModelId) s.videoModelId = old.id;
    }
    delete s.activeModelId;
    if (!has(s.imageModelId)) s.imageModelId = firstOfKind(s.models, 'image');
    if (!has(s.videoModelId)) s.videoModelId = firstOfKind(s.models, 'video');
    // Google retires ids; move a project off anything that is gone
    s.geminiModel = SB.GeminiModels.normalize(s.geminiModel);
    /* Every board written before the local-model option existed was a Gemini
     * board, and normalize() says so for anything unrecognised too. */
    s.aiProvider = SB.Providers.normalize(s.aiProvider);
    if (typeof s.imagineAspect !== 'string') s.imagineAspect = '16:9';
    if (s.originals !== 'webp' && s.originals !== 'source') s.originals = 'webp';
    if (['best', '1080p', 'default'].indexOf(s.imagineResolution) < 0) s.imagineResolution = 'best';
    if (typeof s.imagineShareOrg !== 'boolean') s.imagineShareOrg = true;
    if (s.imagine && typeof s.imagine !== 'object') s.imagine = null;
    /* belt and braces: a board that has been through a version of this app
     * that stored a token here does not carry it any further */
    if (s.imagine) { delete s.imagine.token; delete s.imagine.apiKey; }
    s.brand = (s.brand && typeof s.brand === 'object') ? s.brand : {};
    if (typeof s.brand.enabled !== 'boolean') s.brand.enabled = true;
    // only a hand-edited house style is stored; the rest follow the app's
    if (typeof s.brand.custom !== 'boolean') s.brand.custom = false;
    if (!s.brand.custom) delete s.brand.text;
    if (typeof s.showImagePrompt !== 'boolean') s.showImagePrompt = false;
    if (typeof s.showVideoPrompt !== 'boolean') s.showVideoPrompt = false;
    /* Fill each export key on its own: a file written by an older build has
     * some of them, and replacing the whole object would throw away the
     * preset the user chose. */
    const dx = defaultExport();
    s.export = (s.export && typeof s.export === 'object') ? s.export : {};
    Object.keys(dx).forEach(function (k) {
      if (typeof s.export[k] !== typeof dx[k]) s.export[k] = dx[k];
    });

    p.scenes.forEach(function (sc) {
      sc.id = sc.id || SB.uid('sc');
      sc.heading = sc.heading || '';
      sc.description = sc.description || '';
      /* An older board has no section on any scene, and must not be given one:
       * untied is the resting state, so only what is already there is kept. */
      sc.link = sc.link && typeof sc.link.from === 'number' ? sc.link : null;
      if (sc.link) {
        sc.link.from = SB.clamp(sc.link.from, 0, p.master.text.length);
        sc.link.to = SB.clamp(sc.link.to, sc.link.from, p.master.text.length);
        sc.local = null;
      } else if (sc.local && typeof sc.local.text === 'string') {
        sc.local.marks = sc.local.marks || { b: [], i: [], u: [] };
        ['b', 'i', 'u'].forEach(function (t) { sc.local.marks[t] = sc.local.marks[t] || []; });
      } else {
        sc.local = null;
      }
      sc.broken = !!sc.broken;
      sc.shots = Array.isArray(sc.shots) ? sc.shots : [];
      sc.shots.forEach(function (sh) {
        sh.id = sh.id || SB.uid('sh');
        sh.type = sh.type || '';
        sh.noShot = !!sh.noShot;
        sh.color = sh.color || CARD_COLORS[0];
        sh.link = sh.link && typeof sh.link.from === 'number' ? sh.link : null;
        if (!sh.link) {
          sh.local = sh.local && typeof sh.local.text === 'string' ? sh.local : SB.Doc.make('');
          sh.local.marks = sh.local.marks || { b: [], i: [], u: [] };
          ['b', 'i', 'u'].forEach(function (t) { sh.local.marks[t] = sh.local.marks[t] || []; });
        } else {
          sh.link.from = SB.clamp(sh.link.from, 0, p.master.text.length);
          sh.link.to = SB.clamp(sh.link.to, sh.link.from, p.master.text.length);
        }
        sh.broken = !!sh.broken;
        sh.description = sh.description || '';
        /* The still and the clip can each have words of their own. A board
           written before they existed has neither, and reads exactly as it
           did: every lane falls back to the description it already had. */
        sh.imageDescription = sh.imageDescription || '';
        sh.videoDescription = sh.videoDescription || '';
        sh.fields = (sh.fields && typeof sh.fields === 'object') ? sh.fields : {};
        sh.comments = Array.isArray(sh.comments) ? sh.comments : [];
        sh.prompts = sh.prompts || {};
        sh.render = goodRender(sh.render);
        if (sh.render) p.renderSeq = Math.max(p.renderSeq | 0, sh.render.serial);
        /* A clip claims from the same counter, so a board whose counter is
           behind would hand a new one a serial that is already taken — and
           the whole point of a serial is that it never repeats. */
        sh.video = goodRender(sh.video);
        if (sh.video) p.renderSeq = Math.max(p.renderSeq | 0, sh.video.serial);
        /* The other takes claim from that counter too, and are the one record
           list this sweep used to walk past. Left out, a board whose counter
           was behind handed a new clip a serial an alternate already owned. */
        sh.videoAlts = (Array.isArray(sh.videoAlts) ? sh.videoAlts : [])
          .map(goodRender).filter(Boolean);
        sh.videoAlts.forEach(function (r) {
          p.renderSeq = Math.max(p.renderSeq | 0, r.serial);
        });
        repairTakes(sh);
        sh.personaIds = Array.isArray(sh.personaIds) ? sh.personaIds : [];
        /* Empty for every board written before this, which is the right answer:
           nobody was marked as arriving, so everybody was already there. */
        sh.castEnters = (Array.isArray(sh.castEnters) ? sh.castEnters : [])
          .filter(function (id) { return sh.personaIds.indexOf(id) >= 0; });
        sh.image = SB.Blobs.adopt(p, sh.image);
        sh.annotation = SB.Blobs.adopt(p, sh.annotation);
      });
    });

    /* Last, so it works on shots and comments that are already well-formed. */
    foldLineEndings(p);
    p.versions.forEach(function (v) { if (v && v.snapshot) foldLineEndings(v.snapshot); });
    return p;
  }

  /* ---------- lookup / numbering ---------- */

  function eachShot(p, fn) {
    for (let i = 0; i < p.scenes.length; i++) {
      const sc = p.scenes[i];
      for (let j = 0; j < sc.shots.length; j++) fn(sc.shots[j], sc, i, j);
    }
  }

  function code(sceneIdx, shotIdx) { return (sceneIdx + 1) + SB.letters(shotIdx); }

  function findShot(p, id) {
    let res = null;
    eachShot(p, function (sh, sc, i, j) {
      if (sh.id === id) res = { shot: sh, scene: sc, sceneIdx: i, shotIdx: j, code: code(i, j) };
    });
    return res;
  }

  function findScene(p, id) {
    for (let i = 0; i < p.scenes.length; i++) if (p.scenes[i].id === id) return { scene: p.scenes[i], idx: i };
    return null;
  }

  /* ---------- the shared-script window ---------- */

  /* What document + slice does this shot's script box show? */
  function windowFor(p, shot) {
    if (shot.link) return { doc: p.master, from: shot.link.from, to: shot.link.to, linked: true };
    return { doc: shot.local, from: 0, to: shot.local.text.length, linked: false };
  }

  /* The same for a scene — null when it has claimed nothing, which is where
   * most scenes stay, so every caller has to be ready for it. */
  function windowForScene(p, scene) {
    if (!scene) return null;
    if (scene.link) return { doc: p.master, from: scene.link.from, to: scene.link.to, linked: true };
    if (scene.local) return { doc: scene.local, from: 0, to: scene.local.text.length, linked: false };
    return null;
  }

  function sceneTied(scene) { return !!(scene && (scene.link || scene.local)); }

  /* The one place master-script text changes.
   * sourceShotId  = the shot whose box the user typed in (null = typed in master).
   * sourceSceneId = likewise for a scene's own section box.
   */
  function applyMasterEdit(p, start, end, text, sourceShotId, sourceSceneId) {
    if (SB.History) SB.History.push('master:' + (sourceShotId || ''));
    /* Fold before op.len is taken, not inside Doc.replace: every anchor below
     * is mapped through that length, so measuring the un-folded string would
     * push each link one character further right per pasted line. */
    text = SB.Doc.eol(text);
    const op = { start: start, end: end, len: (text || '').length };
    const links = [];
    eachShot(p, function (sh) { if (sh.link) links.push(sh); });

    links.forEach(function (sh) {
      let fromLeft, toLeft;
      if (sh.id === sourceShotId) {
        // the shot being typed in grows at both edges
        fromLeft = true; toLeft = false;
      } else if (!sourceShotId) {
        // typed in master: text at a shot's end boundary extends that shot
        fromLeft = false; toLeft = false;
      } else {
        // another shot's edit: only interior insertions grow this one
        fromLeft = false; toLeft = true;
      }
      const nf = SB.Doc.mapPos(sh.link.from, start, end, op.len, fromLeft);
      const nt = SB.Doc.mapPos(sh.link.to, start, end, op.len, toLeft);
      sh.link.from = Math.min(nf, nt);
      sh.link.to = Math.max(nf, nt);
      if (sh.link.to <= sh.link.from) sh.broken = true;
      else if (sh.broken && sh.link.to > sh.link.from) sh.broken = false;
    });

    /* A scene's claim is a coarse container: text typed against either edge in
     * the master belongs to the section, and typing inside the scene's own box
     * grows it at both edges the way a shot's box does. */
    p.scenes.forEach(function (sc) {
      if (!sc.link) return;
      const own = sc.id === sourceSceneId;
      const nf = SB.Doc.mapPos(sc.link.from, start, end, op.len, own ? true : false);
      const nt = SB.Doc.mapPos(sc.link.to, start, end, op.len, false);
      sc.link.from = Math.min(nf, nt);
      sc.link.to = Math.max(nf, nt);
      if (sc.link.to <= sc.link.from) sc.broken = true;
      else if (sc.broken && sc.link.to > sc.link.from) sc.broken = false;
    });

    /* A note on a phrase should not swallow text typed against its edges, so
     * neither end grows; if the phrase itself is deleted the note is flagged
     * rather than vanishing with it. */
    (p.scriptComments || []).forEach(function (c) {
      const nf = SB.Doc.mapPos(c.from, start, end, op.len, false);
      const nt = SB.Doc.mapPos(c.to, start, end, op.len, true);
      c.from = Math.min(nf, nt);
      c.to = Math.max(nf, nt);
      if (c.to <= c.from) c.broken = true;
      else if (c.broken) c.broken = false;
    });

    SB.Doc.replace(p.master, start, end, text);
    p.updatedAt = Date.now();
    return op;
  }

  /* Edit routed from a shot's own script box (local coords). */
  function applyShotEdit(p, shot, lStart, lEnd, text) {
    text = SB.Doc.eol(text);
    if (shot.link) {
      return applyMasterEdit(p, shot.link.from + lStart, shot.link.from + lEnd, text, shot.id);
    }
    if (SB.History) SB.History.push('local:' + shot.id);
    SB.Doc.replace(shot.local, lStart, lEnd, text);
    p.updatedAt = Date.now();
    return { start: lStart, end: lEnd, len: (text || '').length };
  }

  function breakLink(p, shot) {
    if (!shot.link) return;
    if (SB.History) { SB.History.seal(); SB.History.push('break:' + shot.id); SB.History.seal(); }
    const w = windowFor(p, shot);
    shot.local = {
      text: p.master.text.slice(w.from, w.to),
      marks: SB.Doc.sliceMarks(p.master, w.from, w.to)
    };
    shot.link = null;
    shot.broken = false;
    p.updatedAt = Date.now();
  }

  /* ---------- a scene's own section of the script ---------- */

  /* Edit routed from a scene's section box (local coords). */
  function applySceneEdit(p, scene, lStart, lEnd, text) {
    text = SB.Doc.eol(text);
    if (scene.link) {
      return applyMasterEdit(p, scene.link.from + lStart, scene.link.from + lEnd,
        text, null, scene.id);
    }
    if (!scene.local) return null;
    if (SB.History) SB.History.push('scenelocal:' + scene.id);
    SB.Doc.replace(scene.local, lStart, lEnd, text);
    p.updatedAt = Date.now();
    return { start: lStart, end: lEnd, len: text.length };
  }

  function breakSceneLink(p, scene) {
    if (!scene.link) return;
    if (SB.History) { SB.History.seal(); SB.History.push('scenebreak:' + scene.id); SB.History.seal(); }
    const w = windowForScene(p, scene);
    scene.local = {
      text: p.master.text.slice(w.from, w.to),
      marks: SB.Doc.sliceMarks(p.master, w.from, w.to)
    };
    scene.link = null;
    scene.broken = false;
    p.updatedAt = Date.now();
  }

  /* Claim [from,to) of the master for a scene. `widen` keeps whatever the scene
   * already had and stretches to cover both, which is how a section gets claimed
   * a paragraph at a time. */
  function tieScene(p, sceneId, from, to, widen) {
    const f = findScene(p, sceneId);
    if (!f) return null;
    from = SB.clamp(from | 0, 0, p.master.text.length);
    to = SB.clamp(to | 0, from, p.master.text.length);
    if (to <= from) return null;
    if (widen && f.scene.link && !f.scene.broken) {
      from = Math.min(from, f.scene.link.from);
      to = Math.max(to, f.scene.link.to);
    }
    f.scene.link = { from: from, to: to };
    f.scene.local = null;
    f.scene.broken = false;
    p.updatedAt = Date.now();
    return f.scene;
  }

  /* Give the section back — the scene keeps its heading, description and shots.
   * A shot cannot do this; a scene with no script is the normal state. */
  function untieScene(p, sceneId) {
    const f = findScene(p, sceneId);
    if (!f) return null;
    f.scene.link = null;
    f.scene.local = null;
    f.scene.broken = false;
    p.updatedAt = Date.now();
    return f.scene;
  }

  /* ---------- notes on the script ---------- */

  function addScriptComment(p, from, to, text) {
    from = SB.clamp(from | 0, 0, p.master.text.length);
    to = SB.clamp(to | 0, from, p.master.text.length);
    if (to <= from) return null;
    const c = {
      id: SB.uid('scm'),
      from: from, to: to,
      quote: p.master.text.slice(from, to),
      text: text || '',
      at: Date.now(),
      broken: false
    };
    p.scriptComments = p.scriptComments || [];
    p.scriptComments.push(c);
    p.updatedAt = Date.now();
    return c;
  }

  function deleteScriptComment(p, id) {
    p.scriptComments = (p.scriptComments || []).filter(function (c) { return c.id !== id; });
    p.updatedAt = Date.now();
  }

  function scriptComments(p) {
    return (p.scriptComments || []).slice().sort(function (a, b) {
      return a.from - b.from || a.at - b.at;
    });
  }

  /* how many notes cover each master character (for the underline layer) */
  function commentCoverage(p) {
    const n = p.master.text.length;
    const d = new Uint8Array(n);
    (p.scriptComments || []).forEach(function (c) {
      if (c.broken) return;
      for (let i = c.from; i < c.to && i < n; i++) if (d[i] < 250) d[i]++;
    });
    return d;
  }

  /* how many shots cover each master character (for the highlight underlay) */
  function coverage(p) {
    const n = p.master.text.length;
    const d = new Uint8Array(n);
    eachShot(p, function (sh) {
      if (!sh.link) return;
      for (let i = sh.link.from; i < sh.link.to && i < n; i++) if (d[i] < 250) d[i]++;
    });
    return d;
  }

  /* How many scenes claim each master character. The loose layer: this is what
   * says a stretch of script is spoken for before any shot exists. */
  function sceneCoverage(p) {
    const n = p.master.text.length;
    const d = new Uint8Array(n);
    p.scenes.forEach(function (sc) {
      if (!sc.link || sc.broken) return;
      for (let i = sc.link.from; i < sc.link.to && i < n; i++) if (d[i] < 250) d[i]++;
    });
    return d;
  }

  /* What share of the script any scene has claimed, 0..1 — the answer to "have
   * I covered it all yet?" without counting spans by eye. */
  function sceneCoverageShare(p) {
    const d = sceneCoverage(p);
    if (!d.length) return 0;
    let hit = 0;
    for (let i = 0; i < d.length; i++) if (d[i]) hit++;
    return hit / d.length;
  }

  /* ---------- structure ---------- */

  function addScene(p, afterIdx) {
    const sc = newScene();
    if (typeof afterIdx === 'number') p.scenes.splice(afterIdx + 1, 0, sc);
    else p.scenes.push(sc);
    p.updatedAt = Date.now();
    return sc;
  }

  function deleteScene(p, sceneId) {
    const f = findScene(p, sceneId);
    if (!f) return;
    p.scenes.splice(f.idx, 1);
    if (!p.scenes.length) p.scenes.push(newScene());
    p.updatedAt = Date.now();
  }

  function addShot(p, sceneId, opts, atIdx) {
    const f = findScene(p, sceneId);
    if (!f) return null;
    const sh = newShot(Object.assign({ type: p.settings.shotTypes[0] || '' }, opts || {}));
    if (typeof atIdx === 'number') f.scene.shots.splice(atIdx, 0, sh);
    else f.scene.shots.push(sh);
    p.updatedAt = Date.now();
    return sh;
  }

  /* Deleting a shot leaves its text in the master script (resolved decision #2). */
  function deleteShot(p, shotId) {
    const f = findShot(p, shotId);
    if (!f) return;
    f.scene.shots.splice(f.shotIdx, 1);
    p.updatedAt = Date.now();
  }

  /* Everything that belongs to the PICTURE rather than to the place in the
   * script. The script window, whether it is linked or freestanding, and the
   * "no shot" flag all describe the fragment of script this card sits on, so
   * they stay behind when the imagery moves. */
  /* Is there anything on this card for a writer to work from? Three boxes
   * now, and any one of them counts. */
  function described(shot) {
    if (!shot) return false;
    return !!((shot.description || '').trim() || (shot.imageDescription || '').trim() ||
      (shot.videoDescription || '').trim());
  }

  const CONTENT_KEYS = [
    'type', 'color', 'image', 'annotation', 'description',
    'imageDescription', 'videoDescription',
    'fields', 'prompts', 'personaIds', 'castEnters', 'comments', 'render', 'video'
  ];

  /* Swap two shots' contents, leaving each card's dialogue where it is. */
  function swapShotContent(p, aId, bId) {
    const fa = findShot(p, aId), fb = findShot(p, bId);
    if (!fa || !fb || aId === bId) return null;
    CONTENT_KEYS.forEach(function (k) {
      const tmp = fa.shot[k];
      fa.shot[k] = fb.shot[k];
      fb.shot[k] = tmp;
    });
    p.updatedAt = Date.now();
    return { a: fa.code, b: fb.code };
  }

  function moveShot(p, shotId, toSceneId, toIdx) {
    const f = findShot(p, shotId);
    const t = findScene(p, toSceneId);
    if (!f || !t) return;
    f.scene.shots.splice(f.shotIdx, 1);
    if (f.scene === t.scene && toIdx > f.shotIdx) toIdx--;
    toIdx = SB.clamp(toIdx, 0, t.scene.shots.length);
    t.scene.shots.splice(toIdx, 0, f.shot);
    p.updatedAt = Date.now();
  }

  /* Move several shots at once, keeping the order they had on the board. */
  function moveShots(p, ids, toSceneId, toIdx) {
    const t = findScene(p, toSceneId);
    if (!t || !ids || !ids.length) return;
    const order = [];
    eachShot(p, function (sh) { if (ids.indexOf(sh.id) >= 0) order.push(sh); });
    if (!order.length) return;
    /* how many of them sit before the drop point in the target scene */
    let removedBefore = 0;
    order.forEach(function (sh) {
      const at = t.scene.shots.indexOf(sh);
      if (at >= 0 && at < toIdx) removedBefore++;
    });
    order.forEach(function (sh) {
      const f = findShot(p, sh.id);
      if (f) f.scene.shots.splice(f.shotIdx, 1);
    });
    let at = SB.clamp(toIdx - removedBefore, 0, t.scene.shots.length);
    order.forEach(function (sh) { t.scene.shots.splice(at++, 0, sh); });
    p.updatedAt = Date.now();
  }

  /* Start a new scene at a card: that card and everything after it in the
   * scene move into a fresh scene inserted straight after. This is how a
   * Premiere import — one long scene of cuts — gets broken into scenes. */
  function splitSceneAt(p, sceneId, idx) {
    const f = findScene(p, sceneId);
    if (!f) return null;
    if (idx <= 0 || idx >= f.scene.shots.length) return null;   // nothing to move
    const moved = f.scene.shots.splice(idx);
    const sc = newScene();
    sc.shots = moved;
    p.scenes.splice(f.idx + 1, 0, sc);
    p.updatedAt = Date.now();
    return sc;
  }

  /* Gather the given shots into a scene of their own, after the scene the
   * first of them is in. */
  function sceneFromShots(p, ids) {
    if (!ids || !ids.length) return null;
    const order = [];
    eachShot(p, function (sh) { if (ids.indexOf(sh.id) >= 0) order.push(sh); });
    if (!order.length) return null;
    const first = findShot(p, order[0].id);
    const afterIdx = first ? first.sceneIdx : p.scenes.length - 1;
    const sources = [];
    order.forEach(function (sh) {
      const f = findShot(p, sh.id);
      if (!f) return;
      if (sources.indexOf(f.scene) < 0) sources.push(f.scene);
      f.scene.shots.splice(f.shotIdx, 1);
    });
    const sc = newScene();
    sc.shots = order;
    p.scenes.splice(afterIdx + 1, 0, sc);
    /* A scene emptied BY THIS is noise on the board. An empty scene the user
     * made on purpose somewhere else is not ours to delete — and neither is one
     * holding a claim on the script, which is a deliberate mark that outlives
     * whichever cards happened to be sitting in it. */
    p.scenes = p.scenes.filter(function (s) {
      return s.shots.length || sources.indexOf(s) < 0 || sceneTied(s);
    });
    if (!p.scenes.length) p.scenes.push(sc);
    p.updatedAt = Date.now();
    return sc;
  }

  function moveScene(p, sceneId, toIdx) {
    const f = findScene(p, sceneId);
    if (!f) return;
    p.scenes.splice(f.idx, 1);
    if (toIdx > f.idx) toIdx--;
    p.scenes.splice(SB.clamp(toIdx, 0, p.scenes.length), 0, f.scene);
    p.updatedAt = Date.now();
  }

  /* The shot whose frame is this exact picture, or null.
   *
   * Needed because anything filed asynchronously — an original being encoded,
   * a clip being downloaded — has to land on the picture it belongs to, and
   * the card it was dropped on is not a reliable address: swapping two cards
   * moves their contents between shot objects while the ids stay put. Looked
   * up by the blob reference, which is the one thing that travels WITH the
   * picture. */
  function shotHolding(p, ref) {
    if (!ref) return null;
    let hit = null;
    eachShot(p, function (sh) {
      if (hit) return;
      const im = sh.image;
      const r = im && (typeof im === 'string' ? im : im.ref);
      if (r === ref) hit = sh;
    });
    return hit;
  }

  function modelById(p, id) {
    return p.settings.models.filter(function (m) { return m.id === id; })[0] || null;
  }
  function imageModel(p) { return modelById(p, p.settings.imageModelId); }
  function videoModel(p) { return modelById(p, p.settings.videoModelId); }

  SB.Model = {
    FILE_VERSION: FILE_VERSION,
    CARD_COLORS: CARD_COLORS,
    DEFAULT_SHOT_TYPES: DEFAULT_SHOT_TYPES,
    DEFAULT_FRAMING: DEFAULT_FRAMING, framingFor: framingFor, guessFraming: guessFraming,
    takes: takes, takeCount: takeCount, addTake: addTake, repairTakes: repairTakes,
    useTake: useTake, dropTake: dropTake,
    IMG_TPL: IMG_TPL, IMG_TPL_V1: IMG_TPL_V1,
    VID_TPL: VID_TPL, VID_TPL_V1: VID_TPL_V1, VID_TPL_V2: VID_TPL_V2,
    H3_VID_TPL: H3_VID_TPL, H3_VID_TPL_V2: H3_VID_TPL_V2, tplsFor: tplsFor,
    FRAME_ONLY: FRAME_ONLY, FULL_REFERENCE: FULL_REFERENCE,
    videoInherits: videoInherits,
    newProject: newProject, migrate: migrate, foldLineEndings: foldLineEndings,
    newShot: newShot, newScene: newScene,
    defaultModels: defaultModels, defaultExport: defaultExport, guessSlug: guessSlug,
    byName: byName,
    eachShot: eachShot, code: code, findShot: findShot, findScene: findScene,
    windowFor: windowFor, applyMasterEdit: applyMasterEdit, applyShotEdit: applyShotEdit,
    breakLink: breakLink, coverage: coverage,
    windowForScene: windowForScene, sceneTied: sceneTied,
    applySceneEdit: applySceneEdit, breakSceneLink: breakSceneLink,
    tieScene: tieScene, untieScene: untieScene,
    sceneCoverage: sceneCoverage, sceneCoverageShare: sceneCoverageShare,
    addScriptComment: addScriptComment, deleteScriptComment: deleteScriptComment,
    scriptComments: scriptComments, commentCoverage: commentCoverage,
    addScene: addScene, deleteScene: deleteScene, addShot: addShot, deleteShot: deleteShot,
    moveShot: moveShot, moveShots: moveShots, moveScene: moveScene,
    splitSceneAt: splitSceneAt, sceneFromShots: sceneFromShots,
    swapShotContent: swapShotContent, CONTENT_KEYS: CONTENT_KEYS, described: described,
    modelById: modelById, imageModel: imageModel, videoModel: videoModel, firstOfKind: firstOfKind,
    shotHolding: shotHolding
  };

})(window.SB);
