# Getty Images in Storyboarder — integration plan

Status: **built** (branch `V3-getty`, 2026-11-13) — phases 1–5. §1 is read off the wire and
is still the reference; §2 is the decision everything else follows from; §3–§9 are the design
the code was written from. Three things came out differently in the building and this file
says so where they are:

- the drawer is a **flex sibling of `#main`**, not a fixed strip with `body` padding (§5) —
  `#app` is already a column, so the board shrinks by construction rather than by arithmetic
  that could be wrong;
- a comp's licence is keyed by **blob reference** in `p.stock`, not by a flag on the shot
  (§6) — takes move pictures between slots and cards, and a flag would stay behind;
- **phase 6 — sign-in and the Getty Board push — is not built.** It needs a redirect URI
  registered with Getty by hand (§1), which has not been asked for yet. The export's
  `<board>-getty.csv` carries the asset ids out in the meantime, so the handoff works
  without it.

Nothing here has run against a real Getty key. The three questions in the phase-0 spike (§9)
are still open, and `fetchComp` reports the one that matters as itself rather than as a
broken picture.

**A review pass the same day found eight real bugs, all fixed and all now tested.** Four are
worth reading as a warning about this feature's shape, because three of the four *looked like
they worked*:

- **"Match this frame" uploaded the user's frame to Getty and threw the answer away.** `run(1)`
  cleared the uploaded URL two lines above the call that reads it, so it fell through to a
  keyword search with an empty phrase — and filled the strip, so it looked right. The user had
  consented to a client picture leaving the machine for nothing. Keyword search and by-image
  search are now separate entry points (`search()` vs `run()`), because `run()` cannot be the
  place that forgets which search it is.
- **A comp in a *subject's* reference box was fed to models.** §6 put the licence gate on a
  card's frame; a subject's reference picture is the same handover one level down and reaches
  the same models. The two copies of that code in `refs.js` are now one `subjectEntry()`, which
  is also how one of them came to have a check the other did not.
- **A comp dropped as a bare URL landed with no licence record** — the "drag it out of a
  gettyimages.com tab" route this file advertises — and was therefore feedable. The asset id is
  in the URL, so `assetIdFromUrl` reads it and the drop is marked.
- **Placing the same asset on a second card restarted the first card's 30-day clock.** One row
  per picture, restamped on every placement; `markStock` now keeps the first `at`.

The rest: `shapeResults` threw on a malformed payload; `byImage` stripped `compositions` but
not `number_of_people` (it deleted the friendly name, not the wire name); the PDF printed no
comp marker although §6.1 promised one; the manifest's `stock` array ignored the export scope;
a comp living only in a banked take was invisible to every count. Also fixed, from the same
pass: the Create panel's video strip called a comp "the only picture the video call is sent"
while the push button beside it refused to send it, and `modelFrame` fell open on a board
holding an original whose proxy had gone (`stockFor` now also believes a getty `made`).

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

## 5. `js/gettypanel.js` — the stock drawer

**Not a modal.** Every other panel in this app (`promptpanel`, `personapanel`, `exportpanel`,
`reviewer`) is a `*-back` backdrop over a centred box, because every one of them is somewhere
you *go*. The stock drawer is the opposite: it is open **while** you work on the board, and
the gesture it exists for is dragging a picture out of it onto a card. A modal cannot do
that — the thing you need to drop on is behind the backdrop.

So: a drawer docked to the bottom, **the board shrinks above it rather than being covered.**

```
┌──────────────────────────────────────────── top bar ─────────┐
│  board — scrolls, all cards still reachable                  │
│  ░░ the drop target is a card frame up here ░░               │
├─────────────────────────── ⋯ drag to resize ─────────────────┤
│ ◧ Stock   [phrase…………]  close-up ✕  horizontal ✕  ⚙   ⌄ │   <- head
│ ┌────┬────┬────┬────┬────┬────┐                  ┌────────┐ │
│ │thmb│thmb│thmb│thmb│thmb│thmb│  → scrolls       │  comp  │ │   <- strip + judging pane
│ └────┴────┴────┴────┴────┴────┘                  └────────┘ │
└──────────────────────────────────────────────────────────────┘
```

**Layout.** A fixed element at `left:0;right:0;bottom:0`, and `body.stock-on` gets a
`padding-bottom` equal to the drawer height so the last row of cards can still be scrolled
into view and dropped on. Overlaying the board would hide exactly the cards you want — that
is the whole reason this is not a modal, and getting it wrong reproduces the modal.
The top edge is a drag handle; the height, and whether it is open at all, live in
`localStorage` (a per-browser convenience, never in the project file). `⌄` collapses it to
the head strip alone so it can stay open all day without costing board.

**Head.** The phrase box, seeded from the selected card's description via
`SB.Refs.plain()` and re-seeded when the selection changes *unless the box has been typed
in* — the caret is never stolen and a typed query is never overwritten. Beside it, the
filters §3 applied on the user's behalf as removable chips: *close-up · horizontal · no
people*. A search fires on Enter or the button, **never on its own** — the same rule the
Create panel follows.

**The strip.** One horizontally scrolling row of `thumb`s by default (a storyboard is wide
and so is the gesture), two or three rows when the drawer is dragged taller. `page_size=60`,
"more" appends by `page`. Each tile carries the artist, the collection, and a `✎` flag if
`allowed_use` says editorial-only — which the default filter should make impossible, but a
default can be switched off.

**The judging pane.** Hovering or arrow-keying a tile shows that asset's `comp` big on the
right of the drawer, with title, artist, collection and size. Thumbs are what you scan;
the comp is what you decide on, and deciding from a 170 px thumb is how the wrong picture
ends up on a board. Nothing is fetched at comp size until a tile is actually looked at.

**Dragging out — the contract.** HTML5 drag, with two types set on the tile:

```js
const DND_STOCK = 'application/x-sb-getty';          // follows DND_SHOT / DND_SCENE
dt.setData(DND_STOCK, JSON.stringify({ id, title, artist, collection_name,
                                       asset_family, license_model, comp, link }));
dt.setData('text/uri-list', compUrl);                 // the fallback that already works
dt.setDragImage(tileImg, w/2, h/2);
```

The second line is free mileage: `SB.imageFromTransfer()` already reads `text/uri-list` and
fetches it with `mode:'cors'`, and the card frame and the scene background already call it.
**So a comp dragged onto a card lands with no change to `board.js` at all** — dropping it on
empty space in a scene even creates a new card, because that handler already does that for
any dropped picture. (It also means dragging straight out of a gettyimages.com tab works,
which is worth knowing but is not the feature.)

What the plain URL loses is *which asset it was* — the id, the artist, the licence model.
That is what the first line is for, and it needs the one change `board.js` does need: the
frame and scene drop handlers check `DND_STOCK` before falling through to
`imageFromTransfer`, exactly as they already check `DND_SHOT` first, and route it to the
provenance path in §6. Two handlers, one branch each.

Two details that only show up once it is built:
- **The board must auto-scroll while dragging.** With the drawer taking the bottom third,
  the card you want is often off-screen upward; browsers do not reliably auto-scroll a
  custom drag. Scroll on `dragover` within ~60 px of the board's top edge.
- **Drag is never the only way.** `Use as frame` is on the tile's hover row and applies to
  the selected card, and the tile's context menu offers *replace the frame* / *add as a
  take* / *new card after this one*. Drag is the good gesture, not the only one — a trackpad
  drag across a shrinking board is a bad single point of failure.

**Other drop targets, for free or nearly:** a persona's reference box (`refbox.js`) takes
pictures the same way, so a stock photo can be a subject's look reference — subject to the
hard rule in §6.2, which means a comp dropped there is *shown to people and never to a
model*, and the box says so.

**Find a match for this frame** (phase 4) sits in the head as a button that is live when a
card with a picture is selected: it `PUT`s that card's `shot.render` to
`/v3/search/by-image/uploads/{name}` and searches `creative/by-image`, filling the same
strip. This is the feature that justifies the whole thing — board it with AI, then find the
licensable picture that looks like what you drew. **It uploads client content to Getty**, so
it asks once per session and says exactly what it is sending.

---

## 6. A comp on a card

The entry point exists and needs no change: `SB.Board.setImage(shot, blob, made)` handles the
≤480p proxy, the full-size original, the take-banking, the serial, and the provenance record.
A comp arrives as a `Blob` from `fetchComp()` and lands exactly like a generated still —
whether it got there by being dragged out of the drawer (§5), by *Use as frame*, or by being
dropped on empty board space, which makes a new card.

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
→ **2** the drawer: dock, resize, head, strip, judging pane, search + filters → **3** drag
out and the four consequences in §6 → **4** find-a-match-for-this-frame → **5** export
manifest → **6** sign-in + board push. Phases 1–5 need no sign-in and no registered redirect
URI; send the registration email at the start of phase 1 so it is answered by phase 6.

Phase 2 and phase 3 are worth separating even though they feel like one thing: a drawer that
searches and shows comps is already useful on its own (it is a better stock browser than the
website, because it knows the card), and the drop plumbing can be judged against a drawer
that already works rather than at the same time as it.

**The build discipline is the repo's, and it bites here:** edit `js/` and `css/app.css`, add
the `<script src>` line to `index.html` (it sets inline order — `getty.js` after `refs.js`,
`gettypanel.js` after `promptpanel.js`), run `node build.mjs`, *then* test. Every suite reads
the built `storyboarder.html`, so an untested build is a lying green.

New tests: **`test-getty.mjs`** against a fake Getty — port the fake from
`gettyforpremiere/test/` rather than writing a second one — covering the filter mapping per
shot type, the 429/`Retry-After` ladder, the 401-refresh-once rule, field selection, and the
PKCE challenge against Node's crypto. Plus `ui-scenario.js` cases, which is where the drawer
has to be held honest, because all three of these are things a hand-test passes by accident:

- the drawer is open and `body.stock-on` padding actually leaves the **last** card droppable
  (drive it with 40 cards, scroll to the bottom, assert the last frame's bounding box is
  above the drawer);
- a synthesised drag carrying `DND_STOCK` onto a frame places the comp **with** its asset id
  on `shot.stock`, and the same drag carrying only `text/uri-list` still places the picture;
- a placed comp is excluded from the `mxm`/`vexport` manifests and the Create panel's push
  button says why — the §6.2 rule, which is the one that costs money to get wrong.

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
- **Should the drawer have a Footage tab?** These are client *videos*, and the b-roll that
  ends up in them is Getty footage, not stills — `/v3/search/videos/creative` is the same
  call and the drawer is the same strip. A card already holds a clip (`shot.video`, the `▷`
  badge, `clipDrop`), and a watermarked preview mp4 fetched to a Blob would land in it. The
  reason it is a question and not a phase: a storyboard card wants a *frame*, and a clip on
  a card is a different claim about the shot. Worth asking the user before building it —
  and the Premiere panel already covers video end to end, which may be the right place for
  it to stay.
- **Does showing a watermarked comp to a client count as proofing?** Almost certainly yes,
  that is what comps are for, but the 30-day window and "no final materials" line are worth
  one email to the Getty rep before a board goes out — and the answer belongs in this file.
