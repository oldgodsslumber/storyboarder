# ImagineArt in Storyboarder — integration plan

Status: **built** (branch `V3`). This is the design note the work was done from; §1–2 are the facts read off the wire and are still the reference. §3 is the one part that could not be settled from outside an account — the code now settles it at runtime instead (see `js/imagine.js`), so nothing here is waiting on a spike.

## 1. What ImagineArt's OAuth actually is

ImagineArt (company: Vyro AI) exposes **one** real OAuth surface today: the one behind its
hosted MCP server. Everything below was read live from the wire on 2026-09-11.

```
https://mcp.imagine.art/.well-known/oauth-protected-resource
  authorization_servers: ["https://auth.vyro.ai/apis/v1/mcp"]
  resource:              "https://mcp.imagine.art/"
  scopes_supported:      ["openid", "email", "mcp:tools"]
  bearer_methods:        ["header"]

AS metadata (mirrored at mcp.imagine.art/.well-known/oauth-authorization-server)
  issuer                 https://auth.vyro.ai/apis/v1/mcp
  authorization_endpoint https://imagine.art/mcp/authorize        <- on the web app, not the API host
  token_endpoint         https://auth.vyro.ai/apis/v1/mcp/token
  registration_endpoint  https://auth.vyro.ai/apis/v1/mcp/register  <- open dynamic registration
  userinfo_endpoint      https://auth.vyro.ai/apis/v1/mcp/userinfo
  introspection_endpoint https://auth.vyro.ai/apis/v1/mcp/introspect
  grant_types            authorization_code, refresh_token
  response_types         code
  code_challenge_methods S256                                      <- PKCE, required
  token_endpoint_auth    none | client_secret_post | client_secret_basic
```

Read that as: **a textbook OAuth 2.1 public-client flow.** No client secret needed
(`none`), PKCE S256 mandatory, refresh tokens issued, and the client is created at runtime
by POSTing to `/register` — no developer portal, no pre-registration, no approval. An empty
`POST /register` answers `{"error":"invalid_redirect_uri","error_description":"redirect_uris is required"}`,
so `redirect_uris` is the one thing it insists on; we can register whatever origin the app
happens to be served from, at first sign-in.

Unauthenticated calls to the resource answer correctly for discovery:

```
POST https://mcp.imagine.art/  ->  401
www-authenticate: Bearer realm="oauth", resource_metadata="https://mcp.imagine.art/.well-known/oauth-protected-resource"
{"error":"missing or invalid bearer token"}
```

**CORS is wide open on every host we need** — `auth.vyro.ai`, `mcp.imagine.art` and
`api.vyro.ai` all echo the request Origin, allow `Authorization`, and cache the preflight for
a day. They echo `Origin: null` too, so even a `file://` page is *not* blocked by CORS.
(`file://` is still blocked from signing in, for a different reason — see §4.)

What the token buys: the audience is the **MCP server**, scope `mcp:tools`. Signing in gets
ImagineArt's tool set — text-to-image, text-to-video, upscale, background removal, music,
balance inquiry, plus the Fashion/Ad studio recipes — billed against the account's existing
imagine.art credits, with no API key to store or rotate. That is the headline: *the team's
existing ImagineArt seats pay for this, not a second API bill.*

## 2. The other door: the documented REST API

Separate from OAuth, ImagineArt has a plain API-key REST surface. It is the better-documented
of the two and it definitely accepts an uploaded image, which matters to us:

```
POST https://api.vyro.ai/v2/image/generations        multipart: prompt, style, aspect_ratio, seed
     -> 200 with the image BYTES in the body (synchronous)
POST https://api.vyro.ai/v2/video/text-to-video      multipart: prompt, style, aspect_ratio
POST https://api.vyro.ai/v2/video/image-to-video     multipart: prompt, style, file=@frame.png
     -> {"id": "...", "status": "processing"}
GET  https://api.vyro.ai/v2/assets/{id}/status
     -> {"status":"success","video":{"uuid":…,"status":"finished","url":{"generation":…,"thumbnail":…}}}
Authorization: Bearer <API key from platform.imagine.art>
Errors: {status, code, error, message} — 1000/1001 auth, 110x validation, 120x service
Rate limit: x-ratelimit-limit: 50 / 60s
```

`style` is the model slug (`imagine-turbo`, `flux-dev`, `flux-schnell`, `sdxl-1.0`,
`kling-1.0-pro`, `kling-v1.6-standard-image-to-video`,
`minimax-video-01-director-image-to-video`, …).

**Recommendation:** build one `SB.Imagine` façade with two interchangeable transports —
`oauth` (MCP) and `key` (v2 REST). Ship OAuth as the default, because it is what was asked for
and it spends credits the team already has; keep the key transport because it is the one whose
image-upload contract is fully documented today. The prompt page calls the façade and never
knows which is live.

## 3. Three things a 30-minute spike must settle first

These need one signed-in account and cannot be answered from public docs:

1. **Does the OAuth access token authenticate `api.vyro.ai/v2/*`?** If yes, the design
   collapses to the happy case: OAuth for sign-in, the documented v2 endpoints for the work,
   image upload included. If no, OAuth work has to go through MCP tool calls.
2. **MCP tool schemas** — `tools/list` over streamable HTTP. Specifically: exact tool names,
   how a model is chosen, and **how an input image is passed** (public URL vs base64). A
   URL-only signature is a blocker for image-to-video, because our frames are local files; the
   fallback is then the key transport, or an upload tool if one exists.
3. **The model slug catalog** the account may use, to map onto the board's model list (§6).

Everything below is written so that only the transport module changes if answer #1 is "no".

## 4. Sign-in flow in a single-file, serverless app

- **Discovery, then registration, then PKCE.** On first "Sign in": fetch the protected-resource
  metadata, fetch the AS metadata it points at, `POST /register` with
  `redirect_uris:[location.origin + location.pathname]`, `token_endpoint_auth_method:"none"`,
  `grant_types:["authorization_code","refresh_token"]`. Cache the returned `client_id` in
  `localStorage` keyed by that exact redirect URI, so registration happens once per machine.
- **No second file.** The redirect URI is the app's own URL. At boot, if `location.search`
  carries `code` + `state` *and* `window.opener` exists, the page is a callback: it
  `postMessage`s the code to the opener and closes itself. The board never unloads.
- **Popup, not top-level redirect.** Storyboarder autosaves through a file handle and holds
  unsaved UI state; a full-page redirect would drop the file permission grant. Open
  `https://imagine.art/mcp/authorize?…` in a 480×720 popup, random `state`, verifier in
  `sessionStorage`.
- **Token exchange** at `auth.vyro.ai/apis/v1/mcp/token` (CORS-clean), store
  `{access_token, refresh_token, expires_at, email}` in **`localStorage` only** — the same rule
  as the Gemini key: never written into the `.storyboard`, so a board stays safe to hand over.
  Refresh silently on expiry and on any 401; on refresh failure, fall back to signed-out.
- **`file://` cannot sign in.** A `null` origin is not a usable redirect target. The README
  already tells people to serve the folder over http for IndexedDB; the Imagine tab says the
  same and offers the API-key transport as the no-server path.

## 5. New module: `js/imagine.js`

```
SB.Imagine = {
  // auth
  signIn(), signOut(), isSignedIn(), account(),      // email + credit balance
  // work — one call per button press
  image({ prompt, slug, aspect, refs })            -> Promise<Blob>,
  video({ prompt, slug, aspect, startFrame, duration }) -> Promise<{blob, url, thumb}>,
  // long jobs
  jobs()                                             // live map, survives panel close
}
```

- Transport A (`oauth`): JSON-RPC over streamable HTTP to `https://mcp.imagine.art/`,
  `Accept: application/json, text/event-stream`, `MCP-Protocol-Version` header, `initialize`
  once per session, then `tools/call`. Parse either a JSON body or an SSE stream.
- Transport B (`key`): multipart to `api.vyro.ai/v2/*`, exactly as §2.
- **The job registry lives in the module, not in the panel.** Video takes minutes and the
  prompt table re-renders constantly, so polling must not be owned by a DOM node. Entries are
  `{shotId, role, state, id, started, error}`; poll `assets/{id}/status` on a backoff
  (2s → 10s, cap ~10 min), one in-flight job per shot+role, and stay under the 50/min ceiling.

## 6. Model mapping

Board models are display names (`Kling`, `Veo`, `MiniMax H3 (Hailuo)`, `Nano Banana`, …) and
already carry per-model prompt templates. Add one field, `imagineSlug`, to each entry in
`p.settings.models`, edited in **Settings → Models & templates** beside the name (a select
seeded from a catalog constant, plus free text for anything new). Migration in `model.js`
prefills the obvious ones and leaves the rest blank. A model with no slug simply shows
"not on Imagine" where the push button would be — the prompt still writes and copies as today.

## 7. The prompt page (`js/promptpanel.js`)

Each prompt cell footer is already `[cast changed] [copy] ——— [✦ generate]`, where generate
writes the *text*. One more button joins it, and the wording keeps the two apart:

- first-frame column → `▶ render` — one image from that exact prompt, on the image model.
- video column → `▶ shoot` — one clip. Image-to-video from the shot's own full-size render
  when there is one (`sh.render` via `SB.Renders.file`), text-to-video when there is not; the
  tooltip says which it will do.

Rules: disabled with no prompt text, no slug, or no sign-in (the tooltip says which). One
press = one generation, never automatic, never batched. Video confirms first, with the credit
cost when the account exposes it. While a job runs the button becomes a pill (`queued · 0:42`)
driven off the job registry, so closing and reopening the panel is harmless. The table header
gains an account chip: `signed in as …  ·  N credits  ·  sign out`.

## 8. Where results land

- **Image** — reuse the existing path wholesale: proxy at ≤480p into `sh.image` via
  `SB.Blobs`, original through `SB.Renders.keep(p, blob, sh.render)`. That gets serials,
  `_versions` archiving of the previous take, and the feed folder for free. A generated frame
  is then indistinguishable from a dropped one, which is the point — the next shot can
  reference it immediately.
- **Video** — nothing stores video today. Add `_video/NNNN.mp4` under the project folder
  (`SB.Renders` gains a `keepVideo`, sharing `claim`/`archive`), record
  `sh.video = {serial, ext, bytes, at, url}` where `url` is the remote copy for instant preview
  while the download runs, and show a play affordance on the row and the card. With no renders
  folder connected, keep the remote URL only and say plainly that it expires.

## 9. Files touched

| File | Change |
|---|---|
| `js/imagine.js` | **new** — discovery, DCR, PKCE, tokens, both transports, job registry |
| `js/store.js` | token get/set (localStorage, never in the project file) |
| `js/settings.js` | new **Imagine** tab: sign in/out, account + credits, transport choice, API-key box, the `file://` explanation |
| `js/model.js` | `imagineSlug` on models + migration |
| `js/promptpanel.js` | the two push buttons, job pills, account chip |
| `js/renders.js` | `keepVideo` |
| `js/board.js` | play affordance on a card that has a clip |
| `index.html`, `build.mjs` | script tag; rebuild `storyboarder.html` |
| `test-*.mjs` | job-registry and mapping tests against a stubbed transport |
| `README.md`, `storyboard_app_spec.md` | the spec currently calls ImagineArt "the access platform, not itself a model" — that stops being true here |

## 10. Order of work

1. Spike the three unknowns (§3).
2. `imagine.js` auth only + the Settings tab — success is "signed in as …, N credits".
3. Image push on the first-frame column, straight into the existing render plumbing.
4. Model slugs + mapping UI.
5. Video push: job registry, polling, `_video/` storage, preview.
6. Tests, README/spec, rebuild.

Steps 2–3 are the demo; step 5 is the one with real unknowns in it.
