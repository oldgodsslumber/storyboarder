/* getty.js — Getty Images, read from the browser.
 *
 * Getty's API answers a page directly: api.gettyimages.com sends
 * `Access-Control-Allow-Origin: *` and allows the `Api-Key` and `Authorization`
 * headers, and so does the media host the comps come off. So there is no proxy
 * here and no server — the app stays the one file the README promises.
 *
 * Search needs the API key and NOTHING else. A token would only be needed for
 * download sizes, licensing, boards and products, none of which this app does:
 * the Premiere panel at d:\claudecode\gettyforpremiere is where money gets
 * spent, and it already carries the ledger that makes that safe. This file
 * selects; it cannot buy. See getty_integration_plan.md §2.
 *
 * ---- what a comp is allowed to be ----
 *
 * A comp is licensed for test and sample use for 30 days, never for final or
 * public material, and must not be modified as downloaded. Three consequences
 * live in other files and are listed here because this is where anyone looking
 * for them will come: the watermark is never cropped or painted over, a stock
 * frame is never handed to an image model (model.js: modelFrame), and the age
 * of every placement is shown in Settings so a lapsed comp says so.
 *
 * ---- one lane ----
 *
 * Getty's per-key QPS is set at account setup and is not published, and a
 * drawer that scrolls has no reason to race itself. Every call queues behind
 * the last one; a 429 waits out `Retry-After` and then doubles. A failure does
 * not block the lane.
 */
(function (SB) {
  'use strict';

  const BASE = 'https://api.gettyimages.com';

  /* The key lives in this browser and never in the project file — the same
   * rule the Gemini key follows, and the reason a board can be handed to
   * anyone. */
  const K_KEY = 'sb.getty.key';

  /* Everything the drawer draws and the manifest records, and not one field
   * that would need a token. `display_set` is the whole picture set in one
   * ask: thumb to judge from, comp to place. */
  const FIELDS = ['id', 'title', 'caption', 'artist', 'collection_name', 'collection_code',
    'asset_family', 'license_model', 'allowed_use', 'graphical_style', 'orientation',
    'max_dimensions', 'display_set', 'referral_destinations'];

  /* Swappable so the whole client can be driven against a fake Getty in node
   * (test-getty.mjs). Nothing else in here touches the network. */
  const deps = {
    fetch: function () { return fetch.apply(null, arguments); },
    sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); },
    now: function () { return Date.now(); }
  };

  /* ---------------- the key ---------------- */

  function ls(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lsSet(k, v) {
    try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) { }
  }

  let listeners = [];
  function onChange(fn) {
    listeners.push(fn);
    return function () { listeners = listeners.filter(function (x) { return x !== fn; }); };
  }
  function notify() { listeners.slice().forEach(function (fn) { try { fn(); } catch (e) { } }); }

  function key() { return ls(K_KEY).trim(); }
  function setKey(v) { lsSet(K_KEY, String(v || '').trim()); notify(); }
  function configured() { return !!key(); }

  /* ---------------- errors ---------------- */

  /* Getty spells its errors three ways depending on which layer answered —
   * the gateway's bare {"message":"Unauthorized"}, the API's ErrorCode /
   * ErrorMessage, and OAuth's error_description. One shape out. */
  function gettyError(status, body, text) {
    const j = body || {};
    const code = j.ErrorCode || j.error_code || j.code || j.error || '';
    let msg = j.ErrorMessage || j.message || j.Message || j.error_description || text || '';
    if (!msg) msg = 'Getty returned ' + status;
    if (status === 401 || status === 403) {
      msg = msg + ' — check the API key in Settings → Getty.';
    }
    const e = new Error(msg + (code && String(msg).indexOf(code) < 0 ? ' [' + code + ']' : ''));
    e.status = status;
    e.code = String(code);
    e.body = body;
    return e;
  }

  /* ---------------- the lane ---------------- */

  let lane = Promise.resolve();
  let calls = 0;

  function enqueue(fn) {
    const run = lane.then(fn, fn);
    lane = run.then(function () { }, function () { });
    return run;
  }

  function query(params) {
    const parts = [];
    Object.keys(params || {}).forEach(function (k) {
      let v = params[k];
      if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return;
      if (Array.isArray(v)) v = v.join(',');
      if (v === false) return;                       // an unset flag is not a filter
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  /* opts: { query, body, raw (a Blob/ArrayBuffer sent as-is), type } */
  function request(method, path, opts) {
    return enqueue(function () { return send(method, path, opts || {}); });
  }

  async function send(method, path, opts) {
    const k = key();
    if (!k) {
      const e = new Error('No Getty API key yet — paste one in Settings → Getty.');
      e.unconfigured = true;
      throw e;
    }
    const url = BASE + path + query(opts.query);
    let netFails = 0;
    let backoff = 1000;

    for (let attempt = 0; attempt < 8; attempt++) {
      const headers = { 'Api-Key': k, 'Accept': 'application/json' };
      let body;
      if (opts.raw !== undefined) {
        headers['Content-Type'] = opts.type || 'application/octet-stream';
        body = opts.raw;
      } else if (opts.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(opts.body);
      }

      let res;
      calls++;
      try {
        res = await deps.fetch(url, { method: method, headers: headers, body: body, mode: 'cors' });
      } catch (e) {
        /* Three different failures look identical from inside a page and none
         * of them is Getty saying no — see the README on this. Say which one
         * this is as far as it can be known, and retry twice before believing
         * it. */
        if (++netFails > 2) {
          const err = new Error('Could not reach Getty — the request never left the browser. ' +
            'Check the connection, and that nothing on this network is intercepting ' +
            'api.gettyimages.com.');
          err.network = true;
          throw err;
        }
        await deps.sleep(backoff); backoff *= 2;
        continue;
      }

      if (res.status === 429) {
        const ra = Number(res.headers && res.headers.get && res.headers.get('retry-after'));
        const wait = ra > 0 ? ra * 1000 : backoff;
        await deps.sleep(wait);
        backoff = Math.min(backoff * 2, 30000);
        continue;
      }

      const text = await readText(res);
      let json = null;
      if (text) { try { json = JSON.parse(text); } catch (e) { json = null; } }
      if (res.status >= 200 && res.status < 300) return json === null ? (text || true) : json;
      throw gettyError(res.status, json, text);
    }
    throw new Error('Getty kept asking us to slow down. Try again in a minute.');
  }

  function readText(res) {
    if (!res || typeof res.text !== 'function') return Promise.resolve('');
    return res.text().catch(function () { return ''; });
  }

  /* ---------------- searching ---------------- */

  /* f: { phrase, orientations, compositions, people, styles, moods, minSize,
   *      color, sort, safe, excludeEditorialOnly, collections, ages }
   * family: 'creative' (the default) | 'editorial'. */
  function searchParams(f, page, pageSize) {
    f = f || {};
    return {
      phrase: f.phrase,
      orientations: f.orientations,
      compositions: f.compositions,
      number_of_people: f.people,
      graphical_styles: f.styles,
      moods: f.moods,
      minimum_size: f.minSize,
      color: f.color,
      age_of_people: f.ages,
      collection_codes: f.collections,
      sort_order: f.sort,
      safe_search: f.safe === false ? '' : 'true',
      /* The one filter that must default on: a client video is commercial
       * use, and an editorial-only asset boarded into one is a problem
       * discovered at the worst moment. Switchable, because an internal
       * explainer about a real event is a real case. */
      exclude_editorial_use_only: f.excludeEditorialOnly === false ? '' : 'true',
      page: page || 1,
      page_size: pageSize || 60,
      fields: FIELDS
    };
  }

  function searchImages(family, f, page, pageSize) {
    const path = '/v3/search/images/' + (family === 'editorial' ? 'editorial' : 'creative');
    return request('GET', path, { query: searchParams(f, page, pageSize) }).then(shapeResults);
  }

  function similar(id, page, pageSize) {
    return request('GET', '/v3/images/' + encodeURIComponent(id) + '/similar', {
      query: { page: page || 1, page_size: pageSize || 60, fields: FIELDS }
    }).then(shapeResults);
  }

  /* By picture rather than by words: either an asset already on Getty, or a
   * URL Getty can reach — which for a frame out of this app means uploading it
   * first (uploadSearchImage below).
   *
   * Getty documents neither the upload's response nor this pair anywhere but
   * the OpenAPI spec, and the spec gives the upload no response schema at all,
   * so both are written defensively and the drawer says plainly when an
   * account cannot do it. */
  function byImage(src, f, page, pageSize) {
    const q = searchParams(f, page, pageSize);
    if (src && src.assetId) q.asset_id = src.assetId;
    if (src && src.imageUrl) q.image_url = src.imageUrl;
    delete q.compositions;             // the picture IS the composition
    delete q.people;
    return request('GET', '/v3/search/images/creative/by-image', { query: q }).then(shapeResults);
  }

  /* PUT the bytes, get back something that names where they landed. The reply
   * has been seen as a bare string and as an object under several keys, so
   * every shape is accepted and an unrecognised one is reported as what it is
   * rather than as a search with no results. */
  function uploadSearchImage(name, blob, type) {
    const safe = String(name || 'frame.jpg').replace(/[^A-Za-z0-9._-]/g, '_');
    return request('PUT', '/v3/search/by-image/uploads/' + encodeURIComponent(safe), {
      raw: blob, type: type || blobType(blob) || 'image/jpeg'
    }).then(function (r) {
      const u = (typeof r === 'string') ? r
        : (r && (r.uri || r.url || r.image_url || r.imageUrl || r.location)) || '';
      if (!u || !/^https?:/i.test(String(u))) {
        const e = new Error('Getty took the picture but did not say where to find it, so it ' +
          'cannot be searched by. This account may not have search-by-image enabled.');
        e.unsupported = true;
        throw e;
      }
      return String(u);
    });
  }

  function blobType(b) { return (b && b.type) || ''; }

  /* One shape for every search: the drawer never learns which call it came
   * from. */
  function shapeResults(r) {
    const list = (r && (r.images || r.result || [])) || [];
    return {
      total: (r && (r.result_count || 0)) | 0,
      images: list.map(asset).filter(Boolean),
      related: (r && r.related_searches) || []
    };
  }

  /* ---------------- one asset ---------------- */

  function sizes(a) {
    return (a && (a.display_sizes || a.display_set)) || [];
  }

  function sizeNamed(a, names) {
    const all = sizes(a);
    for (let i = 0; i < names.length; i++) {
      for (let j = 0; j < all.length; j++) {
        if (all[j] && all[j].name === names[i] && all[j].uri) return all[j].uri;
      }
    }
    return '';
  }

  /* Thumbs are what you scan, the comp is what you decide on. Both come out of
   * the same display set, so asking for one costs nothing extra. */
  function thumbUrl(a) { return sizeNamed(a, ['thumb', 'preview', 'comp']); }
  function previewUrl(a) { return sizeNamed(a, ['preview', 'comp', 'high_res_comp', 'thumb']); }
  function compUrl(a) { return sizeNamed(a, ['high_res_comp', 'comp', 'preview', 'thumb']); }

  /* The normalised asset. `raw` is kept so a later field is one line away and
   * nothing has to re-derive what a display set meant. */
  function asset(a) {
    if (!a || !a.id) return null;
    const dest = (a.referral_destinations || [])[0] || null;
    return {
      id: String(a.id),
      title: a.title || '',
      caption: a.caption || '',
      artist: a.artist || '',
      collection: a.collection_name || '',
      collectionCode: a.collection_code || '',
      family: a.asset_family || '',
      license: a.license_model || '',
      allowedUse: (a.allowed_use && (a.allowed_use.usage_restrictions || a.allowed_use.release_info)) || '',
      editorialOnly: editorialOnly(a),
      style: a.graphical_style || '',
      orientation: a.orientation || '',
      max: a.max_dimensions || null,
      thumb: thumbUrl(a),
      preview: previewUrl(a),
      comp: compUrl(a),
      link: (dest && (dest.uri || dest.site_name)) || '',
      raw: a
    };
  }

  /* "Editorial use only" is carried as a usage restriction rather than a flag,
   * and the words differ between collections — so this matches on the one
   * phrase they all contain and treats anything it cannot read as fine, since
   * the search filter has already excluded the real ones. */
  function editorialOnly(a) {
    const u = (a && a.allowed_use) || {};
    const s = [u.usage_restrictions, u.how_can_i_use_it_collection_text, u.release_info]
      .filter(Boolean).join(' ');
    return /editorial use only/i.test(Array.isArray(s) ? s.join(' ') : String(s));
  }

  /* What goes in the project file when a comp is placed. Small on purpose: it
   * is the licence trail and the manifest row, not a cache of the search. */
  function record(a) {
    return {
      id: a.id, title: a.title || a.caption || '', artist: a.artist || '',
      collection: a.collection || '', family: a.family || '', license: a.license || '',
      link: a.link || '', at: deps.now()
    };
  }

  /* ---------------- the comp, as bytes ---------------- */

  /* The media host allows cross-origin reads, so the comp can be fetched and
   * stored in the .storyboard like any other picture. If that ever stops being
   * true the board can still SHOW a comp from its URL, but it could not carry
   * one — so this failure is reported as itself rather than as a broken
   * picture. */
  function fetchComp(a) {
    const url = (typeof a === 'string') ? a : compUrl(a);
    if (!url) return Promise.reject(new Error('That asset came back with no comp to place.'));
    return deps.fetch(url, { mode: 'cors' }).then(function (res) {
      if (!res.ok) throw new Error('The comp could not be downloaded (' + res.status + ').');
      return res.blob();
    }).catch(function (e) {
      if (e && e.message && /could not be downloaded/.test(e.message)) throw e;
      throw new Error('The comp could not be read from Getty\u2019s media host — the picture ' +
        'can be shown but not placed on a card. (' + (e && e.message || e) + ')');
    });
  }

  /* ---------------- a card, as a search ---------------- */

  /* The expertise this replaces: knowing that a "Close-up" is Getty's
   * `close_up`, that a "Talking head" is a headshot looking at the camera with
   * one person in it, and that an "Insert" has no people in it at all.
   *
   * Keyed on the DEFAULT shot types, because the list is user-editable
   * (p.settings.shotTypes): a renamed or invented type contributes no filter
   * rather than a guessed one, and the drawer says which filters it applied so
   * a silent guess is impossible anyway.
   */
  const BY_TYPE = {
    'wide': { compositions: ['wide_shot'] },
    'medium': { compositions: ['medium_shot', 'waist_up'] },
    'close-up': { compositions: ['close_up'] },
    'extreme close-up': { compositions: ['macro', 'close_up'] },
    'two shot': { people: ['two'] },
    'insert': { compositions: ['still_life', 'cut_out', 'macro'], people: ['none'] },
    'cutaway': { people: ['none'] },
    'talking head': { compositions: ['headshot', 'looking_at_camera'], people: ['one'] }
  };

  /* Over the shoulder, POV and Screen capture are deliberately absent: Getty
   * has no composition that means any of them, and a wrong filter is worse
   * than none because it silently hides the right picture. */

  function typeFilters(type) {
    const t = String(type || '').trim().toLowerCase();
    return BY_TYPE[t] || null;
  }

  function orientationFor(p, shot) {
    const a = (SB.Imagine && SB.Imagine.aspectFor) ? SB.Imagine.aspectFor(p, shot) : '16:9';
    const m = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(String(a || ''));
    if (!m) return 'horizontal';
    const r = Number(m[1]) / Number(m[2]);
    if (r > 1.05) return r >= 2 ? 'panoramic_horizontal' : 'horizontal';
    if (r < 0.95) return 'vertical';
    return 'square';
  }

  /* The filters a card asks for, and the words for them. Both come from here
   * so the chips in the drawer cannot drift from what was sent. */
  function shotFilters(p, shot) {
    const f = {
      orientations: [orientationFor(p, shot)],
      styles: ['photography'],
      safe: true,
      excludeEditorialOnly: true,
      sort: 'best_match'
    };
    const t = shot ? typeFilters(shot.type) : null;
    if (t) {
      if (t.compositions) f.compositions = t.compositions.slice();
      if (t.people) f.people = t.people.slice();
    }
    /* Cast is a fact about the card and the type does not always imply it: two
     * subjects on a Wide is a two-shot whatever the dropdown says. Only when
     * the type has not already spoken. */
    if (!f.people && shot && (shot.personaIds || []).length) {
      const n = shot.personaIds.length;
      f.people = [n === 1 ? 'one' : (n === 2 ? 'two' : 'group')];
    }
    return f;
  }

  /* The phrase a card starts from. `SB.Refs.plain` is the boundary for "a
   * description, read by a machine" — it resolves @{id|Name} marks to the
   * names they now have. Never read a description raw. */
  function phraseFor(p, shot) {
    if (!shot) return '';
    const src = shot.imageDescription || shot.description || '';
    const txt = (SB.Refs && SB.Refs.plain) ? SB.Refs.plain(p, src) : String(src);
    return String(txt || '').replace(/\s+/g, ' ').trim().slice(0, 180);
  }

  /* The chips: what was filtered, in the words a person would use. */
  const WORDS = {
    close_up: 'close-up', medium_shot: 'medium shot', wide_shot: 'wide shot',
    headshot: 'headshot', waist_up: 'waist up', macro: 'macro', still_life: 'still life',
    cut_out: 'cut out', looking_at_camera: 'looking at camera',
    horizontal: 'horizontal', vertical: 'vertical', square: 'square',
    panoramic_horizontal: 'panoramic', none: 'no people', one: 'one person',
    two: 'two people', group: 'a group', photography: 'photographs'
  };
  function word(v) { return WORDS[v] || String(v).replace(/_/g, ' '); }

  function chips(f) {
    const out = [];
    (f.compositions || []).forEach(function (c) { out.push({ k: 'compositions', v: c, label: word(c) }); });
    (f.orientations || []).forEach(function (c) { out.push({ k: 'orientations', v: c, label: word(c) }); });
    (f.people || []).forEach(function (c) { out.push({ k: 'people', v: c, label: word(c) }); });
    (f.styles || []).forEach(function (c) { out.push({ k: 'styles', v: c, label: word(c) }); });
    if (f.excludeEditorialOnly !== false) {
      out.push({ k: 'excludeEditorialOnly', v: true, label: 'commercial use' });
    }
    return out;
  }

  SB.Getty = {
    /* the key */
    key: key, setKey: setKey, configured: configured, onChange: onChange,
    /* calls */
    searchImages: searchImages, similar: similar, byImage: byImage,
    uploadSearchImage: uploadSearchImage, fetchComp: fetchComp,
    /* shaping */
    asset: asset, record: record, thumbUrl: thumbUrl, previewUrl: previewUrl, compUrl: compUrl,
    /* a card as a search */
    shotFilters: shotFilters, typeFilters: typeFilters, phraseFor: phraseFor,
    chips: chips, word: word, orientationFor: orientationFor,
    /* seams */
    deps: deps, FIELDS: FIELDS, BASE: BASE,
    calls: function () { return calls; }
  };

})(window.SB);
