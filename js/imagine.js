/* imagine.js — pushing a finished prompt at ImagineArt.
 *
 * Everything the prompt table needs to actually make the picture is already
 * sitting in the row: the prompt, the model it was written for, and the
 * full-size render the shot already has. Up to now the last step was manual —
 * copy the prompt, open a browser tab, find the frame in the renders folder,
 * drop it in. This closes that loop: one button, one generation.
 *
 * ---- the two doors ----
 *
 * ImagineArt (the company is Vyro AI) can be reached two ways, and they bill
 * differently, so both are here and the user picks:
 *
 *   oauth — sign in with the imagine.art account. A textbook OAuth 2.1 public
 *           client: open dynamic registration, PKCE S256, refresh tokens, no
 *           client secret. The token's audience is ImagineArt's hosted MCP
 *           server, so the work is done by calling MCP tools. Nothing to store
 *           or rotate, and it spends the credits the account already has.
 *
 *   key   — an API key from platform.imagine.art against the documented REST
 *           endpoints (api.vyro.ai/v2). Billed separately, but it is the
 *           surface whose image-upload contract is written down.
 *
 * There is one thing the public documentation does not say: whether an OAuth
 * access token is also accepted by the REST endpoints. If it is, the REST path
 * is strictly better for us — it takes a file upload, which is exactly what
 * image-to-video needs. So a signed-in session TRIES rest first, once, and
 * remembers the answer; if it is refused it never asks again and goes through
 * MCP tools for the rest of the session. The caller never sees which happened.
 *
 * ---- why the tool binding is defensive ----
 *
 * The REST contract is fixed and coded literally. The MCP tool list is not
 * published anywhere, and it changes as ImagineArt ships tools, so this asks
 * the server (tools/list), picks the tool whose name and description read like
 * the job, and fills its arguments by matching its own JSON schema against the
 * handful of things we have (prompt, model, aspect, a start frame). What it
 * chose is shown in Settings, because a guess the user cannot see is a guess
 * nobody can fix.
 *
 * ---- what is stored where ----
 *
 * Tokens and the API key live in localStorage, exactly like the Gemini key,
 * and never touch the .storyboard — a board stays safe to hand to someone. The
 * per-model slug and the aspect ratio DO belong to the project, because they
 * are part of how that board is made.
 */
(function (SB) {
  'use strict';

  /* ---------------- constants ---------------- */

  const RESOURCE = 'https://mcp.imagine.art/';
  const RESOURCE_META = 'https://mcp.imagine.art/.well-known/oauth-protected-resource';
  const REST = 'https://api.vyro.ai/v2';
  const MCP_PROTOCOL = '2025-06-18';
  const SCOPE = 'openid email mcp:tools';
  const CLIENT_NAME = 'Storyboarder';

  /* Read off the wire on 2026-09-11. Only used when discovery itself fails —
   * the metadata documents are the truth, and are fetched first every time. */
  const AS_FALLBACK = {
    issuer: 'https://auth.vyro.ai/apis/v1/mcp',
    authorization_endpoint: 'https://imagine.art/mcp/authorize',
    token_endpoint: 'https://auth.vyro.ai/apis/v1/mcp/token',
    registration_endpoint: 'https://auth.vyro.ai/apis/v1/mcp/register',
    userinfo_endpoint: 'https://auth.vyro.ai/apis/v1/mcp/userinfo',
    code_challenge_methods_supported: ['S256']
  };

  const K_TOK = 'sb.imagine.tokens';
  const K_CLIENT = 'sb.imagine.clients';
  const K_KEY = 'sb.imagine.apiKey';
  const K_MODE = 'sb.imagine.transport';
  const K_REST = 'sb.imagine.oauthRest';   // '' unknown | 'yes' | 'no'

  /* The slugs seen in ImagineArt's own documentation. The list is not
   * authoritative and is not meant to be: the field beside it takes free text,
   * and a signed-in session replaces it with whatever the account's own tool
   * schema advertises. */
  const SLUGS = {
    image: ['imagine-turbo', 'flux-dev', 'flux-dev-fast', 'flux-schnell',
      'sdxl-1.0', 'realistic', 'anime'],
    video: ['kling-1.0-pro', 'kling-1.0-standard', 'kling-v1.6-standard-image-to-video',
      'minimax-video-01-director-image-to-video']
  };

  /* Board model names are display names; a few map onto a slug with no
   * ambiguity worth worrying about. Everything else starts blank, which reads
   * honestly in Settings as "not pointed at anything yet". */
  const GUESS = {
    'Kling': 'kling-1.0-pro',
    'MiniMax H3 (Hailuo)': 'minimax-video-01-director-image-to-video',
    'FLUX': 'flux-dev'
  };

  /* ---------------- small helpers ---------------- */

  function lsGet(k) {
    try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; }
  }
  function lsSet(k, v) {
    try {
      if (v === null || v === undefined || v === '') localStorage.removeItem(k);
      else localStorage.setItem(k, JSON.stringify(v));
    } catch (e) { }
  }
  function lsStr(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lsPut(k, v) {
    try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) { }
  }

  function b64url(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function randomString(n) {
    const a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return b64url(a);
  }

  function sha256(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
      .then(function (buf) { return b64url(new Uint8Array(buf)); });
  }

  function form(obj) {
    const b = new URLSearchParams();
    Object.keys(obj).forEach(function (k) {
      if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') b.set(k, obj[k]);
    });
    return b;
  }

  function jsonOrText(res) {
    return res.text().then(function (t) {
      let body = null;
      try { body = JSON.parse(t); } catch (e) { body = null; }
      return { body: body, text: t };
    });
  }

  /* One shape for everything that comes back wrong, so the UI never has to
   * know which door it went through. ImagineArt's REST errors are
   * {status, code, error, message}; MCP's are JSON-RPC {code, message}. */
  function apiError(res, parsed) {
    const b = parsed && parsed.body;
    const msg = (b && (b.message || b.error)) ||
      (parsed && parsed.text && parsed.text.slice(0, 200)) ||
      ('HTTP ' + (res ? res.status : '?'));
    const e = new Error(String(msg));
    e.status = res ? res.status : 0;
    e.code = b && b.code;
    e.auth = e.status === 401 || e.status === 403 || e.code === 1000 ||
      e.code === 1001 || e.code === 1002;
    return e;
  }

  function blobToDataUrl(blob) {
    return new Promise(function (res, rej) {
      const r = new FileReader();
      r.onload = function () { res(String(r.result)); };
      r.onerror = function () { rej(new Error('could not read the generated file')); };
      r.readAsDataURL(blob);
    });
  }

  function dataUrlToBlob(url) {
    return fetch(url).then(function (r) { return r.blob(); });
  }

  function wait(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  /* ---------------- where the app is served from ----------------
   *
   * The redirect target is the app's own URL with the query and hash taken
   * off. Under file:// the origin is "null", which cannot be a redirect
   * target and cannot be registered — so sign-in is refused there with a
   * reason, and the API-key door stays open. The README already asks people to
   * serve the folder over http for IndexedDB; this is the same fix.
   */
  function redirectUri() {
    if (location.protocol === 'file:') return '';
    return location.origin + location.pathname;
  }

  function signInBlocked() {
    if (!redirectUri()) {
      return 'Signing in needs the app served over http — on file:// there is no address to ' +
        'come back to. Serve the folder (any static server) or use an API key below.';
    }
    if (!(window.crypto && crypto.subtle && crypto.getRandomValues)) {
      return 'This browser does not expose WebCrypto, which the sign-in needs for PKCE.';
    }
    return '';
  }

  /* ---------------- the callback ----------------
   *
   * The redirect comes back to this same page, so there is no second file to
   * ship — which matters for an app whose whole point is that it is one file.
   * A window that loads with a code AND has an opener is the popup: it hands
   * the code back and closes. The board itself never unloads, so the file
   * handle and everything unsaved survive the sign-in.
   */
  (function catchCallback() {
    if (!window.opener || window.opener === window) return;
    const q = new URLSearchParams(location.search);
    if (!q.get('code') && !q.get('error')) return;
    try {
      window.opener.postMessage({
        sb: 'imagine-oauth',
        code: q.get('code') || '',
        state: q.get('state') || '',
        error: q.get('error') || '',
        errorDescription: q.get('error_description') || ''
      }, location.origin);
    } catch (e) { }
    /* Leave something readable behind if the close is blocked. */
    try { document.documentElement.innerHTML = '<body style="font:14px system-ui;padding:24px">Signed in — you can close this window.</body>'; } catch (e) { }
    window.close();
  })();

  /* ---------------- discovery + registration ---------------- */

  let asMeta = null;

  function discover() {
    if (asMeta) return Promise.resolve(asMeta);
    return fetch(RESOURCE_META, { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (prm) {
        const as = (prm && prm.authorization_servers && prm.authorization_servers[0]) ||
          AS_FALLBACK.issuer;
        /* RFC 8414 puts the document under the issuer's host with the path
         * appended; the resource mirrors it too, and that copy is the one that
         * is certain to be reachable. */
        return fetch(RESOURCE + '.well-known/oauth-authorization-server',
          { headers: { Accept: 'application/json' } })
          .then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; })
          .then(function (meta) {
            if (meta && meta.token_endpoint) return meta;
            return fetch(as.replace(/\/+$/, '') + '/.well-known/oauth-authorization-server',
              { headers: { Accept: 'application/json' } })
              .then(function (r) { return r.ok ? r.json() : null; })
              .catch(function () { return null; });
          });
      })
      .catch(function () { return null; })
      .then(function (meta) {
        asMeta = (meta && meta.token_endpoint) ? meta : AS_FALLBACK;
        return asMeta;
      });
  }

  /* One registered client per redirect URI per browser. Registration is open —
   * no portal, no approval — but it is still a write, so the id is kept and
   * reused rather than making a new client on every sign-in. */
  function clientId(meta) {
    const uri = redirectUri();
    const all = lsGet(K_CLIENT) || {};
    if (all[uri]) return Promise.resolve(all[uri]);
    const ep = meta.registration_endpoint || AS_FALLBACK.registration_endpoint;
    return fetch(ep, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: CLIENT_NAME,
        redirect_uris: [uri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: SCOPE,
        application_type: 'web'
      })
    }).then(function (res) {
      return jsonOrText(res).then(function (p) {
        if (!res.ok || !p.body || !p.body.client_id) throw apiError(res, p);
        all[uri] = p.body.client_id;
        lsSet(K_CLIENT, all);
        return p.body.client_id;
      });
    });
  }

  /* ---------------- tokens ---------------- */

  function tokens() { return lsGet(K_TOK) || null; }
  function setTokens(t) { lsSet(K_TOK, t || ''); notify(); }

  function isSignedIn() {
    const t = tokens();
    return !!(t && t.access_token);
  }

  function signOut() {
    setTokens(null);
    lsPut(K_REST, '');
    mcp.session = null;
    mcp.ready = null;
    mcp.tools = null;
    acct = null;
    notify();
  }

  function exchange(body) {
    return discover().then(function (meta) {
      return fetch(meta.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form(body)
      }).then(function (res) {
        return jsonOrText(res).then(function (p) {
          if (!res.ok || !p.body || !p.body.access_token) throw apiError(res, p);
          const prev = tokens() || {};
          const t = {
            access_token: p.body.access_token,
            /* A refresh response that rotates the token replaces it; one that
             * does not must not blank the one we hold. */
            refresh_token: p.body.refresh_token || prev.refresh_token || '',
            expires_at: Date.now() + (((p.body.expires_in | 0) || 3600) * 1000),
            email: prev.email || ''
          };
          setTokens(t);
          return t;
        });
      });
    });
  }

  let refreshing = null;

  /* A live access token, refreshed 60s before it lapses. Rejects — it never
   * opens a popup on its own — so the caller can say "sign in again" instead
   * of a window appearing out of nowhere mid-generation. */
  function accessToken() {
    const t = tokens();
    if (!t || !t.access_token) return Promise.reject(new Error('Not signed in to ImagineArt.'));
    if (Date.now() < (t.expires_at || 0) - 60000) return Promise.resolve(t.access_token);
    if (!t.refresh_token) return Promise.reject(sessionOver());
    if (refreshing) return refreshing;
    refreshing = discover().then(function (meta) {
      return clientId(meta);
    }).then(function (cid) {
      return exchange({
        grant_type: 'refresh_token',
        refresh_token: t.refresh_token,
        client_id: cid,
        resource: RESOURCE,
        scope: SCOPE
      });
    }).then(function (fresh) {
      refreshing = null;
      return fresh.access_token;
    }).catch(function (e) {
      refreshing = null;
      setTokens(null);
      throw sessionOver(e);
    });
    return refreshing;
  }

  function sessionOver(e) {
    const err = new Error('The ImagineArt session has expired — sign in again in Settings → ImagineArt.');
    err.auth = true;
    err.cause = e;
    return err;
  }

  /* ---------------- sign in ---------------- */

  let signingIn = null;

  function signIn() {
    const why = signInBlocked();
    if (why) return Promise.reject(new Error(why));
    if (signingIn) return signingIn;

    const uri = redirectUri();
    const state = randomString(16);
    const verifier = randomString(48);

    /* The popup is opened synchronously, inside the click, or the browser
     * blocks it — the URL is filled in once discovery answers. */
    const win = window.open('', 'imagine-signin',
      'width=520,height=760,menubar=no,toolbar=no');
    if (!win) return Promise.reject(new Error('The sign-in window was blocked — allow popups for this page and try again.'));

    signingIn = Promise.all([discover(), sha256(verifier)]).then(function (both) {
      const meta = both[0], challenge = both[1];
      return clientId(meta).then(function (cid) {
        const url = meta.authorization_endpoint + '?' + form({
          response_type: 'code',
          client_id: cid,
          redirect_uri: uri,
          scope: SCOPE,
          state: state,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          /* RFC 8707 — says out loud which resource the token is for. */
          resource: RESOURCE
        }).toString();
        win.location = url;
        return awaitCode(win, state).then(function (code) {
          return exchange({
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: uri,
            client_id: cid,
            code_verifier: verifier,
            resource: RESOURCE
          });
        });
      });
    }).then(function (t) {
      signingIn = null;
      return whoAmI().catch(function () { return null; }).then(function () { return t; });
    }).catch(function (e) {
      signingIn = null;
      try { win.close(); } catch (x) { }
      throw e;
    });

    return signingIn;
  }

  /* Wait for the popup to hand back a code. Three ways this ends: the message
   * arrives, the user closes the window, or nothing happens for five minutes. */
  function awaitCode(win, state) {
    return new Promise(function (resolve, reject) {
      let done = false;
      const finish = function (fn, arg) {
        if (done) return;
        done = true;
        window.removeEventListener('message', onMsg);
        clearInterval(watch);
        clearTimeout(cap);
        fn(arg);
      };
      const onMsg = function (ev) {
        if (ev.origin !== location.origin) return;
        const d = ev.data;
        if (!d || d.sb !== 'imagine-oauth') return;
        if (d.error) {
          finish(reject, new Error(d.errorDescription || d.error));
          return;
        }
        if (d.state !== state) {
          finish(reject, new Error('The sign-in came back with the wrong state — it was not the window we opened.'));
          return;
        }
        finish(resolve, d.code);
      };
      window.addEventListener('message', onMsg);
      const watch = setInterval(function () {
        if (win.closed) finish(reject, new Error('Sign-in was cancelled.'));
      }, 500);
      const cap = setTimeout(function () {
        try { win.close(); } catch (e) { }
        finish(reject, new Error('Sign-in timed out.'));
      }, 5 * 60 * 1000);
    });
  }

  /* ---------------- who, and how many credits ---------------- */

  let acct = null;   // { email, credits, at }

  function account() { return acct; }

  function whoAmI() {
    return Promise.all([discover(), accessToken()]).then(function (both) {
      const meta = both[0], tok = both[1];
      const ep = meta.userinfo_endpoint || AS_FALLBACK.userinfo_endpoint;
      return fetch(ep, { headers: { Authorization: 'Bearer ' + tok, Accept: 'application/json' } })
        .then(function (res) {
          return jsonOrText(res).then(function (p) {
            if (!res.ok || !p.body) throw apiError(res, p);
            const email = p.body.email || p.body.sub || '';
            const t = tokens();
            if (t) { t.email = email; lsSet(K_TOK, t); }
            acct = { email: email, credits: acct && acct.credits, at: Date.now() };
            notify();
            return acct;
          });
        });
    });
  }

  /* Credits are a tool call, not an endpoint — ImagineArt exposes "balance
   * inquiry" through MCP. Best effort: a number if it can be found, nothing if
   * it cannot. Never blocks a generation. */
  function balance() {
    return callTool('balance', {}).then(function (out) {
      const n = firstNumber(out.text || '') ;
      acct = acct || { email: (tokens() || {}).email || '' };
      if (n !== null) acct.credits = n;
      acct.at = Date.now();
      notify();
      return acct;
    }).catch(function () { return acct; });
  }

  function firstNumber(s) {
    const m = /(-?\d[\d,]*(?:\.\d+)?)/.exec(String(s).replace(/\s+/g, ' '));
    if (!m) return null;
    const n = parseFloat(m[1].replace(/,/g, ''));
    return isFinite(n) ? n : null;
  }

  /* ---------------- MCP transport ----------------
   *
   * Streamable HTTP: one POST per JSON-RPC message, and the answer comes back
   * either as a JSON body or as an SSE stream carrying the same object. Both
   * are handled here so nothing above this cares.
   */
  const mcp = { session: null, ready: null, tools: null, id: 0 };

  function mcpPost(msg) {
    return accessToken().then(function (tok) {
      const headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': MCP_PROTOCOL,
        Authorization: 'Bearer ' + tok
      };
      if (mcp.session) headers['Mcp-Session-Id'] = mcp.session;
      return fetch(RESOURCE, { method: 'POST', headers: headers, body: JSON.stringify(msg) })
        .then(function (res) {
          const sid = res.headers.get('mcp-session-id');
          if (sid) mcp.session = sid;
          if (res.status === 202) return null;          // notification accepted
          return res.text().then(function (text) {
            const obj = parseRpc(text, msg.id);
            if (!res.ok) {
              if (res.status === 401 || res.status === 403) {
                /* The session died under us; a retry after a refresh is the
                 * caller's business, not this layer's. */
                const e = new Error('ImagineArt refused the token.');
                e.auth = true; e.status = res.status;
                throw e;
              }
              throw apiError(res, { body: obj && obj.error, text: text });
            }
            if (obj && obj.error) {
              const e = new Error(obj.error.message || 'ImagineArt returned an error.');
              e.code = obj.error.code;
              throw e;
            }
            return obj ? obj.result : null;
          });
        });
    });
  }

  /* A JSON body, or an SSE stream of them — take the frame that answers our id
   * (or the last one that carries a result, for a server that streams). */
  function parseRpc(text, id) {
    const t = String(text || '').trim();
    if (!t) return null;
    if (t.charAt(0) === '{' || t.charAt(0) === '[') {
      try {
        const j = JSON.parse(t);
        return Array.isArray(j) ? (j.filter(function (x) { return x.id === id; })[0] || j[0]) : j;
      } catch (e) { return null; }
    }
    let best = null;
    t.split(/\r?\n/).forEach(function (line) {
      const m = /^data:\s*(.*)$/.exec(line);
      if (!m || !m[1] || m[1] === '[DONE]') return;
      let j = null;
      try { j = JSON.parse(m[1]); } catch (e) { return; }
      if (j && (j.id === id || j.result || j.error)) best = j;
    });
    return best;
  }

  function mcpReady() {
    if (mcp.ready) return mcp.ready;
    mcp.ready = mcpPost({
      jsonrpc: '2.0', id: ++mcp.id, method: 'initialize',
      params: {
        protocolVersion: MCP_PROTOCOL,
        capabilities: {},
        clientInfo: { name: CLIENT_NAME, version: String(window.SB_BUILD || 'dev') }
      }
    }).then(function (r) {
      /* The notification is fire-and-forget; a server that does not want it
       * answers 202 or 404 and neither is worth failing over. */
      return mcpPost({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })
        .catch(function () { return null; })
        .then(function () { return r; });
    }).catch(function (e) {
      mcp.ready = null;
      throw e;
    });
    return mcp.ready;
  }

  function toolList(force) {
    if (mcp.tools && !force) return Promise.resolve(mcp.tools);
    return mcpReady().then(function () {
      return mcpPost({ jsonrpc: '2.0', id: ++mcp.id, method: 'tools/list', params: {} });
    }).then(function (r) {
      mcp.tools = (r && r.tools) || [];
      notify();
      return mcp.tools;
    });
  }

  /* ---- picking the tool for a job ----
   *
   * Scored rather than matched, because the names are ImagineArt's to change.
   * "text to image" and "generate_image" both have to win for image, and
   * neither must win for video.
   */
  const WANT = {
    image: { need: [/image|picture|photo/], plus: [/generat|create|text.?to.?image|txt2img/], minus: [/video|upscale|background|remove|music|audio|edit|lipsync|vector/] },
    video: { need: [/video|clip|animat/], plus: [/generat|create|text.?to.?video|image.?to.?video|i2v/], minus: [/upscale|extend|trim|lipsync|music|audio|frame|reframe/] },
    balance: { need: [/balance|credit/], plus: [/inquir|check|remaining/], minus: [] }
  };

  function score(tool, want) {
    const hay = ((tool.name || '') + ' ' + (tool.description || '')).toLowerCase();
    let s = 0;
    if (!want.need.some(function (re) { return re.test(hay); })) return -1;
    want.plus.forEach(function (re) { if (re.test(hay)) s += 2; });
    want.minus.forEach(function (re) { if (re.test(hay)) s -= 3; });
    /* A tool that takes an input image is the right one for image-to-video and
     * the wrong one for a plain still — decided by the caller, not here, so it
     * only breaks ties. */
    s += Math.max(0, 3 - (tool.name || '').length / 20);
    return s;
  }

  function pickTool(kind, opts) {
    return toolList().then(function (tools) {
      const want = WANT[kind];
      let best = null, bestScore = -1;
      tools.forEach(function (t) {
        let s = score(t, want);
        if (s < 0) return;
        if (opts && opts.needsImage) s += hasImageParam(t) ? 4 : -2;
        if (opts && opts.noImage && hasImageParam(t)) s -= 1;
        if (s > bestScore) { bestScore = s; best = t; }
      });
      if (!best) {
        throw new Error('The ImagineArt account exposes no ' + kind +
          ' tool — check Settings → ImagineArt for what it does offer.');
      }
      return best;
    });
  }

  function props(tool) {
    return (tool && tool.inputSchema && tool.inputSchema.properties) || {};
  }

  const IMAGE_PARAM = /^(image|image_url|image_uri|img|file|input_image|start_frame|first_frame|reference_image|init_image|source_image)$/i;

  function hasImageParam(tool) {
    return Object.keys(props(tool)).some(function (k) { return IMAGE_PARAM.test(k); });
  }

  /* ---- filling the arguments ----
   *
   * Canonical fields in, the tool's own property names out. Anything the
   * schema does not ask for is dropped rather than guessed at, and a required
   * enum with no value takes its first option so a call is not refused for
   * want of a field we have no opinion about.
   */
  const SYNONYM = {
    prompt: /^(prompt|text|description|input|query)$/i,
    slug: /^(model|style|model_name|model_id|engine|slug|variant)$/i,
    aspect: /^(aspect_ratio|aspectratio|ratio|aspect)$/i,
    duration: /^(duration|length|seconds|duration_seconds)$/i,
    image: IMAGE_PARAM,
    negative: /^(negative_prompt|negative)$/i
  };

  function bind(tool, canon) {
    const p = props(tool);
    const out = {};
    const used = {};
    Object.keys(canon).forEach(function (field) {
      const v = canon[field];
      if (v === undefined || v === null || v === '') return;
      const re = SYNONYM[field];
      if (!re) return;
      const hit = Object.keys(p).filter(function (k) { return re.test(k) && !used[k]; })[0];
      if (!hit) return;
      used[hit] = 1;
      const spec = p[hit] || {};
      if (spec.enum && spec.enum.indexOf(v) < 0) {
        /* The account's own list is the truth. A slug it does not know is the
         * user's to fix, so say so rather than silently sending something
         * else. */
        if (field === 'slug') {
          throw new Error('“' + v + '” is not one of the models this account offers (' +
            spec.enum.slice(0, 6).join(', ') + (spec.enum.length > 6 ? ', …' : '') + ').');
        }
        return;
      }
      out[hit] = (spec.type === 'number' || spec.type === 'integer') ? Number(v) : v;
    });
    ((tool.inputSchema && tool.inputSchema.required) || []).forEach(function (k) {
      if (out[k] !== undefined) return;
      const spec = p[k] || {};
      if (spec.default !== undefined) { out[k] = spec.default; return; }
      if (spec.enum && spec.enum.length) { out[k] = spec.enum[0]; return; }
    });
    return out;
  }

  function callTool(kind, canon, opts) {
    return pickTool(kind, opts).then(function (tool) {
      const args = bind(tool, canon);
      return mcpPost({
        jsonrpc: '2.0', id: ++mcp.id, method: 'tools/call',
        params: { name: tool.name, arguments: args }
      }).then(function (r) {
        if (r && r.isError) {
          throw new Error(harvest(r).text || 'ImagineArt refused the request.');
        }
        const got = harvest(r);
        got.tool = tool.name;
        return got;
      });
    });
  }

  /* What came back: inline bytes, a URL, or text that mentions one. */
  function harvest(result) {
    const out = { dataUrl: '', url: '', text: '', raw: result };
    if (!result) return out;
    const content = result.content || [];
    content.forEach(function (c) {
      if (!c) return;
      if ((c.type === 'image' || c.type === 'audio' || c.type === 'video') && c.data) {
        if (!out.dataUrl) out.dataUrl = 'data:' + (c.mimeType || 'image/png') + ';base64,' + c.data;
      } else if (c.type === 'resource' && c.resource) {
        if (c.resource.blob && !out.dataUrl) {
          out.dataUrl = 'data:' + (c.resource.mimeType || 'application/octet-stream') +
            ';base64,' + c.resource.blob;
        }
        if (c.resource.uri && !out.url && /^https?:/.test(c.resource.uri)) out.url = c.resource.uri;
      } else if (c.type === 'resource_link' && c.uri) {
        if (!out.url && /^https?:/.test(c.uri)) out.url = c.uri;
      } else if (c.type === 'text' && c.text) {
        out.text += (out.text ? '\n' : '') + c.text;
      }
    });
    const sc = result.structuredContent;
    if (sc) {
      out.text = out.text || JSON.stringify(sc);
      deepUrl(sc, out);
    }
    if (!out.url && out.text) {
      const m = /(https?:\/\/[^\s")'<>]+)/.exec(out.text);
      if (m) out.url = m[1];
    }
    return out;
  }

  function deepUrl(o, out, depth) {
    if (!o || out.url || (depth | 0) > 4) return;
    if (typeof o === 'string') {
      if (/^https?:\/\//.test(o)) out.url = o;
      return;
    }
    if (typeof o !== 'object') return;
    Object.keys(o).forEach(function (k) { deepUrl(o[k], out, (depth | 0) + 1); });
  }

  /* ---------------- REST transport ---------------- */

  function apiKey() { return lsStr(K_KEY); }
  function setApiKey(v) { lsPut(K_KEY, (v || '').trim()); notify(); }

  function transport() {
    const m = lsStr(K_MODE);
    return m === 'key' ? 'key' : 'oauth';
  }
  function setTransport(id) { lsPut(K_MODE, id === 'key' ? 'key' : 'oauth'); notify(); }

  /* The bearer to use against api.vyro.ai, or nothing if that door is shut for
   * this session. The OAuth token is offered ONCE; whether it is accepted is
   * remembered so a refused token is not tried again on every press. */
  function restBearer() {
    if (transport() === 'key') {
      const k = apiKey();
      return k ? Promise.resolve(k) : Promise.reject(new Error('No ImagineArt API key — add one in Settings → ImagineArt.'));
    }
    if (lsStr(K_REST) === 'no') return Promise.resolve(null);
    return accessToken().then(function (t) { return t; });
  }

  function restFetch(path, init) {
    return restBearer().then(function (bearer) {
      if (!bearer) return null;
      const o = init || {};
      o.headers = o.headers || {};
      o.headers.Authorization = 'Bearer ' + bearer;
      return fetch(REST + path, o).then(function (res) {
        /* A signed-in session learns here, once, whether its token is good for
         * the REST API at all. */
        if (transport() === 'oauth') {
          if (res.status === 401 || res.status === 403) {
            lsPut(K_REST, 'no');
            return null;
          }
          if (lsStr(K_REST) !== 'yes') lsPut(K_REST, 'yes');
        }
        return res;
      });
    });
  }

  function restImage(canon) {
    const fd = new FormData();
    fd.append('prompt', canon.prompt);
    fd.append('style', canon.slug);
    if (canon.aspect) fd.append('aspect_ratio', canon.aspect);
    return restFetch('/image/generations', { method: 'POST', body: fd }).then(function (res) {
      if (!res) return null;
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.indexOf('application/json') < 0) {
        return res.blob().then(function (b) { return { blob: b }; });
      }
      return jsonOrText(res).then(function (p) {
        /* Some models answer asynchronously even here. */
        if (res.ok && p.body && p.body.id) return pollAsset(p.body.id, canon.onState);
        throw apiError(res, p);
      });
    });
  }

  function restVideo(canon) {
    const fd = new FormData();
    fd.append('prompt', canon.prompt);
    fd.append('style', canon.slug);
    if (canon.aspect) fd.append('aspect_ratio', canon.aspect);
    const path = canon.frame ? '/video/image-to-video' : '/video/text-to-video';
    if (canon.frame) fd.append('file', canon.frame, canon.frameName || 'frame.png');
    return restFetch(path, { method: 'POST', body: fd }).then(function (res) {
      if (!res) return null;
      return jsonOrText(res).then(function (p) {
        if (!res.ok || !p.body || !p.body.id) throw apiError(res, p);
        return pollAsset(p.body.id, canon.onState);
      });
    });
  }

  /* Video is minutes, not seconds. Back off from 2s to 10s, give up at ten
   * minutes, and report each look so a row can show that it is still alive. */
  function pollAsset(id, onState) {
    const started = Date.now();
    let gap = 2000;
    const look = function () {
      return restFetch('/assets/' + encodeURIComponent(id) + '/status', { method: 'GET' })
        .then(function (res) {
          if (!res) throw new Error('ImagineArt stopped accepting the session mid-job.');
          return jsonOrText(res).then(function (p) {
            if (!res.ok) throw apiError(res, p);
            const body = p.body || {};
            const asset = body.video || body.image || body.asset || body;
            const st = String(asset.status || body.status || '').toLowerCase();
            const url = (asset.url && (asset.url.generation || asset.url.output)) ||
              asset.url || '';
            if (url && (st === 'finished' || st === 'success' || st === 'completed')) {
              return {
                url: typeof url === 'string' ? url : '',
                thumb: (asset.url && asset.url.thumbnail) || ''
              };
            }
            if (st === 'failed' || st === 'error') {
              throw new Error(asset.message || body.message || 'ImagineArt could not finish that one.');
            }
            if (Date.now() - started > 10 * 60 * 1000) {
              throw new Error('Gave up waiting after ten minutes. The job may still finish on imagine.art.');
            }
            if (onState) onState('waiting', Date.now() - started);
            return wait(gap).then(function () {
              gap = Math.min(10000, Math.round(gap * 1.4));
              return look();
            });
          });
        });
    };
    return look();
  }

  /* ---------------- the two things the app asks for ---------------- */

  function aspectOf(p) {
    return (p && p.settings && p.settings.imagineAspect) || '16:9';
  }

  function slugOf(model) {
    return (model && (model.imagineSlug || '').trim()) || '';
  }

  /* Why a push cannot happen yet, or '' if it can. Said in one place so the
   * button's tooltip and the Settings panel never disagree. */
  function blocker(model) {
    if (transport() === 'key') {
      if (!apiKey()) return 'No ImagineArt API key — Settings → ImagineArt.';
    } else if (!isSignedIn()) {
      return 'Not signed in to ImagineArt — Settings → ImagineArt.';
    }
    if (!slugOf(model)) {
      return 'This model has no ImagineArt model set — Settings → Models & templates.';
    }
    return '';
  }

  /* One still. Resolves to {blob, dataUrl}. */
  function image(opts) {
    const canon = {
      prompt: opts.prompt, slug: opts.slug,
      aspect: opts.aspect, onState: opts.onState
    };
    return restImage(canon).then(function (got) {
      if (got) return finishImage(got);
      return callTool('image', canon, { noImage: !opts.frame }).then(finishImage);
    });
  }

  function finishImage(got) {
    if (got.blob) {
      return blobToDataUrl(got.blob).then(function (d) { return { blob: got.blob, dataUrl: d }; });
    }
    if (got.dataUrl) {
      return dataUrlToBlob(got.dataUrl).then(function (b) {
        return { blob: b, dataUrl: got.dataUrl };
      });
    }
    if (got.url) {
      /* The CDN may or may not allow a cross-origin read. If it does we get the
       * original bytes; if it does not, the URL is still worth handing back. */
      return fetch(got.url).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.blob();
      }).then(function (b) {
        return blobToDataUrl(b).then(function (d) { return { blob: b, dataUrl: d, url: got.url }; });
      }).catch(function () {
        return { blob: null, dataUrl: '', url: got.url };
      });
    }
    throw new Error('ImagineArt answered without a picture' + (got.text ? ': ' + got.text.slice(0, 160) : '.'));
  }

  /* One clip. `frame` is a Blob to animate from, or nothing for text-to-video.
   * Resolves to {blob, url, thumb} — blob may be null if the CDN refuses a
   * cross-origin read, and the URL is then all there is. */
  function video(opts) {
    const canon = {
      prompt: opts.prompt, slug: opts.slug, aspect: opts.aspect,
      duration: opts.duration, frame: opts.frame, frameName: opts.frameName,
      onState: opts.onState
    };
    return restVideo(canon).then(function (got) {
      if (got) return finishVideo(got);
      return (opts.frame ? blobToDataUrl(opts.frame) : Promise.resolve(''))
        .then(function (dataUrl) {
          const c2 = {
            prompt: canon.prompt, slug: canon.slug, aspect: canon.aspect,
            duration: canon.duration, image: dataUrl || undefined
          };
          return callTool('video', c2, { needsImage: !!opts.frame, noImage: !opts.frame });
        })
        .then(finishVideo);
    });
  }

  function finishVideo(got) {
    const url = got.url || '';
    if (got.blob) return Promise.resolve({ blob: got.blob, url: url, thumb: got.thumb || '' });
    if (got.dataUrl) {
      return dataUrlToBlob(got.dataUrl).then(function (b) {
        return { blob: b, url: url, thumb: got.thumb || '' };
      });
    }
    if (!url) {
      throw new Error('ImagineArt answered without a clip' + (got.text ? ': ' + got.text.slice(0, 160) : '.'));
    }
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.blob();
    }).then(function (b) {
      return { blob: b, url: url, thumb: got.thumb || '' };
    }).catch(function () {
      return { blob: null, url: url, thumb: got.thumb || '' };
    });
  }

  /* ---------------- jobs ----------------
   *
   * A clip takes minutes and the prompt table re-renders on every keystroke,
   * so what is in flight cannot live on a DOM node. It lives here, keyed by
   * shot and role, and the table reads it. Closing the panel mid-job and
   * opening it again finds the job exactly where it was.
   */
  const JOBS = {};
  const LISTENERS = [];

  function key(shotId, role) { return shotId + ':' + role; }

  function job(shotId, role) { return JOBS[key(shotId, role)] || null; }
  function busy(shotId, role) {
    const j = job(shotId, role);
    return !!(j && (j.state === 'working' || j.state === 'waiting'));
  }

  function onChange(fn) {
    LISTENERS.push(fn);
    return function () {
      const i = LISTENERS.indexOf(fn);
      if (i >= 0) LISTENERS.splice(i, 1);
    };
  }

  let pending = null;
  function notify() {
    /* Several fields move at once at the start and end of a job; one repaint
     * covers them. */
    if (pending) return;
    pending = setTimeout(function () {
      pending = null;
      LISTENERS.slice().forEach(function (fn) {
        try { fn(); } catch (e) { }
      });
    }, 0);
  }

  function start(shotId, role) {
    const j = { shotId: shotId, role: role, state: 'working', started: Date.now(), error: '' };
    JOBS[key(shotId, role)] = j;
    notify();
    return j;
  }

  function endJob(shotId, role, error) {
    const k = key(shotId, role);
    const j = JOBS[k];
    if (!j) return;
    if (error) {
      j.state = 'error';
      j.error = error.message || String(error);
      j.ended = Date.now();
      /* An error stays on the row until the next press — it is the only place
       * the reason is written down. */
    } else {
      delete JOBS[k];
    }
    notify();
  }

  function clear(shotId, role) {
    delete JOBS[key(shotId, role)];
    notify();
  }

  /* ---------------- run one ----------------
   *
   * The single entry point the prompt table uses: one press, one generation,
   * results filed where the rest of the app already looks for them.
   */
  function run(shot, role) {
    const p = SB.app.project;
    if (busy(shot.id, role)) return Promise.resolve(null);

    const model = role === 'image' ? SB.Model.imageModel(p) : SB.Model.videoModel(p);
    const why = blocker(model);
    if (why) return Promise.reject(new Error(why));

    const pr = shot.prompts && shot.prompts[model.id];
    const text = pr && (role === 'image' ? pr.imagePrompt : pr.videoPrompt);
    if (!(text || '').trim()) {
      return Promise.reject(new Error('There is no ' +
        (role === 'image' ? 'first-frame' : 'video') + ' prompt on this shot yet.'));
    }

    const j = start(shot.id, role);
    const state = function (s) { j.state = s; notify(); };

    const work = role === 'image'
      ? image({ prompt: text, slug: slugOf(model), aspect: aspectOf(p), onState: function () { state('waiting'); } })
        .then(function (got) { return fileImage(p, shot, got); })
      : startFrame(p, shot).then(function (frame) {
        return video({
          prompt: text, slug: slugOf(model), aspect: aspectOf(p),
          frame: frame && frame.blob, frameName: frame && frame.name,
          onState: function () { state('waiting'); }
        });
      }).then(function (got) { return fileVideo(p, shot, got); });

    return work.then(function (out) {
      endJob(shot.id, role);
      return out;
    }).catch(function (e) {
      endJob(shot.id, role, e);
      throw e;
    });
  }

  /* The frame a clip animates from: the full-size render if the folder has it,
   * the board's own proxy if not, and nothing at all if the shot has no
   * picture — which is a text-to-video, not a failure. */
  function startFrame(p, shot) {
    return SB.Renders.file(p, shot.render).then(function (f) {
      if (f) return { blob: f, name: f.name };
      const src = shot.image ? SB.Blobs.src(p, shot.image) : '';
      if (!src) return null;
      return dataUrlToBlob(src).then(function (b) { return { blob: b, name: 'frame.jpg' }; });
    }).catch(function () { return null; });
  }

  /* A generated still is filed exactly like a dropped one — proxy on the
   * board, original in the renders folder under its serial, the take it
   * replaced moved aside. Which is the point: the next shot can reference it
   * ten seconds later. */
  function fileImage(p, shot, got) {
    if (!got.blob) {
      throw new Error('ImagineArt made the picture but this browser could not read it back' +
        (got.url ? ' — it is at ' + got.url : '.'));
    }
    return SB.Board.setImage(shot, got.blob).then(function () {
      return { kind: 'image' };
    });
  }

  function fileVideo(p, shot, got) {
    const rec = { at: Date.now(), url: got.url || '', thumb: got.thumb || '' };
    if (!got.blob) {
      /* No bytes to keep: hold the remote copy and be honest that it expires. */
      shot.video = rec;
      SB.app.changed(true);
      return Promise.resolve({ kind: 'video', remoteOnly: true });
    }
    return SB.Renders.keepVideo(p, got.blob, shot.video).then(function (saved) {
      shot.video = saved ? {
        serial: saved.serial, ext: saved.ext, bytes: saved.bytes,
        at: saved.at, url: rec.url, thumb: rec.thumb
      } : rec;
      SB.app.changed(true);
      return { kind: 'video', remoteOnly: !saved };
    });
  }

  /* ---------------- what Settings shows ---------------- */

  /* The slug list for a kind: the account's own, where a tool schema offers
   * one, and the documented list otherwise. */
  function catalog(kind) {
    const fromTools = [];
    (mcp.tools || []).forEach(function (t) {
      const p = props(t);
      Object.keys(p).forEach(function (k) {
        if (!SYNONYM.slug.test(k)) return;
        (p[k].enum || []).forEach(function (v) {
          if (fromTools.indexOf(v) < 0) fromTools.push(v);
        });
      });
    });
    if (!fromTools.length) return SLUGS[kind] ? SLUGS[kind].slice() : [];
    /* The enums are not split by kind, so filter by the obvious words and fall
     * back to everything when that leaves nothing. */
    const re = kind === 'video' ? /video|kling|veo|sora|runway|minimax|wan|ltx|seedance|hailuo/i
      : /image|flux|sdxl|imagine|turbo|photo|qwen|ideogram|banana|imagen|midjourney/i;
    const hit = fromTools.filter(function (v) { return re.test(v); });
    return hit.length ? hit : fromTools;
  }

  /* ---------------- playing one back ----------------
   *
   * A clip lives in the renders folder, not in the project, so "play it" means
   * reading the file back through the handle we already hold — and falling
   * back to the remote copy for a board opened on a machine that has no folder
   * connected, where the link is all there is and will not last.
   */
  function playClip(p, shot) {
    const rec = shot && shot.video;
    if (!rec) return;
    SB.Renders.videoFile(p, rec).then(function (f) {
      const src = f ? URL.createObjectURL(f) : (rec.url || '');
      if (!src) {
        SB.toast('That clip is not in the renders folder and its link has gone', true);
        return;
      }
      const box = SB.el('div', 'clip-box');
      const v = document.createElement('video');
      v.src = src;
      v.controls = true;
      v.autoplay = true;
      v.loop = true;
      box.appendChild(v);
      if (!f && rec.url) {
        box.appendChild(SB.el('div', 'pp-note',
          'Played from ImagineArt — this board has no copy of its own, and the link expires.'));
      }
      SB.modal({
        title: 'Clip',
        width: '760px',
        body: box,
        buttons: [{ label: 'Close', primary: true }],
        onClose: function () {
          v.pause();
          if (f) URL.revokeObjectURL(src);
        }
      });
    });
  }

  SB.Clip = { play: playClip };

  SB.Imagine = {
    /* config */
    transport: transport, setTransport: setTransport,
    apiKey: apiKey, setApiKey: setApiKey,
    signInBlocked: signInBlocked, redirectUri: redirectUri,
    /* auth */
    signIn: signIn, signOut: signOut, isSignedIn: isSignedIn,
    account: account, whoAmI: whoAmI, balance: balance,
    /* discovery, for the Settings readout */
    discover: discover, toolList: toolList, tools: function () { return mcp.tools || []; },
    restVerdict: function () { return lsStr(K_REST); },
    catalog: catalog, SLUGS: SLUGS, guessSlug: function (name) { return GUESS[name] || ''; },
    /* work */
    ready: function (model) { return !blocker(model); },
    blocker: blocker, slugOf: slugOf, aspectOf: aspectOf,
    image: image, video: video, run: run,
    /* jobs */
    job: job, busy: busy, clear: clear, onChange: onChange,
    /* exposed for the tests */
    _bind: bind, _pickScore: score, _harvest: harvest, _parseRpc: parseRpc
  };

})(window.SB);
