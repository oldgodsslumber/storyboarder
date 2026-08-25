/* providers.js — where the prompt WRITER runs.
 *
 * Two backends, one shape. prompts.js asks a provider to build a request body
 * and to pull the text back out; everything else in the app is unchanged.
 *
 *   gemini — Google's generativelanguage endpoint, with JSON schema mode.
 *   ooba   — any OpenAI-compatible /v1/chat/completions server: oobabooga's
 *            text-generation-webui (--api), LM Studio, llama.cpp's server,
 *            KoboldCpp. No schema mode, so it takes the same "ask for JSON in
 *            words" path Gemma already uses.
 *
 * Which one is active is a project setting (p.settings.aiProvider) because a
 * board's prompts are written by whatever the board is pointed at. WHERE the
 * local server lives is not: the URL, model and optional key are per-browser,
 * like the Gemini key, so a .storyboard handed to someone else carries neither
 * your key nor your machine's address — and so flipping provider back and
 * forth never costs you either side's model choice.
 */
(function (SB) {
  'use strict';

  const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';
  const DEFAULT_OOBA_URL = 'http://127.0.0.1:5000';

  function P() { return SB.app && SB.app.project; }

  /* ---------------- gemini ---------------- */

  const gemini = {
    id: 'gemini',
    label: 'Google Gemini',
    supportsSchema: true,
    needsKey: true,

    model: function () {
      return (P() && P().settings.geminiModel) || SB.GeminiModels.DEFAULT;
    },
    /* Gemma is served through the same endpoint but has no JSON mode. */
    schemaFor: function (mdl) { return !SB.GeminiModels.isGemma(mdl); },

    ready: function () { return !!SB.Store.getApiKey(); },
    notReady: function () {
      return 'No Google API key. Add one in Settings → API.';
    },

    url: function (mdl) {
      return GEMINI_ENDPOINT + encodeURIComponent(mdl) +
        ':generateContent?key=' + encodeURIComponent(SB.Store.getApiKey());
    },
    headers: function () { return { 'Content-Type': 'application/json' }; },

    /* opts = { schema, system, hint } — hint is the wording that replaces a
     * response schema when the model has no JSON mode. */
    body: function (mdl, text, opts) {
      const plain = !this.schemaFor(mdl);
      const withSchema = !plain && !!opts.schema;
      const gen = { temperature: 0.8 };
      if (withSchema) {
        gen.responseMimeType = 'application/json';
        gen.responseSchema = opts.schema;
      }
      let user = withSchema ? text : text + opts.hint;
      const body = { generationConfig: gen };
      if (opts.system) {
        /* Gemma takes no systemInstruction either — fold it into the one turn. */
        if (plain) user = opts.system + '\n\n----\n\n' + user;
        else body.systemInstruction = { parts: [{ text: opts.system }] };
      }
      body.contents = [{ role: 'user', parts: [{ text: user }] }];
      return body;
    },

    text: function (data) {
      const cand = data.candidates && data.candidates[0];
      const part = cand && cand.content && cand.content.parts && cand.content.parts[0];
      const raw = part && part.text;
      if (!raw) {
        throw new Error('Gemini returned no text' +
          (cand && cand.finishReason ? ' (' + cand.finishReason + ')' : ''));
      }
      return raw;
    },

    /* Turn a non-2xx into the message that says what to do about it. */
    error: function (status, msg, mdl) {
      let err;
      if (status === 429) {
        SB.GeminiModels.markExhausted(mdl);
        err = new Error('Gemini 429 — daily/rate limit reached for ' + mdl +
          '. Pick another model in the Prompts panel. (' + msg + ')');
      } else if (status === 404) {
        err = new Error('Gemini 404 — "' + mdl + '" is not available to this key. ' +
          'Settings → API → refresh the model list. (' + msg + ')');
      } else {
        err = new Error('Gemini ' + status + ': ' + msg);
      }
      return err;
    }
  };

  /* ---------------- ooba / OpenAI-compatible ---------------- */

  /* Trailing slashes and a pasted-in /v1 are both things people will type. */
  function baseUrl(raw) {
    let u = String(raw == null ? SB.Store.getOoba().url : raw).trim();
    if (!u) u = DEFAULT_OOBA_URL;
    u = u.replace(/\s+$/, '').replace(/\/+$/, '');
    u = u.replace(/\/v1(\/chat(\/completions)?)?$/i, '');
    return u;
  }

  const ooba = {
    id: 'ooba',
    label: 'Ooba / OpenAI-compatible',
    supportsSchema: false,
    needsKey: false,

    model: function () { return SB.Store.getOoba().model || ''; },
    schemaFor: function () { return false; },

    /* A local server needs no key, so "ready" only means we know where it is. */
    ready: function () { return !!baseUrl(); },
    notReady: function () {
      return 'No server address for the local model. Set one in Settings → API.';
    },

    url: function () { return baseUrl() + '/v1/chat/completions'; },
    headers: function () {
      const h = { 'Content-Type': 'application/json' };
      const k = SB.Store.getOoba().key;
      if (k) h['Authorization'] = 'Bearer ' + k;
      return h;
    },

    body: function (mdl, text, opts) {
      const messages = [];
      if (opts.system) messages.push({ role: 'system', content: opts.system });
      messages.push({ role: 'user', content: text + opts.hint });
      const b = { messages: messages, temperature: 0.8, stream: false };
      /* Ooba serves whatever model is loaded and ignores this; LM Studio and
       * llama-server want it. Sending it only when set keeps both happy. */
      if (mdl) b.model = mdl;
      return b;
    },

    text: function (data) {
      const ch = data.choices && data.choices[0];
      const raw = ch && ((ch.message && ch.message.content) || ch.text);
      if (!raw) {
        throw new Error('The local model returned no text' +
          (ch && ch.finish_reason ? ' (' + ch.finish_reason + ')' : ''));
      }
      return raw;
    },

    error: function (status, msg) {
      if (status === 404) {
        return new Error('404 from ' + baseUrl() + ' — that address answered, but not on ' +
          '/v1/chat/completions. Check the port, and that the server is started with its ' +
          'OpenAI-compatible API enabled (text-generation-webui: --api). (' + msg + ')');
      }
      if (status === 401 || status === 403) {
        return new Error(status + ' from the local server — it wants an API key. ' +
          'Put the one you launched it with into Settings → API. (' + msg + ')');
      }
      if (status === 500 && /model|loaded/i.test(msg)) {
        return new Error('500 — no model is loaded in the server. Load one, then try again. (' +
          msg + ')');
      }
      return new Error('Local model ' + status + ': ' + msg);
    },

    /* GET /v1/models — the same call on every OpenAI-compatible server. */
    listModels: function (url) {
      const base = baseUrl(url);
      const headers = {};
      const k = SB.Store.getOoba().key;
      if (k) headers['Authorization'] = 'Bearer ' + k;
      return fetch(base + '/v1/models', { headers: headers })
        .catch(function (e) { throw localError(e, base); })
        .then(function (r) {
          return r.text().then(function (t) {
            if (!r.ok) throw ooba.error(r.status, t);
            let data;
            try { data = JSON.parse(t); }
            catch (e) {
              throw new Error(base + ' answered, but not with JSON — is that really an ' +
                'OpenAI-compatible API port?');
            }
            const list = (data.data || data.models || []).map(function (m) {
              const id = typeof m === 'string' ? m : (m.id || m.name || '');
              return { id: id, label: id };
            }).filter(function (m) { return m.id; });
            if (!list.length) throw new Error('That server lists no models.');
            return list;
          });
        });
    }
  };

  /* A dead localhost is not a corporate proxy, and saying so sends people to
   * the wrong fix. util.js classifies any bare fetch rejection as "blocked";
   * for a local server the answer is always about the server itself. */
  function localError(e, base) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      /* still worth reporting honestly — a localhost call does not need the net */
    }
    const err = new Error('Could not reach ' + (base || baseUrl()) + '. Check that the server ' +
      'is running with its OpenAI-compatible API enabled (text-generation-webui: --api), that ' +
      'the port matches, and that it allows requests from this page ' +
      '(text-generation-webui: --api-enable-CORS, or serve this app from the same host).');
    err.localApi = true;      // so SB.apiBlocked leaves it alone
    return err;
  }

  /* ---------------- registry ---------------- */

  const ALL = { gemini: gemini, ooba: ooba };
  const ORDER = ['gemini', 'ooba'];

  function normalize(id) { return ALL[id] ? id : 'gemini'; }

  function activeId() {
    const p = P();
    return normalize(p && p.settings && p.settings.aiProvider);
  }

  function active() { return ALL[activeId()]; }

  function get(id) { return ALL[normalize(id)]; }

  function setActive(id) {
    const p = P();
    if (!p) return;
    p.settings.aiProvider = normalize(id);
  }

  function list() { return ORDER.map(function (id) { return ALL[id]; }); }

  /* What the usage counter is keyed on: two providers can both be running
   * "mistral-7b" and they are not the same allowance. */
  function usageKey(id, mdl) {
    const pid = normalize(id);
    return pid === 'gemini' ? mdl : pid + ':' + (mdl || 'local');
  }

  SB.Providers = {
    DEFAULT_OOBA_URL: DEFAULT_OOBA_URL,
    all: ALL, list: list, get: get, active: active, activeId: activeId,
    setActive: setActive, normalize: normalize, usageKey: usageKey,
    baseUrl: baseUrl, localError: localError
  };

})(window.SB);
