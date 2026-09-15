# Telling the model what to make: the shoot controls

## What exists now

One dial, board-wide: **Resolution asked for** — *best each model offers* /
*1080p where offered* / *whatever it falls back to*. Quality is derived from it
(`qualityFor` returns the top rung when the policy is anything but *default*),
and aspect ratio is a separate board-wide picker. That is the whole surface.

Everything else the account will take, we send as `null` or not at all:
**duration**, **count**, **background**, **mask_url**, **folder_id**.

## The problem to avoid

A row of dials on every card is worse than no dials. Two rules keep this
honest, and they are the ones the existing resolution note already follows:

1. **Never a free number.** Every value comes from the account's own per-model
   allow-list, which the app already parses. An impossible value cannot be
   chosen, so it cannot be silently swapped for the model's floor.
2. **Say when a choice does not survive.** If the board asks for 9s and this
   card's model takes 4, 6 or 8, the control says so and shows what will
   actually happen. Silent fallback is the failure this whole area keeps
   producing.

## The shape: a board default, a per-card override

Board defaults live where the aspect and resolution dials already are
(Settings → ImagineArt) and travel in the file like the rest. A card overrides
only what it needs to, and stores only what it overrode.

```
shot.shoot = { duration: '8', resolution: '2160p', quality: 'max',
               count: 4, background: 'transparent' }   // all optional, sparse
```

Sparse matters: a card with no `shoot` behaves exactly as it does today, and
changing a board default moves every card that has not been overridden.

## Where the controls sit

**With the push button, in the lane** — because they describe the push, and the
lane is already `words → what it feeds → the prompt → what it costs → go`.

```
│ Video · LTX 2.3                          │
│ ┌──────────────────────────────────────┐ │
│ │ motion: she lets go of the cup…      │ │
│ ├──────────────────────────────────────┤ │
│ │ ▸ 1  this card's frame               │ │
│ ├──────────────────────────────────────┤ │
│ │ [ the video prompt ]                 │ │
│ │ 8s ▾   2160p ▾        ~90cr   ▶ push │ │   ← the shoot row
│ └──────────────────────────────────────┘ │
```

- Each control shows the **effective** value — inherited or overridden — never
  a blank. An overridden one is drawn in the accent colour, so scanning a
  board shows which cards differ.
- Each menu lists **only what this model takes**, read from
  `Imagine.allowFor(tool, slug, what)`, with the model's own default marked.
- A board default the model cannot honour appears at the top of the menu,
  struck through, with the nearest value selected: *"9s — not on LTX 2.3"*.

The still's row is the same shape: `4K ▾  max ▾  ×1 ▾`.

## The controls, in the order I would build them

### 1. Duration — the one that matters

Video only, and the reason this plan exists: `duration` is hard-coded to
`null`, so **every clip this app has made is the model's default length** —
6s on LTX 2.3, 4s on most others. A storyboard is the one artifact that knows
how long a shot should run.

The allow-lists are already parsed and already correct, including the range
form (`seedance-2.5: 4 … 30`) and the models that take none (`wan-2.2`, fixed
at 4). `costFor(slug, duration, res)` is **already keyed on duration** — it has
been storing measurements against `''` this whole time, so this also makes the
credit estimate mean something.

Board default: a number, clamped per model at push time. Per card: the menu.

### 2. Quality, as its own dial

Today quality is a side effect of the resolution policy. They are different
questions: `gpt-image-2.5-*` runs `auto, low, medium, high, xhigh, max`, and
`max` on a hero frame with `1K` resolution is a perfectly sensible pair. Split
it out at board level, and put both on the card's still row.

### 3. Count — variations in one press

`count` returns several images for one call. The app stores one picture per
card, so this needs the piece it does not have: **a picker**. Four come back,
you choose, the rest are dropped (or kept as takes — the clip side already has
a takes model to copy).

This is the one control here that is a feature rather than a parameter, and I
would build it last of the four.

### 4. Background: transparent

`auto` / `transparent` / `opaque`, on the two 2.5 models. Narrow, but a
cut-out plate straight from the generator is genuinely useful for an element
that has to sit over something else. One checkbox on the still row, shown only
when the chosen model offers it.

## Two more the contract allows, and what I would do with them

**`mask_url` — inpainting.** Worth flagging because **the app already has the
mask**: `shot.annotation` is a transparent PNG overlay drawn on the frame. The
piece that would normally sink this feature — a mask-painting UI — is already
built and already stored. "Regenerate just what I scribbled over" is a short
step from here, and it is the single most useful thing on this list after
duration. It needs its own plan.

**`folder_id` + `select_folder`.** Everything the app generates lands at the
ImagineArt workspace root. One folder per board, chosen once, remembered in the
file. Small, and it makes the ImagineArt side navigable.

## What I would not add

`video_url` / `audio_url` reference-to-video, and multi-image references on the
six models that take them. The contract allows all of it; this pipeline exists
to animate an approved frame, and handing a video model more pictures is the
failure the lanes were built to prevent. If it is ever wanted it should be a
deliberate per-card opt-in that says what it is doing, not a setting.

## Changes, by file

- **`js/model.js`** — `settings.imagineDuration`, `settings.imagineQuality`;
  `shot.shoot` in `newShot` and `CONTENT_KEYS`; migrate to `{}`.
- **`js/imagine.js`** — `durationFor(p, shot, slug)` beside `resolutionFor`,
  reading override → board → model default, clamped to the allow-list;
  `qualityFor` takes the shot; both generators send what they resolve;
  `whyNot` gains "this length is not on this model" as a *note*, not a block.
- **`js/promptpanel.js`** — the shoot row, per lane.
- **`js/board.js`** — the same row under the card's clip control, so a board
  worked on the canvas never has to open the table.
- **`js/settings.js`** — the board defaults, beside the existing two.
- **`js/exportpanel.js` / `js/pdf.js`** — the manifest and the printed page
  already record resolution; they gain duration.

## Tests

Allow-list clamping for every model in the fixture (including the range form
and the models that take none); override → board → model-default precedence;
a sparse `shoot` surviving save, version restore and a card swap; the push
carrying exactly the resolved values; the menu offering only what the model
takes; the struck-through board default when a model cannot honour it; and the
cost line changing with the duration, which is the whole point of the key it
is already stored under.
