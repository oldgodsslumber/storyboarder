# Getty Images in Storyboarder — integration plan

Status: **not built.** Written 2026-11-13. §1 is read off the wire today (Getty's live
`swagger/v3/swagger.json`, plus preflights run against the real hosts) and is the reference;
§2 is the one decision that shapes everything else; §3–§9 are the build.

The sibling project is `d:\claudecode\gettyforpremiere` — a UXP panel that already does
search → comp → batch licensing → download → relink inside Premiere. **That panel is where
money gets spent and this one is not**, which is the whole architecture (§2). Its
`plugin/lib/getty.js` and `plugin/lib/auth.js` are the port source for §3 and §4, and its
test fakes are the port source for §9.

---

## 1. What Getty's API actually is, read off the wire

Base `https://api.gettyimages.com`, auth host `https://authentication.gettyimages.com`.
Interactive spec: `https://api.gettyimages.com/swagger` — the machine-readable one that the
facts below came from is **`https://api.gettyimages.com/swagger/v3/swagger.json`** (525 KB,
OpenAPI 3, 69 paths). Fetch it again before building; it is the only complete reference and
the published docs page is a summary of it.

### CORS is wide open — the browser can talk to Getty directly

This is the fact that makes the whole thing possible in a static page, and it was the open
question. Measured 2026-11-13 with `Origin: https://oldgodsslumber.github.io`:

```
OPTIONS /v3/search/images/creative              -> 200
  Access-Control-Allow-Origin:  *
  Access-Control-Allow-Methods: GET,OPTIONS,POST,PUT,DELETE
  Access-Control-Allow-Headers: Content-Type, Origin, Accept, Authorization,
                                Api-Key, Accept-Language, GI-Country-Code

OPTIONS https://authentication.gettyimages.com/oauth2/token   -> 200
  Access-Control-Allow-Origin:  *
  Access-Control-Allow-Methods: OPTIONS,POST
  Access-Control-Allow-Headers: Content-Type, Origin, Accept, Authorization, Api-Key, …

HEAD  https://media.gettyimages.com/…           -> Access-Control-Allow-Origin: *
```

`Api-Key` and `Authorization` are both on the allowed-headers list, the token endpoint
preflights, and the media host echoes `*`. **No proxy, no server, no CORS shim.** The app
stays what the README says it is.

The media-host header above came back on a 400 (no valid comp URL to hand it without a key),
so it is the one thing in §1 that is inferred rather than proven — see the spike in §9.

### Authentication: a key is required, a token is extra

- Every request carries `Api-Key: <key>`. With no key at all the API answers a bare
  `401 {"message":"Unauthorized"}` from the gateway, before it ever looks at a token.
- **Search works on the key alone.** The Premiere panel already relies on this
  (`auth: 'optional'` in its client) — comp browsing needs no sign-in.
- A **Bearer token** is needed for: `download_sizes`, `largest_downloads`, every
  `/v3/downloads/*`, `/v3/boards/*`, `/v3/customers/current`, `/v3/products`.
- Token lifetime is **at most 30 minutes** (`expires_in`); refresh tokens are long-lived and
  cannot themselves be used for API access.

Two grants:

| grant | endpoint | what it needs | fits a static page? |
|---|---|---|---|
| `authorization_code` + **PKCE (required)** | `GET /oauth2/auth` → `POST /oauth2/token` | `client_id`, registered `redirect_uri` (no wildcards), `code_challenge` (`S256` or `plain`), `code_verifier`; `client_secret` **only if the client is confidential** | **yes** — this is the one |
| `client_credentials` | `POST /oauth2/token` | `client_id` + `client_secret` | no — a secret in a public page is a published secret |

Two hard edges on the auth-code grant, both of which cost a day in the Premiere panel:

1. **The redirect URI must be registered with Getty beforehand and wildcards are not
   permitted.** Loopback URIs (`https://localhost`, and plain `http` loopback) are exempt and
   need no registration. So: `https://oldgodsslumber.github.io/storyboarder/` (the exact
   deployed path, as `location.origin + location.pathname` produces it) has to be registered
   by whoever owns the Getty account, once, by email to their rep. Until that happens, the
   only way to sign in is to serve the folder locally and use the loopback URI.
2. **Public vs confidential is a property of the key, not of the client type, and Getty does
   not tell you which yours is.** A public client that sends `client_secret` fails; a
   confidential client that omits it fails the same way — `400 "the request was malformed"`,
   with no hint. The Premiere panel hit exactly this on first real sign-in and now tries both
   ways on a malformed 400 and remembers which worked. **Port that behaviour, don't re-derive
   it.**

### Images: the endpoints that matter

```
GET  /v3/search/images/creative        search (page_size ≤ 100, default 30)
GET  /v3/search/images/editorial       same shape, editorial-only
GET  /v3/images  /v3/images/{id}       detail, up to 100 ids per call
GET  /v3/images/{id}/similar           more like this one
GET  /v3/search/images/creative/by-image   search BY a picture (asset_id or image_url)
PUT  /v3/search/by-image/uploads/{file-name}   upload a jpeg/png to search by
GET  /v3/image-match/search?url=       "where else does this picture appear"
POST /v3/downloads/images/{id}         THE call that spends money
GET  /v3/images/{id}/downloadhistory   has this one ever been licensed by us
GET  /v3/products                      what the account can license, + requirements
POST /v3/boards                        {name, description} -> {id}
PUT  /v3/boards/{board_id}/assets      [{asset_id}] -> {assets_added, assets_not_added}
GET  /v3/boards                        boards owned or invited to
POST /v3/ai/image-generations          Getty's own generative AI (see §8)
```

`fields` on a search is the whole game. The useful ones:

```
summary_set (default) · id · title · caption · artist · collection_name · collection_code
asset_family · license_model · allowed_use · graphical_style · orientation · max_dimensions
keywords · date_created · referral_destinations · uri_oembed
display_set | comp | comp_webp | preview | thumb        <- pictures, no token needed
download_sizes | largest_downloads                      <- token needed
```

`preview` is documented as the same size as `comp`. Creative image search results are cached
24 h, so an identical query is free the second time.

### The filters that map onto a storyboard

These are enums, verbatim from the spec, and they are why this is better than typing words
into gettyimages.com:

```
compositions:      abstract candid close_up copy_space cut_out full_frame full_length
                   headshot looking_at_camera macro medium_shot part_of_a_series portrait
                   sparse still_life three_quarter_length waist_up wide_shot
orientations:      horizontal vertical square panoramic_horizontal panoramic_vertical
number_of_people:  none one two group
graphical_styles:  fine_art illustration photography vector
moods:             black_and_white bold cool dramatic natural vivid warm
minimum_size:      x_small small medium large x_large xx_large vector
sort_order:        best_match most_popular newest random
age_of_people:     newborn … senior_adult, plus 40-odd exact bands
also: color (#hex), ethnicity, safe_search, exclude_editorial_use_only, exclude_nudity,
      collection_codes + collections_filter_type, download_product, artists, keyword_ids,
      include_facets + facet_fields, include_related_searches
```

### Rate limits, throttling, pagination

QPS is per key, set at account setup, unpublished; over it is a `429`. The Premiere panel's
answer — one request lane, nothing races itself, `429` honours `Retry-After` then doubles,
a `401` buys exactly one token refresh and one retry — is the right answer here too and
ports as-is.

### Licensing terms, stated plainly

Getty's current licence page: content may be used **on a complimentary basis for test or
sample (comp) use only, for up to 30 days after download**, and may not appear in any final
or publicly available material without a purchased licence. Nothing in that wording names
storyboards, but a watermarked comp in an internal board or a client proofing deck is the
textbook comp use, and resellers' versions of the same terms add the obvious rider: **do not
modify the comp as downloaded.**

Three rules fall out of that and they are design constraints, not disclaimers:

- **The watermark is never removed, cropped, or painted over.** No annotation tool, no PDF
  crop, no "clean up" pass may touch a stock frame. A board that still shows the watermark is
  a board that is obviously a comp, which is the point.
- **A comp never becomes the deliverable.** Storyboarder already distinguishes the board from
  the thing that gets made; a stock card is a *stand-in for a shot*, marked as such.
- **The 30-day window is real.** A board kept for six months holds comps whose comp licence
  lapsed. Record `at` on every placement so the panel can say "this comp is 94 days old" —
  see §6.

---

## 2. The decision everything else follows from: this app selects, Premiere licenses

Storyboarder could implement `POST /v3/downloads/images/{id}` in an afternoon. It should not.

The Premiere panel already carries the expensive part — the ledger, the duplicate-licence
guard, the "after a 2xx nothing may become failed" rule, the never-retry-a-spend rule, the
30-day history-window walk, the project-code/notes requirements read off `/v3/products`. All
of that exists because licensing is where a bug costs money. Building a second, thinner
version of it in a storyboarding tool means two places that can double-charge the account and
no single ledger that knows what was bought.

So the boundary is:

> **Storyboarder picks and shows. The Premiere panel buys.**
> The handoff is a **Getty Board** plus an asset-id manifest in the export.

That is not a compromise, it is the better shape: the board gets built in pre-pro with
watermarked comps that cost nothing, and the spend happens once, in the edit, against the
assets that actually survived into the cut. The Premiere panel's Addendum A already imports a
Getty Board, so the receiving end is **already built** — Storyboarder only has to create the
board and put ids in it (`POST /v3/boards`, `PUT /v3/boards/{id}/assets`, both one call).

One consequence worth stating out loud: **Storyboarder never needs a token for its core
loop.** Search and comps run on the API key alone. Sign-in is only needed for the board
handoff in §7, which means §3–§6 can ship and be useful before anybody at Getty answers the
email about registering a redirect URI.

---

## 3. `js/getty.js` — the client

A port of `gettyforpremiere/plugin/lib/getty.js` with video swapped for images. Keep its
shape: one lane, `_enqueue`, the `GettyError` normaliser, the backoff ladder. Drop
`licenseVideo`, `downloadsSince`, `products` (not needed under §2).

```js
SB.Getty = {
  configured(),                       // has a key
  searchImages(family, f, page, size),// f: {phrase, orientation, compositions, people,
                                      //     style, mood, minSize, color, sort, safe,
                                      //     excludeEditorialOnly, collections}
  images(ids, fields),                // detail, batched at 100
  similar(id, page),
  byImage({assetId|imageUrl}, f, page),
  uploadSearchImage(name, blob),      // PUT /v3/search/by-image/uploads/{name}
  compUrl(asset), previewUrl, thumbUrl,   // display_set pickers, ported
  fetchComp(asset)                    // -> Blob, see §5
};
```

Two Storyboarder-specific additions:

- **`DEFAULT_FIELDS`** = `id,title,caption,artist,collection_name,collection_code,
  asset_family,license_model,allowed_use,graphical_style,orientation,max_dimensions,
  display_set,referral_destinations` — everything the card and the manifest need, nothing
  that requires a token.
- **`shotFilters(p, shot)`** — the mapping table, which is the actual expertise in this
  feature and belongs in code, not in a user's head:

  | shot type | Getty filters |
  |---|---|
  | Wide | `compositions=wide_shot` |
  | Medium | `compositions=medium_shot,waist_up` |
  | Close-up | `compositions=close_up` |
  | Extreme close-up | `compositions=macro,close_up` |
  | Two shot | `number_of_people=two` |
  | Insert | `compositions=still_life,cut_out,macro` + `number_of_people=none` |
  | Cutaway | `number_of_people=none` |
  | Talking head | `compositions=headshot,looking_at_camera` + `number_of_people=one` |
  | Over the shoulder, POV, Screen capture | no composition filter — say so in the UI |

  Plus, from the board rather than the card: `orientations` from the export aspect
  (16:9 → `horizontal`), `graphical_styles=photography`, `safe_search=true`,
  `exclude_editorial_use_only=true` (a client video is commercial use — editorial-only
  assets are a trap and this is the one filter that must default on), and
  `number_of_people` from `shot.personaIds.length` when the card has cast and the type
  does not already set it.

  The shot types are user-editable (`p.settings.shotTypes`), so the table keys off the
  **default** names and an unrecognised type simply contributes no filter. Never guess.

The phrase comes from `SB.Refs.plain(p, shot.imageDescription || shot.description)` —
the existing boundary for "a description, read by a machine", which resolves `@{id|Name}`
marks to names. Do not read descriptions raw.

---

## 4. `js/gettyauth.js` — sign-in (phase 7 only)

Not needed until the board handoff. When it is, it is the ImagineArt flow in `js/imagine.js`
with the endpoints swapped — that file already has: a popup opened synchronously inside the
click, the same page catching `?code=` when it has an `opener` and posting it back, `state`
checking, a five-minute cap, and `location.origin + location.pathname` as the redirect URI.
Reuse that code path rather than writing a second one.

Differences from ImagineArt, all of them from §1:

- **No dynamic registration.** `client_id` is typed into Settings (it is not a secret), and
  the redirect URI must have been registered with Getty by hand.
- **PKCE is required**, `S256`.
- **The malformed-400 dance**: on `400` from the token endpoint, retry the exchange with the
  other secret policy and remember the winner in localStorage (`sb.getty.omitSecret`).
  A confidential key additionally means a secret has to be stored in the browser, which is a
  thing to tell the user plainly in Settings rather than hide.
- `file://` cannot sign in at all (no address to come back to) — the same message
  `signInBlocked()` already produces, and the same non-event, because search still works.

---

## 5. `js/gettypanel.js` — the Stock panel

A panel in the existing mould (`promptpanel.js`, `personapanel.js`, `exportpanel.js`), opened
from a card and from the toolbar.

- **Header**: the card it was opened from (`SH 014 · Close-up`), the phrase box seeded from
  the description, and a one-line *"filtered to: close-up · horizontal · no people"* that
  says out loud what §3 did on the user's behalf, with every chip removable.
- **Grid** of comps, `page_size=60`, infinite "Load more" by `page`. Each tile: the comp,
  the artist, the collection, a `✎` editorial-only flag if `allowed_use` says so (should be
  impossible given the default filter — show it anyway, because a filter default can be
  switched off).
- **Per-tile actions**: *Use as frame* (§6), *More like this* (`/v3/images/{id}/similar`),
  *Open on gettyimages.com* (`referral_destinations`, which is the field that exists for
  exactly this).
- **Find a match for this frame** (phase 4): takes the card's own `shot.render` — the
  generated or dropped full-size original — `PUT`s it to
  `/v3/search/by-image/uploads/{name}`, then searches `creative/by-image`. This is the
  feature that justifies the whole thing: board it with AI, then find the licensable picture
  that looks like what you drew. **It uploads client content to Getty**, so it asks first,
  once per session, and says so in the dialog.

UI rules this app already enforces and this panel inherits: no async result ever steals the
caret or overwrites an in-flight edit, and the panel never fires a search on its own — the
header counts, the user presses.

---

## 6. A comp on a card

The entry point exists and needs no change: `SB.Board.setImage(shot, blob, made)` handles the
≤480p proxy, the full-size original, the take-banking, the serial, and the provenance record.
A comp arrives as a `Blob` from `fetchComp()` and lands exactly like a generated still.

```js
const made = { by: 'getty', id: asset.id, artist, collection: collection_name,
               caption: title, family: asset_family, license: license_model,
               link: referral_destinations[0], at: Date.now() };
```

Then, on the shot itself, so it survives take-swapping and version snapshots:

```js
shot.stock = { id, at, comp: 'blobref', link, artist, collection };   // null on every other shot
```

Four consequences, each of which is a real change somewhere else:

1. **The card is visibly stock.** A corner badge like the `▷` clip badge — `◧ Getty` — plus
   the watermark that is in the picture anyway. The PDF prints the badge too.
2. **Nothing feeds a comp to a model.** `js/mxm.js` and `js/vexport.js` build the manifests
   that get uploaded to generators, and `js/refs.js` decides what a model is shown. A frame
   whose `render.made.by === 'getty'` is **excluded from every one of those feeds**, and the
   Create panel's dark push button says why ("this card's frame is a Getty comp"). This is
   not caution for its own sake: handing a comp to an image model is a derivative use the comp
   licence does not grant, and it is exactly the kind of thing that happens silently because
   the existing code's rule is "feed the frame". Changing that rule is the single most
   important line of this plan.
3. **The export panel grows a third category.** It filters by "only what was made in here";
   stock is neither generated nor dropped. Add it, and name the files from the serial as
   usual with the asset id in the manifest.
4. **The 30-day clock is shown.** Settings → Originals counts what a board weighs; it also
   lists stock cards with the age of each comp, and anything past 30 days says *comp licence
   lapsed — re-comp or license it*.

A stock card is still a card: it can be replaced, it banks as a take, it carries comments and
a shot type. Nothing about it is a special case except what the licence makes special.

---

## 7. The handoff to Premiere

Two outputs, both from the export panel, both small:

- **`getty.json` / `getty.csv`** beside the exported frames: `shot code, serial, asset id,
  title, artist, collection, licence model, comp placed at, gettyimages.com link`. An editor
  with no panel at all can work from that.
- **Push to Getty Board** (needs §4): `POST /v3/boards {name: "<project> — <version>"}` then
  `PUT /v3/boards/{id}/assets` with every stock asset id on the board, reporting
  `assets_not_added` honestly. Then the Premiere panel's Board import pulls that board in,
  and licensing happens there, once, against its ledger.

Round-trip worth noting for later: the panel knows what was *actually* licensed. A
"what did we buy" read-back into Storyboarder (`GET /v3/images/{id}/downloadhistory` per
stock card, needs a token) would let a board show *licensed* vs *still a comp* per card.
Out of scope here; the data model above (`shot.stock`) leaves room for it.

---

## 8. Getty's own generative AI — noted, not planned

`POST /v3/ai/image-generations` and friends (`enhance-prompt`, `refine`, `extend`,
`background-replacement`, `influence-composition-by-image`, `file-registrations` for
reference images, `generation-history`) are a complete image-generation provider sitting in
the same API, trained on licensed content and sold with indemnification — which for
client-facing work is worth more than any quality difference against the models already
wired in. It would slot into `js/providers.js` + `js/imaginemodels.js` as another provider,
and it downloads through `POST /v3/downloads/images/{id}` with `product_type=aigen`, i.e.
**it spends money per generation**, which collides with §2.

That is a separate plan. Mentioned here only so the next person knows it exists and does not
discover it halfway through building §5.

---

## 9. Build order, and the spike that comes first

**Phase 0 — spike, half an hour, needs a real API key.** Three questions, in a scratch page:

1. Does `fetchComp()` work? `fetch(compUri)` → `Blob`, and separately an
   `<img crossOrigin="anonymous">` → `<canvas>` → `toDataURL()`. The media host advertises
   `Access-Control-Allow-Origin: *` but that was measured on an error response. If the bytes
   can't be read, comps can still be *shown* (plain `<img>`) but cannot be stored in the
   `.storyboard` or printed into the PDF — which changes §6 completely, so test it first.
   (If it fails: `crossOrigin` must be set before the browser caches the image, so re-test
   with a cache-busted URL before concluding anything.)
2. Does search really work on the key alone, with no token?
3. Is this key public or confidential? (Only answerable by trying both; §4.)

Then: **1** client + Settings tab (key, client id, connection check via a one-result search)
→ **2** panel + search + filters → **3** *Use as frame* and the four consequences in §6
→ **4** find-a-match-for-this-frame → **5** export manifest → **6** sign-in + board push.
Phases 1–5 need no sign-in and no registered redirect URI; send the registration email at
the start of phase 1 so it is answered by phase 6.

**The build discipline is the repo's, and it bites here:** edit `js/`, add the
`<script src>` line to `index.html` (it sets inline order — `getty.js` after `refs.js`,
`gettypanel.js` after `promptpanel.js`), run `node build.mjs`, *then* test. Every suite reads
the built `storyboarder.html`, so an untested build is a lying green.

New tests: **`test-getty.mjs`** against a fake Getty — port the fake from
`gettyforpremiere/test/` rather than writing a second one — covering the filter mapping per
shot type, the 429/`Retry-After` ladder, the 401-refresh-once rule, field selection, and the
PKCE challenge against Node's crypto. Plus a `ui-scenario.js` case that places a comp and
asserts the four §6 consequences, especially that the model feeds exclude it.

Keys and tokens live in `localStorage` only and are **never** written into the project file —
the rule the README already makes about the Gemini key, and the reason a board can be handed
to anyone. Asset ids, comps and `shot.stock` *do* go in the file; they are the board.

---

## 10. Open questions

- **Which account, and does its key permit `by-image` search?** The by-image endpoints are
  the differentiator in §5 and some keys do not have them enabled. Ask when asking about the
  redirect URI.
- **Which collections the account can actually license.** `download_product` /
  `collection_codes` can restrict the grid to assets that are already paid for under Premium
  Access, so nobody boards a shot around a picture that turns out to cost extra. Needs
  `/v3/products` and a token to read, which is phase 6 — until then the grid shows everything
  and the manifest is honest about `license_model`.
- **Does showing a watermarked comp to a client count as proofing?** Almost certainly yes,
  that is what comps are for, but the 30-day window and "no final materials" line are worth
  one email to the Getty rep before a board goes out — and the answer belongs in this file.
