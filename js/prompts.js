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
    });
  }

  function contextFor(shot) {
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
      DESCRIPTION: SB.Refs.plain(P(), shot.description),
      FIELDS: SB.Fields.promptBlock(P(), shot)
    };
    /* the project's own boxes, each usable on its own: {{ART_DIRECTION}} etc. */
    const extra = SB.Fields.placeholders(P(), shot);
    Object.keys(extra).forEach(function (k) { if (!(k in ctx)) ctx[k] = extra[k]; });
    return ctx;
  }

  const PREAMBLE = 'You write prompts for generative media models. Follow the instruction ' +
    'block(s) below exactly. Return the prompts themselves only — no commentary, no markdown fences.\n\n';

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

  function imageBlock(shot, m) {
    const ctx = contextFor(shot); ctx.MODEL = m.name;
    return '=== FIRST-FRAME IMAGE PROMPT — INSTRUCTIONS ===\n' +
      fill(m.imageTemplate, ctx) + extras(shot, m.imageTemplate) + '\n';
  }
  function videoBlock(shot, m, sc) {
    const ctx = contextFor(shot); ctx.MODEL = m.name;
    /* The H3 template works from a label table the app has already assigned,
       so the writer never has to invent one. */
    if (sc) {
      ctx.H3_LABELS = sc.labels || '(none — describe the shot in plain terms)';
      ctx.H3_TASK = sc.taskTypes.length ? '[' + sc.taskTypes.join(' + ') + ']' : '';
    }
    return '=== IMAGE-TO-VIDEO PROMPT — INSTRUCTIONS ===\n' +
      fill(m.videoTemplate, ctx) + extras(shot, m.videoTemplate) + '\n';
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
          .concat(SB.Brand.genderProblems(P(), shot, res.detailed_description));
      }
    };
  }

  function sysFor(shot, role, model) {
    const parts = [SB.Brand.systemFor(P(), shot, role)];
    const cast = SB.Personas.block(P(), shot, model, role);
    if (cast) parts.push(cast);
    return parts.filter(Boolean).join('\n\n');
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
        check: function (res) {
          return SB.Brand.moveProblems(P(), shot, res.videoPrompt)
            .concat(SB.Brand.genderProblems(P(), shot, res.imagePrompt))
            .concat(SB.Brand.genderProblems(P(), shot, res.videoPrompt));
        }
      });
      return jobs;
    }
    if (wantI) {
      jobs.push({
        text: PREAMBLE + 'Return JSON with the key "imagePrompt".\n\n' + imageBlock(shot, im),
        keys: ['imagePrompt'],
        system: sys('image', im),
        targets: [{ model: im, field: 'imagePrompt' }],
        check: function (res) { return SB.Brand.genderProblems(P(), shot, res.imagePrompt); }
      });
    }
    if (wantV) {
      jobs.push(h3 ? h3Job(shot, vm) : {
        text: PREAMBLE + 'Return JSON with the key "videoPrompt".\n\n' + videoBlock(shot, vm),
        keys: ['videoPrompt'],
        system: sys('video', vm),
        targets: [{ model: vm, field: 'videoPrompt' }],
        check: function (res) {
          return SB.Brand.moveProblems(P(), shot, res.videoPrompt)
            .concat(SB.Brand.genderProblems(P(), shot, res.videoPrompt));
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
    '\n\nOutput format: a single JSON object and nothing else. No preamble, no plan, no bullet points, no commentary. A ```json fenced block is acceptable. Your entire reply must be the JSON.';

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
  function ask(text, schema, system) {
    const prov = SB.Providers.active();
    if (!prov.ready()) return Promise.reject(new Error(prov.notReady()));
    const mdl = prov.model();

    function build(withSchema) {
      return prov.body(mdl, text, {
        schema: withSchema ? schema : null,
        system: system,
        hint: NO_SCHEMA_HINT
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

  function store(shot, model, field, value) {
    const cur = shot.prompts[model.id] || { imagePrompt: '', videoPrompt: '' };
    cur[field] = value || '';
    cur.modelName = model.name;
    cur.at = Date.now();
    shot.prompts[model.id] = cur;
  }

  /* A job that knows what a valid answer looks like gets one corrective pass.
   * This is a format check, not a taste check: a label the writer invented is
   * a subject nobody cast, and it is worth one more call to lose it. */
  function verify(job, res) {
    if (!job.check) return Promise.resolve(res);
    const bad = job.check(res);
    if (!bad.length) return Promise.resolve(res);
    return callWriter(
      job.text + '\n\nYour previous answer did not follow the format: ' + bad.join(' ') +
      ' Write it again, correctly. Keep everything else the same.',
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
  function generateFor(shot, roles) {
    const p = P();
    const im = SB.Model.imageModel(p), vm = SB.Model.videoModel(p);
    roles = roles || { image: true, video: true };
    if ((!roles.image || !im) && (!roles.video || !vm)) {
      return Promise.reject(new Error('Pick a target model first'));
    }
    /* Checked up front rather than letting the job fail: the reason is what the
     * user needs, not a failure count. */
    const prov = SB.Providers.active();
    if (!prov.ready()) return Promise.reject(new Error(prov.notReady()));

    if (shot.noShot) {
      return Promise.reject(new Error('A \u201cno shot\u201d card is never generated.'));
    }
    if (!(shot.description || '').trim()) {
      return Promise.reject(new Error('Write a description first \u2014 there is nothing to work from.'));
    }

    const jobs = jobsFor(shot, im, vm, roles);
    if (!jobs.length) return Promise.reject(new Error('Nothing to write for this shot.'));

    const written = [];
    let lastError = null;

    /* One after another. Two jobs only happen when the image and the video
     * model differ, and a wall that stops the first would stop the second. */
    function step(i) {
      if (i >= jobs.length) return Promise.resolve();
      if (lastError && SB.netKind(lastError)) return Promise.resolve();
      const j = jobs[i];
      return callWriter(j.text, j.keys, j.system).then(function (res) {
        return verify(j, res);
      }).then(function (res) {
        const vals = j.map ? j.map(res) : res;
        j.targets.forEach(function (t) {
          store(shot, t.model, t.field, vals[t.field]);
          written.push(t.field);
          /* One rewrite is all it gets. A move that survives it is not thrown
             away — the rest of the paragraph is usually right — but it is
             marked, so nobody ships a push in they never asked for. */
          const pr = shot.prompts[t.model.id];
          if (t.field === 'videoPrompt') {
            const left = SB.Brand.moveProblems(P(), shot, vals[t.field]).length
              ? SB.Brand.movesIn(vals[t.field]) : [];
            if (left.length) pr.moved = left; else delete pr.moved;
          }
          /* Same bargain as the camera: the prompt is kept, and the words it
             decided on its own are named on the card. */
          const g = SB.Brand.genderProblems(P(), shot, vals[t.field]);
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
      SB.app.changed(true);
      if (!written.length) throw lastError || new Error('Nothing was written');
      return { written: written, error: lastError ? lastError.message : null };
    });
  }

  SB.Prompts = {
    generateFor: generateFor,
    jobsFor: jobsFor, fill: fill, raw: ask
  };

})(window.SB);
