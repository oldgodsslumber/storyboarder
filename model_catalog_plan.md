# Keeping the ImagineArt model list current — plan

Status: **built** — `fetch-models.mjs` generates `js/imaginemodels.js`; the account list, the cache, the refresh triggers and the Settings line are in `js/imagine.js` and `js/settings.js`. Kept for the reasoning, and for the two things below that are still open: whether `/v2/models` exists (needs a token), and labels — the listing page does not publish one a script can rely on, so names are derived from the slug.

## Why you only see four

The slug field in **Settings → Models & templates** offers `SB.Imagine.catalog(kind)`, and
with nobody signed in that returns a constant I typed by hand from ImagineArt's own docs on
2026-09-11 — seven image slugs and **four** video ones:

```js
image: imagine-turbo, flux-dev, flux-dev-fast, flux-schnell, sdxl-1.0, realistic, anime
video: kling-1.0-pro, kling-1.0-standard, kling-v1.6-standard-image-to-video,
       minimax-video-01-director-image-to-video
```

`catalog()` does already prefer the account's own list when there is one — it scrapes `enum`
values off the MCP tool schemas — but only if `tools/list` has been fetched in this session,
and it splits image from video with a name-matching regex rather than knowing which tool an
enum came from. Nothing refreshes, nothing is cached between sessions, and nothing on screen
says which of the two lists you are looking at. So the honest reading of "I only see four" is:
*the app is showing you my notes, not your account.*

## What "check in each time" should mean

Not background polling — this is a static page with no server, and a page that phones home on
a timer is a page that fails differently every time. Four triggers, all tied to something the
user just did:

| When | What |
|---|---|
| Sign-in completes | fetch the catalog, cache it |
| Settings opens, cache older than 24h | refresh in the background, repaint the field when it lands |
| **Refresh models** pressed | always, and say what changed |
| A push is refused for an unknown slug | that refusal is the catalog telling us it moved — refresh, then re-offer |

Never block the dialog on the network: draw from cache, repaint when the answer arrives.

## Where the list comes from

In priority order:

1. **The account's MCP tools** (`tools/list`, already implemented). For each tool, read the
   `enum` of its model/style property and tag those slugs with the tool's own kind — image
   tool, video tool — instead of guessing by name. This is authoritative: it is exactly the
   set that account may call.
2. **A REST catalog endpoint, if one exists.** `GET /v2/models` answers `400 "bearer token is
   missing"` — but so does `/v2/definitely-not-a-real-endpoint`, so the auth guard runs before
   routing and nothing can be concluded from outside. One signed-in probe of `/v2/models`,
   `/v2/styles` and `/v2/image/models` settles it; if one answers, it becomes source 1 for the
   key transport, which today has no catalog at all.
3. **The built-in list**, as the floor. Labelled as such.

The field stays free text regardless: a slug that arrives before this app hears about it must
always be typeable.

## Shape

```js
SB.Imagine.catalog(kind)            // unchanged signature, now cache-backed
SB.Imagine.refreshCatalog()         // -> {image:[], video:[], at, source, added:[], gone:[]}
SB.Imagine.catalogAge()             // ms, or null if never fetched
```

Cached in `localStorage` under `sb.imagine.catalog`, keyed by account (email) and transport,
because two accounts on one machine do not see the same models. Never in the `.storyboard` —
it is a fact about an account, not about a board, exactly like the token.

Each entry carries what the UI needs to be useful rather than just complete:

```js
{ slug: 'kling-v2.1-master', kind: 'video', label: 'Kling v2.1 Master',
  from: 'account' | 'built-in', seen: 1757… }
```

## What it changes on screen

**Settings → ImagineArt** gains a models line under the account chip:

```
Models   38 from your account — checked 4 minutes ago        [ Refresh ]
         23 image · 15 video
```

…and when there is no account: *"Showing the built-in list (7 image, 4 video). Sign in and
this becomes whatever your account actually offers."* A refresh that changes anything says so
in the toast: *"4 new models, 1 gone — Kling 1.0 Standard is no longer offered."*

**Settings → Models & templates**: the datalist is grouped by kind and filtered to the kind of
the model being edited (a video model should never be offered `flux-dev`). A board model whose
slug is no longer in the catalog gets an amber mark and the reason — *"ImagineArt no longer
offers `kling-1.0-standard`"* — so it is found at the desk rather than at the push.

## Edges that have to behave

- **Offline / blocked**: the cache answers, the line says how old it is, nothing throws.
- **API-key transport**: until a REST catalog is confirmed, it stays on the built-in list, and
  says so rather than implying the list is the account's.
- **Empty result**: a `tools/list` that yields no enums is not an empty catalog — fall back
  and say "your account's tools do not publish a model list", never show zero.
- **A slug the catalog does not know is not an error at the field.** Free text stands; the
  warning is informational. `bind()` already refuses at push time with the offered list, which
  stays the backstop.

## Tests

- `catalog()` merges and de-duplicates account and built-in entries, prefers account ones, and
  splits by the tool they came from rather than by name regex.
- The cache round-trips through localStorage, is scoped per account, and expires.
- `refreshCatalog()` reports `added`/`gone` against the previous snapshot.
- A board model with a retired slug is flagged in Settings and still pushable by hand.
- No network in the node tests: `tools/list` stubbed, as in `test-imagine.mjs`.

## Order of work

1. The signed-in probe: what `tools/list` actually returns for enums, and whether `/v2/models`
   is real. Everything below is shaped by that answer, and it is ten minutes with an account.
2. `catalog.js` (or a section of `imagine.js`): cache, refresh, diff, per-account scoping.
3. The Settings line, the refresh button, the grouped/filtered datalist.
4. The stale-slug flag in Models & templates, and the refresh-on-refusal path.
5. Tests, README.
