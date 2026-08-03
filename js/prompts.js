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
    return {
      MODEL: '',
      CODE: f ? f.code : '',
      SHOT_TYPE: shot.type || 'unspecified',
      SCENE: f ? (f.scene.heading || '') : '',
      SCENE_DESC: f ? (f.scene.description || '') : '',
      SCRIPT: w.doc.text.slice(w.from, w.to),
      DESCRIPTION: shot.description || ''
    };
  }

  const PREAMBLE = 'You write prompts for generative media models. Follow the instruction ' +
    'block(s) below exactly. Return the prompts themselves only — no commentary, no markdown fences.\n\n';

  function imageBlock(shot, m) {
    const ctx = contextFor(shot); ctx.MODEL = m.name;
    return '=== FIRST-FRAME IMAGE PROMPT — INSTRUCTIONS ===\n' + fill(m.imageTemplate, ctx) + '\n';
  }
  function videoBlock(shot, m) {
    const ctx = contextFor(shot); ctx.MODEL = m.name;
    return '=== IMAGE-TO-VIDEO PROMPT — INSTRUCTIONS ===\n' + fill(m.videoTemplate, ctx) + '\n';
  }

  /* Build the request list for one shot given the selected roles. */
  function jobsFor(shot, im, vm, roles) {
    const jobs = [];
    const wantI = roles.image && im, wantV = roles.video && vm;
    if (wantI && wantV && im.id === vm.id) {
      jobs.push({
        text: PREAMBLE + 'Return JSON with the keys "imagePrompt" and "videoPrompt".\n\n' +
          imageBlock(shot, im) + '\n' + videoBlock(shot, vm),
        keys: ['imagePrompt', 'videoPrompt'],
        targets: [{ model: im, field: 'imagePrompt' }, { model: vm, field: 'videoPrompt' }]
      });
      return jobs;
    }
    if (wantI) {
      jobs.push({
        text: PREAMBLE + 'Return JSON with the key "imagePrompt".\n\n' + imageBlock(shot, im),
        keys: ['imagePrompt'],
        targets: [{ model: im, field: 'imagePrompt' }]
      });
    }
    if (wantV) {
      jobs.push({
        text: PREAMBLE + 'Return JSON with the key "videoPrompt".\n\n' + videoBlock(shot, vm),
        keys: ['videoPrompt'],
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
    }).then(function (r) {
      return r.text().then(function (t) {
        if (!r.ok) {
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

  const NO_SCHEMA_HINT =
    '\n\nReply with ONLY the JSON object — start with { and end with }, no markdown fences.';

  function callGemini(text, keys) {
    const key = SB.Store.getApiKey();
    if (!key) return Promise.reject(new Error('No Google API key. Add one in Settings → API.'));
    const mdl = P().settings.geminiModel || SB.GeminiModels.DEFAULT;
    const props = {};
    keys.forEach(function (k) { props[k] = { type: 'STRING' }; });

    function build(withSchema) {
      const gen = { temperature: 0.8 };
      if (withSchema) {
        gen.responseMimeType = 'application/json';
        gen.responseSchema = { type: 'OBJECT', properties: props, required: keys };
      }
      return {
        contents: [{ role: 'user', parts: [{ text: withSchema ? text : text + NO_SCHEMA_HINT }] }],
        generationConfig: gen
      };
    }

    /* Gemma runs on the same endpoint but has no JSON mode — ask it in words.
     * Any other model that rejects the schema gets the same treatment on retry. */
    const useSchema = !SB.GeminiModels.isGemma(mdl);

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
        const m = raw.match(/\{[\s\S]*\}/);
        if (!m) throw new Error('Could not parse the Gemini response');
        return JSON.parse(m[0]);
      }
    });
  }

  function store(shot, model, field, value) {
    const cur = shot.prompts[model.id] || { imagePrompt: '', videoPrompt: '' };
    cur[field] = value || '';
    cur.modelName = model.name;
    cur.at = Date.now();
    shot.prompts[model.id] = cur;
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

    const jobs = [];
    shots.forEach(function (s) {
      if (s.noShot) return;                        // "no shot" fragments never generate
      if (!(s.description || '').trim()) return;   // nothing for the writer to work from
      jobsFor(s, im, vm, roles).forEach(function (j) { j.shot = s; jobs.push(j); });
    });
    if (!jobs.length) {
      return Promise.reject(new Error('Nothing to generate — “no shot” cards and empty descriptions are skipped.'));
    }

    let done = 0, failed = 0;
    const total = jobs.length;
    const tick = function () { if (opts.onProgress) opts.onProgress(done, total, failed); };
    tick();

    const queue = jobs.slice();
    function worker() {
      const j = queue.shift();
      if (!j) return Promise.resolve();
      return callGemini(j.text, j.keys).then(function (res) {
        j.targets.forEach(function (t) { store(j.shot, t.model, t.field, res[t.field]); });
        done++;
      }).catch(function (e) {
        failed++;
        console.error('[storyboarder] prompt failed', e);
        if (failed === 1) SB.toast(e.message, true);
      }).then(function () { tick(); return worker(); });
    }
    const lanes = [];
    for (let i = 0; i < Math.min(3, jobs.length); i++) lanes.push(worker());
    return Promise.all(lanes).then(function () {
      SB.app.changed(true);
      return { done: done, failed: failed, total: total };
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
    jobsFor: jobsFor, fill: fill
  };

})(window.SB);
