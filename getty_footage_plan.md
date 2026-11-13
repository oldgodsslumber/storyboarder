# Getty footage in Storyboarder — plan

Status: **built** (branch `V3-getty`, 2026-11-13). Supersedes §3's `shotFilters`, §5's search,
§6's "what lands on a card" and §10's "should the drawer have a Footage tab?" in
`getty_integration_plan.md`. §1 (the API, read off the wire), §2 (this app selects, Premiere
licenses) and §6's licence rules stand unchanged.

Built as written, with one thing worth recording because it cost an hour. The judging pane
plays the comp, so the UI suite's fixture pointed a `<video>` at Getty's real media host — and
a pending network request stalls Chrome's virtual clock, so the run hung instead of failing.
Three habits came out of it:

- **Nothing in a test may leave the page.** A pending network request stalls the virtual
  clock, and the run then hangs instead of failing — which reads like a crash and is not one.
- **`file://` localStorage is shared between runs**, so a run that stops half way can leave a
  setting behind that breaks the next one. The *keep the comp* switch did exactly that. A test
  states what it needs rather than inheriting it.
- **Instrument before waiting again.** Four UI runs were killed on timeouts in this feature's
  history, about half an hour of wall clock for nothing. What ended it was a ten-line probe
  harness that flushes partial results as it goes, so a hang says which assertion it stopped
  at: it costs two minutes to write and it answered immediately. The right move at the first
  timeout, not the third. It lives in the scratchpad, not the repo — `test-ui.mjs` plus a `t`
  that also writes `out` into `#toastRoot`.

## 1. Why the first cut was wrong

This app boards **videos**. The thing that gets cut into one is footage. A photograph of an
office is not a shot of an office, and the receiving end of the handoff says so out loud —
`gettyforpremiere/plugin/lib/boards.js`:

```js
/* Split a board's assets into videos to import and things to report as skipped. */
if (type && type !== 'video' && type !== 'film') { stills.push(a); return; }
```

So the asset ids the first cut handed over were ids that panel is written to discard. An
image-only drawer could not have worked, whatever it looked like on the board.

The second thing it got wrong was **who drives the search**. The first cut read the selected
card — its shot type became a Getty `compositions` filter, its description became the phrase.
That is not the workflow. The workflow is: *find the footage in the drawer, then drag the shot
up onto the board.* The drawer is a search panel a person uses; it is not a function of the
card. So the card stops driving anything.

## 2. What goes

- `searchImages` and every image endpoint. No photographs, no Photographs tab. Not "images
  too" — out.
- The shot-type → composition mapping: `BY_TYPE`, `typeFilters`, `shotFilters`, and the table
  in §3 of the old plan. Getty's `compositions` enum exists on video search too; it is still
  not wired to the card, because nothing is.
- `phraseFor` (the card's description as the query), `orientationFor` (the board's aspect as a
  filter), the card-derived chips, the "↺ from this card" button, and the `SH 014 · Close-up`
  label in the head.
- `SB.Getty.chips` keeps its job, but describes the filters **the person set**, not filters
  this app inferred.

The selected card keeps exactly one role: *Use on 3b* places the highlighted result without a
drag. Dragging needs no selection at all.

## 3. What arrives

```
GET /v3/search/videos/creative        the search
GET /v3/search/videos/editorial       same shape
GET /v3/videos/{id}/similar           more like this one
GET /v3/search/videos/creative/by-image   "match this frame"
PUT /v3/search/by-image/uploads/{name}    (unchanged — it takes a jpeg/png either way)
```

Fields, none of which needs a token:

```
id · title · caption · artist · clip_length · aspect_ratio · asset_family
collection_name · collection_code · license_model · allowed_use · shot_speed
mastered_to · display_set · referral_destinations
```

**Filters, from the video vocabulary, all set by hand** (the enums are verbatim from the live
spec):

| filter | values |
|---|---|
| `min_clip_length` / `max_clip_length` | seconds |
| `frame_rates` | 23.98 24 25 29.97 30 50 59.94 60 |
| `format_available` | sd · hd · 4k · hd_web |
| `aspect_ratios` | 16:9 9:16 3:4 4:3 4:5 2:1 17:9 9:17 |
| `orientations` | horizontal · vertical (video has only these two) |
| `license_models` | royaltyfree · rightsready |
| `image_techniques` | realtime · time_lapse · slow_motion · color · black_and_white · animation · selective_focus |
| `viewpoints` | lockdown · panning · tracking_shot · aerial_view · high_angle_view · low_angle_view · tilt · point_of_view |
| `sort_order` | best_match · most_popular · newest · random |

`viewpoints` is the one worth noticing: it is the camera-move vocabulary, which is what you
actually want from footage and is a better fit for this app than `compositions` ever was. It
is offered as a filter chip, not inferred from anything.

Two defaults stay on because they are about the job and not about taste: `safe_search`, and
`exclude_editorial_use_only` — a client video is commercial use.

## 4. The drawer

Same drawer: bottom-docked, board shrinks above it, drag out of it onto a card. Changes:

- **The tile** is the poster still plus the clip length (`0:12`) and a `▷`. Tiles stay cheap —
  nothing autoplays in the strip.
- **The judging pane plays the comp.** A `<video muted loop playsinline>` on the comp URL,
  started when a tile is chosen. Judging footage from a still is judging the wrong thing;
  this is the whole reason the pane exists.
- **The filter row** is the hand-set filters above: a clip-length pair, and small pickers for
  the enums that matter (format, frame rate, technique, viewpoint). Everything else stays in
  the phrase.
- **"◎ match this frame"** stays, pointed at `/v3/search/videos/creative/by-image`. It now
  does what it always should have: board a shot with a model, then find the *footage* that
  looks like it.

## 5. What lands on a card

This is the part the user specified, and it is the right mechanism:

1. **Fetch the comp** — the watermarked preview mp4 — from the media host, as bytes.
2. **Take its first frame.** The blob becomes an object URL, so the `<video>` reading it is
   same-origin and the canvas can never be tainted — CORS cannot break the extraction, which
   is the one way this could have been fragile. Seek to 0, draw at `videoWidth × videoHeight`,
   read it off the canvas.
3. **That frame becomes the card's frame**, through the existing `SB.Board.setImage` — proxy
   for the board, full-size original in the file, licence record beside it. It is the comp's
   own resolution (720p or better), not the ~170px thumbnail: a board printed from thumbnails
   looks like a board printed from thumbnails.
4. **The comp mp4 becomes the card's clip**, through `SB.Clip.attach`, which needs one new
   optional argument so the clip carries its provenance like everything else. The card gets
   the `▷` badge with the duration, and the footage is *in the file* — a board you can hand to
   somebody and watch.
5. **One licence record covers both**, now carrying `kind: 'video'` and `clipLength`.
6. **The card plays it.** A frame is a still and a comp is not: a `▶ play` button on any card
   holding a clip runs it in place, muted and looping, one at a time, so a board of comps is
   reviewed by watching it. The drawer is called **Getty**, not Footage — it is the name of
   the thing it talks to.

Honest fallbacks, because three steps there can fail independently:

- the frame cannot be decoded → fall back to the poster `thumb`, and say so on the toast
  rather than silently boarding a 170px picture;
- the comp cannot be stored → keep the frame, say the clip was not kept;
- the comp cannot be fetched at all → nothing lands, and the error says which host refused.

**Weight.** A comp preview is a few MB and a board of thirty is a file you cannot email.
Settings → Getty gets one switch — *keep the comp clip in the file*, default on — and Settings
→ General already counts what a board weighs. Off means frame-only, which is still the comp's
first frame and still marked as stock.

## 6. The handoff, which now actually connects

`<board>-getty.csv` gains **Kind** (always `video` now) and **Clip length**, and the ids in it
are video ids — so `partition()` in the Premiere panel imports them instead of sorting them
into `stills` and reporting them skipped. The manifest's `stock` array gains the same two
fields.

## 7. Tests

- **The removal is a test.** No `shotFilters`/`typeFilters` anywhere, no image-search path,
  and a card's type and description provably do not reach the query.
- Video search: the path, the fields (and that no token-requiring field is asked for), every
  hand-set filter going out under its wire name, the clip-length pair, paging.
- `by-image` against the videos endpoint, including that it strips the filters the picture
  itself answers.
- The placement: one drag → a frame on the card AND a clip on the card AND one licence record
  saying `video`, with the frame coming from the extractor rather than the thumb. The
  extractor is a seam (`SB.Getty.deps.firstFrame`) so the flow can be driven without a real
  mp4, and both fallbacks are asserted.
- The export: `Kind` and `Clip length` columns, video ids.
- Everything in `test-getty.mjs` that covers the licence rules stays and must stay green —
  those rules do not change, only what is being licensed.

**The gap, stated:** the real decoder path — a genuine Getty comp mp4 decoded by Chrome and
read off a canvas — is not covered by a test. Synthesising a decodable mp4 in the suite means
`MediaRecorder` under a virtual clock, which is exactly the kind of flake that is worse than
no test. It sits beside the other honest gap: nothing here has run against a real Getty key.
