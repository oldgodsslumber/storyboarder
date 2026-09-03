/* coverage.js — turn a scene description into a short run of shots.
 *
 * Two scene-level calls to the writer model, both single-shot:
 *   generate() — the description becomes 2-3 consecutive beats of one moment
 *   rewrite()  — a rough description becomes a shootable one
 *
 * Coverage, not invention: everything returned has to be traceable to what the
 * user already wrote.
 *
 * Descriptions are PLAIN ENGLISH — what a director would say to a crew, not a
 * prompt. Nobody's appearance or wardrobe belongs in them. Continuity lives on
 * the cards instead: generate resolves the people it uses against the project's
 * personas (minting one when the scene needs somebody nobody has cast yet) and
 * pins their ids to every shot. prompts.js then hands the full cast block to
 * the prompt writer for each shot on its own — personas.js:block() — so the
 * text never has to carry the wardrobe itself.
 */
(function (SB) {
  'use strict';

  const MIN = 2, MAX = 4;

  /* ---------- shot types ---------- */

  /* The card's type dropdown only offers p.settings.shotTypes, so a returned
   * type has to land on one of them or the card would show a value it cannot
   * re-select. */
  const ALIASES = [
    [/(^|\b)(ecu|xcu)\b|extreme close|macro/, ['extreme close', 'close']],
    [/(^|\b)ots\b|over.the.shoulder/, ['over the shoulder', 'medium']],
    [/(^|\b)cu\b|close.?up|tight/, ['close', 'medium']],
    [/insert|detail|hands?\b|object/, ['insert', 'close']],
    [/cutaway|b.?roll/, ['cutaway', 'insert']],
    [/(^|\b)(ws|ews)\b|wide|establish|master shot|landscape/, ['wide', 'medium']],
    [/two.?shot/, ['two shot', 'medium']],
    [/(^|\b)(ms|mcu)\b|medium|mid\b|waist/, ['medium', 'wide']],
    [/pov|point of view/, ['pov', 'close']],
    [/screen|ui\b|monitor|laptop capture/, ['screen capture', 'insert']],
    [/talking head|interview|piece to camera/, ['talking head', 'medium']]
  ];

  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim(); }

  function matchType(p, raw) {
    const types = (p.settings && p.settings.shotTypes) || [];
    if (!types.length) return String(raw || '');
    const want = norm(raw);
    if (!want) return types[0];

    let hit = types.filter(function (t) { return norm(t) === want; })[0];
    if (hit) return hit;
    hit = types.filter(function (t) { return want.indexOf(norm(t)) >= 0; })[0];
    if (hit) return hit;
    /* Short abbreviations are left to the alias table below — "CU" is inside
     * "cutaway", and matching it there would be wrong every time. */
    if (want.length >= 4) {
      hit = types.filter(function (t) { return norm(t).indexOf(want) >= 0; })[0];
      if (hit) return hit;
    }

    /* "ECU on the hands" is a real answer from a model that has never seen this
     * project's list — read the intent, then take the closest thing offered. */
    for (let i = 0; i < ALIASES.length; i++) {
      if (!ALIASES[i][0].test(want)) continue;
      const prefs = ALIASES[i][1];
      for (let j = 0; j < prefs.length; j++) {
        hit = types.filter(function (t) { return norm(t).indexOf(prefs[j]) >= 0; })[0];
        if (hit) return hit;
      }
    }
    return types[0];
  }

  /* ---------- context for the call ---------- */

  /* A scene's own claim is a statement of what it covers; stitching its shots'
   * windows together is a guess derived from them. Prefer the claim — and in
   * the case this feature exists for, a scene with no shots yet, it is the only
   * script there is. Preferred, not unioned: shot ranges usually sit inside the
   * claimed stretch, so concatenating would send the model the same text twice. */
  function sceneScript(p, sc) {
    const sw = SB.Model.windowForScene(p, sc);
    if (sw) {
      const t = (sw.doc.text || '').slice(sw.from, sw.to).replace(/\s+/g, ' ').trim();
      if (t) return t;
    }
    const bits = [];
    sc.shots.forEach(function (sh) {
      const w = SB.Model.windowFor(p, sh);
      const t = (w.doc.text || '').slice(w.from, w.to).replace(/\s+/g, ' ').trim();
      if (t && bits.indexOf(t) < 0) bits.push(t);
    });
    return bits.join(' ');
  }

  function existingShots(p, sc) {
    return sc.shots.filter(function (sh) { return (sh.description || '').trim(); })
      .map(function (sh) {
        return '- ' + (sh.type || 'shot') + ': ' +
          sh.description.replace(/\s+/g, ' ').trim().slice(0, 200);
      });
  }

  /* Personas already on this scene's cards. Whoever is here is who the scene is
   * already about — the writer is told to reuse them before anyone else. */
  function castFor(p, sc) {
    const seen = {}, out = [];
    sc.shots.forEach(function (sh) {
      (sh.personaIds || []).forEach(function (id) {
        if (seen[id]) return;
        seen[id] = 1;
        const per = SB.Personas.find(p, id);
        if (per) out.push(per);
      });
    });
    return out;
  }

  /* Names are how the writer addresses a persona, so matching is by name and
   * has to survive "Ops Lead" vs "ops lead." */
  function nameKey(s) { return norm(s).replace(/\s+/g, ' ').trim(); }

  function findByName(p, name) {
    const want = nameKey(name);
    if (!want) return null;
    return SB.Personas.all(p).filter(function (per) {
      return nameKey(per.name) === want;
    })[0] || null;
  }

  function neighbours(p, idx) {
    const lines = [];
    const prev = p.scenes[idx - 1], next = p.scenes[idx + 1];
    if (prev) lines.push('The scene before this one: ' + (prev.heading || '(untitled)'));
    if (next) lines.push('The scene after this one: ' + (next.heading || '(untitled)'));
    return lines;
  }

  function sceneOf(p, sceneId) {
    const f = SB.Model.findScene(p, sceneId);
    if (!f) throw new Error('That scene is gone');
    return f;
  }

  function needKey() {
    const prov = SB.Providers.active();
    return prov.ready() ? null : new Error(prov.notReady());
  }

  /* ---------- generate shots ---------- */

  const GEN_SCHEMA = {
    type: 'OBJECT',
    properties: {
      cast: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING' },
            description: { type: 'STRING' },
            imagePrompt: { type: 'STRING' }
          },
          required: ['name', 'description']
        }
      },
      shots: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            beat: { type: 'STRING' },
            type: { type: 'STRING' },
            description: { type: 'STRING' },
            cast: { type: 'ARRAY', items: { type: 'STRING' } }
          },
          required: ['beat', 'type', 'description']
        }
      }
    },
    required: ['shots']
  };

  function countLine(n) {
    if (n) {
      return 'Return exactly ' + n + ' shots.';
    }
    return 'Return 2 or 3 shots — 2 when the description is a single continuous action, ' +
      '3 when there is a clear before and after. Never more than 3.';
  }

  function framingLine(n) {
    if (n === 2) return 'Both shots are tight. No wide shot in a two-shot sequence.';
    return 'Most shots are tight — close-up, extreme close-up, or an insert on hands, ' +
      'a face, an object, a screen. Exactly ONE of them is wider, used for rhythm and to ' +
      'place the action in its setting. If you return 2 shots, both are tight.';
  }

  function buildGenPrompt(p, sc, idx, n, note, onScene, roster) {
    const script = sceneScript(p, sc);
    const already = existingShots(p, sc);
    const types = (p.settings.shotTypes || []).join(', ');

    const lines = [
      'You are boarding one short scene of a video. Break the scene description below ' +
      'into a run of consecutive storyboard shots.',
      '',
      countLine(n),
      '',
      'HOW THE SEQUENCE MUST READ',
      '- The shots are consecutive beats of ONE continuous moment, in the order they cut ' +
      'together: an entry into the action, the action itself, and the beat that resolves it. ' +
      'They are not several angles on a frozen tableau.',
      '- The moment must feel complete. The last shot lands the point of the scene — a ' +
      'result, a reaction, a finished gesture. Never end mid-action.',
      '- ' + framingLine(n),
      '- No two neighbouring shots use the same framing.',
      '- Everything you describe must be traceable to the scene description. Do not invent ' +
      'new locations, new events, or people who are not implied by it.',
      '- Location, time of day, lighting and screen direction stay consistent across every shot.',
      '',
      'WHO IS ON CAMERA',
      onScene.length
        ? '- This scene is already cast (ON THIS SCENE, below). Reuse those people by their ' +
        'exact name. Do not rename them and do not invent a second version of the same person.'
        : (roster.length
          ? '- The board already has people on it (THE BOARD\'S PEOPLE, below). If one of them ' +
          'fits this scene, reuse them by their exact name rather than inventing anybody new.'
          : '- Nobody has been cast on this board yet.'),
      '- Return every person the scene needs in the "cast" array. For someone already listed ' +
      'below, return their name alone — leave description and imagePrompt out, they are already ' +
      'written. For somebody genuinely new, add them with a short handle for a name ("Ops lead", ' +
      'not a character name), a description covering age range, build, hair, skin tone and a ' +
      'specific outfit down to fabric and colour, and an imagePrompt that would produce a clean ' +
      'front-facing reference frame of them — plain background, natural light, full wardrobe ' +
      'visible, neutral expression. No gendered language.',
      '- Keep the cast as small as the scene honestly needs. Reuse beats inventing, every time.',
      '- Name the people each shot contains in that shot\'s own "cast" array, by the same names.',
      '',
      'EACH SHOT',
      '- beat: three or four words naming what this beat does ("hands find the label").',
      '- type: choose from this project\'s list — ' + (types || 'Wide, Medium, Close-up'),
      '- description: 2-4 sentences of PLAIN ENGLISH — what we see, written the way a director ' +
      'would say it to a crew. Who is doing what, the framing, the setting detail, the light. ' +
      'No dialogue, no camera moves, no cuts, no editorialising.',
      '',
      'THE DESCRIPTIONS ARE NOT IMAGE PROMPTS',
      '- Write sentences, not a stack of comma-separated tags. No lens or camera specifications, ' +
      'no render or style vocabulary, no quality words ("cinematic", "photorealistic", "8k", ' +
      '"highly detailed"), no aspect ratios, no artist or film references, no trailing modifiers.',
      '- Refer to people by their cast name ("Ops lead reaches past the rack"). Do NOT restate ' +
      'what anybody looks like or is wearing — appearance lives on the cast entry and is attached ' +
      'to the shot separately, so repeating it here only makes the two drift apart.',
      '- Somebody who has never read a prompt should be able to read the description and picture ' +
      'the shot.',
      '',
      note ? 'ADDITIONAL DIRECTION: ' + note + '\n' : '',
      'SCENE ' + (idx + 1) + ': ' + (sc.heading || '(untitled)'),
      /* With a section claimed and no description written, the script IS the
       * brief — an empty DESCRIPTION block would just read as a blank order. */
      (sc.description || '').trim()
        ? 'DESCRIPTION:\n' + sc.description.trim()
        : 'There is no scene description. Board directly from the script this scene covers, below.'
    ];

    neighbours(p, idx).forEach(function (l) { lines.push(l); });
    if (script) lines.push('', 'SCRIPT THIS SCENE COVERS:\n' + script.slice(0, 4000));
    if (onScene.length) {
      lines.push('', 'ON THIS SCENE — already cast here, reuse by name:');
      onScene.forEach(function (per) {
        lines.push('- ' + (per.name || 'unnamed') + ': ' + (per.description || '').trim());
      });
    }
    /* The roster is context for reuse, not a cast order — a scene is free to
     * need none of them. Only the ones not already pinned here are worth the
     * tokens. */
    const rest = roster.filter(function (per) { return onScene.indexOf(per) < 0; });
    if (rest.length) {
      lines.push('', 'THE BOARD\'S PEOPLE — reuse one of these by name if they fit this scene:');
      rest.forEach(function (per) {
        lines.push('- ' + (per.name || 'unnamed') + ': ' +
          (per.description || '').replace(/\s+/g, ' ').trim().slice(0, 300));
      });
    }
    if (already.length) {
      lines.push('', 'SHOTS ALREADY ON THIS SCENE — your shots continue the scene, they do not ' +
        'repeat these:', already.join('\n'));
    }
    return lines.join('\n');
  }

  /* The description is prose for a human, so the prompt-shop habits that leak
   * out of a writer model are cleaned off rather than argued with: a trailing
   * run of comma-separated modifiers, and the quality vocabulary that only ever
   * means "this text was meant for an image model".
   *
   * Conservative on purpose — it trims the tail, it never rewrites a sentence. */
  const TAG_WORDS = new RegExp('\\b(' + [
    '8k', '4k', 'hdr', 'uhd', 'bokeh', 'octane', 'unreal engine', 'trending on \\w+',
    'cinematic(?: lighting| composition)?', 'photorealistic', 'photo ?realistic',
    'hyper ?realistic', 'ultra[- ]detailed', 'highly detailed', 'masterpiece',
    'award[- ]winning', 'depth of field', 'shot on \\w+', '\\d+ ?mm lens',
    'f/?\\d(?:\\.\\d)?', 'aspect ratio', 'sharp focus', 'volumetric', 'film grain',
    'anamorphic', 'in the style of [^.]+', 'colou?r graded'
  ].join('|') + ')\\b', 'i');

  function deprompt(desc) {
    let d = String(desc || '').replace(/\s+/g, ' ').trim();
    if (!d) return '';
    /* "--ar 16:9", "::2" and friends are never part of a sentence. */
    d = d.replace(/\s*(?:--|——)\w+[^,.]*$/, '').trim();
    /* Walk the final comma-separated tail off while each fragment reads as a
     * bare modifier rather than a clause with something happening in it. */
    for (let guard = 0; guard < 8; guard++) {
      const m = /,\s*([^,.]{2,60})\s*\.?\s*$/.exec(d);
      if (!m) break;
      const frag = m[1].trim();
      const words = frag.split(' ').length;
      if (!TAG_WORDS.test(frag) && words > 2) break;
      d = d.slice(0, m.index).trim();
    }
    if (d && !/[.!?]$/.test(d)) d += '.';
    return d;
  }

  /* A card nobody has touched yet — the one every new scene starts with. */
  function isBlank(p, sh) {
    if ((sh.description || '').trim()) return false;
    if (sh.image || sh.link || (sh.personaIds || []).length) return false;
    if (Object.keys(sh.prompts || {}).length) return false;
    if (Object.keys(sh.fields || {}).some(function (k) { return (sh.fields[k] || '').trim(); })) return false;
    const w = SB.Model.windowFor(p, sh);
    return !(w.doc.text || '').slice(w.from, w.to).trim();
  }

  /* opts = { count, note } — count 0/undefined lets the writer choose. */
  function generate(p, sceneId, opts) {
    opts = opts || {};
    let f;
    try { f = sceneOf(p, sceneId); } catch (e) { return Promise.reject(e); }
    const sc = f.scene;
    /* Either brief will do: a description written by hand, or a stretch of the
     * script this scene has claimed — which is the whole point of claiming one. */
    if (!(sc.description || '').trim() && !sceneScript(p, sc)) {
      return Promise.reject(new Error('Write a scene description first, or tie this scene to a ' +
        'stretch of the master script — the shots are built from one of them.'));
    }
    const miss = needKey();
    if (miss) return Promise.reject(miss);

    const n = opts.count ? SB.clamp(opts.count | 0, MIN, MAX) : 0;
    const onScene = castFor(p, sc);
    const roster = SB.Personas.all(p).slice();
    const text = buildGenPrompt(p, sc, f.idx, n, (opts.note || '').trim(), onScene, roster);

    const brand = SB.Brand.brandOf(p);
    const system = [
      'You are a director laying out coverage for a short video. You answer with shots, ' +
      'not with commentary.',
      /* The house style belongs to the prompt writer, which is shown it again
       * downstream. Here it is a constraint, not something to transcribe —
       * folding it into the descriptions is what made them read as prompts. */
      brand.enabled ? '\nHOUSE STYLE — nothing you describe may contradict this.\n\n' + brand.text : '',
      brand.enabled ? '\nDo not quote these rules back or write them into the descriptions — the ' +
        'prompt writer applies them later. Never use gendered language.' : ''
    ].filter(Boolean).join('\n');

    return SB.Prompts.raw(text, GEN_SCHEMA, system).then(function (out) {
      let list = (out && out.shots) || [];
      if (!list.length) throw new Error('No shots came back — try again, or say more in the description.');
      if (n) list = list.slice(0, n);
      else if (list.length > 3) list = list.slice(0, 3);

      /* Resolve the cast before any card is written. A returned name that
       * already exists is reused as it stands — the roster entry is the user's,
       * and a generated description does not get to overwrite it. */
      const byName = {}, created = [];
      (out.cast || []).forEach(function (c) {
        const nm = String((c && c.name) || '').trim();
        if (!nm || byName[nameKey(nm)]) return;
        let per = findByName(p, nm);
        if (!per) {
          per = SB.Personas.add(p, {
            name: nm,
            description: String(c.description || '').trim(),
            imagePrompt: String(c.imagePrompt || '').trim()
          });
          created.push(per);
        }
        byName[nameKey(nm)] = per;
      });
      /* Whoever the scene already had stays addressable even if the writer
       * forgot to list them. */
      onScene.forEach(function (per) {
        if (!byName[nameKey(per.name)]) byName[nameKey(per.name)] = per;
      });
      const all = Object.keys(byName).map(function (k) { return byName[k]; });

      function idsFor(x) {
        const named = ((x && x.cast) || []).map(function (nm) { return byName[nameKey(nm)]; })
          .filter(Boolean);
        if (named.length) {
          return named.filter(function (per, i) { return named.indexOf(per) === i; })
            .map(function (per) { return per.id; });
        }
        /* An insert on hands or on a screen often names nobody. With a single
         * person in play those hands are still theirs, so the reference frame
         * should follow; with several there is no honest guess to make. */
        return all.length === 1 ? [all[0].id] : [];
      }

      const made = [];
      list.forEach(function (x) {
        const type = matchType(p, x.type);
        const description = deprompt(x.description);
        /* Reuse the scene's own empty starter card before adding beside it. */
        const blank = sc.shots.filter(function (sh) { return isBlank(p, sh); })[0];
        const sh = (blank && !made.length && sc.shots.length === 1)
          ? blank : SB.Model.addShot(p, sc.id, {});
        if (!sh) return;
        sh.type = type;
        sh.description = description;
        const pid = idsFor(x);
        if (pid.length) sh.personaIds = pid;
        made.push(sh);
      });
      if (!made.length) {
        /* Nothing landed, so the people invented for it should not linger. */
        created.forEach(function (per) { SB.Personas.remove(p, per.id); });
        throw new Error('Nothing could be added to this scene');
      }
      p.updatedAt = Date.now();
      return {
        ids: made.map(function (sh) { return sh.id; }),
        shots: made,
        cast: all,
        created: created,
        personaIds: created.map(function (per) { return per.id; }),
        beats: list.map(function (x) { return String(x.beat || '').trim(); })
      };
    });
  }

  /* Structural changes are outside SB.History on purpose, so generate hands
   * back its own way out. personaIds are the people that run invented; one that
   * something else has been cast in since stays. */
  function undo(p, ids, personaIds) {
    (ids || []).forEach(function (id) { SB.Model.deleteShot(p, id); });
    (personaIds || []).forEach(function (pid) {
      let used = false;
      SB.Model.eachShot(p, function (sh) {
        if ((sh.personaIds || []).indexOf(pid) >= 0) used = true;
      });
      if (!used) SB.Personas.remove(p, pid);
    });
    p.updatedAt = Date.now();
  }

  /* ---------- descriptions that still carry a wardrobe ---------- */

  /* Boards written before descriptions became prose had the subject's clothes
   * stapled onto the end of every one of them. That copy froze the moment it
   * was written: edit the persona, or put a DIFFERENT person on the card, and
   * the description is now describing somebody who is not in the shot.
   *
   * The cast block overrides it at prompt time (personas.js), but the text on
   * the card is still wrong to read, so it is worth actually repairing. */

  const GARMENTS = ('jacket coat parka anorak hoodie hoody fleece shirt tee blouse sweater ' +
    'jumper cardigan waistcoat gilet overalls coveralls dungarees trousers jeans chinos ' +
    'slacks skirt dress shorts boots shoes trainers sneakers loafers cap beanie hat helmet ' +
    'scarf gloves apron lanyard tie belt uniform scrubs hi-vis high-vis vest sleeves cuffs ' +
    'collar hem lapel').split(' ');

  /* Phrases that only ever appear when a description is introducing a person
   * rather than showing one doing something. */
  const APPEARANCE = [
    /\b(?:wearing|wears|dressed in|clad in)\b/i,
    /\b(?:early|mid|late)[- ](?:teens|twenties|thirties|forties|fifties|sixties)\b/i,
    /\bin their (?:teens|twenties|thirties|forties|fifties|sixties)\b/i,
    /\b(?:wiry|stocky|slight|broad[- ]shouldered|heavy[- ]set|willowy)\b/i,
    /\b(?:cropped|shaved|buzzed|braided|dreadlocked|greying|graying|salt[- ]and[- ]pepper|shoulder[- ]length)\b/i,
    /\bskin tone\b/i
  ];

  const GARMENT_RE = new RegExp('\\b(' + GARMENTS.join('|') + ')\\b', 'ig');

  /* The terms that made this description look like a character sheet, or [] if
   * it reads as plain action. */
  function wardrobeTerms(desc) {
    const d = String(desc || '');
    if (!d.trim()) return [];
    const hits = [];
    APPEARANCE.forEach(function (re) {
      const m = re.exec(d);
      if (m) hits.push(m[0].toLowerCase());
    });
    const seen = {}, garments = [];
    let g;
    GARMENT_RE.lastIndex = 0;
    while ((g = GARMENT_RE.exec(d))) {
      const w = g[1].toLowerCase();
      if (seen[w]) continue;
      seen[w] = 1;
      garments.push(w);
    }
    /* One garment on its own is usually the thing being photographed — an
     * insert on a cuff, a hand pulling a strap. Two or more, or any of the
     * phrases above, and the description is introducing somebody. */
    if (hits.length || garments.length >= 2) return hits.concat(garments);
    return [];
  }

  /* Only a card that HAS cast can be carrying it redundantly. With nobody
   * attached the wardrobe in the text is the only record there is, and taking
   * it out would lose the shot. */
  function carriesWardrobe(p, sh) {
    if (!(sh.description || '').trim()) return null;
    if (!SB.Personas.forShot(p, sh).length) return null;
    const terms = wardrobeTerms(sh.description);
    return terms.length ? terms : null;
  }

  function shotsCarryingWardrobe(p) {
    const out = [];
    SB.Model.eachShot(p, function (sh) {
      if (carriesWardrobe(p, sh)) out.push(sh);
    });
    return out;
  }

  function sentences(d) {
    return String(d || '').match(/[^.!?]+[.!?]*\s*/g) || [];
  }

  const SKIP = ('the and a an of in on at to with for is are as its their this that from ' +
    'over into onto they them shot scene frame close wide medium camera').split(' ');

  function words(str) {
    return norm(str).split(' ').filter(function (w) {
      return w.length >= 4 && SKIP.indexOf(w) < 0;
    });
  }

  /* The free half of the repair: the old code APPENDED the subject verbatim, so
   * where the persona has not been edited since, the tail is still an exact
   * copy and can be lifted straight back off. No model, no judgement. */
  function stripCast(desc, personas) {
    let d = String(desc || '').trim();
    if (!d || !(personas || []).length) return d;
    const pool = personas.map(function (per) { return words(per.description || ''); })
      .filter(function (w) { return w.length >= 3; });
    if (!pool.length) return d;

    for (let guard = 0; guard < 4; guard++) {
      const parts = sentences(d);
      if (parts.length < 2) break;                 // never strip the only sentence
      const tail = parts[parts.length - 1];
      const tw = words(tail);
      if (tw.length < 3) break;
      const matched = pool.some(function (pw) {
        let shared = 0;
        tw.forEach(function (w) { if (pw.indexOf(w) >= 0) shared++; });
        /* Most of the tail has to be the persona's own words — a sentence that
         * merely mentions them is a real sentence and stays. */
        return shared / tw.length >= 0.7;
      });
      if (!matched) break;
      d = parts.slice(0, -1).join('').trim();
    }
    return d;
  }

  const CLEAN_SCHEMA = {
    type: 'OBJECT',
    properties: { description: { type: 'STRING' } },
    required: ['description']
  };

  function cleanPrompt(p, sh, cast) {
    const names = cast.map(function (per) { return per.name || 'unnamed'; });
    return [
      'Rewrite the shot description below so it no longer describes what anybody LOOKS LIKE.',
      '',
      '- Take out every mention of appearance, wardrobe, hair, age, build and skin tone. ' +
      'That information is held separately, on the cast, and repeating it here only lets the ' +
      'two drift apart.',
      '- Refer to the people in the shot by their cast name instead' +
      (names.length ? ' — ' + names.join(', ') : '') + '.',
      '- Keep everything else exactly as it is: the same action, the same place, the same ' +
      'framing, the same light, the same props. Change nothing about what happens.',
      '- Do not add anything. If removing the appearance leaves a short description, leave it short.',
      '- Plain English sentences. No prompt tags, no camera or lens specifications, no ' +
      'quality words, no dialogue.',
      '',
      cast.length ? 'THE CAST ON THIS CARD (do not restate any of this in the description):\n' +
        cast.map(function (per) {
          return '- ' + (per.name || 'unnamed') + ': ' +
            (per.description || '').replace(/\s+/g, ' ').trim();
        }).join('\n') + '\n' : '',
      'DESCRIPTION:\n' + (sh.description || '').trim()
    ].filter(Boolean).join('\n');
  }

  /* Repair a run of cards. The deterministic strip runs first and for free; only
   * what it cannot settle costs a request — on a board whose personas were never
   * edited that is usually nothing at all.
   *
   * opts = { onProgress(done, total), dryRun }
   * Resolves { cleaned, stripped, asked, failed, changes: [{id, from, to}] } */
  function cleanWardrobe(p, shots, opts) {
    opts = opts || {};
    const list = (shots || []).filter(function (sh) { return !!carriesWardrobe(p, sh); });
    const changes = [];
    let stripped = 0;

    const queue = [];
    list.forEach(function (sh) {
      const cast = SB.Personas.forShot(p, sh);
      const cut = stripCast(sh.description, cast);
      if (cut !== (sh.description || '').trim() && !wardrobeTerms(cut).length) {
        changes.push({ id: sh.id, from: sh.description, to: cut });
        stripped++;
        return;
      }
      queue.push({ shot: sh, cast: cast, seed: cut });
    });

    const total = list.length;
    let done = stripped, failed = 0;
    const tick = function () { if (opts.onProgress) opts.onProgress(done, total); };

    function finish() {
      if (!opts.dryRun) {
        changes.forEach(function (ch) {
          const f = SB.Model.findShot(p, ch.id);
          if (f) f.shot.description = ch.to;
        });
        if (changes.length) p.updatedAt = Date.now();
      }
      return {
        cleaned: changes.length, stripped: stripped, asked: queue.length,
        failed: failed, changes: changes
      };
    }

    if (!queue.length) { tick(); return Promise.resolve(finish()); }

    const miss = needKey();
    if (miss) {
      /* Whatever the strip already settled is real work — keep it rather than
       * throwing the lot away over the ones that needed a model. */
      if (changes.length) { finish(); }
      return Promise.reject(miss);
    }

    const brand = SB.Brand.brandOf(p);
    const system = [
      'You edit storyboard shot descriptions. You return the rewritten description only — ' +
      'no commentary, no headings.',
      brand.enabled ? '\nNever use gendered language.' : ''
    ].filter(Boolean).join('\n');

    tick();
    const pending = queue.slice();
    function worker() {
      const j = pending.shift();
      if (!j) return Promise.resolve();
      return SB.Prompts.raw(cleanPrompt(p, j.shot, j.cast), CLEAN_SCHEMA, system)
        .then(function (out) {
          const next = String((out && out.description) || '').trim();
          if (next) changes.push({ id: j.shot.id, from: j.shot.description, to: deprompt(next) });
          else failed++;
        })
        .catch(function (e) {
          failed++;
          console.error('[storyboarder] clean failed', e);
        })
        .then(function () { done++; tick(); return worker(); });
    }

    /* Same shape as the prompt writer: one canary, then two more lanes, so a
     * blocked network costs one request instead of forty. */
    return worker().then(function () {
      if (!pending.length) return;
      const lanes = [];
      for (let i = 0; i < Math.min(2, pending.length); i++) lanes.push(worker());
      return Promise.all(lanes);
    }).then(finish);
  }

  /* ---------- rewrite the description ---------- */

  const REWRITE_SCHEMA = {
    type: 'OBJECT',
    properties: { description: { type: 'STRING' } },
    required: ['description']
  };

  function rewrite(p, sceneId, note) {
    let f;
    try { f = sceneOf(p, sceneId); } catch (e) { return Promise.reject(e); }
    const sc = f.scene;
    const draft = (sc.description || '').trim();
    if (!draft) return Promise.reject(new Error('Nothing to rewrite yet — write a rough description first.'));
    const miss = needKey();
    if (miss) return Promise.reject(miss);

    const script = sceneScript(p, sc);
    const text = [
      'Rewrite the scene description below so it is strong enough to board from.',
      '',
      '- Keep every fact the draft states: the same subject, the same place, the same action, ' +
      'the same point. This is a rewrite, not a new scene.',
      '- Make it concrete and visual. Name what is actually on screen — the action, the setting, ' +
      'the objects, the light. Replace abstractions ("shows the value of the platform") with the ' +
      'thing a camera could photograph.',
      '- Cut hedging, throat-clearing and restatement.',
      '- One paragraph, roughly 40-90 words. Prose, not a shot list.',
      '- No camera directions, no shot types, no dialogue, no cuts — that comes later.',
      '- Do not invent new events, people or locations.',
      '',
      note ? 'ADDITIONAL DIRECTION: ' + note + '\n' : '',
      'SCENE HEADING: ' + (sc.heading || '(untitled)'),
      'DRAFT:\n' + draft
    ];
    if (script) text.push('', 'SCRIPT THIS SCENE COVERS (context only, do not summarise it):\n' +
      script.slice(0, 4000));

    const brand = SB.Brand.brandOf(p);
    const system = [
      'You sharpen scene descriptions for a storyboard. You return the rewritten ' +
      'description only — no commentary, no headings.',
      brand.enabled ? '\nHOUSE STYLE — the rewrite must obey this.\n\n' + brand.text : '',
      brand.enabled ? '\nNever use gendered language.' : ''
    ].filter(Boolean).join('\n');

    return SB.Prompts.raw(text.join('\n'), REWRITE_SCHEMA, system).then(function (out) {
      const next = String((out && out.description) || '').trim();
      if (!next) throw new Error('The rewrite came back empty');
      return next;
    });
  }

  SB.Coverage = {
    MIN: MIN, MAX: MAX,
    generate: generate, rewrite: rewrite, undo: undo,
    matchType: matchType, deprompt: deprompt, isBlank: isBlank,
    wardrobeTerms: wardrobeTerms, carriesWardrobe: carriesWardrobe,
    shotsCarryingWardrobe: shotsCarryingWardrobe, stripCast: stripCast,
    cleanWardrobe: cleanWardrobe,
    sceneScript: sceneScript
  };

})(window.SB);
