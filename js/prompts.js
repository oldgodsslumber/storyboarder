/* prompts.js — the prompt WRITER. The app never generates media.
 *
 * Which model writes them is providers.js's business: Google's Gemini, or a
 * local OpenAI-compatible server. Everything below is the same either way.
 *
 * Two roles, each with its own target model:
 *   image model -> the first-frame prompt      (stored on prompts[imageModel.id].imagePrompt)
 *   video model -> the image-to-video prompt   (stored on prompts[videoModel.id].videoPrompt)
 * Every model a shot has been run against keeps its prompts, forever.
 */
(function (SB) {
  'use strict';

  function P() { return SB.app.project; }

  function fill(tpl, ctx) {
    return String(tpl || '').replace(/\{\{(\w+)\}\}/g, function (m, k) {
      return ctx[k] == null ? '' : String(ctx[k]);
    }).replace(/ ?Scene: \.(?=\s|$)/g, '');   // an untitled scene left "Scene: ." behind
  }

  /* What this lane is told the shot is.
   *
   * The shared description plus the box for this lane, run together as one
   * paragraph — so {{DESCRIPTION}} means the same thing it always did and no
   * template anybody has edited has to change. The two halves are also
   * available on their own, for a template that wants to place them. */
  function describe(shot, role) {
    /* The clip reads its motion box, and only that, once it is filled. The general description re-tells the
       scene the first frame already shows ("a dim call-centre at night, monitors glowing"), and the writer
       dutifully re-described it instead of the action. Its @ marks still count (Refs.boxes), so the export lane
       uploads the same pictures. Empty, the general description stands in. Only once there IS a frame: with
       none, the setting has to come from words, and "He lowers the letter" alone gave the writer no place and
       not even a name. */
    if (role === 'video' && (shot.render || shot.image) && SB.Refs.plain(P(), shot.videoDescription || '').trim()) {
      return SB.Refs.plain(P(), shot.videoDescription).trim();
    }
    const parts = SB.Refs.boxes(shot, role)
      .map(function (t) { return SB.Refs.plain(P(), t || '').trim(); })
      .filter(Boolean);
    return parts.join('\n\n');
  }

  /* What the first frame actually shows, for the writer that cannot see it.
   *
   * Two sources, in the order they are trusted: the first-frame box, which is
   * what a person wrote about the opening instant, and the first-frame prompt
   * that was actually sent, which is the record of what got rendered. Most
   * boards have only the second — the detail that matters ("standing at the
   * window, phone to her ear") is usually in the written prompt, not in a box
   * somebody filled in by hand — so both go, or this fixes nothing.
   *
   * Empty on a card with no frame yet: there is nothing to be faithful to. */
  function frameShows(shot) {
    /* Words about a picture that is not being sent are worse than silence:
     * the block tells the writer the model can see all this, and on a
     * frameless card the model sees nothing. Three riders already assume a
     * picture; this one at least knows whether there is one. */
    if (!(shot.render || shot.image)) return '';
    const bits = [];
    const own = SB.Refs.plain(P(), shot.imageDescription || '').trim();
    if (own) bits.push(own);
    const im = SB.Model.imageModel(P());
    const wrote = im && shot.prompts && shot.prompts[im.id] &&
      (shot.prompts[im.id].imagePrompt || '').trim();
    if (wrote) bits.push(wrote);
    return bits.join('\n\n');
  }

  /* What the first frame shows, and what to do about it.
   *
   * Two different things, and they were bolted together: the CONTENT (the
   * first-frame box and the prompt that was actually rendered) and the RULE
   * (do not contradict it, do not write it out again). Suppressing the whole
   * block for H3 — because that second bullet is the opposite of what the H3
   * template asks for — threw the content away too, and left the one video
   * format in the app with no idea what its own opening picture contains. It
   * was then ordered to describe that picture's composition, appearance,
   * environment and lighting, from nothing. That is the exact regression this
   * block was written to end: a woman standing at the window on the phone
   * coming back sitting on the couch.
   *
   * So the content is unconditional and the rule follows the format. */
  function frameBlock(shot, opts) {
    const shows = frameShows(shot);
    if (!shows) return '';
    const describes = !!(opts && opts.describes);
    return '\n=== THE FIRST FRAME THIS CLIP ANIMATES ===\n' +
      'The picture handed to the video model already shows the following. It is settled: ' +
      'everyone is already standing, sitting or holding what this says they are, and the ' +
      'shot opens exactly there.\n' +
      '- Do NOT contradict it. If the description of the action reads as though somebody is ' +
      'somewhere else, the picture wins and the movement has to start from where they are.\n' +
      (describes
        /* a format whose sections ARE the description of the frame */
        ? '- Where your answer describes the shot — composition, each subject’s appearance ' +
          'and position, the environment, the lighting — describe THIS. Every such detail ' +
          'comes from what follows, not from your own invention. You are writing down a ' +
          'picture that exists, not designing one.\n'
        : '- Do NOT write it out again. The model can see it; repeating the set, the ' +
          'wardrobe, the light or the framing re-renders the shot instead of moving it. ' +
          'This block is here so you know what is true, not so you can describe it.\n') +
      '\n' + shows + '\n';
  }

  function contextFor(shot, role) {
    const f = SB.Model.findShot(P(), shot.id);
    const w = SB.Model.windowFor(P(), shot);
    const ctx = {
      MODEL: '',
      CODE: f ? f.code : '',
      SHOT_TYPE: shot.type || 'unspecified',
      SCENE: f ? (f.scene.heading || '') : '',
      SCENE_DESC: f ? SB.Refs.plain(P(), f.scene.description) : '',
      SCRIPT: w.doc.text.slice(w.from, w.to),
      /* marks resolve to the names they have now — the writer gets prose */
      DESCRIPTION: describe(shot, role),
      SHARED: SB.Refs.plain(P(), shot.description || ''),
      FIRST_FRAME: SB.Refs.plain(P(), shot.imageDescription || ''),
      MOTION: SB.Refs.plain(P(), shot.videoDescription || ''),
      /* for a template that would rather place it itself */
      FRAME_SHOWS: frameShows(shot),
      FIELDS: SB.Fields.promptBlock(P(), shot)
    };
    /* the project's own boxes, each usable on its own: {{ART_DIRECTION}} etc. */
    const extra = SB.Fields.placeholders(P(), shot);
    Object.keys(extra).forEach(function (k) { if (!(k in ctx)) ctx[k] = extra[k]; });
    return ctx;
  }

  const PREAMBLE = 'You write prompts for generative media models. Follow the instructions below exactly.\n\n';

  /* A template that never mentions the project's own fields would silently
   * drop them, so anything filled in is appended unless the template already
   * places it itself. */
  function extras(shot, tpl) {
    const block = SB.Fields.promptBlock(P(), shot);
    if (!block) return '';
    if (/\{\{FIELDS\}\}/.test(tpl || '')) return '';
    const placed = SB.Fields.enabled(P()).every(function (f) {
      return !SB.Fields.value(shot, f.id).trim() ||
        new RegExp('\\{\\{' + SB.Fields.placeholder(f) + '\\}\\}').test(tpl || '');
    });
    return placed ? '' : '\n\n' + block;
  }

  /* The blocking's camera: its lens, and its height (the angle Pose Bench measured). Older blockings carry the
     lens and say the angle in their text ("Camera: 35mm lens, eye level."). */
  function blockingCamera(shot) {
    const ps = shot && shot.pose;
    if (!ps || !ps.image) return null;
    const lens = Math.round(+ps.lens || 0) || (/(\d{2,3})mm lens/.exec(ps.text || '') || [])[1] | 0;
    if (!lens) return null;
    const angle = (ps.framing && ps.framing.angle) ||
      ((/Camera: \d+mm lens, ([^.]+)\./.exec(ps.text || '') || [])[1] || '').replace(/^(high|low) angle/, 'a $1 angle') || 'eye level';
    return { lens: lens, angle: angle };
  }
  function imageBlock(shot, m) {
    const ctx = contextFor(shot, 'image'); ctx.MODEL = m.name;
    /* An edit of another card's frame from the same camera inherits its lens; only a new setup takes the
       blocking's (DERIVED_RIDER and the closing line both say not to restate the lens). */
    const srcFrame = SB.Refs.feed(P(), shot, 'image').filter(function (e) { return e.kind === 'shot' && e.images.length; })[0];
    const sameCamEdit = !!srcFrame && !(SB.Personas.newSetup && SB.Personas.newSetup(P(), shot, srcFrame));
    const bc = sameCamEdit ? null : blockingCamera(shot);
    ctx.LOOK = [SB.Brand.lookLineFor(P(), shot),
      bc ? 'The blocking is framed on a ' + bc.lens + 'mm lens at ' + bc.angle + ': use that focal length and that camera height.' : '']
      .filter(Boolean).join('\n');
    let body = fill(m.imageTemplate, ctx);
    /* A template that doesn't place {{LOOK}} (every board's own copy) gets it right after its task, ahead of
       the shot description, so it is part of the ask rather than a note at the end. */
    if (ctx.LOOK && !/\{\{LOOK\}\}/.test(m.imageTemplate || '')) {
      const at = body.indexOf('SHOT DESCRIPTION:');
      body = at > 0 ? body.slice(0, at).replace(/\s*$/, '\n') + ctx.LOOK + '\n\n' + body.slice(at) : body + '\n' + ctx.LOOK;
    }
    return '=== FIRST-FRAME IMAGE PROMPT — INSTRUCTIONS ===\n' + body + extras(shot, m.imageTemplate) + '\n';
  }
  function videoBlock(shot, m, sc) {
    const ctx = contextFor(shot, 'video'); ctx.MODEL = m.name;
    /* The H3 template works from a label table the app has already assigned,
       so the writer never has to invent one. */
    if (sc) {
      ctx.H3_LABELS = sc.labels || '(none — describe the shot in plain terms)';
      ctx.H3_TASK = sc.taskTypes.length ? '[' + sc.taskTypes.join(' + ') + ']' : '';
    }
    /* Appended rather than placed in the template, so it reaches a board
       whose template somebody has edited — which is every board that has been
       tuned, and exactly the ones that would otherwise go on contradicting
       their own first frames. A template that places {{FRAME_SHOWS}} itself
       gets it there instead. */
    const placed = /\{\{FRAME_SHOWS\}\}/.test(m.videoTemplate || '');
    /* H3's own sections are a description of the opening picture, so it gets
       the frame's content with the opposite rule attached: describe this one,
       rather than do not describe it. */
    const describes = !!(SB.H3 && SB.H3.stock(m));
    return (m.export ? '=== REFERENCE-TO-VIDEO PROMPT — INSTRUCTIONS ===\n' : '=== IMAGE-TO-VIDEO PROMPT — INSTRUCTIONS ===\n') +
      fill(m.videoTemplate, ctx) + extras(shot, m.videoTemplate) +
      (placed ? '' : frameBlock(shot, { describes: describes })) + '\n';
  }

  /* The H3 job: two prose keys instead of one prompt, and the six sections
   * sewn together here once they come back. */
  function h3Job(shot, vm) {
    const sc = SB.H3.scaffold(P(), shot);
    return {
      text: PREAMBLE + 'Return JSON with the keys "summary" and "detailed_description".\n\n' +
        videoBlock(shot, vm, sc),
      keys: SB.H3.WRITTEN,
      system: sysFor(shot, 'video', vm),
      targets: [{ model: vm, field: 'videoPrompt' }],
      /* what actually gets stored is the assembled six-section prompt */
      map: function (res) { return { videoPrompt: SB.H3.assemble(sc, res) }; },
      check: function (res) {
        return SB.H3.problems(sc, res)
          .concat(SB.Brand.moveProblems(P(), shot, res.detailed_description))
          .concat(SB.Brand.genderProblems(P(), shot, res.detailed_description))
          .concat(invented(shot, res.detailed_description));
      }
    };
  }

  function sysFor(shot, role, model) {
    const parts = [SB.Brand.systemFor(P(), shot, role)];
    const cast = SB.Personas.block(P(), shot, model, role);
    if (cast) parts.push(cast);
    if (parts.filter(Boolean).length) parts.push(SB.Brand.closingFor(P(), shot, role));
    return parts.filter(Boolean).join('\n\n');
  }

  /* What the app writes around the writer's words (clay_reference_prompting_plan.md): the
     clay render's own paragraph ahead of a still. Written by the app, not asked for, so it is
     there whatever the writer did — and visible in the stored prompt, where it can be edited. */
  function decorateImage(shot) {
    return function (raw) {
      /* the blocking first: it is image 1 (or the top-left panel), so its paragraph opens the prompt */
      return [SB.Personas.clayPreamble(P(), shot), SB.Personas.refPreamble(P(), shot),
        String(raw || '').trim()].filter(Boolean).join('\n\n');
    };
  }
  function decorateVideo(shot) {
    return function (raw) {
      return String(raw || '').trim();
    };
  }
  const invented = function (shot, text) { return SB.Brand.inventedProblems(P(), shot, text); };

  /* A board image model left on the MiniMax Image template: its prompt is the
     assembled brief, not a writer's paragraph. An edited template is the
     user's own and goes to the writer like any other. */
  function mxmImage(m) {
    return !!m && m.name === 'MiniMax Image' && m.imageTemplate === SB.Model.tplsFor('MiniMax Image').image;
  }

  /* Build the request list for one shot given the selected roles. */
  function jobsFor(shot, im, vm, roles) {
    const jobs = [];
    const wantI = roles.image && im, wantV = roles.video && vm;
    const sys = function (role, model) { return sysFor(shot, role, model); };
    /* H3 is written in its own shape, so it never shares a call with the
       still — even in the unlikely case of one model being picked for both. */
    const h3 = wantV && SB.H3.stock(vm);
    if (wantI && wantV && im.id === vm.id && !h3) {
      jobs.push({
        text: PREAMBLE + 'Return JSON with the keys "imagePrompt" and "videoPrompt".\n\n' +
          imageBlock(shot, im) + '\n' + videoBlock(shot, vm),
        keys: ['imagePrompt', 'videoPrompt'],
        system: sys('both', im),
        targets: [{ model: im, field: 'imagePrompt' }, { model: vm, field: 'videoPrompt' }],
        decorate: { imagePrompt: decorateImage(shot), videoPrompt: decorateVideo(shot) },
        check: function (res) {
          return SB.Brand.moveProblems(P(), shot, res.videoPrompt)
            .concat(SB.Brand.genderProblems(P(), shot, res.imagePrompt))
            .concat(SB.Brand.genderProblems(P(), shot, res.videoPrompt))
            .concat(invented(shot, res.imagePrompt)).concat(invented(shot, res.videoPrompt))
            .concat(SB.Brand.lookProblems(P(), shot, res.imagePrompt));
        }
      });
      return jobs;
    }
    /* MiniMax Image, stock template: the brief is assembled from the board
       (mxm.js) — a job with no writer call, so it needs no key either. */
    if (wantI && SB.Mxm && mxmImage(im)) {
      jobs.push({
        local: function () { return { imagePrompt: SB.Mxm.brief(SB.Mxm.manifest(P(), shot, 'image')) }; },
        keys: ['imagePrompt'],
        targets: [{ model: im, field: 'imagePrompt' }]
      });
    } else if (wantI) {
      jobs.push({
        text: PREAMBLE + 'Return JSON with the key "imagePrompt".\n\n' + imageBlock(shot, im),
        keys: ['imagePrompt'],
        system: sys('image', im),
        targets: [{ model: im, field: 'imagePrompt' }],
        decorate: { imagePrompt: decorateImage(shot) },
        check: function (res) {
          return SB.Brand.genderProblems(P(), shot, res.imagePrompt).concat(invented(shot, res.imagePrompt))
            .concat(SB.Brand.lookProblems(P(), shot, res.imagePrompt));
        }
      });
    }
    if (wantV) {
      /* A blocked card on a stock H3 board is the full-reference call: its
         blocking (the clay clip, or the clay still) is the reference, so it
         needs no first frame — and the prompt says what each file is. */
      const full = h3 && SB.Mxm && SB.Mxm.h3Card(P(), shot);
      jobs.push(full ? mxmVideoJob(shot, vm) : h3 ? h3Job(shot, vm) : {
        text: PREAMBLE + 'Return JSON with the key "videoPrompt".\n\n' + videoBlock(shot, vm),
        keys: ['videoPrompt'],
        system: sys('video', vm),
        targets: [{ model: vm, field: 'videoPrompt' }],
        decorate: { videoPrompt: decorateVideo(shot) },
        check: function (res) {
          return SB.Brand.moveProblems(P(), shot, res.videoPrompt)
            .concat(SB.Brand.genderProblems(P(), shot, res.videoPrompt))
            .concat(invented(shot, res.videoPrompt));
        }
      });
    }
    return jobs;
  }

  /* One POST to whichever backend is selected. The provider owns the URL, the
   * headers and the wording of a failure; everything the retry logic below
   * needs (status, raw) is attached the same way for both. */
  function request(prov, mdl, body) {
    return fetch(prov.url(mdl), {
      method: 'POST',
      headers: prov.headers(),
      body: JSON.stringify(body)
    }).catch(function (e) {
      /* fetch rejected: nothing reached the server. Say which wall it hit —
       * for a local server that is never the corporate proxy. */
      if (prov.id === 'ooba') throw SB.Providers.localError(e);
      const kind = SB.netKind(e);
      if (kind) throw SB.netError(kind);
      throw e;
    }).then(function (r) {
      return r.text().then(function (t) {
        if (!r.ok) {
          if (prov.id !== 'ooba' && SB.isInterception(r.status, t)) throw SB.netError('blocked');
          let msg = t;
          try {
            const j = JSON.parse(t);
            msg = (j.error && (j.error.message || j.error)) || j.detail || t;
            if (typeof msg !== 'string') msg = JSON.stringify(msg);
          } catch (e) { }
          const err = prov.error(r.status, msg, mdl);
          err.status = r.status;
          err.raw = msg;
          throw err;
        }
        SB.GeminiModels.bump(SB.Providers.usageKey(prov.id, mdl));
        try { return JSON.parse(t); }
        catch (e) {
          throw new Error('The server answered, but not with JSON.' +
            (prov.id === 'ooba'
              ? ' Check that the address points at an OpenAI-compatible API port.'
              : ''));
        }
      });
    });
  }

  /* Gemma has no JSON mode, and responseMimeType is accepted-then-IGNORED rather
   * than rejected (verified live 2026-08-21), so nothing ever errors -- it just
   * answers with a bulleted plan and prose that can contain no braces at all.
   * Measured over 10 runs on a reproducing prompt: the old "start with { and end
   * with }" hint parsed 5/10; this wording parsed 10/10. Prefilling a model turn
   * with "{" was tried and REJECTED -- it lifts parse rate but makes the API read
   * the turn as a function call, returning MALFORMED_FUNCTION_CALL on ~90% of
   * calls, truncating mid-object and sometimes returning no content.parts at all. */
  const NO_SCHEMA_HINT =
    '\n\nReply with the JSON object only \u2014 no preamble, plan or commentary (a ```json fence is fine).';

  /* Pull the first balanced {...} out of prose, respecting strings and escapes.
   * The old /\{[\s\S]*\}/ was greedy: in a reply holding two objects it spanned
   * from the first { to the last }, producing invalid JSON. */
  function firstObject(str) {
    const fence = str.match(/```(?:json)?[ \t]*\r?\n?([\s\S]*?)```/i);
    if (fence) str = fence[1];
    let depth = 0, start = -1, inStr = false, esc = false, q = '';
    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === q) inStr = false;
        continue;
      }
      if (c === '"' || c === "'") { inStr = true; q = c; continue; }
      if (c === '{') { if (depth === 0) start = i; depth++; continue; }
      if (c === '}') { depth--; if (depth === 0 && start >= 0) return str.slice(start, i + 1); }
    }
    return null;
  }

  /* One JSON-shaped question to the writer model, wherever it runs. */
  /* The shape a schema asks for, as a JSON skeleton with its key names. A model with no JSON mode (a local
     server, Gemma) used to be told only "one JSON object", never WHICH keys, so it answered {"prompt": ...}
     where {"imagePrompt": ...} was read, and the result was silently blank. */
  function shapeOf(sc) {
    if (!sc || typeof sc !== 'object') return '...';
    const t = String(sc.type || '').toUpperCase();
    if (t === 'OBJECT') {
      const o = {};
      Object.keys(sc.properties || {}).forEach(function (k) { o[k] = shapeOf(sc.properties[k]); });
      return o;
    }
    if (t === 'ARRAY') return [shapeOf(sc.items)];
    if (t === 'NUMBER' || t === 'INTEGER') return 0;
    if (t === 'BOOLEAN') return false;
    return '...';
  }
  function ask(text, schema, system) {
    const prov = SB.Providers.active();
    if (!prov.ready()) return Promise.reject(new Error(prov.notReady()));
    const mdl = prov.model();
    const hint = schema
      ? NO_SCHEMA_HINT + '\nUse exactly this shape and these key names: ' + JSON.stringify(shapeOf(schema))
      : NO_SCHEMA_HINT;

    function build(withSchema) {
      return prov.body(mdl, text, {
        schema: withSchema ? schema : null,
        system: system,
        hint: hint
      });
    }

    /* A local server has no JSON mode at all, and neither does Gemma — both
     * get asked in words instead. Any other model that rejects the schema is
     * given the same treatment on retry. */
    const useSchema = prov.supportsSchema && prov.schemaFor(mdl) && !!schema;

    return request(prov, mdl, build(useSchema)).catch(function (e) {
      const schemaProblem = /schema|json|mime|not supported|unsupported|invalid argument/i
        .test(String(e.raw || e.message || ''));
      if (useSchema && e.status === 400 && schemaProblem) {
        return request(prov, mdl, build(false));
      }
      throw e;
    }).then(function (data) {
      const raw = prov.text(data);
      try { return JSON.parse(raw); }
      catch (e) {
        const m = firstObject(raw);
        if (!m) throw new Error('Could not parse the reply from ' + prov.label);
        return JSON.parse(m);
      }
    });
  }

  function callWriter(text, keys, system) {
    const props = {};
    keys.forEach(function (k) { props[k] = { type: 'STRING' }; });
    return ask(text, { type: 'OBJECT', properties: props, required: keys }, system);
  }

  /* The board this was asked for, if it is still the board on screen.
   *
   * generateFor used to close over the shot OBJECT and store() wrote straight
   * into it -- the same pattern land() in imagine.js was rewritten to drop.
   * A writer model takes tens of seconds, and opening another board or
   * restoring a version in that window put the finished prompt on an orphan,
   * reported success, and then touched the board that WAS on screen over the
   * top of its own file. There is no undo behind a prompt. */
  function stillOpen(projectId, shotId) {
    const cur = SB.app && SB.app.project;
    if (!cur || cur.id !== projectId) return null;
    const f = SB.Model.findShot(cur, shotId);
    return f ? f.shot : null;
  }

  function store(shot, model, field, value) {
    const cur = shot.prompts[model.id] || { imagePrompt: '', videoPrompt: '' };
    cur[field] = value || '';
    cur.modelName = model.name;
    cur.at = Date.now();
    /* Written now, so it matches the call as it stands now — whatever marked
       the previous one out of date. */
    delete cur.stale;
    shot.prompts[model.id] = cur;
  }

  /* A job that knows what a valid answer looks like gets one corrective pass.
   * This is a format check, not a taste check: a label the writer invented is
   * a subject nobody cast, and it is worth one more call to lose it. */
  function verify(job, res) {
    if (!job.check) return Promise.resolve(res);
    const bad = job.check(res);
    if (!bad.length) return Promise.resolve(res);
    /* The draft goes back with the problems: told only "keep everything else the same", the writer had never
       seen what it wrote, so a rewrite asked to fix one word came back as a different prompt. */
    let draft = '';
    try { draft = JSON.stringify(res); } catch (e) { draft = ''; }
    return callWriter(
      job.text + '\n\nYOUR PREVIOUS ANSWER:\n' + draft + '\n\nIt has these problems: ' + bad.join(' ') +
      ' Fix them in that answer and keep the rest of it as it is. Return the whole answer again, in the same shape.',
      job.keys, job.system
    ).catch(function () { return res; });   // the draft is better than nothing
  }

  /* Write the prompts for ONE shot.
   *
   * There used to be a batch here: a queue, three lanes, a canary first request
   * to prove the network before the rest followed, progress ticks and an
   * aggregate result. All of it existed to write a whole board at once, which
   * turned out to be a fast way to produce text nobody had read — every prompt
   * it wrote was one you then opened and edited anyway. So it is one shot, and
   * at most the two jobs that shot needs.
   *
   * Resolves with what was written. Rejects if nothing could be.
   */
  /* Which prompts are being written right now, keyed shot:field.
   *
   * This used to live in the pressed button's own textContent — "…" meant
   * busy. Two things followed from that. A repaint could not tell a running
   * button from an idle one, so it re-enabled it; and closing the panel threw
   * the state away entirely, so reopening it mid-write showed a ready button,
   * and pressing it again sent a second call for the same prompt. Two calls
   * against the day's allowance, and — since a prompt edited while another
   * is in flight is now kept rather than overwritten — the second one came
   * back and was dropped with a message about an edit nobody had made.
   *
   * So it lives here, next to the shot it is about, the way a push does. */
  const WRITING = {};

  function writeKey(shotId, field) { return shotId + ':' + field; }
  function writing(shotId, field) { return !!WRITING[writeKey(shotId, field)]; }
  function writingAny(shotId) {
    return writing(shotId, 'imagePrompt') || writing(shotId, 'videoPrompt');
  }

  const WATCHERS = [];
  function onWriting(fn) {
    WATCHERS.push(fn);
    return function () {
      const i = WATCHERS.indexOf(fn);
      if (i >= 0) WATCHERS.splice(i, 1);
    };
  }
  function tellWatchers() {
    WATCHERS.slice().forEach(function (fn) { try { fn(); } catch (e) { } });
  }

  function markWriting(shotId, fields, on) {
    fields.forEach(function (f) {
      if (on) WRITING[writeKey(shotId, f)] = true;
      else delete WRITING[writeKey(shotId, f)];
    });
    tellWatchers();
  }

  function generateFor(shot, roles) {
    const p = P();
    const im = SB.Model.imageModel(p), vm = SB.Model.videoModel(p);
    roles = roles || { image: true, video: true };
    if ((!roles.image || !im) && (!roles.video || !vm)) {
      return Promise.reject(new Error('Pick a target model first'));
    }
    if (shot.noShot) {
      return Promise.reject(new Error('A \u201cno shot\u201d card is never generated.'));
    }
    /* Any of the three boxes is something to work from — a card that says
       nothing in the shared box but everything in the motion box is written,
       not blocked. */
    if (!SB.Model.described(shot)) {
      return Promise.reject(new Error('Write a description first \u2014 there is nothing to work from.'));
    }

    const jobs = jobsFor(shot, im, vm, roles);
    if (!jobs.length) return Promise.reject(new Error('Nothing to write for this shot.'));
    /* Checked up front rather than letting the job fail: the reason is what the
     * user needs, not a failure count. A job assembled here needs no writer. */
    const prov = SB.Providers.active();
    if (jobs.some(function (j) { return !j.local; }) && !prov.ready()) {
      return Promise.reject(new Error(prov.notReady()));
    }

    /* Ids, not the object. Looked up again when the answer arrives. */
    const projectId = p.id, shotId = shot.id;

    /* One at a time per field: a second press while the first is in the air is
       a second call for the same prompt, and the guard below is the only thing
       standing between that and two charges. */
    const fields = [];
    jobs.forEach(function (j) {
      j.targets.forEach(function (tg) {
        if (fields.indexOf(tg.field) < 0) fields.push(tg.field);
      });
    });
    if (fields.some(function (f) { return writing(shot.id, f); })) {
      return Promise.reject(new Error('That prompt is already being written.'));
    }
    markWriting(shot.id, fields, true);
    const done = function () { markWriting(shot.id, fields, false); };

    const written = [];
    const kept = [];
    let lastError = null;

    /* What each target said at the moment we asked. A writer model takes tens
     * of seconds, and in that time the person who pressed the button reads the
     * prompt that is already there and fixes it by hand. The answer that comes
     * back was written against the OLD text and knows nothing about the fix —
     * storing it threw the fix away, silently, with no undo behind it. A hand
     * edit is the newer intent, so it wins, and the button is there to press
     * again if the written one was wanted after all. */
    const asked = {};
    jobs.forEach(function (j) {
      j.targets.forEach(function (t) {
        const pr = shot.prompts[t.model.id];
        asked[t.model.id + '|' + t.field] = (pr && pr[t.field]) || '';
      });
    });

    /* One after another. Two jobs only happen when the image and the video
     * model differ, and a wall that stops the first would stop the second. */
    function step(i) {
      if (i >= jobs.length) return Promise.resolve();
      if (lastError && SB.netKind(lastError)) return Promise.resolve();
      const j = jobs[i];
      return (j.local ? Promise.resolve(j.local()) : callWriter(j.text, j.keys, j.system).then(function (res) {
        return verify(j, res);
      })).then(function (res) {
        const vals = j.map ? j.map(res) : res;
        const live = stillOpen(projectId, shotId);
        if (!live) {
          lastError = new Error('That board is not open any more, so the prompt ' +
            'was not written. Open it and generate again.');
          return;
        }
        j.targets.forEach(function (t) {
          const now = (live.prompts[t.model.id] || {})[t.field] || '';
          if (now !== asked[t.model.id + '|' + t.field]) {
            kept.push({ field: t.field, model: t.model });
            return;
          }
          const raw = vals[t.field];
          store(live, t.model, t.field, j.decorate && j.decorate[t.field] ? j.decorate[t.field](raw) : raw);
          written.push(t.field);
          /* What the writer added and kept through its one rewrite — read off its own words,
             before the app's lock (which names the very things it rules out) was put round them. */
          {
            const inv = SB.Brand.inventedTerms(P(), live, raw), rec = live.prompts[t.model.id];
            const by = rec.invented && typeof rec.invented === 'object' && !Array.isArray(rec.invented) ? rec.invented : {};
            if (inv.length) by[t.field] = inv; else delete by[t.field];
            if (Object.keys(by).length) rec.invented = by; else delete rec.invented;
          }
          /* A still that came back flat even after its rewrite: marked, the way an added coat is. */
          if (t.field === 'imagePrompt') {
            const rec = live.prompts[t.model.id], flat = SB.Brand.lookMark(P(), live, raw);
            if (flat.length) rec.flat = flat; else delete rec.flat;
          }
          /* which call a video prompt was written for: the full-reference one
             cannot go through the frame-only push */
          if (t.field === 'videoPrompt') {
            const rec = live.prompts[t.model.id];
            if (j.route) { rec.route = j.route; rec.mxmSig = j.manifest.sig; }
            else { delete rec.route; delete rec.mxmSig; }
          }
          if (j.after) j.after(live, vals);
          /* One rewrite is all it gets. A move that survives it is not thrown
             away — the rest of the paragraph is usually right — but it is
             marked, so nobody ships a push in they never asked for. */
          const pr = live.prompts[t.model.id];
          if (t.field === 'videoPrompt') {
            const left = SB.Brand.moveProblems(P(), live, vals[t.field]).length
              ? SB.Brand.movesIn(vals[t.field]) : [];
            if (left.length) pr.moved = left; else delete pr.moved;
          }
          /* Same bargain as the camera: the prompt is kept, and the words it
             decided on its own are named on the card. */
          const g = SB.Brand.genderProblems(P(), live, vals[t.field]);
          if (g.length) {
            const said = SB.Brand.genderedTerms(vals[t.field]);
            const allowed = SB.Brand.castSides(P(), shot);
            pr.gendered = said.filter(function (w) {
              const s2 = SB.Brand.castSides(P(), { description: w });
              return (s2.f && !allowed.f) || (s2.m && !allowed.m);
            });
            if (!pr.gendered.length) delete pr.gendered;
          } else {
            delete pr.gendered;
          }
        });
      }).catch(function (e) {
        lastError = e;
        console.error('[storyboarder] prompt failed', e);
      }).then(function () { return step(i + 1); });
    }

    return step(0).then(function () {
      done();
      /* This lands whenever the writer model is done — which is routinely
         while the user has moved on and is typing in another box. It waits
         for a gap in the typing. */
      SB.Focus.defer('prompts:' + shot.id, function () { SB.app.changed(true); });
      if (kept.length) {
        const f = SB.Model.findShot(P(), shot.id);
        SB.toast('Your edit to the ' +
          kept.map(function (k) {
            return k.field === 'imagePrompt' ? 'first-frame prompt' : 'video prompt';
          }).join(' and ') +
          (f ? ' for ' + f.code : '') +
          ' was kept — it changed while the writer was working, so the new one was ' +
          'dropped. Generate again to replace it.', true);
      }
      if (!written.length && !kept.length) throw lastError || new Error('Nothing was written');
      return { written: written, kept: kept, error: lastError ? lastError.message : null };
    }).catch(function (e) {
      /* step() swallows its own failures, so this is the throw above and
         anything unforeseen — either way the field stops being busy. */
      done();
      throw e;
    });
  }

  /* The MiniMax H3 full-reference prompt for the package (mxm.js): the stock
   * H3 template with the call's own label table — clip, first frame, subject
   * pictures — and a rider saying what each file is for. Stored on shot.mxm,
   * never on shot.prompts: the ImagineArt push keeps its frame-only prompt. */
  /* The full-reference H3 job: what the MiniMax package's Write asks, and what
   * the Create panel asks for a blocked card on a stock H3 board (a card whose
   * blocking IS its reference — no still needed). One job, so the two can
   * never write different prompts for the same call. */
  function mxmVideoJob(shot, vm) {
    const p = P();
    const m = SB.Mxm.manifest(p, shot, 'video');
    const sc = SB.Mxm.h3Scaffold(m);
    const tm = { id: 'mxm', name: SB.H3.NAME, kind: 'video', videoTemplate: SB.Model.tplsFor(SB.H3.NAME).video };
    return {
      manifest: m, scaffold: sc, route: 'mxm',
      text: PREAMBLE + 'Return JSON with the keys "summary" and "detailed_description".\n\n' +
        videoBlock(shot, tm, sc) + '\n' + SB.Mxm.h3Rider(m, sc) + '\n',
      keys: SB.H3.WRITTEN,
      system: sysFor(shot, 'video', tm),
      targets: vm ? [{ model: vm, field: 'videoPrompt' }] : [],
      map: function (res) { return { videoPrompt: SB.H3.assemble(sc, res) }; },
      /* the package carries the same text */
      after: function (live, vals) {
        SB.Mxm.remember(live, 'video', { prompt: vals.videoPrompt, sig: m.sig, written: true });
      },
      check: function (res) {
        /* with a clip, the camera is the clip's: a move it describes is not one nobody asked for */
        return SB.H3.problems(sc, res)
          .concat(sc.clip ? [] : SB.Brand.moveProblems(p, shot, res.detailed_description))
          .concat(SB.Brand.genderProblems(p, shot, res.detailed_description))
          .concat(SB.Brand.inventedProblems(p, shot, res.detailed_description));
      }
    };
  }

  function writeMxm(shot) {
    const p = P();
    const prov = SB.Providers.active();
    if (!prov.ready()) return Promise.reject(new Error(prov.notReady()));
    if (!SB.Model.described(shot)) {
      return Promise.reject(new Error('Write a description first \u2014 there is nothing to work from.'));
    }
    if (writing(shot.id, 'mxmVideo')) return Promise.reject(new Error('That prompt is already being written.'));
    /* a stock H3 board's own video prompt for this card is the same call: keep it in step */
    const vm = SB.Model.videoModel(p);
    const same = !!(SB.H3.stock(vm) && SB.Mxm.h3Card(p, shot));
    const job = mxmVideoJob(shot, same ? vm : null);
    const m = job.manifest;
    const projectId = p.id, shotId = shot.id;
    markWriting(shotId, ['mxmVideo'], true);
    return callWriter(job.text, job.keys, job.system).then(function (res) {
      return verify(job, res);
    }).then(function (res) {
      const live = stillOpen(projectId, shotId);
      if (!live) throw new Error('That board is not open any more, so the prompt was not written.');
      const text = job.map(res).videoPrompt;
      SB.Mxm.remember(live, 'video', { prompt: text, sig: m.sig, written: true });
      if (same) {
        store(live, vm, 'videoPrompt', text);
        live.prompts[vm.id].route = 'mxm';
        live.prompts[vm.id].mxmSig = m.sig;
      }
      markWriting(shotId, ['mxmVideo'], false);
      SB.Focus.defer('prompts:' + shotId, function () { SB.app.changed(true); });
      return text;
    }).catch(function (e) {
      markWriting(shotId, ['mxmVideo'], false);
      throw e;
    });
  }

  SB.Prompts = {
    generateFor: generateFor, writeMxm: writeMxm, mxmImage: mxmImage, mxmVideoJob: mxmVideoJob,
    writing: writing, writingAny: writingAny, onWriting: onWriting,
    jobsFor: jobsFor, fill: fill, raw: ask, blockingCamera: blockingCamera
  };

})(window.SB);
