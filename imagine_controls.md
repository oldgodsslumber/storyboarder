# What the ImagineArt MCP will actually let us set

Everything below is read off the tool list the account itself publishes
(`test-imagine-tools.json`, captured from a real `tools/list`). These tools do
not carry a JSON `inputSchema` with enums — the whole contract is written in
the tool **description** as prose, which is why `imagine.js` parses
descriptions rather than schemas.

## The complete surface

### `generate_image`

| parameter | required | what it takes | what the app sends today |
|---|---|---|---|
| `org_id` | yes | the org from `select_organization` | ✅ sent |
| `prompt` | yes | the text | ✅ sent |
| `model` | required-but-nullable | one of 10 slugs | ✅ sent |
| `aspect_ratio` | required-but-nullable | per-model allow-list | ✅ sent (project setting) |
| `duration` | required-but-nullable | *present on the image tool and meaningless* | sent as `null` |
| `resolution` | optional | `1K, 2K, 4K` — only nano-banana-pro, nano-banana-2, gpt-image-2; `2K, 4K` for seedream-v5-lite | ✅ sent (resolution policy) |
| `quality` | optional | `low, medium, high` — **gpt-image-2 only** | ✅ sent |
| `count` | optional | integer — more than one image per call | ❌ **never sent** |
| `folder_id` | optional | from `select_folder` | ❌ never sent |
| `image_url` | optional | one reference URL → img2img | ✅ sent (one) |

### `generate_video`

| parameter | required | what it takes | what the app sends today |
|---|---|---|---|
| `org_id` | yes | the org | ✅ sent |
| `prompt` | yes | the text | ✅ sent |
| `model` | required-but-nullable | one of 15 slugs | ✅ sent |
| `aspect_ratio` | required-but-nullable | per-model allow-list | ✅ sent |
| **`duration`** | required-but-nullable | **seconds as a string, per-model allow-list** | ❌ **always `null`** |
| `resolution` | optional | per-model allow-list | ✅ sent |
| `image_url` | optional | an **ARRAY** | ✅ sent — but always exactly one |
| `video_url` | optional | an ARRAY — reference-to-video | ❌ never sent |
| `audio_url` | optional | an ARRAY — reference-to-video | ❌ never sent |
| `folder_id` | optional | from `select_folder` | ❌ never sent |

## The gap that matters: duration

**Every clip this app has ever made is the model's default length**, because
`duration` is hard-coded to `null` ([imagine.js:1753](js/imagine.js#L1753)) and
nothing in the UI ever supplies `opts.duration`. On LTX 2.3 that is 6 seconds.
The allow-lists are published per model and `SB.Imagine.allowFor(TOOL.video,
slug, 'duration')` **already parses them** — the knowledge is in the app and
nothing asks for it.

```
seedance-2.5        4 … 30 (any whole second)
seedance-2.0(-fast) auto, 4 … 15
kling-o3            3 … 15
kling-3.0-pro       3 … 15
pixverse-v6         1 … 15
happy_horse         3 … 15
seedance-1.5-pro    4 … 12
seedance-pro-fast   3 … 12
wan-2.6             5, 10, 15
kling-2.6-pro       5, 10
veo-3.1 / -fast     4, 6, 8
ltx-2.3             6, 8, 10          ← default 6
wan-2.2             (fixed at 4)
```

A storyboard is the one place that knows how long a shot should run. This is
the single most valuable control we are not using.

## The rest, ranked

1. **Duration, per card.** Belongs on the card next to the motion box, not in
   settings — every shot wants a different length. Offer the chosen model's
   allow-list, default to the model's own default, and say when a length is
   not available on this model rather than letting it silently fall back.
2. **Reference-to-video.** `image_url` is an array and we send one. Six models
   take multiple references — seedance-2.5/2.0/2.0-fast, happy_horse, wan-2.6,
   veo-3.1 — and that is exactly what the video lane's feed already is. Today
   the clip gets the first frame and nothing else, while the card says it is
   handing over three references. Two of those models *require* their media:
   `happy_horse` needs at least one image, `wan-2.6` needs a video.
3. **`video_url` / `audio_url`.** A previous take as a motion reference, or a
   track to cut to. The app already holds clips in the file, so the plumbing
   (upload → URL) exists.
4. **`count` on images.** Four variations of a frame for one press, which is
   how anybody actually picks a first frame.
5. **Resolutions we are leaving on the table.** LTX 2.3 does **1440p and
   2160p**, not just 1080p. veo-3.1 does **4k**.
6. **`folder_id`.** Everything the app generates lands at the workspace root.
   One folder per board would make the ImagineArt side navigable — and there
   is a `select_folder` tool referenced in these descriptions that we have
   never called.

## What the account actually publishes — the 2026-09-15 capture

The dump came back with **96 tools**, not six, and with real `inputSchema`
objects, `outputSchema`, `annotations`, `icons` and `title` on every one. The
six we knew about were the six this app calls.

### Three things that were broken and are now fixed

1. **The image model list had silently stopped parsing.** Two models were added
   (`gpt-image-2.5-flare`, `gpt-image-2.5-sunburst`) and the sentence rewrapped,
   so `"xAI-grok-imagine". Pass the model name…` became `"xAI-grok-imagine".⏎
   Pass the model name…`. The regex wanted one space, found a newline, matched
   nothing — and the account's own model list became empty, dropping the app
   back to the year-old REST catalog **without a word**. One `\s+` .
2. **"Best quality" was asking for third best.** `quality` used to be a
   sentence about `gpt-image-2` alone (`low, medium, high`); it is now a table,
   and the 2.5 models go `auto, low, medium, high, xhigh, max`. The chooser had
   `['high','medium','low']` hard-coded, so a board set to *best* asked for
   `high` where `max` was on offer.
3. **One model writes its durations as a range.** `seedance-2.5: 4 through 30
   (any whole second)` was read as a single option whose label was that
   sentence. It spreads to 4…30 now.

All three were invisible against the old fixture, which was this app's *digest*
of six tools with no `inputSchema` at all — fed to the tests where a raw
`tools/list` belongs. The fixture is now twelve real tool records, schemas and
all, and the model-count assertion is derived from the account's own list
rather than typed in, because a hard number fails for being out of date rather
than for being wrong.

### Two image controls we never knew existed

- **`background`** — `auto`, `transparent`, `opaque` on the 2.5 models. A
  cut-out first frame, straight from the generator.
- **`mask_url`** — inpainting mask for image-to-image on the same two models.
  Fix one corner of a frame instead of rerolling it.

### The tools beyond the six

Worth having, in order:

| tool | what it is |
|---|---|
| `select_folder` | the folder picker the generators' `folder_id` refers to |
| `edit_photo` | an edit described in plain language, applied to an asset |
| `enhance_image` | upscale and sharpen — a board copy made printable |
| `remove_background` | cut-out, as a separate operation |
| `list_assets` / `list_user_creations` / `show_assets` | what this org already holds |
| `request_image_upload` | an upload without base64 in the payload |
| `generate_video_captions`, `generate_music` | out of scope, but there |

The rest — about sixty of the ninety-six — are **fashion, ad, product and
avatar flows** (`create_fashion_*`, `generate_ad`, `composite_shoot`,
`generate_drone_video`, `generate_interior_design`…). They are guided widget
flows with their own pickers, and nothing in a storyboard wants them.

### Two catalog tools that look relevant and are not

`list_camera_movements` and `list_camera_angles` return ImagineArt's own
vocabulary — *Pan Left, Push In, Pull Out, Orbit, Dolly Zoom, Whip Pan, FPV
Drone*; *Wide Shot, Close-Up, Over The Shoulder, Ground Level*. Tempting, given
what the camera rider and the shot types already deal in. But both say **"used
internally by the ImagineArt widgets"**, and their ids go to
`animate_fashion_image` and `composite_shoot` — not to `generate_video`. They
are not a control surface for the calls this app makes.

Similarly `list_durations`, `list_resolutions` and `list_aspect_ratios` are
titled **"List Ad …"** and their descriptions say to call them before
`generate_ad`. The parameter descriptions on `generate_image` / `generate_video`
do point at them, so there is a contradiction in their own docs — but the
per-model allow-lists in the generator descriptions are complete, and we
already parse them. Not worth a call until something proves otherwise.

### Does `fetch_status` return what a job cost?

No. Its `outputSchema` is `heading, prompt, tags, assets, shoot_type,
footerLabel, notice, hasMore, nextFrom, nextFromId` — no credits field. The
balance-diff measurement stays the only way to price a generation, and it stays
only valid when one job is in the air.

## Still to build, in order

1. **Duration.** Unchanged from above and now confirmed against the live
   contract: `generate_video.duration` is required-but-nullable, we send
   `null`, and every clip is the model's default.
2. **Reference-to-video** — `image_url` as the array it is.
3. **`folder_id` + `select_folder`** — a board's output in its own folder.
4. **`background: transparent`** on a first frame, where the model supports it.
5. **`count`** — variations of a frame in one press.
6. **`enhance_image`** on a board copy that has no original.
