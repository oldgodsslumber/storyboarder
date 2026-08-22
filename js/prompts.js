/* prompts.js — Gemini is the prompt WRITER. The app never generates media.
 *
 * Two roles, each with its own target model:
 *   image model -> the first-frame prompt      (stored on prompts[imageModel.id].imagePrompt)
 *   video model -> the image-to-video prompt   (stored on prompts[videoModel.id].videoPrompt)
 * Every model a shot has been run against keeps its prompts, forever.
 */
(function (SB) {
  'use strict';

  const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';

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
      SCENE_DESC: f ? (f.scene.description || '') : '',
      SCRIPT: w.doc.text.slice(w.from, w.to),
      DESCRIPTION: shot.description || '',
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
  function videoBlock(shot, m) {
    const ctx = contextFor(shot); ctx.MODEL = m.name;
    return '=== IMAGE-TO-VIDEO PROMPT — INSTRUCTIONS ===\n' +
      fill(m.videoTemplate, ctx) + extras(shot, m.videoTemplate) + '\n';
  }

  /* Build the request list for one shot given the selected roles. */
  function jobsFor(shot, im, vm, roles) {
    const jobs = [];
    const wantI = roles.image && im, wantV = roles.video && vm;
    const sys = function (role, model) {
      const parts = [SB.Brand.systemFor(P(), shot, role)];
      const cast = SB.Personas.block(P(), shot, model);
      if (cast) parts.push(cast);
      return parts.filter(Boolean).join('\n\n');
    };
    if (wantI && wantV && im.id === vm.id) {
      jobs.push({
        text: PREAMBLE + 'Return JSON with the keys "imagePrompt" and "videoPrompt".\n\n' +
          imageBlock(shot, im) + '\n' + videoBlock(shot, vm),
        keys: ['imagePrompt', 'videoPrompt'],
        system: sys('both', im),
        targets: [{ model: im, field: 'imagePrompt' }, { model: vm, field: 'videoPrompt' }]
      });
      return jobs;
    }
    if (wantI) {
      jobs.push({
        text: PREAMBLE + 'Return JSON with the key "imagePrompt".\n\n' + imageBlock(shot, im),
        keys: ['imagePrompt'],
        system: sys('image', im),
        targets: [{ model: im, field: 'imagePrompt' }]
      });
    }
    if (wantV) {
      jobs.push({
        text: PREAMBLE + 'Return JSON with the key "videoPrompt".\n\n' + videoBlock(shot, vm),
        keys: ['videoPrompt'],
        system: sys('video', vm),
        targets: [{ model: vm, field: 'videoPrompt' }]
      });
    }
    return jobs;
  }

  function request(mdl, key, body) {
    return fetch(ENDPOINT + encodeURIComponent(mdl) + ':generateContent?key=' + encodeURIComponent(key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).catch(function (e) {
      /* fetch rejected: nothing reached Google. Say which wall it hit. */
      const kind = SB.netKind(e);
      if (kind) throw SB.netError(kind);
      throw e;
    }).then(function (r) {
      return r.text().then(function (t) {
        if (!r.ok) {
          if (SB.isInterception(r.status, t)) throw SB.netError('blocked');
          let msg = t;
          try { msg = JSON.parse(t).error.message; } catch (e) { }
          let err;
          if (r.status === 429) {
            SB.GeminiModels.markExhausted(mdl);
            err = new Error('Gemini 429 — daily/rate limit reached for ' + mdl +
              '. Pick another model in the Prompts panel. (' + msg + ')');
          } else if (r.status === 404) {
            err = new Error('Gemini 404 — "' + mdl + '" is not available to this key. ' +
              'Settings → API → refresh the model list. (' + msg + ')');
          } else {
            err = new Error('Gemini ' + r.status + ': ' + msg);
          }
          err.status = r.status;
          err.raw = msg;
          throw err;
        }
        SB.GeminiModels.bump(mdl);
        return JSON.parse(t);
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

  /* One JSON-shaped question to the writer model. */
  function ask(text, schema, system) {
    const key = SB.Store.getApiKey();
    if (!key) return Promise.reject(new Error('No Google API key. Add one in Settings → API.'));
    const mdl = P().settings.geminiModel || SB.GeminiModels.DEFAULT;

    /* Gemma takes neither a response schema nor a systemInstruction — it gets
     * both folded into the one user turn instead. */
    const plain = SB.GeminiModels.isGemma(mdl);

    function build(withSchema) {
      const gen = { temperature: 0.8 };
      if (withSchema) {
        gen.responseMimeType = 'application/json';
        gen.responseSchema = schema;
      }
      let user = withSchema ? text : text + NO_SCHEMA_HINT;
      const body = { generationConfig: gen };
      if (system) {
        if (plain) user = system + '\n\n----\n\n' + user;
        else body.systemInstruction = { parts: [{ text: system }] };
      }
      body.contents = [{ role: 'user', parts: [{ text: user }] }];
      return body;
    }

    /* Gemma runs on the same endpoint but has no JSON mode — ask it in words.
     * Any other model that rejects the schema gets the same treatment on retry. */
    const useSchema = !plain;

    return request(mdl, key, build(useSchema)).catch(function (e) {
      const schemaProblem = /schema|json|mime|not supported|unsupported|invalid argument/i
        .test(String(e.raw || e.message || ''));
      if (useSchema && e.status === 400 && schemaProblem) {
        return request(mdl, key, build(false));
      }
      throw e;
    }).then(function (data) {
      const cand = data.candidates && data.candidates[0];
      const part = cand && cand.content && cand.content.parts && cand.content.parts[0];
      const raw = part && part.text;
      if (!raw) throw new Error('Gemini returned no text' + (cand && cand.finishReason ? ' (' + cand.finishReason + ')' : ''));
      try { return JSON.parse(raw); }
      catch (e) {
        const m = firstObject(raw);
        if (!m) throw new Error('Could not parse the Gemini response');
        return JSON.parse(m);
      }
    });
  }

  function callGemini(text, keys, system) {
    const props = {};
    keys.forEach(function (k) { props[k] = { type: 'STRING' }; });
    return ask(text, { type: 'OBJECT', properties: props, required: keys }, system);
  }

  function store(shot, model, field, value, flagged) {
    const cur = shot.prompts[model.id] || { imagePrompt: '', videoPrompt: '' };
    cur[field] = value || '';
    cur.modelName = model.name;
    cur.at = Date.now();
    cur.flagged = cur.flagged || {};
    if (flagged && flagged.length) cur.flagged[field] = flagged;
    else delete cur.flagged[field];
    shot.prompts[model.id] = cur;
  }

  /* "No gender references" is a hard brand rule, so it gets verified rather
   * than hoped for: one corrective rewrite, then a visible flag on the card if
   * the writer still won't let go of it. */
  function enforceNeutral(job, res) {
    if (!SB.Brand.brandOf(P()).enabled) return Promise.resolve({ res: res, flags: {} });
    const bad = {};
    let any = false;
    job.keys.forEach(function (k) {
      const terms = SB.Brand.genderedTerms(res[k]);
      if (terms.length) { bad[k] = terms; any = true; }
    });
    if (!any) return Promise.resolve({ res: res, flags: {} });

    const all = Object.keys(bad).reduce(function (a, k) { return a.concat(bad[k]); }, []);
    const fix = job.text +
      '\n\nYour previous draft used gendered language (' + all.join(', ') + '). ' +
      'Rewrite it with no gendered nouns, adjectives, titles or pronouns — ' +
      'use "the subject", "the person", or no pronoun at all. Keep everything else the same.';

    return callGemini(fix, job.keys, job.system).then(function (res2) {
      const still = {};
      job.keys.forEach(function (k) {
        const terms = SB.Brand.genderedTerms(res2[k]);
        if (terms.length) still[k] = terms;
      });
      return { res: res2, flags: still };
    }).catch(function () {
      return { res: res, flags: bad };   // rewrite failed — keep the draft, flag it
    });
  }

  /* opts = { roles:{image,video}, onProgress(done,total,failed) } */
  function generateFor(shots, opts) {
    opts = opts || {};
    const p = P();
    const im = SB.Model.imageModel(p), vm = SB.Model.videoModel(p);
    const roles = opts.roles || { image: true, video: true };
    if ((!roles.image || !im) && (!roles.video || !vm)) {
      return Promise.reject(new Error('Pick a target model first'));
    }
    /* Check up front rather than letting every job fail one at a time — the
     * reason is what the user needs, not a count of failures. */
    if (!SB.Store.getApiKey()) {
      return Promise.reject(new Error('No Google API key yet — add one in Settings → API.'));
    }

    const jobs = [];
    shots.forEach(function (s) {
      if (s.noShot) return;                        // "no shot" fragments never generate
      if (!(s.description || '').trim()) return;   // nothing for the writer to work from
      jobsFor(s, im, vm, roles).forEach(function (j) { j.shot = s; jobs.push(j); });
    });
    if (!jobs.length) {
      return Promise.reject(new Error('Nothing to generate — “no shot” cards and empty descriptions are skipped.'));
    }

    let done = 0, failed = 0, lastError = null;
    const total = jobs.length;
    const tick = function () { if (opts.onProgress) opts.onProgress(done, total, failed); };
    tick();

    const queue = jobs.slice();
    let stopped = false;
    function worker() {
      if (stopped) return Promise.resolve();
      const j = queue.shift();
      if (!j) return Promise.resolve();
      return callGemini(j.text, j.keys, j.system).then(function (res) {
        return enforceNeutral(j, res);
      }).then(function (out) {
        j.targets.forEach(function (t) {
          store(j.shot, t.model, t.field, out.res[t.field], out.flags[t.field]);
        });
        done++;
      }).catch(function (e) {
        failed++;
        lastError = e;
        console.error('[storyboarder] prompt failed', e);
        /* Blocked at the network: every remaining job would fail the same way.
         * Stop, so one wall costs one failed request and one message. */
        if (SB.netKind(e)) { stopped = true; queue.length = 0; return; }
        if (failed === 1) SB.toast(e.message, true);
      }).then(function () { tick(); return worker(); });
    }

    /* The first job goes alone. Three lanes opening at once would put three
     * doomed requests on the wire before the first rejection came back, so the
     * canary proves the network is there before the rest follow. */
    return worker().then(function () {
      if (stopped || !queue.length) return;
      const lanes = [];
      for (let i = 0; i < Math.min(2, queue.length); i++) lanes.push(worker());
      return Promise.all(lanes);
    }).then(function () {
      SB.app.changed(true);
      /* Nothing written at all is a failure, not a result — say why. */
      if (!done && lastError) throw lastError;
      return {
        done: done, failed: failed, total: total,
        error: lastError ? lastError.message : null
      };
    });
  }

  function allShots() {
    const all = [];
    SB.Model.eachShot(P(), function (sh) { all.push(sh); });
    return all;
  }

  function sceneShots(sceneId) {
    const f = SB.Model.findScene(P(), sceneId);
    return f ? f.scene.shots.slice() : [];
  }

  SB.Prompts = {
    generateFor: generateFor, allShots: allShots, sceneShots: sceneShots,
    jobsFor: jobsFor, fill: fill, raw: ask
  };

})(window.SB);
