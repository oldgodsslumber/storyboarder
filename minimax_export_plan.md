# MiniMax export: a finished package per card, per lane

Status: **built on `V3-posebench` (2026-09-28).** Decisions taken as recommended:
- the video uses H3's six-section format;
- the brief uses `[Image N]` labels;
- the brief is assembled, and the H3 prose comes from the writer (with an assembled fallback);
- the still is taken at the in-point.

H3's limits were checked: whole seconds from 4 to 15, at most 9 images, 3 videos and 12 files.

What was built differently from the plan below:
- the full-reference H3 scaffold lives in `mxm.js` rather than as a route inside `h3.js`, so the
  ImagineArt prompt code is untouched;
- `retention_analysis` uses `weak_reference` for a subject with no picture, where `h3.js` writes
  `newly_introduced`, which isn't one of the guide's markers;
- the package's prompts are stored on `shot.mxm`, not `shot.prompts`.

Tests: `test-mxm.mjs`.

It builds on the 3D blocking (`pose_bench_plan.md`), the recorded
performances (`pose_motion_plan.md`), the H3 prompt module (`js/h3.js`), and the MiniMax H3
full-reference skill (`minimax-h3-r2v-prompt`).

## Why

Most of the team has no ComfyUI and uses MiniMax by hand: upload files, paste a prompt, and generate.
That only works when three things agree exactly:

- the prompt's labels (`[Image 1]`, `<Picture 2>`, `<Video 1>`);
- the order the files are uploaded in;
- which figure in the grey render is which person.

Today somebody reconciles those by hand for every shot. The board already knows all three: the
blocking, the cast and their reference pictures, the performance clip, and the approved still. So the
app should write the whole package: numbered files, the prompt, and an upload order that can't
disagree with the prompt.

Here is a prompt that already works by hand (from the team):

```
[Image 1] is an untextured grey clay render from Blender. It defines layout, staging, camera and
animation. Follow its composition, subject positions and timing exactly, frame by frame. Keep
geometry, layout and animation unchanged; add only material, colour and lighting.
[Image 2] is a man, Gus.
Scene: … / Left figure [Image 2]: Gus, wearing … / Action: … / Camera: comes entirely from
[Image 1]. … / Style: … / Negative: …
```

Its first paragraph is what matters. It declares each file's **role** before anything else, and the
rest is written against those roles. The plan below generates exactly that, from the board.

## What the app already has

| Piece | Where | Used for |
|---|---|---|
| Blocking still (full-size render) and the figure colours → cast | `shot.pose.render`, `shot.pose.cast` | the image lane's clay render |
| Blocking in words ("Gus (the tan mannequin): left of frame; seated…") | `shot.pose.text` | figure positions: "Left figure" |
| The performance clip: take, camera, in/out | `shot.pose.perf`, `SB.Pose.clip()` | the video lane's clay render |
| Subject reference pictures and descriptions | `SB.Refs.feed`, `SB.Personas` | `[Image 2…]`, wardrobe |
| Feed numbering: one order, shared by the strip, the files and the prompt | `SB.Refs.images` | file order |
| The H3 six-section writer: fixed labels, computed task types, self-check | `js/h3.js`, `H3_VID_TPL` | the video prompt |
| House style | `settings.brand` | the Style line |
| "Download for MXM" (image lane only: numbered pictures, no prompt) | `promptpanel.js` → `Board.saveFeed` | replaced by the package |

The gap: none of it is joined up for MiniMax. The image lane downloads pictures but no prompt. The
video lane's H3 prompt is written for the ImagineArt route, which sends the frame only (see "Keep the
ImagineArt route unchanged" below), so it never names the clip or the reference pictures.

## The design

### One source of truth: the manifest

Each card, per lane, gets one assembled object, and the prompt text and the file list are both
written from it:

```
manifest = {
  lane: 'image' | 'video',
  target: 'minimax-image' | 'minimax-h3',
  assets: [ { n, file, kind: 'clay-still'|'clay-clip'|'first-frame'|'subject', role, subjectId? } ],
  figures: [ { subjectId, name, colour, position: 'left'|'centre'|'right', inFrame, arrives } ],
  scene, action, camera, style, negatives, duration, aspect,
  warnings: [ … ]
}
```

Because the prompt and the file names come from the same `assets[]`, the labels and the upload
order can't disagree. That's the whole point, and a test checks it (below).

### The image lane: first frame on MiniMax Image

**Files, in order:**

1. `01_clay.png` — the blocking render at full size (`shot.pose.render`, not the proxy).
2. `02_<name>.jpg`, … — each subject's reference, in feed order, **as separate files**. (The
   one-picture sheet exists for ImagineArt's single slot, and MiniMax takes several pictures.)

**Prompt:** the team's brief format, image variant. Here it is for the Gus example:

```
[Image 1] is an untextured grey clay render of this exact shot. It defines layout, staging and
camera. Follow its composition, framing, subject positions and poses exactly. Keep geometry and
layout unchanged; add only material, colour and lighting. The clay figures are placeholders: the
tan figure is Gus [Image 2].
[Image 2] is a man, Gus.

Scene: A man sits and looks at his phone, a confused expression on his face.
Left figure [Image 2]: Gus, wearing a white shirt, headset and dark slacks.
Moment: the first instant of the shot — Gus looks down at his phone, confused.
Camera: comes entirely from [Image 1]. Match its framing, angle and lens exactly.
Style: <house style>.
Negative: no clay or mannequin surfaces, no grey studio floor or grid, no on-screen text, no
watermark, no extra people, no deformed hands.
```

**Where each line comes from:**

- **Role lines:** the assets. Every figure line is `<position> figure [Image N]: <name>, <description>`.
- **Positions:** from the blocking. These are already computed per figure in `blockingText` ("left of
  frame…"), so they're stored, not re-derived.
- **Colours:** "the tan figure is Gus" comes from `shot.pose.cast`. The blocking now renders in full
  colour, which makes this checkable at a glance.
- **Scene / Moment:** the card's first-frame text (`imageDescription`, or the description). "Moment"
  is the first instant only, the same rule `IMG_TPL` enforces, so people who arrive later are not in
  it.
- **Style:** the house style. **Negative:** a fixed list per lane.

### The video lane: MiniMax H3 full reference, using the skill

**Files, in order:**

1. `01_clay.mp4` — the card's performance clip, rendered now through its camera over its in/out
   (`SB.Pose.clip`, beauty pass).
2. `02_first_frame.png` — the card's approved still (full-size original), if it has one.
3. `03_<name>.jpg`, … — subject references, in feed order.

With no performance, the blocking still takes slot 1 as a composition anchor (a still clay render)
and the motion comes from the words alone.

**Prompt:** the H3 six-section rewrite, following the skill. Every section except the two prose ones
is computed from the manifest, the way `h3.js` already works. What changes is the vocabulary.

- **`subject_definitions`** carries the team's first paragraph, in H3 labels:
  ```
  <Video 1> is an untextured grey clay render of this exact shot. It defines layout, staging, camera
  and animation: subject positions, poses, movement and timing, frame by frame.
  <Picture 1> is the first frame this shot begins from.
  <Subject 1> is Gus, seen in <Picture 2>: a man in a white shirt, headset and dark slacks. In
  <Video 1> he is the tan figure on the left of frame.
  ```
  The last clause is new and matters most. It binds each person to a clay figure, so with two people
  the motion goes to the right one.
- **`summary`** has the prefix computed from the assets. With a clip it's `[reference generation]`
  (the guide: a video supplying camera and motion is reference generation, not editing). With a
  first frame too, it's `[keyframe completion + reference generation]`.
- **`retention_analysis`**, one line per label:
  - `<Video 1>`: `fully_preserved` within its role: camera path, framing, positions and timing are
    followed exactly, and the clay surfaces are replaced by the subjects.
  - `<Picture 1>`: `fully_preserved`.
  - each `<Subject N>`: `fully_preserved` from its picture.
- **`detailed_description`** is written by the existing writer call, 350–500 words, using the fixed
  labels only.
  - It opens with the style sentence, then `[Shot 1]`, then "the shot begins from `<Picture 1>` and
    follows `<Video 1>`'s camera and motion".
  - The action comes from the motion text. The timing comes from the clip: its length, and the
    take's cut list, if the card spans a cut.
  - H3 has no negative section, so the team's negatives go in as plain sentences inside the style
    opening ("one continuous take with no cuts; no on-screen text…"), keeping the format's six
    sections intact.
- **Sound sections:** the existing silent constants.

**The self-check** (`H3.problems`) extends to `<Video N>`. Any label the writer invents is rejected,
and the writer gets one retry, as it does now.

### Keep the ImagineArt route unchanged

ImagineArt reaches MiniMax only as **image-to-video: the frame and nothing else**
(`minimax-video-01-director-image-to-video`; see `arrival_reference_plan.md`). The current H3 prompt
is correct for that route, and the full-reference package must not leak into it. So `h3.js` takes a
**route**:

- `imagine` (today's behaviour, default for the push);
- `mxm` (clip, frame and subject pictures, for the package).

Nothing that sends today changes.

### The order of work, per shot

This is the order the package enforces. It's what makes a hand-fed MiniMax, and later ComfyUI,
come out right.

1. **Block it** in Pose Bench, linking each figure to a person. If it moves, record or import a
   performance and cut the card from it.
2. **Image lane → MiniMax Image.** Export the package, generate, and drop the chosen still back on
   the card (the existing drop, which records `made`).
3. **Video lane → MiniMax H3.** Export the package. It now includes the approved still as
   `<Picture 1>`, so the clip starts from the picture that was signed off.

The package **warns, rather than blocks**, when the order is broken:

- the still is older than the blocking (the existing `⛹ older`);
- the performance changed since the card was cut (`🎞 older`);
- the still was taken at a different moment than the clip's in-point (see "The still's moment");
- a figure isn't linked to anyone ("an extra"), or a subject has no reference picture;
- the clip is longer than the model takes.

The same assets and order are what a ComfyUI route will consume later: the manifest is
route-agnostic, and the control passes are already listed in the feed as `as:'control'`.

## Where it lives in the app

- **Settings → Models.** Add **MiniMax Image** as an image model (the catalogue already knows the
  slug). `MiniMax H3 (Hailuo)` is already a video model. The lane's model decides the format, so a
  board pointed at MiniMax gets MiniMax prompts with no extra switch.
- **Prompts panel, per lane.** "Download for MXM" becomes **Export for MiniMax**, on both lanes. One
  press gives:
  - `minimax/<code>/<lane>/` with the numbered files;
  - `prompt.txt`;
  - `ORDER.txt` (upload order, model, duration, aspect, and any warnings).

  The prompt is also copied to the clipboard. It's a zip download, using the store-only zip writer
  Pose Bench already has, moved to a shared helper. Beside the button, the lane's prompt cell shows
  the brief or the six sections as they'll be pasted.
- **Export panel.** New check: **MiniMax packages, per shot**. It writes the same folders for every
  card in scope, through the existing lazy-item path (clips render only when written).
- **On the card.** The existing `🎞 clip` stays. There's no new card chrome.

## Code to change

| File | Change |
|---|---|
| `js/mxm.js` (new) | `manifest(p, shot, lane)`, `brief(manifest)` (the image prompt), `order(manifest)`, `warnings(manifest)`, `package(p, shot, lane)` → files + texts |
| `js/h3.js` | a `route` argument: `mxm` adds `<Video 1>` (clip or clay still), subject pictures as `<Picture N>`, figure-to-colour binding, the task types for those, and `problems()` knowing `<Video N>` |
| `js/model.js` | `MiniMax Image` in `defaultModels()` with a brief template; the H3 template gets the clip sentence under the mxm route; migration adds the model to existing boards |
| `js/pose.js` | store each figure's screen position with the cast at Use (`cast[].pos`), so "Left figure" is data, not parsed prose |
| `posebench/pose.html` | `hostLink`: include the figures' positions and the in-point frame; default the still to the in-point when a performance is linked |
| `js/promptpanel.js` | Export for MiniMax on both lanes; show the package preview |
| `js/exportpanel.js` | the *MiniMax packages* option, via lazy items |
| `js/zip.js` (new, shared) | the store-only zip writer, moved out of Pose Bench |
| `build.mjs`, `index.html` | load `mxm.js` and `zip.js` |

## Tests

- **Order equals labels:** for a card with two people, a clip and a still, every `[Image N]`,
  `<Picture N>` and `<Video N>` in the prompt matches file `N` in the package, and every file is
  named in the prompt.
- **Colour binding:** the figure-to-person lines match `shot.pose.cast` after a rename, a recolour
  and a relink.
- **Positions:** a two-person blocking gives left and right figure lines in picture order.
- **H3 format:**
  - six sections, in order;
  - task types match the assets (clip only / clip + frame / frame only);
  - `problems()` rejects an invented `<Video 2>`;
  - the ImagineArt route's prompt is byte-for-byte unchanged.
- **Warnings:** each order-breaking state produces its warning, and a clean card produces none.
- **End to end:** block → performance → Use → still dropped on the card → Export for MiniMax on both
  lanes → the zip holds the right files, names, prompt and ORDER.txt.

## Decisions to confirm

1. **The video prompt's format.** The recommendation is **H3's six-section format**, following the
   skill. MiniMax's guide says full-reference mode expects it, and `h3.js` already writes it. The
   alternative is the team's brief paragraph on both lanes.
   - The six sections carry the same role sentences, so nothing from the brief is lost.
   - If the brief has been giving better H3 results by hand, say so and it becomes a per-board
     switch.
2. **Labels in the brief:** `[Image N]`, as in the team's prompt (recommended), counted in upload
   order.
3. **Writing Scene and Action.**
   - **Image brief:** assembled straight from the card's words (recommended). It's short, exact, and
     needs no API key, which matters for teammates without one.
   - **H3 `detailed_description`:** needs the writer for its 350–500 words. With no key, a shorter
     assembled version goes out with a warning.
4. **The still's moment:** when a card is cut from a performance, its still defaults to the
   **in-point** (recommended), so `<Picture 1>` is the clip's first frame. Today it is wherever the
   playhead was.
5. **Clip length:** this needs checking against the H3 durations MiniMax actually offers. A card
   longer than the maximum is flagged, and split or trimmed in Pose Bench.

