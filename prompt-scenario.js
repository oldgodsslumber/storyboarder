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
      const res = await SB.Prompts.generateFor(shots.a, { image: true })
        .catch(function (e) { err = e.message || String(e); return null; });

      t('an image prompt can be generated',
        !!res && res.written.join() === 'imagePrompt' && !err,
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
      await SB.Prompts.generateFor(shots.a, { image: true });
      t('an enabled card field reaches the request',
        window.__calls[0].contents === undefined &&
        window.__calls[0].body.contents[0].parts[0].text.indexOf('Warm practicals only.') > 0,
        window.__calls[0].body.contents[0].parts[0].text.slice(-160));

      /* ---------- cast ---------- */
      const per = SB.Personas.add(P(), { name: 'Ops lead', description: 'Charcoal knit.' });
      per.image = SB.Blobs.image(P(), 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', 4, 3);
      shots.a.personaIds = [per.id];
      window.__calls = [];
      await SB.Prompts.generateFor(shots.a, { image: true });
      const sys2 = window.__calls[0].body.systemInstruction.parts[0].text;
      t('the cast reaches the request', /CAST/.test(sys2) && /Ops lead/.test(sys2), '');
      t('with the reference-image numbering', /image 1 = Ops lead/.test(sys2), '');

      /* ---------- a gender nobody cast ---------- */
      {
        const guessed = 'A businessman leans over the desk, his sleeve catching the lamp.';
        const neutral = 'A figure leans over the desk, one sleeve catching the lamp.';
        window.__calls = [];
        window.__reply = function (n) {
          return { ok: true, status: 200, text: JSON.stringify({ candidates: [{ content: {
            parts: [{ text: JSON.stringify({ imagePrompt: n === 1 ? guessed : neutral }) }] } }] }) };
        };
        shots.b.description = 'Someone leans over the desk in the dark.';
        shots.b.personaIds = [];
        await SB.Prompts.generateFor(shots.b, { image: true });
        t('a gender the board never cast buys one corrective call',
          window.__calls.length === 2, window.__calls.length);
        const ask = window.__calls[1].body.contents[0].parts[0].text;
        t('and the correction names the words',
          /decided someone/.test(ask) && /businessman/.test(ask), ask.slice(-200));
        const imId = P().settings.imageModelId;
        t('the neutral rewrite is what gets stored',
          shots.b.prompts[imId].imagePrompt === neutral, shots.b.prompts[imId].imagePrompt);
        t('and nothing is flagged', !shots.b.prompts[imId].gendered, '');

        /* the cast is the authority: with her cast, her pronouns cost nothing */
        const nat = SB.Personas.add(P(), {
          name: 'Nat', description: 'A woman in her forties, charcoal knit.'
        });
        shots.b.personaIds = [nat.id];
        window.__calls = [];
        window.__reply = function () {
          return { ok: true, status: 200, text: JSON.stringify({ candidates: [{ content: {
            parts: [{ text: JSON.stringify({
              imagePrompt: 'Nat leans over the desk, her sleeve catching the lamp.'
            }) }] } }] }) };
        };
        await SB.Prompts.generateFor(shots.b, { image: true });
        t('a cast persona\u2019s own pronouns cost no second call',
          window.__calls.length === 1, window.__calls.length);
        t('and are never flagged', !shots.b.prompts[imId].gendered, '');

        /* one that will not let go */
        window.__calls = [];
        shots.b.personaIds = [];
        window.__reply = function () {
          return { ok: true, status: 200, text: JSON.stringify({ candidates: [{ content: {
            parts: [{ text: JSON.stringify({ imagePrompt: guessed }) }] } }] }) };
        };
        await SB.Prompts.generateFor(shots.b, { image: true });
        t('a guess that survives the rewrite is kept, not thrown away',
          shots.b.prompts[imId].imagePrompt === guessed, shots.b.prompts[imId].imagePrompt);
        t('and the prompt is flagged with the words it chose',
          Array.isArray(shots.b.prompts[imId].gendered) &&
          shots.b.prompts[imId].gendered.indexOf('businessman') >= 0,
          JSON.stringify(shots.b.prompts[imId].gendered));

        window.__reply = null;
        shots.b.personaIds = [];
        shots.b.description = 'A desk in the dark.';
      }

      /* ---------- a camera move nobody asked for ---------- */
      {
        const moved = 'The camera pushes in slowly on her hands as she lets go of the cup.';
        const clean = 'Her hands loosen around the cup and settle flat on the table.';

        /* first answer moves the camera, second one does not */
        window.__calls = [];
        window.__reply = function (n) {
          return { ok: true, status: 200, text: JSON.stringify({ candidates: [{ content: {
            parts: [{ text: JSON.stringify({ videoPrompt: n === 1 ? moved : clean }) }] } }] }) };
        };
        shots.a.description = 'Her hands shake around the cup.';
        P().settings.videoModelId = P().settings.models.filter(function (m) {
          return m.kind === 'video';
        })[0].id;
        await SB.Prompts.generateFor(shots.a, { video: true });
        t('a camera move nobody asked for buys one corrective call',
          window.__calls.length === 2, window.__calls.length);
        const ask = window.__calls[1].body.contents[0].parts[0].text;
        t('and the correction names the words it found',
          /You moved the camera/.test(ask) && /camera pushes/i.test(ask), ask.slice(-220));
        const vmId = P().settings.videoModelId;
        t('the rewritten prompt is what gets stored',
          shots.a.prompts[vmId].videoPrompt === clean, shots.a.prompts[vmId].videoPrompt);
        t('and nothing is flagged, because nothing survived',
          !shots.a.prompts[vmId].moved, JSON.stringify(shots.a.prompts[vmId].moved));

        /* a writer that will not let go of it */
        window.__calls = [];
        window.__reply = function () {
          return { ok: true, status: 200, text: JSON.stringify({ candidates: [{ content: {
            parts: [{ text: JSON.stringify({ videoPrompt: moved }) }] } }] }) };
        };
        await SB.Prompts.generateFor(shots.a, { video: true });
        t('a move that survives the rewrite is kept, not thrown away',
          shots.a.prompts[vmId].videoPrompt === moved, shots.a.prompts[vmId].videoPrompt);
        t('and the prompt is flagged with the words that did it',
          Array.isArray(shots.a.prompts[vmId].moved) &&
          /camera pushes/i.test(shots.a.prompts[vmId].moved.join(' ')),
          JSON.stringify(shots.a.prompts[vmId].moved));

        /* asked for in the description: no correction, no flag */
        window.__calls = [];
        shots.a.description = 'Slow push in on her hands as she lets go of the cup.';
        await SB.Prompts.generateFor(shots.a, { video: true });
        t('a move the description asked for costs no second call',
          window.__calls.length === 1, window.__calls.length);
        t('and is not flagged',
          !shots.a.prompts[vmId].moved, JSON.stringify(shots.a.prompts[vmId].moved));

        window.__reply = null;
        shots.a.description = 'She sets the cup down.';
      }

      /* ---------- both prompts, one model, one call ---------- */
      P().settings.videoModelId = P().settings.imageModelId;
      window.__calls = [];
      await SB.Prompts.generateFor(shots.b, { image: true, video: true });
      t('one model for both prompts means one call', window.__calls.length === 1,
        window.__calls.length);
      t('and both come back stored',
        !!shots.b.prompts[im.id].imagePrompt && !!shots.b.prompts[im.id].videoPrompt, '');
      t('the motion rules are included then',
        /MOTION/.test(window.__calls[0].body.systemInstruction.parts[0].text), '');

      /* ---------- gemma: no schema, no systemInstruction ---------- */
      P().settings.geminiModel = 'gemma-4-31b-it';
      window.__calls = [];
      await SB.Prompts.generateFor(shots.a, { image: true });
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
      const r2 = await SB.Prompts.generateFor(shots.a, { image: true })
        .catch(function (e) { return { written: [], err: e.message }; });
      t('a schema rejection is retried without the schema',
        r2 && r2.written.length === 1 && window.__calls.length === 2,
        JSON.stringify(r2) + ' calls=' + window.__calls.length);
      t('the retry drops the schema',
        window.__calls.length === 2 && !window.__calls[1].body.generationConfig.responseSchema, '');
      window.__reply = null;

      /* ---------- a cast woman is written as a woman ----------
         The app used to scan every draft for gendered words and spend a second
         call rewriting them out, whoever they were about. It neutered the
         descriptions the reference frames are generated from, and a model
         handed a genderless person draws a man. The scan is back, but the cast
         is the authority — so this, the case that broke it, must cost nothing
         and must be stored exactly as the writer put it. */
      const her = SB.Personas.add(P(), {
        name: 'Dana', description: 'A businesswoman in her fifties, navy coat.'
      });
      shots.a.personaIds = [her.id];
      window.__calls = [];
      window.__reply = function () {
        return { ok: true, status: 200, text: JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify({
            imagePrompt: 'A businesswoman adjusts her collar by the window.' }) }] } }] }) };
      };
      await SB.Prompts.generateFor(shots.a, { image: true });
      t('a prompt naming a cast woman costs one call, not two', window.__calls.length === 1,
        window.__calls.length);
      t('and it is stored exactly as written',
        shots.a.prompts[im.id].imagePrompt.indexOf('businesswoman') >= 0,
        shots.a.prompts[im.id].imagePrompt);
      t('nothing is flagged, because the board cast her',
        !shots.a.prompts[im.id].gendered,
        JSON.stringify(shots.a.prompts[im.id].gendered || null));
      /* "Diversity across age, gender presentation…" is a casting note and
         stays; what had to go is the instruction never to say so at all. */
      const gsys = SB.Brand.systemFor(SB.app.project, shots.a, 'image');
      t('and nothing in the system message forbids saying who she is',
        !/no gender references|avoid gendered|never use gendered/i.test(gsys) &&
        /Never neutralise a person the board has cast/.test(gsys), '');
      shots.a.personaIds = [];
      window.__reply = null;

      /* ---------- the failure paths say what to do ---------- */
      window.__reply = function () {
        return { ok: false, status: 404, text: JSON.stringify(
          { error: { message: 'models/x is not found' } }) };
      };
      let msg404 = '';
      window.__calls = [];
      await SB.Prompts.generateFor(shots.b, { image: true })
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
      await SB.Prompts.generateFor(shots.b, { image: true })
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
      await SB.Prompts.generateFor(shots.a, { image: true })
        .catch(function (e) { noKey = e.message; });
      t('no key gives a clear message', /API key/i.test(noKey), noKey);
      SB.Store.setApiKey('AIza-test-key');

      let empty = '';
      const blank = SB.Model.addShot(P(), P().scenes[0].id, {});
      await SB.Prompts.generateFor(blank, { image: true })
        .catch(function (e) { empty = e.message; });
      t('a shot with no description is skipped with a reason',
        /description/i.test(empty), empty);

      const ns = SB.Model.addShot(P(), P().scenes[0].id, {});
      ns.description = 'Something';
      ns.noShot = true;
      let noShot = '';
      await SB.Prompts.generateFor(ns, { image: true })
        .catch(function (e) { noShot = e.message; });
      t('a “no shot” card is never generated for', /no shot/i.test(noShot), noShot);

      /* ---------- a 404 in the panel offers the models the key can reach ---------- */
      window.__reply = function (n, body) {
        return { ok: false, status: 404, text: JSON.stringify(
          { error: { message: 'models/gemini-3.6-flash is not found' } }) };
      };
      SB.PromptPanel.open();
      await wait(150);
      /* prompts are written one shot at a time, so the recovery lives on a
         row's own button — there is no bulk run to carry it any more */
      const genBtn = Array.prototype.filter.call(
        document.querySelectorAll('.pt-row .pt-foot .mini.primary'),
        function (b) { return !b.disabled; })[0];
      t('a row offers its own generate', !!genBtn,
        document.querySelectorAll('.pt-row').length + ' rows');
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
      const status = document.querySelector('.lib-head .pt-status').textContent;
      t('a 404 sends the app to ask the key what it can reach',
        /not available to this key/.test(status) && /pick one/.test(status), status);
      const opts = document.querySelector('.lib-head .gm-picker select').options;
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
        await SB.Prompts.generateFor(shots.a, { image: true }).catch(function (e) { e1 = e; });
        t('a blocked request is recognised as one', !!e1 && e1.blocked === true,
          e1 && e1.message);
        t('and the message says how to fix it', !!e1 && /AI Studio/.test(e1.message),
          e1 && e1.message);
        t('“Failed to fetch” never reaches the user', !!e1 && !/failed to fetch/i.test(e1.message),
          e1 && e1.message);

        // 2. a shot needing two prompts from two models is two jobs, and a wall
        //    that stops the first has to stop the second
        tries = 0;
        await SB.Prompts.generateFor(shots.b, { image: true, video: true })
          .catch(function () { });
        t('one wall costs one request, not one per job', tries === 1, tries);

        // 3. an interception page answering with HTML where JSON was due
        window.fetch = function () {
          tries++;
          return Promise.resolve({
            ok: false, status: 403,
            text: function () { return Promise.resolve('<html><body>Access denied by policy</body></html>'); }
          });
        };
        let e2 = null;
        await SB.Prompts.generateFor(shots.a, { image: true }).catch(function (e) { e2 = e; });
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
        await SB.Prompts.generateFor(shots.a, { image: true }).catch(function (e) { e3 = e; });
        t('a genuine 403 is not mistaken for the network', !!e3 && !e3.blocked &&
          /API key not valid/.test(e3.message), e3 && e3.message);

        // 5. the whole loop through the Prompts panel: block -> dialog -> try again
        window.fetch = function () { return Promise.reject(new TypeError('Failed to fetch')); };
        const genBtn2 = Array.prototype.filter.call(
          document.querySelectorAll('.pt-row .pt-foot .mini.primary'),
          function (b) { return !b.disabled; })[0];
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
          /blocked/.test(document.querySelector('.lib-head .pt-status').textContent),
          document.querySelector('.lib-head .pt-status').textContent);

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
        /* a row that succeeds says nothing — the prompt appearing in its box is
           the result. What matters is that the request went out again and the
           status is no longer reporting a wall. */
        const againStatus = document.querySelector('.lib-head .pt-status');
        t('try again re-runs the thing that failed',
          window.__calls.length > 0 && !/blocked/.test(againStatus.textContent),
          againStatus.textContent + ' / ' + window.__calls.length);
      }

      /* ---------- MiniMax H3 gets its own published prompt format ---------- */
      {
        const h3 = P().settings.models.filter(function (m) {
          return m.name === 'MiniMax H3 (Hailuo)'; })[0];
        t('the MiniMax model ships as H3', !!h3,
          P().settings.models.map(function (m) { return m.name; }).join(','));
        t('its video template asks only for the two prose sections',
          !!h3 && /"summary"/.test(h3.videoTemplate) &&
          /"detailed_description"/.test(h3.videoTemplate) &&
          h3.videoTemplate.indexOf('overall_soundscape') < 0,
          h3 && h3.videoTemplate.slice(0, 60));
        t('and it hands over a fixed label table',
          !!h3 && /\{\{H3_LABELS\}\}/.test(h3.videoTemplate) &&
          /never invent a <Subject N>/.test(h3.videoTemplate),
          h3 && h3.videoTemplate.slice(0, 60));
        t('its persona wording points at the assigned labels',
          !!h3 && /<Picture N>/.test(h3.referenceTemplate),
          h3 && h3.referenceTemplate);

        /* a cast with pictures, and a first frame to open on */
        const png = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
        const lead = SB.Personas.add(P(), { name: 'Ops lead',
          description: 'Charcoal knit, cropped hair.' });
        SB.Personas.setImage(lead, SB.Blobs.image(P(), png, 270, 480), 'front');
        const tech = SB.Personas.add(P(), { name: 'Technician',
          description: 'Navy work shirt.' });
        SB.Personas.setImage(tech, SB.Blobs.image(P(), png, 854, 480), 'front');
        shots.a.personaIds = [lead.id, tech.id];
        SB.Personas.setEnters(shots.a, tech.id, true);
        shots.a.image = SB.Blobs.image(P(), png, 854, 480);

        const sc = SB.H3.scaffold(P(), shots.a);
        t('the first frame is <Picture 1>', /<Picture 1> is the first frame/.test(sc.definitions),
          sc.definitions.split('\n')[0]);
        t('each subject gets one label and one picture',
          sc.subjects.length === 2 && sc.subjects[0].pictures.length === 1,
          JSON.stringify(sc.subjects.map(function (x) { return x.pictures.length; })));
        t('and cites the picture that defines it',
          /<Subject 1> is Ops lead, seen in <Picture 2>: Charcoal knit/.test(sc.definitions),
          sc.definitions);
        t('retention_analysis is written from the board, not asked for',
          /<Subject 1> \(appears in \[Shot 1\]\): fully_preserved/.test(sc.retention) &&
          /<Picture 1> \(appears in \[Shot 1\]\): fully_preserved/.test(sc.retention),
          sc.retention);
        t('the task type is computed from what is actually supplied',
          sc.taskTypes.join(' + ') === 'keyframe completion + reference generation',
          sc.taskTypes.join(' + '));
        t('somebody arriving mid-shot is marked in the label table',
          /<Subject 2> = Technician[\s\S]*ARRIVES DURING THE SHOT/.test(sc.labels), sc.labels);

        P().settings.videoModelId = h3.id;
        window.__calls = [];
        window.__reply = function () {
          return { ok: true, status: 200, text: JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify({
              summary: '[keyframe completion + reference generation] <Subject 1> walks toward ' +
                'camera as <Subject 2> arrives.',
              detailed_description: 'Documentary realism, warm daylight. [Shot 1] The shot ' +
                'begins from <Picture 1>. ' + 'word '.repeat(200) }) }] } }] }) };
        };
        await SB.Prompts.generateFor(shots.a, { video: true });
        t('one call writes the whole H3 prompt', window.__calls.length === 1,
          window.__calls.length);
        const sent = window.__calls[0].body.contents[0].parts[0].text;
        t('the label table reaches the request', sent.indexOf('<Subject 1> = Ops lead') > 0,
          sent.slice(0, 120));
        t('and so does the script the shot covers',
          sent.indexOf('Wide of the office floor') > 0, '');
        t('the writer is asked for two keys, not six',
          window.__calls[0].body.generationConfig.responseSchema.required.join() ===
          'summary,detailed_description',
          JSON.stringify(window.__calls[0].body.generationConfig.responseSchema.required));

        const built = shots.a.prompts[h3.id].videoPrompt;
        const six = ['subject_definitions', 'summary', 'retention_analysis',
          'detailed_description', 'overall_soundscape', 'non_diegetic_music'];
        let order = true, at = -1;
        six.forEach(function (k) {
          const n = built.indexOf(k + ':');
          if (n <= at) order = false;
          at = n;
        });
        t('the stored prompt is all six sections in order', order, built.slice(0, 200));
        t('with the scaffold sewn in, not a guess at it',
          built.indexOf('<Subject 1> is Ops lead') > 0 &&
          built.indexOf('fully_preserved') > 0, built.slice(0, 200));
        t('and silence written into both sound sections',
          /overall_soundscape:\nN\/A - the target video has no audio\./.test(built) &&
          /non_diegetic_music:\nN\/A/.test(built), built.slice(-120));

        /* a label nobody defined is the one failure worth another call */
        window.__calls = [];
        let nth = 0;
        window.__reply = function () {
          nth++;
          return { ok: true, status: 200, text: JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify({
              summary: '[keyframe completion + reference generation] a summary.',
              detailed_description: 'Style sentence. [Shot 1] The shot begins from <Picture 1>. ' +
                (nth === 1 ? '<Subject 7> appears. ' : '<Subject 2> appears. ') +
                'word '.repeat(200) }) }] } }] }) };
        };
        await SB.Prompts.generateFor(shots.a, { video: true });
        t('an invented label is caught and rewritten once', window.__calls.length === 2,
          window.__calls.length);
        t('the correction says which labels actually exist',
          /no subject_definitions line defines/.test(
            window.__calls[1].body.contents[0].parts[0].text), '');
        t('and the corrected answer is what gets stored',
          shots.a.prompts[h3.id].videoPrompt.indexOf('<Subject 7>') < 0, '');
        window.__reply = null;

        /* a template the user rewrote is theirs, and takes the plain path */
        const was = h3.videoTemplate;
        h3.videoTemplate = 'Write a video prompt for {{MODEL}}: {{DESCRIPTION}}';
        window.__calls = [];
        await SB.Prompts.generateFor(shots.a, { video: true });
        t('an edited H3 template opts out of the scaffold',
          window.__calls[0].body.generationConfig.responseSchema.required.join() === 'videoPrompt',
          JSON.stringify(window.__calls[0].body.generationConfig.responseSchema.required));
        h3.videoTemplate = was;
        P().settings.videoModelId = null;
        shots.a.personaIds = [];
        shots.a.image = null;
      }

      /* ---------- the frame is supplied, so the video prompt is motion ----------
       *
       * The complaint this answers: video prompts came back re-describing the
       * set, the wardrobe and the grade — all of it already in the picture the
       * call is handed — with the action reduced to a clause. Four instructions
       * asked for the look (the house style, the fold-in line, the rider, the
       * cast block) and one asked for motion.
       */
      {
        const wan = P().settings.models.filter(function (m) { return m.name === 'Wan'; })[0];
        P().settings.videoModelId = wan.id;
        const per = SB.Personas.add(P(), { name: 'Ana', description: 'Navy suit, tan boots.' });
        shots.a.personaIds = [per.id];
        shots.a.image = { ref: 'frame1', w: 8, h: 8 };

        const sys = [SB.Brand.systemFor(P(), shots.a, 'video'),
          SB.Personas.block(P(), shots.a, wan, 'video')].join('  ');

        t('the house style is not sent to a frame-only video job',
          sys.indexOf('muted professional grade') < 0 && sys.indexOf('HOUSE STYLE —') < 0,
          sys.slice(0, 120));
        t('and is told nothing about it either — not even that it is missing',
          sys.indexOf('HOUSE STYLE') < 0, '');
        t('the frame is declared already supplied',
          /THE FIRST FRAME IS SUPPLIED TO THE MODEL AS A PICTURE/.test(sys), '');
        t('the closing instruction asks for movement, not description',
          /concrete MOVEMENT/.test(sys) && !/as concrete description/.test(sys), '');
        t('a subject in the frame is named but not described',
          sys.indexOf('Ana') >= 0 && sys.indexOf('Navy suit') < 0, '');
        t('and the old look-restating rider line is gone',
          sys.indexOf('Hold the natural-light look') < 0, '');

        /* the half that must NOT change: a full-reference model still gets the
           appearance, because binding a label to a picture is its format */
        const h3b = P().settings.models.filter(function (m) {
          return m.name === 'MiniMax H3 (Hailuo)'; })[0];
        P().settings.videoModelId = h3b.id;
        const h3sys = [SB.Brand.systemFor(P(), shots.a, 'video'),
          SB.Personas.block(P(), shots.a, h3b, 'video')].join('  ');
        t('a full-reference model still gets the house style and the descriptions',
          h3sys.indexOf('Navy suit') > 0 && h3sys.indexOf('muted professional grade') > 0, '');
        t('and is no longer told not to use image numbers',
          h3sys.indexOf('must not refer to image numbers') < 0, '');

        /* the migration that brings an existing board onto the new wording */
        const proj = { name: 'old', master: SB.Doc.make(''), scenes: [],
          settings: { models: [
            { id: 'm_v1', name: 'Wan', kind: 'video',
              imageTemplate: SB.Model.IMG_TPL, videoTemplate: SB.Model.VID_TPL_V1 },
            { id: 'm_v2', name: 'Kling', kind: 'video',
              imageTemplate: SB.Model.IMG_TPL, videoTemplate: 'my own wording' }
          ], modelSeeds: [] } };
        SB.Model.migrate(proj);
        const m1 = proj.settings.models.filter(function (m) { return m.id === 'm_v1'; })[0];
        const m2 = proj.settings.models.filter(function (m) { return m.id === 'm_v2'; })[0];
        t('an untouched video template is brought up to date',
          m1.videoTemplate === SB.Model.VID_TPL, m1.videoTemplate.slice(0, 40));
        t('an edited one is left alone', m2.videoTemplate === 'my own wording', m2.videoTemplate);
        t('and every model gets a videoRefs kind',
          m1.videoRefs === SB.Model.FRAME_ONLY && m2.videoRefs === SB.Model.FRAME_ONLY,
          m1.videoRefs + '/' + m2.videoRefs);
        t('with H3 the only full-reference one',
          proj.settings.models.filter(function (m) {
            return m.videoRefs === SB.Model.FULL_REFERENCE;
          }).map(function (m) { return m.name; }).join() === 'MiniMax H3 (Hailuo)', '');

        P().settings.videoModelId = null;
        shots.a.personaIds = [];
        shots.a.image = null;
        SB.Personas.remove(P(), per.id);
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
