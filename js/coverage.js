/* coverage.js — turn a scene description into a short run of shots.
 *
 * Two scene-level calls to the writer model, both single-shot:
 *   generate() — the description becomes 2-3 consecutive beats of one moment
 *   rewrite()  — a rough description becomes a shootable one
 *
 * Coverage, not invention: everything returned has to be traceable to what the
 * user already wrote. The subject is pinned down once and repeated in every
 * description, because each shot's prompt is written independently later
 * (prompts.js) and has no other way to know the shots share a person.
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

  /* Personas already on this scene's cards ARE the subject — inventing a new
   * one on top of them is how continuity breaks. */
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
      subject: { type: 'STRING' },
      shots: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            beat: { type: 'STRING' },
            type: { type: 'STRING' },
            description: { type: 'STRING' }
          },
          required: ['beat', 'type', 'description']
        }
      }
    },
    required: ['subject', 'shots']
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

  function buildGenPrompt(p, sc, idx, n, note, cast) {
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
      'THE SUBJECT',
      cast.length
        ? '- The subject is already cast (below). Use them, describe them exactly as written, ' +
        'and return that same wording in the "subject" field. Do not invent anyone new.'
        : '- First decide the subject: one concrete sentence covering appearance and specific ' +
        'wardrobe. Return it in the "subject" field.',
      '- The subject is the SAME person in every shot. Repeat the subject wording, essentially ' +
      'verbatim, inside every shot description — each description is later read on its own by a ' +
      'prompt writer that cannot see the others, so continuity has to live in the text itself.',
      '',
      'EACH SHOT',
      '- beat: three or four words naming what this beat does ("hands find the label").',
      '- type: choose from this project\'s list — ' + (types || 'Wide, Medium, Close-up'),
      '- description: 2-4 sentences of what we SEE. Subject, what they are doing, framing, ' +
      'setting detail, light. No dialogue, no camera moves, no cuts, no editorialising.',
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
    if (cast.length) {
      lines.push('', 'CAST — describe these people exactly as written, every time:');
      cast.forEach(function (per) {
        lines.push('- ' + (per.name || 'unnamed') + ': ' + (per.description || '').trim());
      });
    }
    if (already.length) {
      lines.push('', 'SHOTS ALREADY ON THIS SCENE — your shots continue the scene, they do not ' +
        'repeat these:', already.join('\n'));
    }
    return lines.join('\n');
  }

  const STOP = ('the and a an of in on at to with for is are as its their this that ' +
    'shot scene frame close wide medium camera').split(' ');

  function tokens(s) {
    return norm(s).split(' ').filter(function (w) {
      return w.length >= 5 && STOP.indexOf(w) < 0;
    });
  }

  /* The whole feature rests on the subject surviving into every description, so
   * it is checked rather than trusted. A description that shares almost nothing
   * with the subject line gets it appended outright. */
  function ensureSubject(desc, subject) {
    const d = (desc || '').trim();
    const s = (subject || '').trim();
    if (!s) return d;
    if (!d) return s;
    const dt = tokens(d), st = tokens(s);
    let shared = 0;
    st.forEach(function (w) { if (dt.indexOf(w) >= 0) shared++; });
    if (shared >= 2 || !st.length) return d;
    return d + (/[.!?]$/.test(d) ? ' ' : '. ') + s;
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
    const cast = castFor(p, sc);
    const text = buildGenPrompt(p, sc, f.idx, n, (opts.note || '').trim(), cast);

    const brand = SB.Brand.brandOf(p);
    const system = [
      'You are a director laying out coverage for a short video. You answer with shots, ' +
      'not with commentary.',
      brand.enabled ? '\nHOUSE STYLE — every shot you describe must obey this.\n\n' + brand.text : '',
      brand.enabled ? '\nFold these requirements into the descriptions as concrete detail — do not ' +
        'quote the rules back, and never use gendered language.' : ''
    ].filter(Boolean).join('\n');

    return SB.Prompts.raw(text, GEN_SCHEMA, system).then(function (out) {
      let list = (out && out.shots) || [];
      if (!list.length) throw new Error('No shots came back — try again, or say more in the description.');
      if (n) list = list.slice(0, n);
      else if (list.length > 3) list = list.slice(0, 3);

      const subject = cast.length
        ? cast.map(function (per) { return (per.description || '').trim(); }).filter(Boolean).join(' ')
        : String((out && out.subject) || '').trim();

      const made = [];
      list.forEach(function (x) {
        const type = matchType(p, x.type);
        const description = ensureSubject(x.description, subject);
        /* Reuse the scene's own empty starter card before adding beside it. */
        const blank = sc.shots.filter(function (sh) { return isBlank(p, sh); })[0];
        const sh = (blank && !made.length && sc.shots.length === 1)
          ? blank : SB.Model.addShot(p, sc.id, {});
        if (!sh) return;
        sh.type = type;
        sh.description = description;
        if (cast.length) {
          sh.personaIds = cast.map(function (per) { return per.id; });
        }
        made.push(sh);
      });
      if (!made.length) throw new Error('Nothing could be added to this scene');
      p.updatedAt = Date.now();
      return {
        ids: made.map(function (sh) { return sh.id; }),
        shots: made,
        subject: subject,
        beats: list.map(function (x) { return String(x.beat || '').trim(); })
      };
    });
  }

  /* Structural changes are outside SB.History on purpose, so generate hands
   * back its own way out. */
  function undo(p, ids) {
    (ids || []).forEach(function (id) { SB.Model.deleteShot(p, id); });
    p.updatedAt = Date.now();
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
    matchType: matchType, ensureSubject: ensureSubject, isBlank: isBlank,
    sceneScript: sceneScript
  };

})(window.SB);
