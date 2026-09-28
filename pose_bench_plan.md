# Blocking a shot in 3D (Pose Bench) — plan

Status: **planned, not built.**

## Why

A card's still is written from words and, at best, one reference picture of each subject. Where
people stand, which way they face, what they hold and where the camera is are all left to the
model to guess, and it guesses differently every take. Pose Bench (the mannequin tool, today at
`d:\claudecode\pose\pose.html`) poses figures, props and a camera in a few seconds. The goal is
to open it **from a card**, block the shot, and have that blocking:

- travel with the still push as the layout reference,
- be named correctly in the prompt ("the tan mannequin is Nat, seated left, looking at Rowan"),
- stay editable: reopening the card's blocking restores the 3D scene exactly, and saving it again
  replaces the reference everywhere,
- show which takes were made from an older blocking.

## What the platform can and cannot take — read this first

Everything here has to go through ImagineArt, the app's only image generator.

- **A still takes one `image_url`.** Several references are already composited into one 2×2
  reference sheet (`buildSheet`, imagine.js:2516, at most 4 panels of 768 px). A blocking image
  is one more picture that goes into that same pipe.
- **There is no control-image input.** ImagineArt has no ControlNet, depth, pose or normal
  conditioning. Pose Bench's **depth / OpenPose / normal / mask passes cannot be sent as
  controls**. Sent as a picture, a depth map is just a grey image the model may copy.
- So the plan sends **the beauty render only**: grey mannequins on a neutral background, which
  image models read well as a layout reference. The passes are **kept reproducible and
  exported**, for the user's local ComfyUI/VACE work and for any future control-capable route.
  They are not sent.
- REST mode (API key) sends no reference at all today (imagine.js:1669). For that route the
  **blocking text** (below) is the only thing that carries the layout, which is a second reason
  to generate the text.

## What does NOT change

- **The frame is still the output slot.** `shot.image`/`shot.render` stay "the picture the card
  shows / the take". Blocking is **not** written into the frame, because the next still would
  bank it as a take and the layout would stop feeding.
- **Feed numbering, @marks, the cast block, the sheet** keep their rules. Blocking is one more
  feed entry, placed first.
- **Clips** are unchanged. A clip animates the card's frame; blocking is a still-lane input.
- **Pose Bench stays usable on its own**, and it stays one source file.

## The data change

One new optional field on a shot:

```
shot.pose = {
  serial:  3,                         // bumps on every save; takes record which one made them
  scene:   'b_…',                     // blob ref: Pose Bench scene JSON (figures, props, camera) — the source of truth
  image:   {ref, w, h},               // ≤480p proxy of the beauty render (SB.downscaleImage)
  render:  {ref, serial, ext, w, h, bytes, …},   // the full-size beauty render (Renders.keep: WebP q0.9)
  cast:    [{fig:'f…', personaId:'per_…', color:'#c99a6b', colorName:'tan'}],
  text:    'Nat (tan mannequin): seated left third, facing right, looking at Rowan. …',
  aspect:  '16:9', lens: 35, at: 1790000000000
}
```

- **Passes are not stored.** They are re-rendered from `scene` when someone asks for them
  (export, "download passes"). A scene is about 10 KB; five PNG passes per card would be about
  1–2 MB each, carried by every copy of the board forever (the same weight argument as
  `one_reference_plan.md`). Rendering them from the scene also keeps them consistent with the
  beauty image by construction.
- **Takes remember the blocking:** `made.pose = serial` is written at generation time next to
  `made.reference` (imagine.js:~2319).
- **Migration:** none. The field is optional. Boards without it are unchanged.

## How it feeds a still

- `Refs.feed(p, shot, 'image')` puts a `{kind:'pose', label:'blocking', role:'layout'}` entry
  **first** when `shot.pose` exists.
  - With nothing else to send, the blocking goes **alone at full size** as the single `image_url`.
  - With subjects, it takes the **top-left panel** of the sheet.
- The cast block (personas.js:455ff) gets one sentence per model template (`REF_TEMPLATES` gains a
  `pose` line, editable in Settings like the others), for example:

  > image 1 is a BLOCKING reference: grey mannequins show the camera angle, framing, where each
  > person stands and how they are posed. Match that layout; render real people, never
  > mannequins, and ignore the mannequins' colour and material. The tan mannequin is Nat
  > (image 2); the grey one is Rowan (image 3).

- **H3:** the blocking becomes `<Picture 1>` with the existing *composition anchor* wording
  (h3.js:143–148, 196–215). That is exactly what the code already says about a riffed frame.
- **The prompt writer** gets `shot.pose.text` in its input for the image lane, so the written
  description agrees with the picture instead of contradicting it.
- `refsFor` (imagine.js:3239) counts the blocking, so the corner badge and the "how many pictures
  travel" sentence stay honest.

## Figure ↔ subject linking (Pose Bench side)

The prompt can only say "the tan one is Nat" if Pose Bench knows who is who.

- The card opens Pose Bench with its cast `[{personaId, name, kind}]`. The Figures panel gets
  **"Is: Nat / Rowan / —"**. Linking renames the figure and gives it a distinct palette colour.
  Two linked figures never share a colour.
- On save, Pose Bench computes the **blocking text** from the rig for each linked figure:
  - which third of the frame, and whether foreground or background (projected pelvis);
  - facing relative to camera, and relative to the other figures;
  - seated or standing, and what they hold (props attached to the hand);
  - who they look at (`f.look`).
- An unlinked figure is described as "an extra".

## The Pose Bench host mode

Pose Bench learns to run **embedded**:

- `posebench:open {token, scene|null, cast, aspect, longEdge, shotLabel}` starts it.
  - The capture aspect is **locked** to the board's (`SB.Imagine.aspectOf(p)`).
  - Autosave to localStorage is **off**: the scene belongs to the card, and must not overwrite
    the standalone tool's scene.
- The top bar gains **Use for shot 12** and **Cancel**. Pose Bench's own undo covers the whole
  editing session, so Cancel discards everything.
- **Use** posts `posebench:done {token, scene, beauty(dataUrl), cast, text, lens}`.
- `posebench:passes {token, scene}` renders the passes **offscreen** and replies
  `{depth, openpose, normal, mask}`. This is used by export, with no UI shown.
- Messages carry the token. The host ignores anything else (the same pattern as the
  OAuth popup, imagine.js:472–550).

## Where it lives and how it opens

**Pose Bench moves into this repo** (`posebench/pose.html`), and `build.mjs` inlines it as a
string into `storyboarder.html`. It then opens in a **full-screen in-app overlay**: an `<iframe
srcdoc>` inside `SB.modal`, the precedent being the PDF preview (exportoptions.js:156–205).

- It keeps the single-file promise: one `storyboarder.html`, nothing to locate relative to it.
- There is no second window to lose behind the board.
- It still opens standalone from `posebench/pose.html`.
- three.js still loads from cdnjs. The app is already online for ImagineArt.

## Board UI

- **Frame tools** (board.js ~1965): a **⛹ block** button beside draw and ✕. On an empty frame, the
  drop hint reads *"drop / paste an image, click to load, or ⛹ block it in 3D"* (board.js:1920).
- **A blocking badge** sits on the frame when `shot.pose` exists. It shows a tiny thumbnail, and
  clicking it reopens the scene.
- **An empty frame shows the blocking**, dimmed and labelled *blocking*, until a still arrives. A
  freshly blocked board then reads as a storyboard immediately. This is display only; nothing
  is written into `shot.image`.
- **Stale takes:** a take whose `made.pose` is older than `shot.pose.serial` gets *"earlier
  blocking"* in the Reviewer and on its take badge.
- **Remove blocking** is an armed action (`SB.armButton`). Structural changes aren't undoable in
  this app.

## Export

- The export panel gains **"include blocking passes"**. It writes `…_blocking.png` plus
  `…_depth.png / _openpose.png / _normal.png / _mask.png` per blocked card, rendered on demand via
  `posebench:passes`, named by the export naming rules.
- The scene JSON is exported too, so a card's blocking can be reopened in standalone Pose Bench.

## Code to change

| File | Change |
|---|---|
| `posebench/pose.html` | host mode (open/done/passes messages, locked aspect, no autosave, Use/Cancel), figure ↔ subject linking, palette colours, blocking-text generator |
| `build.mjs` | inline `posebench/pose.html` as a string (`SB.PoseBenchSrc`) |
| `js/pose.js` (new) | `SB.Pose`: `open(shot)`, overlay + iframe + token, `save(shot, msg)` (blobs, `Renders.keep`, `serial++`, `changed(true)`), `passes(shot) → Promise`, `clear(shot)` |
| `index.html` | `<script src="js/pose.js">` after renders/model, before board/app |
| `js/blobs.js` | `referenced()` marks `pose.scene`, `pose.image.ref`, `pose.render.ref`; `stats()` counts them |
| `js/model.js` | `CONTENT_KEYS` += `pose` (card swap); card copy clones it; `Renders.weigh()` counts blocking |
| `js/refs.js` | `feed()` puts the pose entry first on the image lane |
| `js/personas.js` | `block()` blocking sentence + colour→subject mapping; `REF_TEMPLATES.pose` |
| `js/h3.js` | blocking = `<Picture 1>` composition anchor |
| `js/imagine.js` | the sheet puts blocking top-left; `refsFor` counts it; `made.pose = serial` |
| `js/prompts.js` | writer input gets `shot.pose.text` for the image lane |
| `js/board.js` | ⛹ button, hint, badge, dimmed blocking in empty frames |
| `js/reviewer.js` | "earlier blocking" on stale takes |
| `js/exportpanel.js` | include blocking + passes + scene |

## Tests

- **test-core.mjs:**
  - the pose entry is fed first, numbered 1, and shifts subjects to 2…;
  - `gc()` does not collect pose blobs;
  - a card swap moves `pose`, and a card copy clones it;
  - `made.pose` is recorded.
- **prompt-scenario.js:**
  - the blocking sentence appears with the right colours and numbers;
  - it is absent when there's no blocking;
  - H3 names `<Picture 1>` as the composition anchor.
- **ui-scenario.js:**
  - the ⛹ button and badge appear;
  - an empty blocked frame shows the dimmed blocking;
  - the stale-take label shows up after a re-save.
- **New Pose Bench round trip** (headless Chrome, as in the Pose Bench tests):
  - open with a cast, link figures, Use;
  - the host receives scene + beauty + text;
  - reopen restores the identical scene;
  - `passes` returns four images.

## Order of work

1. **Pose Bench host mode + linking + blocking text.** Tested on its own with a tiny host page.
2. **`build.mjs` inlining + `js/pose.js` overlay + `shot.pose` storage**, with `blobs.referenced()`
   in the same commit (or the first structural change eats the scene).
3. **Feed + cast block + H3 + sheet + `refsFor`.** This is the point where blocking starts
   affecting stills.
4. **Board UI:** button, badge, empty-frame display, Reviewer staleness.
5. **Export with passes.**
6. Tests and README.

## Decisions to confirm

1. **Move Pose Bench into this repo** (`posebench/pose.html`, git-tracked, inlined by the build).
   The recommended alternative to keeping it at `d:\claudecode\pose` and loading it by path.
2. **Blocking plus subjects on one card:** blocking takes the top-left sheet panel
   (recommended), or blocking alone with subjects described only in words.
3. **Show the blocking in empty frames**, dimmed (recommended), or keep empty frames empty.
