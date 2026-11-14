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
  /* Set only when somebody turns it OFF, so the default is "keep the clip"
   * without writing anything into a fresh browser. */
  const K_NOCLIP = 'sb.getty.noclip';

  /* Everything the drawer draws and the manifest records, and not one field
   * that would need a token. `display_set` is the whole picture set in one
   * ask: thumb to judge from, comp to place. */
  /* Everything a footage tile, the judging pane and the manifest need, and
   * not one field that would need a token. `display_set` is the whole picture
   * set in one ask: the poster to scan, the comp mp4 to judge from and to
   * take a first frame off. */
  const FIELDS = ['id', 'title', 'caption', 'artist', 'clip_length', 'aspect_ratio',
    'asset_family', 'collection_name', 'collection_code', 'license_model', 'allowed_use',
    'shot_speed', 'mastered_to', 'display_set', 'referral_destinations'];

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

  /* Whether the comp clip is kept in the file alongside its first frame.
   * A comp preview is a few megabytes; a board of thirty is a file nobody can
   * email. On by default — a board you can watch is the point of footage. */
  function keepCompOff() { return ls(K_NOCLIP) === '1'; }
  function setKeepComp(on) { lsSet(K_NOCLIP, on ? '' : '1'); notify(); }

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
        /* A rejected fetch is NOT necessarily a dead network, and assuming it
         * was is the most misleading thing this client ever said.
         *
         * Getty's gateway answers a bad or unentitled key with 401/403 and
         * **no Access-Control-Allow-Origin header**, so the browser refuses to
         * let the page read the response at all: `fetch` rejects exactly as if
         * the request had never left. The old message then blamed the network
         * — "check that nothing is intercepting api.gettyimages.com" — for a
         * typo in the key. (The same is true of a 429, which is why the
         * Retry-After ladder below can never run in a browser.)
         *
         * The status is unreadable, so it is not guessed: one no-cors probe
         * asks the only question that can be answered — did the host answer
         * at all? An opaque response that resolves means Getty replied and
         * the browser hid it, which means the key or the account, not the
         * wire. */
        if (++netFails > 2) {
          const answered = await hostAnswered(url);
          const err = new Error(answered
            ? 'Getty answered, but the browser would not let this page read the answer — ' +
              'which is what a rejected API key looks like from a web page, because Getty ' +
              'sends 401, 403 and 429 without the header a browser needs. Check the key in ' +
              'Settings → Getty first, and that the account is entitled to the footage ' +
              'API. If the key is right, this can also mean the per-second limit was hit; ' +
              'wait a moment and try again.'
            : 'Could not reach Getty — the request never left the browser, and ' +
              'api.gettyimages.com did not answer at all. Check the connection, and that ' +
              'nothing on this network is intercepting it.');
          err.network = !answered;
          err.opaque = !!answered;
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

  /* Did the host answer anything at all? A no-cors GET is a simple request —
   * no preflight, no readable body — and it resolves for a 401 or a 403 just
   * as it does for a 200. That is exactly what is needed here: not the status,
   * only the difference between "Getty replied and the browser hid it" and
   * "nothing came back". */
  function hostAnswered(url) {
    return deps.fetch(url, { method: 'GET', mode: 'no-cors', cache: 'no-store' })
      .then(function () { return true; })
      .catch(function () { return false; });
  }

  function readText(res) {
    if (!res || typeof res.text !== 'function') return Promise.resolve('');
    return res.text().catch(function () { return ''; });
  }

  /* ---------------- searching ----------------
   *
   * Footage, and only footage. This app boards videos, the thing that gets cut
   * into one is a clip, and the Premiere panel that does the licensing sorts
   * stills into a bucket it reports as skipped — so an image search here could
   * only ever have produced a list of ids the edit throws away. See
   * getty_footage_plan.md §1.
   *
   * Nothing in here is derived from a card. The person searching is looking
   * for footage and then dragging the shot up onto the board; the card is
   * where the result lands, not an input to finding it.
   */

  /* f, all of it set by hand in the drawer:
   *   phrase, orientations, aspects, formats, frameRates, techniques,
   *   viewpoints, licenses, minLength, maxLength, collections, sort,
   *   safe, excludeEditorialOnly
   * family: 'creative' (the default) | 'editorial'. */
  function searchParams(f, page, pageSize) {
    f = f || {};
    return {
      phrase: f.phrase,
      /* video has exactly two orientations, not five */
      orientations: f.orientations,
      aspect_ratios: f.aspects,
      /* single-valued in the spec, unlike every other filter here: a comma
         list would be a 400 the moment anything set two */
      format_available: one(f.formats),
      frame_rates: f.frameRates,
      image_techniques: f.techniques,
      viewpoints: f.viewpoints,
      license_models: f.licenses,
      min_clip_length: f.minLength,
      max_clip_length: f.maxLength,
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

  /* The first of a set, for a parameter the spec declares as one value. */
  function one(v) { return Array.isArray(v) ? v[0] : v; }

  function searchVideos(family, f, page, pageSize) {
    return searchVideosRaw(family, f, page, pageSize).then(shapeResults);
  }

  /* The same call without the shaping, so the key check in Settings can say
   * what Getty actually sent rather than what we made of it. */
  function searchVideosRaw(family, f, page, pageSize) {
    const path = '/v3/search/videos/' + (family === 'editorial' ? 'editorial' : 'creative');
    return request('GET', path, { query: searchParams(f, page, pageSize) });
  }

  function similar(id, page, pageSize) {
    return request('GET', '/v3/videos/' + encodeURIComponent(id) + '/similar', {
      query: { page: page || 1, page_size: pageSize || 60, fields: FIELDS }
    }).then(shapeResults);
  }

  /* By picture rather than by words: a frame off the board, uploaded, then
   * searched against the FOOTAGE index — board a shot with a model, then find
   * the clip that looks like it.
   *
   * Getty documents neither the upload's response nor this pair anywhere but
   * the OpenAPI spec, and the spec gives the upload no response schema at all,
   * so both are written defensively and the drawer says plainly when an
   * account cannot do it. */
  /* The by-image endpoint declares a SHORT parameter list, and it is not the
   * search's: no clip length, no frame rate, no format, no sort, no safe
   * search. The first cut blacklisted the four filters a picture obviously
   * answers and sent everything else, which meant seven undeclared parameters
   * went out on every call — including sort_order and safe_search, which are
   * on by default.
   *
   * A whitelist, from the spec, because a blacklist is wrong the moment a new
   * filter is added. BY_IMAGE_OK is the full set the spec allows that this app
   * has any use for. */
  const BY_IMAGE_OK = ['asset_id', 'image_url', 'phrase', 'fields', 'page', 'page_size',
    'collection_codes', 'collections_filter_type', 'exclude_editorial_use_only',
    'product_types', 'istock_exclusive'];

  function byImage(src, f, page, pageSize) {
    const all = searchParams(f, page, pageSize);
    const q = {};
    BY_IMAGE_OK.forEach(function (k) { if (all[k] !== undefined) q[k] = all[k]; });
    if (src && src.assetId) q.asset_id = src.assetId;
    if (src && src.imageUrl) q.image_url = src.imageUrl;
    return request('GET', '/v3/search/videos/creative/by-image', { query: q }).then(shapeResults);
  }

  /* Which of the drawer's filters a by-image search can actually honour, so
   * the chips can say so rather than promising a frame-rate filter the
   * endpoint has never heard of. */
  function byImageIgnores(f) {
    const out = [];
    chips(f || {}).forEach(function (c) {
      const wire = WIRE[c.k];
      if (wire && BY_IMAGE_OK.indexOf(wire) < 0) out.push(c);
    });
    return out;
  }

  /* PUT the bytes, get back something that names where they landed. The reply
   * has been seen as a bare string and as an object under several keys, so
   * every shape is accepted and an unrecognised one is reported as what it is
   * rather than as a search with no results. */
  /* PUT the bytes, then search by the URL they now live at.
   *
   * That URL is OURS to build: the spec gives this endpoint a 200 with no
   * response body at all, and Getty's own documentation says to pass the
   * upload URL you chose as `image_url`. The first cut demanded a URL in the
   * reply and, on the empty 200 the spec describes, threw an error blaming the
   * account — after the user's frame had already been sent. A reply that DOES
   * name a location still wins, in case an account's gateway adds one. */
  function uploadSearchImage(name, blob, type) {
    const safe = String(name || 'frame.jpg').replace(/[^A-Za-z0-9._-]/g, '_');
    const path = '/v3/search/by-image/uploads/' + encodeURIComponent(safe);
    return request('PUT', path, {
      raw: blob, type: type || blobType(blob) || 'image/jpeg'
    }).then(function (r) {
      const said = (typeof r === 'string') ? r
        : (r && (r.uri || r.url || r.image_url || r.imageUrl || r.location)) || '';
      return /^https?:/i.test(String(said)) ? String(said) : (BASE + path);
    });
  }

  function blobType(b) { return (b && b.type) || ''; }

  /* One shape for every search: the drawer never learns which call it came
   * from.
   *
   * `videos` FIRST, and this line is the whole reason a real search came back
   * empty with a working key. Getty's footage endpoints answer
   * {result_count, videos:[…]} — the image endpoints answer {images:[…]} —
   * and this was ported from the image search and kept reading `images`. The
   * request was fine, the key was fine, and the parser dropped every result
   * on the floor. The test fake had the same wrong shape in it, so 146 green
   * checks proved only that the code agreed with my mistake: a fixture has to
   * come off the spec, not off the implementation. */
  function shapeResults(r) {
    /* Anything that is not a list of assets is no assets. A list that came
     * back as an object or a string used to reach .map and throw, and the
     * drawer showed the TypeError where "nothing found" belonged. */
    const raw = r && (r.videos || r.images || r.result);
    const list = Array.isArray(raw) ? raw : [];
    return {
      total: (r && (r.result_count || 0)) | 0,
      images: list.map(asset).filter(Boolean),
      /* How many Getty SENT, which is what says whether there is another page.
       * Counting the shaped ones instead ended somebody's paging at result 59
       * because one asset in the page had no id. */
      raw: list.length,
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

  /* A video's display set is a poster still plus one or more watermarked
   * clips. Telling them apart is guesswork by design: the spec says a
   * display size carries only {name, uri, aspect_ratio, is_watermarked} —
   * there is NO media type to read, which is what the first cut leaned on.
   *
   * So: anything that looks like a picture is a picture, and everything else
   * with a URI is a candidate clip. That way round on purpose. A still
   * misread as a clip fails loudly at the first decode; a clip misread as a
   * still means the drawer silently has nothing to play and nothing to put on
   * a card, which is the failure that is hard to see. Getty's URLs carry the
   * format in the query as often as in the path (`?s=mp4-640x640`), so both
   * are matched. */
  function looksLikeStill(z) {
    const u = String((z && z.uri) || '');
    const n = String((z && z.name) || '');
    if (/\.(jpe?g|png|gif|webp|bmp)(\?|#|$)/i.test(u)) return true;
    if (/[?&=](jpe?g|png|webp)\b/i.test(u)) return true;
    return /thumb|poster|still|image/i.test(n) && !/\bmp4\b/i.test(u);
  }

  function isClipSize(z) {
    if (!z || !z.uri) return false;
    return !looksLikeStill(z);
  }

  function clipSize(a) {
    const all = sizes(a).filter(isClipSize);
    if (!all.length) return null;
    const order = ['high_res_comp', 'comp', 'preview', 'mid_res_comp'];
    for (let i = 0; i < order.length; i++) {
      const hit = all.filter(function (z) { return z.name === order[i]; })[0];
      if (hit) return hit;
    }
    return all[0];
  }

  function stills(a) {
    return sizes(a).filter(function (z) { return z && z.uri && looksLikeStill(z); });
  }

  /* Two jobs, opposite needs, so two functions rather than one with a
   * compromise order.
   *
   * The TILE wants the cheapest thing that fills a 168px box — forty of them
   * scroll. A FALLBACK FRAME, used when the clip itself will not decode, wants
   * the largest still there is, because it is going on a card and into a PDF.
   * One ordering served both and handed a ~170px thumbnail to the card. */
  function posterUrl(a) {
    const list = stills(a);
    const order = ['thumb', 'preview_image', 'comp_image', 'preview', 'comp'];
    for (let i = 0; i < order.length; i++) {
      const hit = list.filter(function (z) { return z.name === order[i]; })[0];
      if (hit) return hit.uri;
    }
    return list.length ? list[0].uri : '';
  }

  function bestStillUrl(a) {
    const list = stills(a);
    const order = ['high_res_comp', 'comp', 'comp_image', 'preview', 'preview_image', 'thumb'];
    for (let i = 0; i < order.length; i++) {
      const hit = list.filter(function (z) { return z.name === order[i]; })[0];
      if (hit) return hit.uri;
    }
    return list.length ? list[list.length - 1].uri : '';
  }

  /* The watermarked comp clip — what the judging pane plays, what the card
   * keeps, and what the first frame is taken off. */
  function compUrl(a) {
    const z = clipSize(a);
    return (z && z.uri) || '';
  }

  function thumbUrl(a) { return posterUrl(a); }
  function previewUrl(a) { return posterUrl(a); }

  /* The normalised asset. `raw` is kept so a later field is one line away and
   * nothing has to re-derive what a display set meant. */
  /* What a search actually came back with, in one line, for the key check in
   * Settings. This exists because of how the `videos`/`images` bug presented:
   * a working key, a successful request, and an empty strip with nothing
   * anywhere saying why. A shape mismatch should be a line of text, not an
   * afternoon. */
  function describeRaw(r) {
    if (!r || typeof r !== 'object') return 'the reply was not an object';
    const keys = Object.keys(r);
    const arr = keys.filter(function (k) { return Array.isArray(r[k]); });
    const list = (r.videos || r.images || r.result || []);
    const first = Array.isArray(list) ? list[0] : null;
    const names = first ? (first.display_sizes || first.display_set || [])
      .map(function (z) { return z && z.name; }).filter(Boolean) : [];
    return 'reply keys: ' + keys.join(', ') +
      ' | arrays: ' + (arr.join(', ') || 'none') +
      ' | result_count: ' + (r.result_count === undefined ? '(absent)' : r.result_count) +
      (first ? ' | first asset: ' + first.id +
        ' | display sizes: ' + (names.join(', ') || '(none)') : ' | no assets in the reply');
  }

  function asset(a) {
    if (!a || !a.id) return null;
    const dest = (a.referral_destinations || [])[0] || null;
    return {
      id: String(a.id),
      kind: 'video',
      title: a.title || '',
      caption: a.caption || '',
      artist: a.artist || '',
      collection: a.collection_name || '',
      collectionCode: a.collection_code || '',
      family: a.asset_family || '',
      license: a.license_model || '',
      editorialOnly: editorialOnly(a),
      /* seconds. Getty sends it as a number on some collections and as
       * "0:12" on others, so both are read and one shape comes out. */
      seconds: seconds(a.clip_length),
      aspect: a.aspect_ratio || '',
      speed: a.shot_speed || '',
      mastered: a.mastered_to || '',
      poster: posterUrl(a),
      /* the biggest still there is, for the one case where the clip will not
         decode and a frame still has to go on the card */
      still: bestStillUrl(a),
      comp: compUrl(a),
      link: (dest && (dest.uri || dest.site_name)) || '',
      raw: a
    };
  }

  /* `clip_length` is typed as a string in the spec and has been seen as a
   * number, as "0:12" and as an ISO duration. All three, one answer. */
  function seconds(v) {
    if (typeof v === 'number' && isFinite(v)) return Math.round(v);
    const str = String(v == null ? '' : v).trim();
    const mm = /^(\d+):(\d{1,2})(?:\.\d+)?$/.exec(str);
    if (mm) return Number(mm[1]) * 60 + Number(mm[2]);
    const iso = /^P(?:T)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(str);
    if (iso && (iso[1] || iso[2])) {
      return Math.round(Number(iso[1] || 0) * 60 + Number(iso[2] || 0));
    }
    const n = parseFloat(str);
    return isFinite(n) ? Math.round(n) : 0;
  }

  /* 0:12. A clip length is the first thing anyone reads off a footage tile. */
  function clock(sec) {
    const n = Math.max(0, Math.round(sec || 0));
    return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0');
  }

  /* "Editorial use only" is carried as a usage restriction rather than a flag,
   * and the words differ between collections — so this matches on the one
   * phrase they all contain and treats anything it cannot read as fine, since
   * the search filter has already excluded the real ones. */
  /* `allowed_use.editorial_use_only` is a boolean and it is the authority.
   * The first cut only regexed the prose fields — and read
   * `how_can_i_use_it_collection_text`, which is not a field; the real one is
   * `how_can_i_use_it` — so the flag missed every asset that states it
   * properly and fired only where a collection happened to spell it out. The
   * prose stays as a fallback, because a collection that says it in words and
   * leaves the boolean unset should still be flagged. */
  function editorialOnly(a) {
    const u = (a && a.allowed_use) || {};
    if (u.editorial_use_only === true) return true;
    const parts = [u.usage_restrictions, u.how_can_i_use_it, u.release_info];
    const s = parts.map(function (x) {
      return Array.isArray(x) ? x.join(' ') : String(x == null ? '' : x);
    }).join(' ');
    return /editorial use only/i.test(s);
  }

  /* The asset id out of a Getty media URL, or ''.
   *
   * This exists for the drop nobody planned: a comp dragged straight out of a
   * gettyimages.com tab arrives as a bare URL with no asset beside it, lands
   * on a card like any dropped picture — and would be a comp with no licence
   * record, which is to say a comp a model may be handed. The id is right
   * there in the URL, so it is read rather than lost. Both URL shapes Getty
   * has used are matched; anything else is not a Getty picture. */
  function assetIdFromUrl(url) {
    const s = String(url || '');
    if (!/(^|\.)gettyimages\.com\//i.test(s) && !/media\.gettyimages\.com/i.test(s)) return '';
    const m = /\/id\/(\d{4,})\//.exec(s) || /-id(\d{4,})\b/.exec(s) ||
      /\/detail\/[^?#]*?\/(\d{4,})\b/.exec(s);
    return m ? m[1] : '';
  }

  /* The record for a comp we know only by its URL. Honest about what is
   * missing: an id and where it came from, and no artist invented. */
  function recordFromUrl(url) {
    const id = assetIdFromUrl(url);
    if (!id) return null;
    return {
      id: id, title: '', artist: '', collection: '', family: '', license: '',
      kind: 'video', seconds: 0,
      link: 'https://www.gettyimages.com/detail/' + id, at: deps.now(), fromUrl: true
    };
  }

  /* What goes in the project file when a comp is placed. Small on purpose: it
   * is the licence trail and the manifest row, not a cache of the search. */
  function record(a) {
    return {
      id: a.id, title: a.title || a.caption || '', artist: a.artist || '',
      collection: a.collection || '', family: a.family || '', license: a.license || '',
      /* what the edit will be licensing, and how long it runs — the two
         things the Premiere panel needs that a still never had */
      kind: a.kind || 'video', seconds: a.seconds || 0,
      link: a.link || '', at: deps.now()
    };
  }

  /* ---------------- the comp, as bytes ---------------- */

  /* The watermarked comp clip. The media host allows cross-origin reads, so it
   * can be fetched and kept in the .storyboard like any other file the board
   * carries. If that ever stops being true the drawer can still PLAY a comp
   * from its URL but the board could not carry one, so this failure is
   * reported as itself rather than as a broken picture. */
  function fetchComp(a) {
    const url = (typeof a === 'string') ? a : compUrl(a);
    if (!url) return Promise.reject(new Error('That clip came back with no comp to place.'));
    return deps.fetch(url, { mode: 'cors' }).then(function (res) {
      if (!res.ok) throw new Error('The comp could not be downloaded (' + res.status + ').');
      return res.blob();
    }).catch(function (e) {
      if (e && e.message && /could not be downloaded/.test(e.message)) throw e;
      throw new Error('The comp could not be read from Getty\u2019s media host \u2014 the clip ' +
        'can be played but not placed on a card. (' + (e && e.message || e) + ')');
    });
  }

  /* ---------------- the first frame ----------------
   *
   * The board draws a frame, and the frame a footage card should draw is the
   * first frame of the clip itself — NOT the poster thumbnail, which is about
   * 170px wide and prints like it. The comp is 720p or better, so its own
   * first frame is the best picture of this shot anyone has before it is
   * licensed.
   *
   * The bytes are already in hand, so they go in as an object URL: the
   * <video> reading it is same-origin, which means the canvas can never be
   * tainted and CORS cannot break the extraction. That was the one way this
   * could have been fragile and it is designed out rather than handled.
   *
   * Seeking is the fiddly part. `currentTime = 0` on a freshly loaded video
   * does not always have a decoded frame behind it, so this waits for a seek
   * to land and then checks the canvas is not uniformly blank before
   * believing it; a blank first frame (a clip that fades up from black is a
   * real thing) gets one nudge forward rather than a black card.
   */
  function firstFrame(blob) {
    if (deps.firstFrame) return deps.firstFrame(blob);       // test seam
    return new Promise(function (resolve, reject) {
      let url = '', done = false, tries = 0;
      const v = document.createElement('video');
      const finish = function (data, err) {
        if (done) return;
        done = true;
        clearTimeout(cap);
        try { v.removeAttribute('src'); v.load(); } catch (e) { }
        if (url) URL.revokeObjectURL(url);
        if (data) resolve(data); else reject(err || new Error('no frame'));
      };
      const grab = function () {
        try {
          const w = v.videoWidth, h = v.videoHeight;
          if (!w || !h) { finish(null, new Error('the clip reported no size')); return; }
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const ctx = c.getContext('2d');
          ctx.drawImage(v, 0, 0, w, h);
          /* A clip that opens on black would board as a black card. One
             nudge forward, once — this is not a hunt for a good frame, it is
             a guard against the degenerate one. */
          if (tries === 0 && blank(ctx, w, h) && isFinite(v.duration) && v.duration > 0.2) {
            tries++;
            v.currentTime = Math.min(0.25, v.duration / 10);
            return;
          }
          finish(c.toDataURL('image/png'));
        } catch (e) { finish(null, e); }
      };
      const cap = setTimeout(function () {
        finish(null, new Error('the clip did not decode in time'));
      }, 15000);
      v.muted = true;
      v.preload = 'auto';
      v.playsInline = true;
      v.onerror = function () { finish(null, new Error('the clip could not be decoded here')); };
      v.onseeked = grab;
      v.onloadeddata = function () {
        /* already at zero on most builds, in which case no seeked fires */
        if (v.currentTime === 0 && v.readyState >= 2) grab();
        else v.currentTime = 0;
      };
      try {
        url = URL.createObjectURL(blob);
        v.src = url;
        v.load();
      } catch (e) { finish(null, e); }
    });
  }

  /* Uniform to the eye: every sampled pixel within a few levels of the first.
   * Sampled rather than scanned — this runs on a 1080p frame. */
  function blank(ctx, w, h) {
    try {
      const step = Math.max(1, Math.floor(Math.min(w, h) / 16));
      const d = ctx.getImageData(0, 0, w, h).data;
      const at = function (x, y) { return (y * w + x) * 4; };
      const i0 = at(0, 0);
      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          const i = at(x, y);
          if (Math.abs(d[i] - d[i0]) > 6 || Math.abs(d[i + 1] - d[i0 + 1]) > 6 ||
            Math.abs(d[i + 2] - d[i0 + 2]) > 6) return false;
        }
      }
      return true;
    } catch (e) { return false; }     // a read that throws is not a blank frame
  }

  /* ---------------- the words for a filter ----------------
   *
   * Nothing here is derived from a card. The first cut mapped a card's shot
   * type onto Getty's `compositions` enum, which was the wrong shape twice
   * over: it made the drawer a function of the selected card when the
   * workflow is to find footage and then drag the shot up onto the board, and
   * it was an image filter chosen because it was the prettiest thing in the
   * API. These are the filters a person sets, and the words for them.
   */
  const WORDS = {
    horizontal: 'horizontal', vertical: 'vertical',
    sd: 'SD', hd: 'HD', '4k': '4K', hd_web: 'HD web',
    realtime: 'real time', time_lapse: 'time lapse', slow_motion: 'slow motion',
    color: 'colour', black_and_white: 'black and white', animation: 'animation',
    selective_focus: 'selective focus',
    lockdown: 'locked off', panning: 'pan', tracking_shot: 'tracking', aerial_view: 'aerial',
    high_angle_view: 'high angle', low_angle_view: 'low angle', tilt: 'tilt',
    point_of_view: 'POV',
    royaltyfree: 'royalty-free', rightsready: 'rights-ready'
  };
  function word(v) { return WORDS[v] || String(v).replace(/_/g, ' '); }

  /* What is filtering this search, in the words a person would use, each one
   * removable. Built from the filters that are SET — so an empty filter set
   * says so, instead of a row of chips nobody chose. */
  /* friendly name -> the name that goes on the wire */
  const WIRE = {
    orientations: 'orientations', aspects: 'aspect_ratios', formats: 'format_available',
    frameRates: 'frame_rates', techniques: 'image_techniques', viewpoints: 'viewpoints',
    licenses: 'license_models', minLength: 'min_clip_length', maxLength: 'max_clip_length',
    collections: 'collection_codes', sort: 'sort_order', safe: 'safe_search',
    excludeEditorialOnly: 'exclude_editorial_use_only'
  };

  function chips(f) {
    const out = [];
    const add = function (k, vals) {
      (vals || []).forEach(function (v) { out.push({ k: k, v: v, label: word(v) }); });
    };
    add('orientations', f.orientations);
    add('aspects', f.aspects);
    add('formats', f.formats);
    add('frameRates', (f.frameRates || []).map(String));
    add('techniques', f.techniques);
    add('viewpoints', f.viewpoints);
    add('licenses', f.licenses);
    if (f.minLength) out.push({ k: 'minLength', v: f.minLength, label: '\u2265 ' + f.minLength + 's' });
    if (f.maxLength) out.push({ k: 'maxLength', v: f.maxLength, label: '\u2264 ' + f.maxLength + 's' });
    if (f.excludeEditorialOnly !== false) {
      out.push({ k: 'excludeEditorialOnly', v: true, label: 'commercial use' });
    }
    return out;
  }

  /* The filters a search starts with. Two, both about the job rather than
   * about taste: a client video is commercial use, and nobody is boarding
   * from unsafe results. Everything else is empty until somebody picks it. */
  function defaultFilters() {
    return { safe: true, excludeEditorialOnly: true, sort: 'best_match' };
  }

  /* The enums the drawer offers, in the order it offers them. Here rather
   * than in the panel so the values and the words they are drawn with cannot
   * drift apart from the ones that go out on the wire. */
  const PICKERS = [
    { k: 'formats', label: 'format', values: ['hd', '4k', 'hd_web', 'sd'] },
    { k: 'orientations', label: 'orientation', values: ['horizontal', 'vertical'] },
    { k: 'frameRates', label: 'fps', values: ['23.98', '24', '25', '29.97', '30', '50', '59.94', '60'] },
    {
      k: 'techniques', label: 'technique',
      values: ['realtime', 'slow_motion', 'time_lapse', 'black_and_white', 'selective_focus', 'animation']
    },
    {
      k: 'viewpoints', label: 'camera',
      values: ['lockdown', 'panning', 'tracking_shot', 'aerial_view', 'high_angle_view',
        'low_angle_view', 'tilt', 'point_of_view']
    },
    { k: 'licenses', label: 'licence', values: ['royaltyfree', 'rightsready'] }
  ];

  SB.Getty = {
    /* the key */
    key: key, setKey: setKey, configured: configured, onChange: onChange,
    keepCompOff: keepCompOff, setKeepComp: setKeepComp,
    /* calls — footage only */
    searchVideos: searchVideos, searchVideosRaw: searchVideosRaw,
    similar: similar, byImage: byImage, describeRaw: describeRaw,
    uploadSearchImage: uploadSearchImage, fetchComp: fetchComp,
    /* shaping */
    asset: asset, record: record, posterUrl: posterUrl, bestStillUrl: bestStillUrl,
    compUrl: compUrl, byImageIgnores: byImageIgnores, BY_IMAGE_OK: BY_IMAGE_OK,
    thumbUrl: thumbUrl, previewUrl: previewUrl, clipSize: clipSize,
    seconds: seconds, clock: clock,
    assetIdFromUrl: assetIdFromUrl, recordFromUrl: recordFromUrl,
    /* the picture a card draws */
    firstFrame: firstFrame,
    /* filters, all of them set by hand */
    defaultFilters: defaultFilters, chips: chips, word: word, PICKERS: PICKERS,
    /* seams */
    deps: deps, FIELDS: FIELDS, BASE: BASE,
    calls: function () { return calls; }
  };

})(window.SB);
