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
    '- No gender references: do not mention or imply gender. Avoid gendered nouns, adjectives, titles and pronouns. Use only neutral language — "the subject", "the person", "they" — or omit pronouns entirely.',
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
  const VIDEO_RIDER = [
    'MOTION',
    '- Wardrobe and location must not change during the shot.',
    '- Camera moves are restrained and motivated — no flourishes the scene has not earned.',
    '- Movement is documentary-real: the pace of an actual moment, not choreography.',
    '- Hold the natural-light look and the clean exposure through the whole move.'
  ].join('\n');

  /* Gendered language the "no gender references" rule forbids. Word-bounded, so
   * "human", "manager" and "therapist" are safe. */
  const GENDERED = new RegExp('\\b(' + [
    'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself',
    'man', 'men', "man's", 'woman', 'women', "woman's",
    'male', 'males', 'female', 'females',
    'boy', 'boys', 'girl', 'girls', 'guy', 'guys', 'gal', 'gals',
    'lady', 'ladies', 'gentleman', 'gentlemen',
    'businessman', 'businesswoman', 'businessmen', 'businesswomen',
    'salesman', 'saleswoman', 'spokesman', 'spokeswoman', 'chairman', 'chairwoman',
    'mr', 'mrs', 'ms', 'miss', 'sir', 'madam', "ma'am",
    'husband', 'wife', 'mother', 'father', 'mom', 'mum', 'dad',
    'son', 'daughter', 'brother', 'sister', 'aunt', 'uncle',
    'actress', 'waitress', 'hostess', 'stewardess'
  ].join('|') + ')\\b', 'gi');

  /* Which gendered words a written prompt actually used (deduped, lowercase). */
  function genderedTerms(text) {
    const hits = String(text || '').match(GENDERED);
    if (!hits) return [];
    const seen = {}, out = [];
    hits.forEach(function (h) {
      const k = h.toLowerCase();
      if (!seen[k]) { seen[k] = 1; out.push(k); }
    });
    return out;
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
  function sequenceBlock(p, shot) {
    const f = SB.Model.findShot(p, shot.id);
    if (!f) return '';
    const scene = f.scene;
    const beats = scene.shots.filter(function (s) { return !s.noShot; });
    const pos = beats.indexOf(shot) + 1;
    const lines = [];

    lines.push('SCENE CONTEXT');
    lines.push('Scene ' + (f.sceneIdx + 1) + ': ' + (scene.heading || '(untitled)'));
    if (scene.description) lines.push('Scene note: ' + scene.description);
    lines.push('This is shot ' + f.code + (pos > 0 ? ' (beat ' + pos + ' of ' + beats.length + ')' : '') + '.');

    if (beats.length > 1) {
      lines.push('The other beats in this scene, in order:');
      beats.forEach(function (s, i) {
        const sf = SB.Model.findShot(p, s.id);
        const d = (s.description || '').replace(/\s+/g, ' ').trim();
        lines.push('  ' + (i + 1) + '. [' + (sf ? sf.code : '?') + '] ' + (s.type || 'shot') + ' — ' +
          (d ? (d.length > 160 ? d.slice(0, 157) + '…' : d) : '(no description yet)') +
          (s.id === shot.id ? '   <-- the frame you are writing' : ''));
      });
      lines.push('Keep the location, the lighting mood and the grade coherent across these beats.');
    }
    return lines.join('\n');
  }

  /* The system instruction for one prompt-writing job. */
  function systemFor(p, shot, role) {
    const b = brandOf(p);
    if (!b.enabled) return '';
    const parts = ['HOUSE STYLE — every prompt you write must obey this.', '', b.text];
    if (role === 'video' || role === 'both') parts.push('', VIDEO_RIDER);
    const seq = sequenceBlock(p, shot);
    if (seq) parts.push('', seq);
    parts.push('', 'Fold these requirements into the prompt itself as concrete description — ' +
      'do not quote the rules back, do not add headings or commentary, and never use gendered language.');
    return parts.join('\n');
  }

  SB.Brand = {
    DEFAULT: DEFAULT_BRAND,
    VIDEO_RIDER: VIDEO_RIDER,
    brandOf: brandOf,
    systemFor: systemFor,
    sequenceBlock: sequenceBlock,
    genderedTerms: genderedTerms
  };

})(window.SB);
