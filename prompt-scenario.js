/* prompt-scenario.js — driven by test-prompts.mjs against the stubbed endpoint. */
(function () {
  const out = [];
  const t = function (name, cond, extra) {
    out.push((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' :: ' + extra));
  };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const SB = window.SB;
  const P = () => SB.app.project;
  const MARK = 'RES' + 'ULT';

  function seed() {
    const p = P();
    p.name = 'Prompt check';
    SB.Model.applyMasterEdit(p, 0, 0, 'Wide of the office floor. The subject turns to camera.', null);
    const sc = p.scenes[0];
    sc.heading = 'Opening';
    sc.description = 'Client office, late morning.';
    sc.shots = [];
    const a = SB.Model.addShot(p, sc.id, { type: 'Wide', link: { from: 0, to: 25 } });
    a.description = 'Open-plan office, the subject mid-stride toward camera.';
    const b = SB.Model.addShot(p, sc.id, { type: 'Close-up', link: { from: 26, to: 53 } });
    b.description = 'Hands settling on a laptop.';
    SB.app.changed(true);
    return { a: a, b: b };
  }

  setTimeout(async function () {
    try {
      const shots = seed();
      SB.Store.setApiKey('AIza-test-key');

      /* ---------- the plain case: one image prompt for one shot ---------- */
      window.__calls = [];
      let err = '';
      const res = await SB.Prompts.generateFor([shots.a], { roles: { image: true } })
        .catch(function (e) { err = e.message || String(e); return null; });

      t('an image prompt can be generated', !!res && res.done === 1 && !err,
        err || JSON.stringify(res));
      t('exactly one request went out', window.__calls.length === 1, window.__calls.length);

      const im = SB.Model.imageModel(P());
      const stored = shots.a.prompts[im.id];
      t('the prompt is stored against the image model', !!stored && !!stored.imagePrompt,
        JSON.stringify(shots.a.prompts));
      t('and no video prompt was invented', !stored.videoPrompt, stored && stored.videoPrompt);

      const call = window.__calls[0];
      t('it went to the chosen writer model',
        call.url.indexOf(P().settings.geminiModel) > 0, call.url.split('/').pop());
      t('the key is on the request', /key=AIza-test-key/.test(call.url), '');
      const userText = call.body.contents[0].parts[0].text;
      t('the shot description is in the request',
        userText.indexOf('the subject mid-stride') > 0, userText.slice(0, 120));
      t('the target model is named', userText.indexOf(im.name) > 0, im.name);
      t('a JSON schema is asked for',
        !!call.body.generationConfig.responseSchema &&
        call.body.generationConfig.responseSchema.required.join() === 'imagePrompt',
        JSON.stringify(call.body.generationConfig.responseSchema));
      const sys = call.body.systemInstruction &&
        call.body.systemInstruction.parts[0].text;
      t('the house style rides along', !!sys && /HOUSE STYLE/.test(sys), String(sys).slice(0, 80));
      t('so does the scene context', !!sys && /SCENE CONTEXT/.test(sys), '');
      t('no motion rules on an image-only job', !!sys && !/MOTION/.test(sys), '');

      /* ---------- card fields travel ---------- */
      SB.Fields.find(P(), 'artDirection').enabled = true;
      SB.Fields.set(shots.a, 'artDirection', 'Warm practicals only.');
      window.__calls = [];
      await SB.Prompts.generateFor([shots.a], { roles: { image: true } });
      t('an enabled card field reaches the request',
        window.__calls[0].contents === undefined &&
        window.__calls[0].body.contents[0].parts[0].text.indexOf('Warm practicals only.') > 0,
        window.__calls[0].body.contents[0].parts[0].text.slice(-160));

      /* ---------- cast ---------- */
      const per = SB.Personas.add(P(), { name: 'Ops lead', description: 'Charcoal knit.' });
      per.image = SB.Blobs.image(P(), 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', 4, 3);
      shots.a.personaIds = [per.id];
      window.__calls = [];
      await SB.Prompts.generateFor([shots.a], { roles: { image: true } });
      const sys2 = window.__calls[0].body.systemInstruction.parts[0].text;
      t('the cast reaches the request', /CAST/.test(sys2) && /Ops lead/.test(sys2), '');
      t('with the reference-image numbering', /image 1 = Ops lead/.test(sys2), '');

      /* ---------- both prompts, one model, one call ---------- */
      P().settings.videoModelId = P().settings.imageModelId;
      window.__calls = [];
      await SB.Prompts.generateFor([shots.b], { roles: { image: true, video: true } });
      t('one model for both prompts means one call', window.__calls.length === 1,
        window.__calls.length);
      t('and both come back stored',
        !!shots.b.prompts[im.id].imagePrompt && !!shots.b.prompts[im.id].videoPrompt, '');
      t('the motion rules are included then',
        /MOTION/.test(window.__calls[0].body.systemInstruction.parts[0].text), '');

      /* ---------- gemma: no schema, no systemInstruction ---------- */
      P().settings.geminiModel = 'gemma-4-31b-it';
      window.__calls = [];
      await SB.Prompts.generateFor([shots.a], { roles: { image: true } });
      const g = window.__calls[0];
      t('gemma is sent no response schema',
        !g.body.generationConfig.responseSchema, JSON.stringify(g.body.generationConfig));
      t('gemma is sent no systemInstruction', !g.body.systemInstruction, '');
      t('the house style is folded into gemma’s single turn',
        /HOUSE STYLE/.test(g.body.contents[0].parts[0].text), '');
      P().settings.geminiModel = SB.GeminiModels.DEFAULT;

      /* ---------- a model that rejects the schema is retried without it ---------- */
      window.__calls = [];
      window.__reply = function (n) {
        if (n === 1) {
          return { ok: false, status: 400, text: JSON.stringify(
            { error: { message: 'Invalid JSON payload: response_mime_type is not supported' } }) };
        }
        return null;
      };
      const r2 = await SB.Prompts.generateFor([shots.a], { roles: { image: true } })
        .catch(function (e) { return { done: 0, err: e.message }; });
      t('a schema rejection is retried without the schema',
        r2 && r2.done === 1 && window.__calls.length === 2,
        JSON.stringify(r2) + ' calls=' + window.__calls.length);
      t('the retry drops the schema',
        window.__calls.length === 2 && !window.__calls[1].body.generationConfig.responseSchema, '');
      window.__reply = null;

      /* ---------- gendered language is rewritten, then flagged ---------- */
      window.__calls = [];
      window.__reply = function (n) {
        return { ok: true, status: 200, text: JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify({
            imagePrompt: n === 1
              ? 'A businessman adjusts his tie by the window.'
              : 'The subject adjusts a collar by the window.' }) }] } }] }) };
      };
      await SB.Prompts.generateFor([shots.a], { roles: { image: true } });
      t('a gendered draft triggers one rewrite', window.__calls.length === 2,
        window.__calls.length);
      t('and the clean rewrite is what gets stored',
        shots.a.prompts[im.id].imagePrompt.indexOf('businessman') < 0,
        shots.a.prompts[im.id].imagePrompt);
      t('the rewrite request names the offending words',
        /businessman/.test(window.__calls[1].body.contents[0].parts[0].text), '');
      t('nothing is flagged when the rewrite works',
        !(shots.a.prompts[im.id].flagged || {}).imagePrompt, '');

      window.__calls = [];
      window.__reply = function () {
        return { ok: true, status: 200, text: JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify({
            imagePrompt: 'He stands by the window.' }) }] } }] }) };
      };
      await SB.Prompts.generateFor([shots.a], { roles: { image: true } });
      t('a draft that stays gendered is flagged for the user',
        (shots.a.prompts[im.id].flagged || {}).imagePrompt &&
        shots.a.prompts[im.id].flagged.imagePrompt.indexOf('he') >= 0,
        JSON.stringify(shots.a.prompts[im.id].flagged));
      window.__reply = null;

      /* ---------- the failure paths say what to do ---------- */
      window.__reply = function () {
        return { ok: false, status: 404, text: JSON.stringify(
          { error: { message: 'models/x is not found' } }) };
      };
      let msg404 = '';
      window.__calls = [];
      await SB.Prompts.generateFor([shots.b], { roles: { image: true } })
        .catch(function (e) { msg404 = e.message; });
      t('a run that writes nothing rejects rather than reporting success',
        !!msg404, 'it resolved quietly');
      t('a 404 tells you to refresh the model list', /refresh the model list/i.test(msg404), msg404);

      window.__reply = function () {
        return { ok: false, status: 429, text: JSON.stringify(
          { error: { message: 'Quota exceeded' } }) };
      };
      window.__calls = [];
      const before = SB.GeminiModels.count(P().settings.geminiModel);
      let msg429 = '';
      await SB.Prompts.generateFor([shots.b], { roles: { image: true } })
        .catch(function (e) { msg429 = e.message; });
      t('a 429 says which model ran out and what to do',
        /daily\/rate limit/i.test(msg429) && /Prompts panel/.test(msg429), msg429);
      t('a 429 marks the model spent for the day',
        SB.GeminiModels.count(P().settings.geminiModel) > before,
        before + ' -> ' + SB.GeminiModels.count(P().settings.geminiModel));
      window.__reply = null;

      /* ---------- refusals to start ---------- */
      SB.Store.setApiKey('');
      let noKey = '';
      await SB.Prompts.generateFor([shots.a], { roles: { image: true } })
        .catch(function (e) { noKey = e.message; });
      t('no key gives a clear message', /API key/i.test(noKey), noKey);
      SB.Store.setApiKey('AIza-test-key');

      let empty = '';
      const blank = SB.Model.addShot(P(), P().scenes[0].id, {});
      await SB.Prompts.generateFor([blank], { roles: { image: true } })
        .catch(function (e) { empty = e.message; });
      t('a shot with no description is skipped with a reason',
        /description/i.test(empty), empty);

      const ns = SB.Model.addShot(P(), P().scenes[0].id, {});
      ns.description = 'Something';
      ns.noShot = true;
      let noShot = '';
      await SB.Prompts.generateFor([ns], { roles: { image: true } })
        .catch(function (e) { noShot = e.message; });
      t('a “no shot” card is never generated for', /no shot/i.test(noShot), noShot);

      /* ---------- a 404 in the panel offers the models the key can reach ---------- */
      window.__reply = function (n, body) {
        return { ok: false, status: 404, text: JSON.stringify(
          { error: { message: 'models/gemini-3.6-flash is not found' } }) };
      };
      SB.PromptPanel.open();
      await wait(150);
      const genBtn = Array.prototype.filter.call(
        document.querySelectorAll('#promptBody .tb'),
        function (b) { return b.textContent === 'Generate'; })[0];
      /* ListModels answers even though generateContent 404s */
      const realFetch = window.fetch;
      window.fetch = function (url, opts) {
        if (String(url).indexOf('/models?') > 0) {
          return Promise.resolve({
            ok: true, status: 200,
            text: function () {
              return Promise.resolve(JSON.stringify({ models: [
                { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash',
                  supportedGenerationMethods: ['generateContent'] },
                { name: 'models/gemma-4-31b-it', displayName: 'Gemma 4 31B',
                  supportedGenerationMethods: ['generateContent'] }
              ] }));
            }
          });
        }
        return realFetch(url, opts);
      };
      genBtn.click();
      await wait(900);
      const status = document.querySelector('#promptBody .pp-status').textContent;
      t('a 404 sends the app to ask the key what it can reach',
        /not available to this key/.test(status) && /pick one/.test(status), status);
      const opts = document.querySelector('#promptBody .gm-picker select').options;
      t('and the picker is rebuilt from that answer',
        opts.length === 4 &&                     // 2 reachable + the current one + Custom…
        /gemini-2\.5-flash/.test(opts[1].value + opts[2].value),
        Array.prototype.map.call(opts, function (o) { return o.value; }).join(','));
      t('the unavailable model stays visible, marked as such',
        /not in list/.test(opts[0].textContent), opts[0].textContent);
      window.fetch = realFetch;
      window.__reply = null;
      SB.GeminiModels.clearCache();

      /* ---------- the request that never leaves the browser ---------- */
      {
        const realFetch2 = window.fetch;
        let tries = 0;

        // 1. fetch rejects outright — a CORS/proxy wall
        window.fetch = function () { tries++; return Promise.reject(new TypeError('Failed to fetch')); };
        let e1 = null;
        await SB.Prompts.generateFor([shots.a], { roles: { image: true } }).catch(function (e) { e1 = e; });
        t('a blocked request is recognised as one', !!e1 && e1.blocked === true,
          e1 && e1.message);
        t('and the message says how to fix it', !!e1 && /AI Studio/.test(e1.message),
          e1 && e1.message);
        t('“Failed to fetch” never reaches the user', !!e1 && !/failed to fetch/i.test(e1.message),
          e1 && e1.message);

        // 2. a whole board's worth of jobs still costs exactly one request
        const many = [];
        for (let i = 0; i < 6; i++) {
          const s = SB.Model.addShot(P(), P().scenes[0].id, {});
          s.description = 'beat number ' + i;
          many.push(s);
        }
        tries = 0;
        await SB.Prompts.generateFor(many, { roles: { image: true } }).catch(function () { });
        t('one wall costs one request, not one per job', tries === 1, tries);
        many.forEach(function (s) { SB.Model.deleteShot(P(), s.id); });

        // 3. an interception page answering with HTML where JSON was due
        window.fetch = function () {
          tries++;
          return Promise.resolve({
            ok: false, status: 403,
            text: function () { return Promise.resolve('<html><body>Access denied by policy</body></html>'); }
          });
        };
        let e2 = null;
        await SB.Prompts.generateFor([shots.a], { roles: { image: true } }).catch(function (e) { e2 = e; });
        t('an HTML interception page reads as blocked too', !!e2 && e2.blocked === true,
          e2 && e2.message);

        // 4. ...but a real 403 from Google still reports itself
        window.fetch = function () {
          tries++;
          return Promise.resolve({
            ok: false, status: 403,
            text: function () { return Promise.resolve(JSON.stringify({ error: { message: 'API key not valid' } })); }
          });
        };
        let e3 = null;
        await SB.Prompts.generateFor([shots.a], { roles: { image: true } }).catch(function (e) { e3 = e; });
        t('a genuine 403 is not mistaken for the network', !!e3 && !e3.blocked &&
          /API key not valid/.test(e3.message), e3 && e3.message);

        // 5. the whole loop through the Prompts panel: block -> dialog -> try again
        window.fetch = function () { return Promise.reject(new TypeError('Failed to fetch')); };
        const scopeSel = document.querySelector('#promptBody select');
        const genBtn2 = Array.prototype.filter.call(
          document.querySelectorAll('#promptBody .tb'),
          function (b) { return b.textContent === 'Generate'; })[0];
        genBtn2.click();
        await wait(300);

        const link = document.querySelector('.blocked-link');
        t('the dialog offers a way out', !!link, document.querySelectorAll('.modal h2').length);
        t('the link points at AI Studio',
          !!link && link.getAttribute('href') === 'https://aistudio.google.com/',
          link && link.getAttribute('href'));
        t('and opens in a new tab', !!link && link.getAttribute('target') === '_blank',
          link && link.getAttribute('target'));
        t('the panel points at the dialog rather than repeating it',
          /blocked/.test(document.querySelector('#promptBody .pp-status').textContent),
          document.querySelector('#promptBody .pp-status').textContent);

        // accept happens in the other tab; here the network simply works again
        window.fetch = realFetch2;
        window.__reply = null;
        window.__calls = [];
        const tryAgain = Array.prototype.filter.call(
          document.querySelectorAll('.modal .foot .tb'),
          function (b) { return b.textContent === 'Try again'; })[0];
        t('try again is offered', !!tryAgain, '');
        tryAgain.click();
        await wait(600);
        t('the dialog closes when it is used', !document.querySelector('.blocked-link'), '');
        t('try again re-runs the thing that failed',
          /done —/.test(document.querySelector('#promptBody .pp-status').textContent) &&
          window.__calls.length > 0,
          document.querySelector('#promptBody .pp-status').textContent + ' / ' + window.__calls.length);
        if (scopeSel) scopeSel.value = 'project';
      }

      /* ---------- MiniMax H3 gets its own published prompt format ---------- */
      {
        const h3 = P().settings.models.filter(function (m) {
          return m.name === 'MiniMax H3 (Hailuo)'; })[0];
        t('the MiniMax model ships as H3', !!h3,
          P().settings.models.map(function (m) { return m.name; }).join(','));
        const six = ['subject_definitions', 'summary', 'retention_analysis',
          'detailed_description', 'overall_soundscape', 'non_diegetic_music'];
        t('its video template asks for the six-section rewrite',
          !!h3 && six.every(function (k) { return h3.videoTemplate.indexOf(k) >= 0; }),
          h3 && h3.videoTemplate.slice(0, 60));
        t('and it carries the reference labels',
          !!h3 && /<Subject N>/.test(h3.videoTemplate) && /<Picture 1>/.test(h3.videoTemplate),
          h3 && h3.videoTemplate.slice(0, 60));
        t('its persona wording is the H3 one, not the generic numbered line',
          !!h3 && /<Subject N>/.test(h3.referenceTemplate),
          h3 && h3.referenceTemplate);

        P().settings.videoModelId = h3.id;
        window.__calls = [];
        await SB.Prompts.generateFor([shots.a], { roles: { video: true } });
        const sent = JSON.stringify(window.__calls[0].body);
        t('the format reaches the request', sent.indexOf('retention_analysis') > 0,
          sent.slice(0, 80));
      }

      /* ---------- and an existing board is carried over to it ---------- */
      {
        const old1 = { id: 'm_old1', name: 'Hailuo (MiniMax)', kind: 'video',
          imageTemplate: SB.Model.IMG_TPL, videoTemplate: SB.Model.VID_TPL,
          referenceTemplate: SB.Personas.DEFAULT_REF_TEMPLATE };
        const old2 = { id: 'm_old2', name: 'Hailuo (MiniMax)', kind: 'video',
          imageTemplate: SB.Model.IMG_TPL, videoTemplate: 'my own wording',
          referenceTemplate: 'mine too' };
        const proj = { name: 'old', master: SB.Doc.make(''), scenes: [],
          settings: { models: [old1, old2], modelSeeds: ['Hailuo (MiniMax)'] } };
        SB.Model.migrate(proj);
        t('a legacy MiniMax entry is renamed', old1.name === 'MiniMax H3 (Hailuo)', old1.name);
        t('and picks up the H3 template',
          old1.videoTemplate.indexOf('retention_analysis') > 0, old1.videoTemplate.slice(0, 40));
        t('an edited template is left alone', old2.videoTemplate === 'my own wording' &&
          old2.referenceTemplate === 'mine too', old2.videoTemplate);
        t('the seed list follows the rename, so H3 is not added twice',
          proj.settings.models.filter(function (m) {
            return /MiniMax/.test(m.name); }).length === 2,
          proj.settings.models.map(function (m) { return m.name; }).join(','));
      }

      t('no page errors', (window.__err || []).length === 0, JSON.stringify(window.__err));
    } catch (e) {
      out.push('FAIL exception :: ' + (e && e.stack || e));
    }
    document.getElementById('toastRoot').textContent = MARK + '>>' + out.join(' | ') + '<<' + MARK;
  }, 500);
})();
