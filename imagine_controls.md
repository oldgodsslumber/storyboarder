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

## Is asking the MCP the best way? Yes — for one specific reason

Not for the parameters. The two generator tools document themselves completely
and we have them.

It is worth asking because **our captured copy has only six tools**, and the
descriptions in it reference a `select_folder` tool that is not among them. So
there are tools on the account we have never seen — plausibly folder
management, and quite possibly editing, upscaling, background removal or
lip-sync, which are products ImagineArt ships. We would be guessing to list
them.

The model lists also move: this capture has FLUX nowhere and `nano-banana-pro`
as the image default, which will not be true for long.

**The mechanism to build:** a *Copy the raw tool list* button in Settings →
ImagineArt, beside the existing connection report. The app already performs
`tools/list` over the same transport; this just dumps the untouched JSON to the
clipboard. One click produces the exact current contract, with no RTF and no
retyping — and it doubles as the thing to paste when a model stops working.

Second, smaller ask: whether `fetch_status` returns the credits a job actually
cost. The app measures cost by diffing `get_balance` around a generation, which
only works when one job is in the air. If the status payload carries the number,
the whole measured-price mechanism becomes exact.
