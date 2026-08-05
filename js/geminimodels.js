/* geminimodels.js — which Gemini model writes the prompts.
 *
 * Curated list of the text models documented at ai.google.dev (checked Aug 2026),
 * filtered to ones that take text in and return text/JSON out — no image, TTS,
 * live-audio, embedding or video models, none of which can write a prompt.
 *
 * Google retires ids on its own schedule, so the picker can also ask the key
 * itself: "refresh from my key" calls ListModels and replaces the list with
 * whatever that key can actually reach today. That result is cached locally.
 */
(function (SB) {
  'use strict';

  const DEFAULT = 'gemini-3.6-flash';
  const CACHE_KEY = 'sb.geminiModelList';

  const LIST = [
    { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash — latest, balanced (default)' },
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash — most intelligent' },
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite — fastest / cheapest 3.5' },
    { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite — frontier-class, low cost' },
    { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro — deepest reasoning (preview)' },
    { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (preview)' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash — older price/performance' },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite — older, budget' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro — older, deep reasoning' },
    { id: 'gemma-4-31b-it', label: 'Gemma 4 31B — open model, large free quota' }
  ];

  /* Gemma is served through the same endpoint but is not a Gemini model: it
   * has no JSON mode, so prompts.js asks it for JSON in words instead of
   * sending a responseSchema. */
  function isGemma(id) { return /^gemma/i.test(String(id || '')); }

  /* ids Google has shut down — anything pointing at these gets moved to DEFAULT */
  const RETIRED = [
    'gemini-2.0-flash', 'gemini-2.0-flash-lite',
    'gemini-3-pro-preview', 'gemini-3.1-flash-lite-preview',
    'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-flash-latest', 'gemini-pro'
  ];

  /* ---- daily request counting (same idea as the AI GM app) ----
   * Google stopped publishing per-model free-tier RPD in the docs, so the
   * count here is real (every request this browser sent today) while the
   * limit is whatever AI Studio shows you. Resets at local midnight.
   */
  const USAGE_KEY = 'sb.geminiUsage';
  const LIMITS_KEY = 'sb.geminiLimits';
  const DEFAULT_LIMITS = {
    'gemini-2.5-flash': 20, 'gemini-2.5-flash-lite': 20,
    'gemma-4-31b-it': 1500
  };

  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function usage() {
    try {
      const u = JSON.parse(localStorage.getItem(USAGE_KEY));
      if (u && u.date === today()) return u;
    } catch (e) { }
    return { date: today(), counts: {} };
  }

  function saveUsage(u) {
    try { localStorage.setItem(USAGE_KEY, JSON.stringify(u)); } catch (e) { }
  }

  function bump(id) {
    const u = usage();
    u.counts[id] = (u.counts[id] || 0) + 1;
    saveUsage(u);
    return u.counts[id];
  }

  function count(id) { return usage().counts[id] || 0; }

  /* a 429 means today's allowance is gone whatever the number says */
  function markExhausted(id) {
    const u = usage();
    const lim = limit(id);
    u.counts[id] = lim ? Math.max(lim, u.counts[id] || 0) : (u.counts[id] || 0) + 1;
    saveUsage(u);
  }

  function limits() {
    try { return JSON.parse(localStorage.getItem(LIMITS_KEY)) || {}; } catch (e) { return {}; }
  }

  function limit(id) {
    const l = limits();
    if (typeof l[id] === 'number') return l[id];
    return DEFAULT_LIMITS[id] || 0;   // 0 = unknown, just show the count
  }

  function setLimit(id, n) {
    const l = limits();
    if (n > 0) l[id] = n; else delete l[id];
    try { localStorage.setItem(LIMITS_KEY, JSON.stringify(l)); } catch (e) { }
  }

  function remaining(id) {
    const lim = limit(id);
    return lim ? Math.max(0, lim - count(id)) : null;
  }

  function usageText(id) {
    const c = count(id), lim = limit(id);
    if (!lim) return c + ' request' + (c === 1 ? '' : 's') + ' today';
    return c + ' / ' + lim + ' today · ' + Math.max(0, lim - c) + ' left';
  }

  function cached() {
    try {
      const v = JSON.parse(localStorage.getItem(CACHE_KEY));
      return (v && Array.isArray(v.models) && v.models.length) ? v : null;
    } catch (e) { return null; }
  }

  /* Curated list, or the live one from the key if it has been fetched. */
  function options() {
    const c = cached();
    if (!c) return LIST.slice();
    return c.models.map(function (m) {
      return { id: m.id, label: m.label || m.id };
    });
  }

  function isRetired(id) { return RETIRED.indexOf(id) >= 0; }

  function normalize(id) {
    if (!id || isRetired(id)) return DEFAULT;
    return id;
  }

  /* Ask the user's own key what it can reach. */
  function fetchAvailable() {
    const key = SB.Store.getApiKey();
    if (!key) return Promise.reject(new Error('Add your API key first, then refresh the list.'));
    return fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=' +
      encodeURIComponent(key))
      .catch(function (e) {
        const kind = SB.netKind(e);
        if (kind) throw SB.netError(kind);
        throw e;
      })
      .then(function (r) {
        return r.text().then(function (t) {
          if (!r.ok) {
            if (SB.isInterception(r.status, t)) throw SB.netError('blocked');
            let msg = t;
            try { msg = JSON.parse(t).error.message; } catch (e) { }
            throw new Error('Gemini ' + r.status + ': ' + msg);
          }
          return JSON.parse(t);
        });
      })
      .then(function (data) {
        const models = (data.models || []).filter(function (m) {
          const methods = m.supportedGenerationMethods || m.supportedActions || [];
          if (methods.indexOf('generateContent') < 0) return false;
          const id = String(m.name || '').replace(/^models\//, '');
          // drop anything that can't write text back
          return !/embedding|aqa|tts|image|live|veo|imagen|robotics/i.test(id);
        }).map(function (m) {
          const id = String(m.name).replace(/^models\//, '');
          return { id: id, label: (m.displayName || id) + ' — ' + id };
        });
        if (!models.length) throw new Error('That key returned no text models.');
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), models: models }));
        } catch (e) { }
        return models;
      });
  }

  function clearCache() {
    try { localStorage.removeItem(CACHE_KEY); } catch (e) { }
  }

  /* A <select> of known models plus a "Custom…" escape hatch.
   * Returns {el, value()} — el is a wrapper holding the select and, when
   * "Custom…" is chosen, a text input. */
  function picker(current, onChange) {
    const wrap = SB.el('div', 'gm-picker');
    const sel = document.createElement('select');
    const custom = document.createElement('input');
    custom.type = 'text';
    custom.placeholder = 'model id, e.g. gemini-3.6-flash';
    custom.className = 'gm-custom';

    function build() {
      const list = options();
      sel.innerHTML = '';
      let matched = false;
      list.forEach(function (m) {
        const o = document.createElement('option');
        o.value = m.id; o.textContent = m.label;
        if (m.id === current) { o.selected = true; matched = true; }
        sel.appendChild(o);
      });
      if (current && !matched) {
        const o = document.createElement('option');
        o.value = current; o.textContent = current + ' — (not in list)';
        o.selected = true;
        sel.insertBefore(o, sel.firstChild);
      }
      const oc = document.createElement('option');
      oc.value = '__custom'; oc.textContent = 'Custom…';
      sel.appendChild(oc);
    }
    build();

    custom.classList.add('hidden');
    sel.addEventListener('change', function () {
      if (sel.value === '__custom') {
        custom.classList.remove('hidden');
        custom.value = current || '';
        custom.focus();
        return;
      }
      custom.classList.add('hidden');
      current = sel.value;
      if (onChange) onChange(current);
    });
    custom.addEventListener('input', function () {
      current = custom.value.trim();
      if (onChange) onChange(current);
    });

    wrap.appendChild(sel);
    wrap.appendChild(custom);
    return {
      el: wrap,
      value: function () { return current; },
      rebuild: function (cur) { if (cur) current = cur; build(); }
    };
  }

  SB.GeminiModels = {
    DEFAULT: DEFAULT, LIST: LIST, RETIRED: RETIRED,
    options: options, isRetired: isRetired, normalize: normalize, isGemma: isGemma,
    fetchAvailable: fetchAvailable, clearCache: clearCache, picker: picker,
    bump: bump, count: count, markExhausted: markExhausted,
    limit: limit, setLimit: setLimit, remaining: remaining, usageText: usageText
  };

})(window.SB);
