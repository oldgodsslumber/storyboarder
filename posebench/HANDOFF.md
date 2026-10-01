# Pose Bench — handoff

A single-file 3D mannequin posing and capture tool. You pose one or more figures, frame a camera,
and capture clean PNG/JPEG images to use as **MiniMax H3 reference images** and storyboard shot frames.
Eventual goal: fold the capture step into Jason's storyboarder (single-file HTML app, per-shot base64 JPEGs ≤480p).

## Files
- `pose.html` is the whole app (HTML + CSS + JS in one file). Open it directly in Chrome.

## Stack / constraints
- Vanilla HTML/CSS/JS, no build step.
- The only external dependency is **three.js r128 UMD** from cdnjs, so it needs network on first open.
  If the script fails to load, the page shows a "three.js didn't load" panel instead of silently breaking.
- The orbit camera, rig, and IK are all hand-rolled (no OrbitControls, no mannequin.js), so the code is original and clean to reuse.

## Rewrite (2026-09-28): what was wrong with v1
- The spine was built with `bone()`, which extends limbs *down*, so the torso, neck, and head hung
  upside-down between the legs. This was the main "it's not right" bug.
- Knee and elbow bend signs were inverted, so the presets bent joints backwards.
- Hip twist fought the body-turn slider (both wrote `root.rotation.y`).
- The selection highlight and colours were baked into captures, and colours were washed out (no sRGB conversion).

## Architecture (inside the `<script>` IIFE)
- **Rig spec:** `SPEC` defines each joint's DOFs in *anatomical* terms (`[label, neg hint, pos hint, euler sign, min, max]`).
  For left/right joints, the y/z signs are also multiplied by side (+1 L, −1 R), so the same number means
  the same movement on both sides. `getA/setA(joint, axis, deg)` read and write anatomical degrees. Euler order is `XZY`
  (x = bend, z = side, y = twist, applied innermost) on every pivot.
- **Joints:** `pelvis, spine, chest, neck, head, l/rShoulder, l/rElbow, l/rWrist, l/rHip, l/rKnee, l/rAnkle`.
  The figure faces **+Z**, and its left is +X.
- **`Figure` class:** one per figure. It builds pivots and lathe/ellipsoid meshes from `TYPES{male,female,child}`
  proportions × build. Its `group` carries world position + facing (`turn`), and the pelvis pivot carries the crouch offset.
  `ground()` drops the lowest vertex to y=0 when "Keep on floor" is on.
- **Presets:** `PRESETS` are anatomical-degree maps, verified visually from front, ¾, and side.
- **Mirror:** swaps l/r names. Centre joints negate y/z, and pelvis offset x flips.
- **IK:** `solveChain` handles two-bone chains analytically (law of cosines on the elbow/knee hinge, then aims the root).
  Shoulder and hip aiming uses `aimSwing`, which solves the swing angles in closed form and **leaves twist alone**.
  Spine and neck use quaternion CCD. Limits are clamped after every step.
- **Pointer modes:** drag a part → IK on `CHAIN[joint]`. Drag the hips → crouch with both feet pinned (world position +
  orientation). Drag the ring or Shift+drag → move on the floor. Drag the knob → turn. Empty → orbit. Right/middle → pan.
  Two fingers → pinch/pan.
- **Camera:** spherical `cam{target,theta,phi,radius,mm}`. View buttons are relative to the active figure's facing.
  `fitShot(wide|full|medium|close)` frames using the *capture guide* aspect and FOV, not the window.
- **Capture:** `renderShot()` renders at output size using `camera.setViewOffset` over the guide rectangle, so the
  image matches the on-screen frame guide exactly. It hides handles and highlights, and with the transparent option it also hides
  the grid and shadow. `turnaround()` composes front/¾/side/back into one sheet. Shots go into the bottom tray and a viewer.
- **History:** `commit()` pushes a JSON snapshot (figures + active figure) at the end of each gesture or slider change. The
  history holds 150 steps, and `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` move through it. The scene autosaves to `localStorage` (`posebench.v2.scene`).
  Saved poses live in `posebench.v2.poses`. Export/Import writes and reads the same JSON.

## Work poses, props, look-at and hand goals (2026-09-28)
The preset panel is grouped: **Work** (the default set), **Two-person scenes**, and **More poses** (the older 14 angle presets, collapsed).
- **Props (`Prop` class):** chair, desk, table, laptop, phone, cup. They are simple grey geometry, face +Z, and the user side is local −Z.
  - `owner` is the figure that a preset created the prop for. `on` is the surface the prop sits on. `attach` = `{fig, side}` means the prop is held and parented to that wrist pivot.
  - Props appear in the depth and normal passes, and as neutral grey (0.5) in the mask pass. They are never in OpenPose.
  - `carriedBy(f)`: moving or turning a figure (ring or Shift-drag) carries its owned props and its chair. Dragging a prop carries whatever sits on it
    (a laptop on a desk, a figure on a chair). Q/E turns the selected prop and Delete removes it.
- **Seating:** `f.seat` holds a chair id. `seatFigure` sets the chair's seat height from the sitter's lower-leg length (`autoSeatH`, like a gas lift),
  places the pelvis on the seat (`placeOnSeat`), and searches knee angle so the feet land flat (`fitFeet`). `Figure.ground()` calls
  `placeOnSeat` for seated figures, so every edit keeps them on the chair.
- **Look-at:** `f.look` is `{fig}`, `{prop}` or `'camera'`. `aimHead` splits yaw and pitch between neck and head in closed form.
  A camera look updates every frame. Editing the neck or head releases the look.
- **Hand goals:** `f.goals` = `[{side, kind, prop?, fig?}]`. The kinds are `type, ear, view, text, lap, gesture(low), cup, shake, cross`.
  - `goalFrame` returns the palm position, palm normal and finger direction in world space. `solveHandGoal` runs two-bone IK, then `swivel`
    turns the elbow toward a per-kind pole (`POLES`), then `orientHand` puts the roll into forearm twist first and the wrist second.
  - Goals re-solve live whenever a figure or prop moves.
  - Editing a joint on an arm releases that arm's goal (`releaseFor`), so the user always wins.
  - `alignHeldPhone` orients a held phone independently of the hand: ear-to-mouth on a call, upright when viewing.
    Its exact grip is saved in the snapshot (`grip`).
- **Presets:** `WORK{}` holds data presets (base angles + seat/desk/laptop + props + hand shapes + goals + look) built by `applyWork`.
  `SCENES{}` are functions that place a second figure (reusing an existing one if there is one). `applyNamed(name)` handles all three groups.
  Because presets are goals rather than stored angles, they fit Man, Woman and Child builds (checked on contact sheets).
- **Hand shapes:** `HANDS{relaxed, grip, flat}` move the finger block and thumb. There's a per-figure select in the Figures panel.
- **Known limits:** there's no collision, so an arm can clip a desk if you drag it there. The second figure in a scene is always a Man, so change
  its type afterwards if needed. A laptop hand goal survives moving the chair but can over-stretch if you move the laptop out of reach.

## Control passes (for ControlNet / Wan VACE / reference models)
Toggle them under **Capture → Also capture**. The choice persists in `posebench.v2.passes`. Every capture and turnaround then
produces a matched set (same camera, same frame), and the files share a set stamp: `pose_<stamp>.png`, `_depth`, `_openpose`, `_normal`, `_mask`.
- **Depth:** inverse depth, near = white, normalised to the figures (`setDepthRange`), similar to MiDaS / Depth Anything output.
  "Floor in depth pass" includes the ground plane.
- **OpenPose:** COCO-18 body keypoints projected straight from the rig (`poseKeypoints`), drawn like controlnet_aux/DWPose.
  Limbs use 0.6× colour and joints full colour; line width is 4 px per 1024 px. Eyes, ears and nose that face away from the camera are dropped,
  which is what tells a model the head direction. There are no hand or face-detail keypoints.
- **Normal:** camera-space normals as RGB = (x right, y up, z toward camera) × 0.5 + 0.5. **Unverified** against a specific
  normal ControlNet's axis convention. If one reads it inverted, flip the red/green channels in `normalMat`.
- **Mask:** a flat colour per figure (red, green, blue, yellow, …) on black, for regional prompts and inpaint masks.
- All of these are raw `ShaderMaterial`s swapped in by `swapPassMaterials`, so no tone mapping or sRGB conversion touches the values.

## Storyboarder hook (built, not yet wired on the storyboard side)
- `PoseBench.captureSet({aspect,longEdge,passes})` returns `{beauty,depth,openpose,normal,mask}` data URLs.
  `capture({pass})` returns one image. The postMessage `posebench:captureSet` replies with `{type:'posebench:set', images}`.
- `window.PoseBench.capture({aspect, longEdge, format:'png'|'jpeg', transparent})` returns a data URL.
  `getScene()`, `setScene(s)`, and `applyPreset(name)` are also exposed.
- postMessage: send `{type:'posebench:capture', id, aspect, longEdge, format}` and get back `{type:'posebench:shot', id, dataUrl}`.
- If the page was opened by another window or is in an iframe, the shot viewer shows **Send to storyboard**, which posts
  `{type:'posebench:shot', dataUrl, width, height, name}` to the opener/parent.
- Every capture also dispatches a `posebench:shot` CustomEvent on `window`.

## Testing
Headless Chrome via playwright-core (swiftshader WebGL). `window.__pb` exposes internals (figures, cam, fitShot,
setView, solveChain) for scripted checks. There's no test suite in the repo, only ad-hoc scripts.

## Next steps / ideas
1. Wire the storyboarder side: open Pose Bench from a shot card, then receive `posebench:shot` → downscale to ≤480p JPEG.
2. Vendor three.js into the file if fully offline use is wanted (≈600 KB).
3. Props (stool/box/wall) for sit and lean poses, and simple finger poses (fist / open / point).
4. Optional: per-figure "look at" target for eyelines between two figures.

## Embedded in the storyboarder (host mode, 2026-09-28)
**This file is now the source of truth** (`storyboarder/posebench/pose.html`). `node build.mjs` in the storyboarder
writes it into `js/posebench-src.js`, and the app mounts it as an `<iframe srcdoc>` named `posebench-embed`.
The same file still runs on its own in a browser.

- **Detecting embed mode:** `EMBED = window.name === 'posebench-embed'`. This is synchronous, so it is known before boot.
  - In embed mode the scene is never autosaved (`saveScene`), because file:// pages share one localStorage and the
    card owns the scene.
  - Saved poses (`posebench.v2.poses`) and pass choices stay shared with the standalone tool.
- **Protocol** (all via postMessage; everything leaving carries the host's token):
  - `posebench:ready` → host sends `posebench:open {token, scene|null, cast:[{id,name,kind}], aspect, longEdge, shot}`.
    - The aspect is locked and the long edge is set.
    - With no scene, the editor starts with one mannequin per `person` in the cast, already linked.
  - **Use for 1B** → `posebench:done {scene, beauty, text, cast:[{fig, personaId, name, color, colorName}], lens}`.
  - **Cancel** → `posebench:cancel`.
  - `posebench:passes {token, id, scene, aspect, longEdge, passes}` → `posebench:passes {id, images}`.
    This renders offscreen and is used by the storyboarder's export.
- **Linking:** `f.link` holds the storyboarder subject id. The Figures panel shows "Who this is" when a cast arrives.
  - Linking renames the figure.
  - It gives the figure the first free colour from `LINK_ORDER` (tan, blue, coral, green, dark grey, white, light grey), so
    the prompt can say "the tan mannequin is Nat". Only one figure can be linked to each subject.
- **`blockingText(aspect)`** writes one line per figure, projected through the capture camera:
  - third of frame, depth rank, how much of the figure is framed;
  - seated, standing or crouching, and facing relative to camera and screen;
  - look target, and hand actions (from goals and held props);
  - one camera line and one props line.

  It is plain English on purpose: it goes into the prompt writer's input.
- Test harness for host mode: see the storyboarder's e2e flow (open from a card → link → Use → reopen identical →
  re-block marks older takes → passes render). `window.__pb.blockingText` is exposed for checks.

## Pose from camera or photo (body, 2026-09-28)
This is the **◉ Pose from camera or photo** button at the top of the Pose section. It opens a floating panel with a
mirrored webcam preview and the detected skeleton drawn over it. It also has **Follow live**, **Snap in 3** (or press
Space), **From photo…** (you can also drop a picture on the panel), a Body switch (auto / full / upper), a model choice
(lite / full / heavy; heavy by default, and the last pick is remembered in `localStorage` as `posebench.camModel`) and **Swap sides**. The plan is `pose_from_camera_plan.md` in the storyboarder repo.

- **Model:** `@mediapipe/tasks-vision@1.0.1` (Apache-2.0), loaded with dynamic `import()` from jsdelivr. The models come
  from `storage.googleapis.com/mediapipe-models/pose_landmarker/*`. The GPU delegate is tried first, then the CPU one.
  Everything loads lazily on first use (about 21 MB with the full model) and runs in the browser. `mpLoad(model, mode)`
  switches between VIDEO and IMAGE mode.
- **Axes:** MediaPipe world coordinates `(x right, y down, z away)`, centred on the hips, become figure space as
  `(x, -y, -z)`. Landmarks are anatomical, so the performer's right wrist drives the figure's right wrist.
  - I confirmed this on a real photo: `left_shoulder` sits on the image's right, and the nose z is negative.
  - Mannequin renders are *not* a valid test for this. A faceless mannequin reads as seen from behind, so the model
    swaps its left/right labels.
- **`retarget(f, pose, {body})`:**
  - **Figure keeps its facing.** With the hips visible, the performer's overall turn (from the hip line) is removed;
    with no hips visible, the performer is assumed to face the camera.
  - **Pelvis:** roll from the hip line.
  - **Torso:** `splitTwo` spine/chest from the shoulder line plus hips→shoulders, with a spine correction pass.
  - **Head:** `splitTwo` neck/head from the ear line plus nose, with `NOSE_DROP` of 15°.
  - **Limbs:** `limbFrame` builds the root's orientation *exactly* from both segment directions and picks whichever
    of the two XZY Euler solutions fits the joint limits. A straight limb falls back to `solveChain` + `swivelJ`.
  - **Palm:** from the index and pinky knuckles, via `orientHand`, which also sets forearm twist.
  - **Feet:** from heel→toe.
  - **Gating:** a landmark with visibility < 0.5 leaves its joint as it was. Body `auto` means upper body only when the
    figure is seated or the hips/knees can't be seen.
- **Tests (headless, no webcam):**
  - `synthLandmarks(f)` makes MediaPipe-format landmarks *from* a posed rig. Round-tripping 18 presets from a Man onto
    a shorter, turned Woman comes back within 3° per segment.
  - Gating checks: upper body keeps the legs, hidden legs switch to auto-upper, a hidden arm keeps its angle, seated
    stays seated, facing and mark are kept, swap sides mirrors, and each snap is one undo step.
  - Photo mode on the MediaPipe sample photo.
  - Live mode with `getUserMedia` stubbed to a `canvas.captureStream()`.
- **Fresh vs live** (fixed 2026-09-28 after a user report):
  - A photo or a snap is a **fresh** pose (`retarget(..., {fresh:true})`). Every joint in scope goes back to neutral
    first, so a part the model can't see this time comes out neutral.
  - Before this fix, low-confidence joints kept whatever the *previous* photo left. For example, a standing woman
    whose right knee scored 0.49 kept the raised leg of the seated photo before her. It got worse with every photo:
    "it only posed the top half".
  - Live follow is not fresh: a joint that drops out for a frame stays where it was a moment ago.
  - Photos also use a lower threshold (`PHOTO_VIS` 0.3, against 0.5 for the webcam), because a still is chosen
    deliberately.
  - The panel shows a busy overlay while downloading or reading, and a green ✓ result that lists what was copied and
    what was set to neutral. It has a **Reset figure to neutral** button, and an unreadable file is reported in the
    panel.
- **Several people (2026-09-28):** the panel's **People** control can be Auto, One or Two.
  - **Why not the pose model's own option:** asked for four people (`numPoses`), MediaPipe returned the *same* man three
    times and never found the second. At its default confidence it also found nobody in a clear full-length handshake
    photo.
  - **What it does instead:** a person finder runs first, then one pose read per person.
    - The finder is `ObjectDetector` with `efficientdet_lite2` in int8, 7.5 MB, on the CPU delegate. The GPU delegate
      silently finds nothing with int8, and lite0 missed one of two walkers.
    - `findPeople()` reads each person from their own padded crop (`poseInBox`), maps the landmarks back to the full
      frame, and drops duplicates.
    - With `whole:true`, the whole-picture read goes to whichever person it lands on. A crop cut beside someone else
      read a long-coated man's hidden legs as seated.
  - **Photos:** Auto finds up to four people. The people map to figures left to right on screen: the selected figure
    and its nearest neighbours, plus new figures when there are too few (`figsForPeople`).
  - **Arrange like the photo** (on by default) places and turns the figures relative to *this* camera
    (`arrangeLikePhoto`). Distance comes from each person's torso: its length in metres, from the world landmarks,
    against its length in the picture, through an assumed 45° vertical lens. Facing comes from the hip line.
    Carried props move with each figure.
  - **Webcam, Two:** people are found every 12 frames and tracked in between from their landmark boxes, then ordered as
    the mirrored preview shows them. Poses only; figures keep their marks. Snap averages each person separately.
  - **Single photos:** when nothing is found at 0.5, `poseDetect(..., retry)` looks again at 0.2 before saying "No
    person found".
  - **Tested on:** the handshake photo (both men found, placed and turned toward each other), an overhead two-walker
    photo (one person readable; the other is too overlapped), and a synthetic two-person webcam stream (follow and
    snap).
- **Trusting unsure joints (2026-09-28, after a user report):** the panel has a **Use unsure joints** switch,
  on by default.
  - **When it's on:** a joint moves whenever the model gives it any real estimate (`TRUST_FLOOR` 0.02). The problem
    it fixes: an arm the model could plainly see, but marked low-confidence, was frozen in live follow and set to
    neutral on a snap, although its guess was right.
  - **When it's off:** the cautious thresholds come back: 0.5 for the webcam, 0.3 for photos.
  - **What stays strict either way:** *whether the hips and legs are in view at all* (`sure()` at 0.5). That decision
    keeps a figure's legs still while someone sits at a desk webcam that can't see them.
  - **The preview:** joints drawn in colour are the ones being used, fainter the less sure the model is.
- **Storyboarder embed:** the iframe is `allow="clipboard-write *; camera *"`. A plain `camera` is refused, because a
  srcdoc frame on a file:// page has an opaque origin.
- **Next:** hands (HandLandmarker → forearm twist, wrist, finger shapes, a *point* shape), then "match the webcam's
  view". (Two performers → two figures is built, above.)

## Motion takes: record a performance, recut it (2026-09-28)
Plan: `pose_motion_plan.md`, all seven steps built. The code is the `motion takes` region, just before host mode.

- **Making a take.**
  - **● Record** in the camera panel: a 3-second countdown, then until Stop (at most 60 s).
  - **Video file…**: an offline read. The file is seeked every 1/30 s, and each frame goes through the VIDEO landmarker,
    or through `findPeople` when People is Two.
  - Both hand frames to `makeTake(frames, figs, W, H)`. **No footage is kept**: only landmarks, stored as Int16
    base64 (`encPose`), about 57 KB for 3.5 s.
- **Cleanup and bake (`bakeTake`):**
  - `resampleTake` resamples to 30 fps, bridging gaps up to 0.5 s. `smoothSeq` smooths both ways with a Gaussian.
  - One body mode per take: full when ≥60% of frames see the hips and a knee. Full takes travel (`rootSeq`: distance
    from torso size through an assumed 45° lens, sideways from hip position); upper-body takes stay in place.
  - Then `retarget` runs on every frame and `recordFrame` stores joint eulers, pelvis, position and turn.
  - `footPin` is root pinning. While a foot is planted (image speed < 0.12 body heights per second — tighter would miss real plants, looser pinned a figure that glides, within 3.5% of
    body height of the lowest foot, for 3+ frames), the earliest-planted foot anchors the whole figure, and the other
    planted foot is solved with leg IK. A performer standing still shows 0 slide.
- **Timeline** (under the stage when a take is open):
  - Play/pause (Space), step (`,` `.`), and a track to scrub, trim (drag the ends) and cut on.
  - The ⚙ panel: name, root (auto / in place / travels), fps, smoothing, foot pin, body, Re-bake, Clear fixes, Delete.
- **Correction keys:** pause, pose a figure by hand, and the difference from the bake becomes a key that blends
  cosine-wise over ±0.35 s (`takeEditHook`, called from `commit`; `keyDelta` at playback). A second nudge at the same
  frame adds to the same key. Keys survive re-bakes and the file.
- **Cameras and the cut:**
  - **+ Cam** saves the current view as A, B, C… Per camera: Update, **Move to here** (it travels from its view to this
    one across the take, smoothstep), and **Follow** a figure (the target rides that figure's chest).
  - The cut: press 1–9 while playing, or ✂ at the playhead, to cut to that camera. Tick **Edit** to watch the cut.
  - `camAt(tk, c, t)` gives a camera's view at a time; `cutCam(tk, t)` gives which camera the cut shows then.
- **Export (`exportTake`):**
  - Mediabunny 1.60.0 (MPL-2.0, jsdelivr ESM) encodes H.264 MP4 (VP9 WebM as fallback), 24 fps by default.
  - Choose the edit or one camera, and beauty or any control pass. PNG frames export as a store-only zip.
  - The cut list (`cutList`) is a JSON of the segments with in/out frames.
  - `o.from` / `o.to` export a sub-range without moving the take's trim, which camera moves are timed against.
- **`takeChanged()` bumps `version`** on every change a clip would show: bake, keys, cameras, cuts, trim, fps. The
  storyboard uses it for staleness.
- **Host mode:** see the protocol comment at the top of host mode.
  - `posebench:open` carries the scene's `takes` and the card's `link`. On reopen, the take opens at the card's
    still moment; if the card came from a segment of the edit (`link.cut`), the edit is switched back on.
  - `posebench:done` returns `takes` and `link`. With the edit on, the link is the SEGMENT under the playhead: its
    camera and its in/out. Otherwise it is the selected camera over the take's trim, or `view` if the user orbited off
    every camera.
  - `posebench:clip` renders a card's clip in the hidden worker. Passes and clips share one job queue (`hostJob`).
- **Tests** (scratchpad scripts, not in the repo):
  - Synthetic round trip on a different, turned figure: mean pose error 3.6°, worst 7°; travel 0.95 m against 1.0 m;
    turn 58° against 60°.
  - Webcam recording: the jumping-jacks video drawn into a `captureStream` gave 8.7 s with no gaps.
  - Correction keys, and export: the cuts switch at the exact frames, and pass, PNG and file round trips work.
  - Real footage: Wikimedia "Jumping jacks and burpees" (8 s): 241 frames, no gaps, the arms swing 5–62°.
    (The Wikimedia clip "Jumping jack slow motion" shows an *ant*, the jumping jack ant, so nobody is found in it.
    Don't use it as a test.)
  - Headless swiftshader reads video at about 2 frames per second. On real hardware it is far faster.

## Live smoothing and kept models (2026-09-29)
- **Smoothing** (camera panel, beside Model; Off / Light / **Medium** / Strong, remembered as `posebench.camSmooth`).
  It works in two parts:
  - **The landmark filter:** each level sets the One-Euro cut-off and beta (`SMOOTH`).
  - **The glide:** in live follow, a reading becomes a target (`glideTo`). The render loop eases each joint's
    quaternion toward it with the level's time constant (`glideTick`; Medium is 80 ms, so it settles in about 200 ms).
    This is what removes the choppiness of a model reading 15–30 times a second.

  Snaps, photos, arranging and a take's bake never glide. Stopping live follow, stopping the camera, and any exact
  apply land the glide first (`glideFinish`).
- **Kept models.** Pose and person-finder models are fetched once and stored in IndexedDB (`posebench-models`,
  keyed by URL). After that they're handed to MediaPipe as `modelAssetBuffer`, and a later open makes no model
  request. If storage is unavailable, it falls back to the URL. The MediaPipe wasm comes from jsdelivr, which the
  browser caches normally.
- **Headless testing:** the Accurate model on swiftshader starves the test harness. Set `posebench.camModel` to
  `lite` in test runs.

## Video-file import, hardened (2026-09-29, after a user report)
Reported: the webcam posed fine, but a video file didn't pose at all. I couldn't reproduce it headless: software
decoding plus the CPU delegate. The most likely cause on a real machine is GPU decoding: straight after a seek, the
`<video>` frame isn't ready for the GPU landmarker, so it reads a blank picture. `camImportVideo` now:
- waits for `seeked`, then for `requestVideoFrameCallback` (or a frame, if that's unavailable);
- copies the frame to a canvas (at most 1280 px long edge) and detects on the canvas, never the video element;
- uses a fresh VIDEO landmarker of its own (`MP.lm.FILE`, via `mpLoad(model,'VIDEO','FILE')`), so the webcam's
  tracking state doesn't carry into the file;
- gives a frame it misses a second look with the IMAGE landmarker at a lower confidence (`poseDetect(...,true)`);
- measures a recording that reports an `Infinity` duration (MediaRecorder output) by seeking to its end first;
- reports "a person in N of M frames", and warns when that's under half.

## Limbs solved to end points; facing from the video (2026-09-29, after "it found the video but messed up the posing")
Test clip: a squat filmed from behind, at three-quarters (Wikimedia "Squat - exercise demonstration video").
- **Legs and arms reach the measured ankle and wrist** (`twoBone`), scaled from the performer's limb lengths to the
  figure's. The measured knee or elbow only chooses the bend plane.
  - **Why:** laying fixed-length bones along the measured thigh and shin *directions* failed from behind. The model's
    depth for one thigh put the knee above the hip (thighs measured 0.26 m and 0.44 m), which threw that leg up.
  - **Result:** both feet are planted and both knees bend forward in the squat.
  - **Clean data is unaffected:** the 18-preset round trip is unchanged.
- **Face as in the video** (take setting, on for video-file imports): the figure starts turned the way the performer
  faces the camera (`group.rotation.y = base + yaw`), so a performer filmed from behind is a figure seen from behind.
  Webcam takes keep the old rule (the figure keeps its facing; only turns are copied).
- **Still limited by the model:** hands hidden behind the head or a bar, and torso lean seen from behind (the model
  measured about 17° where the lifter leans more).

## The head from the face model (2026-09-29, after "the head was totally off")
- **Symptom:** a sullen walk and a woman in a chair were right except the head.
  - Reproduced on photos: a woman looking down at her hand, one tilted down toward her shoulder, and a bird-dog.
    The old head came out level or chin-up every time.
  - **Cause:** the pose model's five face points (nose, eyes, ears) have poor depth. A clearly lowered head read as
    18–23° of "nose below the ears", barely past the 15° allowance for a level head.
  - The fallback also used a hidden, guessed ear whenever unsure joints were trusted.
- **Now:** where a face can be seen, the head comes from MediaPipe's **FaceLandmarker** (`FACE_URL`, float16,
  about 4 MB, kept in IndexedDB like the others) and its facial transformation matrix.
- **`addHead(pose, src, W, H)`** does the work:
  - It crops around the head. The crop is sized from the torso and shoulders, because the ears overlap in profile.
    The model finds no face in a full-body frame.
  - It runs the face model in IMAGE mode, and checks that the face's nose tip sits on this pose's nose.
  - It corrects for the head sitting off-centre in the real picture (the camera ray, `PHOTO_FOV_V`).
  - It sets `pose.face = {fwd, up}` in landmark space.
- **`retarget`** uses `pose.face` for neck and head when present, de-yawed like everything else.
- **Where it runs:** webcam (one person), `findPeople` (photos, two people, the two-person webcam, two-person video),
  single photos, and video files.
- **How the head data travels:** through `swapPose` (mirrored), the live One-Euro filter, snap averaging,
  `lerpPose`, `smoothSeq`, and take storage (`encPose` adds 6 values; older takes decode with `face: null`).
- **Switch:** "Head from the face" in the camera panel, on by default.
- **Fallback, when no face is read** (a back view, a profile the model can't read): the old landmark head, but the
  ears are used only when the model is *sure* of both. Then the eyes; otherwise the head stays put.
- **Verified:**
  - on the three photos, the head now drops and tilts like the photo;
  - a take's head equals the same frame applied as a photo, and survives the file;
  - clean synthetic round trips are unchanged, since they carry no face.

## Glitch frames (2026-09-29, `pose_glitch_plan.md`)
- **Where it runs:** `bakeTake` calls `repairSeq(read, level, overrides)` between `resampleTake` and `smoothSeq`,
  so one bad frame can't be smoothed into a lurch. The raw landmarks stay stored, so any setting change or override
  just re-bakes.
- **The detector** (`glitchMask`) works per frame and per limb (`GL_LIMBS`: arms, legs, torso, head) and uses the
  take's own statistics:
  - **Swaps:** if a frame fits the median of its ±4 neighbours better with its left/right labels swapped back
    (`labelSwap`, which never mirrors), it's unswapped exactly.
  - **Spikes:** a Hampel-style test on each joint against the median of its ±3 neighbours, scaled by how much those
    neighbours spread. A fast real move spreads its neighbours too, so it isn't flagged.
  - **Bone lengths:** each of the 12 bones is compared with its median over the take. Several bones off at once
    means a whole-frame collapse.
  - **Promotion:** a broken torso, or 3 or more limbs, becomes a whole-frame glitch.
  - **Long runs** of a limb (over `GL_RUN_MAX` = 8 frames, bridging gaps of up to 2 clean frames) are sustained
    misreads, not glitches. On the squat-from-behind clip, the hidden arms read about 40% long for 1.5 s. Those are
    left as read and noted (`kind: 'long'`), because rebuilding them from equally wrong neighbours only froze the arm.
- **The repair** (`repairSeq`) rebuilds a broken limb by interpolating it from the nearest good frames within
  0.5 s, and keeps the rest of the frame. A broken frame is rebuilt with `lerpPose`. With nothing to rebuild from,
  the limb's visibility is zeroed, so the retarget holds it.
- **Levels** (`tk.opts.glitch`: `off` / `auto` default / `strong`):
  - Strong tightens the thresholds and adds a second bake that flags limbs pinned against a joint limit (not the
    straight end of an elbow or knee) where the neighbours aren't.
  - Strong can flag a real pose held right at a limit; it's opt-in.
- **Overrides:** `tk.glitch[k] = {mark: {frame: limb|'all'}, keep: {frame: true}}`, set by **Mark as glitch**
  (uses the selected joint's limb) and **Keep as read** in the ⚙ panel. They're stored in `takeSnap`.
- **UI:**
  - **Timeline:** a red tick per repaired frame (taller for a whole frame) and a hollow bar over a long misread;
    hovering says what and why.
  - **⚙ panel:** the level control, a summary, and "This frame: …".
  - **Import message:** "…; 24 frames repaired (24 limbs); 1 longer misread left as read".
- **Live** (`liveGuard`, "Catch glitches" in the camera panel, on by default): readings are judged against the last
  accepted one.
  - A swap is undone on the spot.
  - A limb whose bones read over 35% off their recent median is held.
  - A limb jumping more than 0.35 m is held for up to 2 readings, then accepted if the next reading agrees (a real
    fast move).
  - Recordings keep the raw readings, so the bake repairs them.
- **Photos:** `photoWarnings` compares each bone with the figure's own proportions, relative to the torso. More than
  45% off gets a warning in the panel; nothing is changed.
- **Verified:**
  - **Synthetic test** (a swap, a 2-frame 90° arm throw, a +50% thigh, a whole-body collapse, and a real fast
    punch): all five glitches caught, the punch not flagged, repairs within 0–4° of the clean take against 11–47°
    unrepaired, and no flags on the clean take (Auto).
  - **Live guard:** the swap undone, the glitch held, the real move accepted a frame later.
  - **Real footage:**
    - jumping jacks: 1 frame repaired;
    - squat from behind: 24 short repairs, plus one 1.5 s arm misread left as read.

## Photo to figure: the translation, diagnosed and fixed (2026-09-29)
**The user's report:** the 2D skeleton over the photo looked right, but the figure looked wonky.

**How it was measured.** Every bone's on-screen angle was compared three ways: the 2D skeleton, the model's 3D
world landmarks seen from the camera, and the figure seen from the photo's camera (the removed turn put back). The
photos were: seated on the ground, standing and turned 53°, a bird-dog, and a standing officer. The model's own 3D
agreed with its 2D (mostly within 0–10°), so the losses were in `retarget`.

**The findings, and the fixes:**
1. **Limb scale averaged both sides.** A hidden arm's guessed length (0.40 m, visibility 0.11) dragged the average
   below the visible arm's 0.49 m. The visible wrist target was then out of reach, so the two-bone solve
   straightened a bent arm (19–24° error).
   - **Fix:** `sideScale` scales each limb by its own length when sure, otherwise borrows the sure side's, and falls
     back to the average only when neither side is sure.
   - **Result:** 19–24° → 1°.
2. **The pelvis was always upright** (`basisXY(hipLine, worldUp)`, clamped to its ±30° posing range). A bird-dog
   needs the pelvis tipped about 75°, so the spine hit its 55° limit, the hip hit −30° extension, and the torso and
   legs were clipped.
   - **Fix:** the pelvis takes the torso's lean about the hip line, and the spine keeps `clamp(0.4 × lean, −20°,
     +35°)`. It's set with `setRootQuat`, unclamped, because the root's angle is the body's orientation, not a
     joint.
   - **Result:** thigh 40° → 0°, shin 51° → 0°, torso 21° → 3°, hips 14° → 0°.
3. **Viewing.** The figure keeps its facing, so for a performer turned 50–70° the default view is a different side
   from the photo, and a correct pose looks like a tangle.
   - **Fix:** **◎ View as the photo** in the camera panel (`viewAsPhoto`; `camS.photoView` = the figure plus the
     performer's yaw) sets `cam.theta = figure turn − yaw`.

The diagnostic script is `diag_translate.js` in the session scratchpad. Its table columns: `img~model`,
`model~figure` and `3d model~figure`, plus the depth of each bone.

## Steady standing: the model's depth guess for a still stance (2026-09-29, after "the dummy looks like it has to pee")

A neutral standing photo came out with bent knees, a forward torso and forearms raised toward the lens, while the 2D skeleton on the photo was straight. Diagnosis on three neutral photos (`diag_stand.js`): the retarget was faithful (model vs figure 0–2°). The fault was MediaPipe's world **depth**, biased the same way every time: shins 16–29° back, forearms 9–35° toward the camera, torso 4–16° forward. Heavy was no better (the knees were worse). The picture can't settle it: a 22° depth tilt shortens a bone on screen by only 7%.

`steadyDepth(ps)` runs before `retarget` in `camApply`/`camApplyMulti` when **Steady standing** (`camSteady`, default on) is set, and only when `standingStill(ps)` holds: hips, knees and ankles all confident, legs mostly extended, feet level, torso within 35° of upright. It then:
- damps each bone's depth tilt (torso, then the arm and leg bones from the root out, carrying descendants): tilts under 30° are kept at 20%, tilts over 45° are kept whole, and the range between is blended;
- slides the ankles in depth under the centre of mass, with the knees following half way.

Only camera-space z moves, so the photo-angle view is unchanged. Results: knees went from 14–27° to 4–11°, and the spine from 10–16° lean to 3–4°. Hands-on-hips elbows stay bent (they're real). Squats, seated poses, a bird-dog and a mid-stride photo are not steadied. Takes don't use it (a walk seen from the front can pass for standing).

## The human body (2026-09-30, after "is it worth upgrading our dummy?")

**Body** (Capture panel: Human / Classic mannequin; saved as `bodyStyle` in the scene; older scenes open as Human) swaps what the figures look like, on screen and in every render and pass. Nothing about posing changed. The mannequin stays in place as an invisible skeleton (`mat.visible=false`), and posing, IK, limits, picking (the raycaster ignores `visible`), grounding and props all still work on it. The body follows it.

- **Source:** "Human Models Set - Male/Female (Rigged)" by lzyassoul, CC-BY-4.0. The credit sits in the UI, the README and `bodies.js`. The source zip is in `posebench/models/`. Unzip it to `models/sketchfab/` (gitignored), then run `node posebench/models/prep-bodies.mjs [--dump]` to write `posebench/bodies.js` (~940 KB). `build.mjs` inlines it into `js/posebench-src.js`.
- **Prep:**
  - Woman: the rigged low-poly weights are copied to the 17k high mesh (nearest four vertices).
  - Man: his source skin is broken (left-thigh weights sit on the right leg, the toe bones take half the shin). He gets nearest-bone weights kept to his own side (`autoWeights`), then the woman's weights carried over through each bone (`templateWeights`); his separate fingers keep their own. His 33k high mesh is meshes 5+6 (the right arm is a separate piece).
  - Both: welded, winding made consistent per connected piece (the man's faces were mixed), weights smoothed six passes over the surface (`smoothWeights`: this removed the torn shoulder tops), and the Rigify rig trimmed to 53 bones (the torso chain, limbs, toes, 30 finger bones; palms, face and breasts fold into their parent).
- **Runtime (`makeBody`/`fitBody`):**
  - Each body bone rides one mannequin joint (`BODY_MAP`). At build time the body is fitted to the figure: every bone head goes on its joint, each bone is stretched along its length to the figure's own segment, the A-pose arms and legs are swung onto the mannequin's rest direction, and the head is scaled for a child.
  - `K[i] = rest(joint)^-1 · fitted bone · bind^-1`. Each frame the skeleton's `update` writes `inverse(group) · pivot.matrixWorld · K[i]`. The mesh is a detached-bind `SkinnedMesh` inside the figure's group, `DoubleSide`.
  - The fingers curl from the hand shape (`CURL`, about each finger bone's X).
  - Highlight: the `aHl` attribute is the share of each vertex belonging to the selected or hovered joint, injected as emissive.
  - Passes use skinned copies of the depth, normal and mask materials (`SKIN_VS`).
- **Types:** Man and Child use the male body (the child's head is scaled up); Woman uses the female one. Bulk widens the limbs laterally.
- **Known limits:**
  - A faint dark crease at the crotch.
  - Clicks on body areas wider than the mannequin (flanks, belly) miss, because picking uses the mannequin.
  - Undo doesn't revert a Body change.

### Shoulders and holding (2026-09-30, after "the shoulders are too high, and the hands aren't holding objects")

- **Shoulders and neck.** The torso bones now keep the body's own proportions, placed only on the figure's hips. They used to be stretched onto the mannequin's joints, whose chest is long and neck short, and that squashed the body's neck by about 40%: the head sank and the shoulders rode up to the jaw. Each torso bone still rides its mannequin joint.
- **Palm orientation.** After the A-pose arm is swung down, the hand is turned about the arm until its thumb points forward, the way the mannequin's hand hangs and the way every held prop is placed. The forearm takes half the turn (`body.handTwist` records it: about 42° left, −20° right on the male).
- **Fingers.** The model's rest fingers are each bent about 30° off the hand, by different amounts, so "flat" came out half-curled and pointing forward. `bodyFingers` now lays each finger out from its own knuckle: straight along the hand, curling toward the palm by `CURL`, with the thumb down and forward, curling across. Phone at the ear, mug and texting now sit in the hand the way they do on the mannequin.

### Human (low-poly, original rig) (2026-09-30)

A third **Body** option: the file's own rigged low-poly meshes (male mesh 0, ~9k tris; female mesh 2, ~4k), with the artist's weights untouched (`body(..., {own:true})` → `male_rig` / `female_rig` in bodies.js, which is now ~1.2 MB). Fitting, hands and fingers are the same code as the sculpted bodies. In the comparison (`models/body-compare.png`), the woman looks close to the sculpted one. The man tears at the hip and chest whenever a leg lifts or an arm comes forward, because his source thigh weights are crossed.

### Human (auto-rigged, MIA) (2026-09-30)

The sculpted meshes, rigged and weighted by ComfyUI-UniRig's MIA auto-rigger (Mixamo skeleton, all fingers). Pipeline:
1. `node models/prep-bodies.mjs --export-mesh` writes `ComfyUI/input/3d/pb_body_{male,female}.glb`.
2. `models/mia_run.py` queues MIA through the ComfyUI API. `GeomPackLoadMeshPath` sidesteps UniRig's cached file list.
3. `models/fbx_extract.html/.js` (headless Chrome, three FBXLoader) turns `ComfyUI/output/pb_body_*_rig_mia.fbx` into `models/mia_*.json`.
4. `node models/prep-bodies.mjs --mia` maps the Mixamo bones onto the runtime names (spine.005 is synthesized midway up the neck), gives each bone a bind frame aimed at its child, and welds.

ComfyUI's isolated envs needed `comfy-aimdo` 0.5.5 (unirig and geometrypack) and `comfy-kitchen` 0.2.35 (unirig) after the 2026-09-28 core update, plus a ComfyUI restart.

Result (`models/body-compare.png`, rows: sculpted with our weights / MIA / original rig): the MIA man bends cleanly where the original rig tears. The MIA hands open into claws on a grip, and the MIA woman's shoulders sit high. bodies.js now carries all three sets (~2.1 MB); trim once one is chosen.

## Build: set pieces from the local model (2026-09-30, `build_plan.md` phase 1)

The **Build** box in the Props panel takes "a sedan" or "an office with four desks facing a window".
- **Where it goes:** the request goes to Storyboarder's Local provider, which the host passes in `posebench:open` as `d.llm` = {url, model, key}. Standalone, the address comes from the "Local model" fold (localStorage `posebench.llm`, default `http://127.0.0.1:5000`), posted to `/v1/chat/completions`.
- **What's sent:** `BUILD_SYSTEM` (the format, a real-size table, rules) plus three worked examples (`BUILD_EXAMPLES`: chair, sedan, small office).
- **Reading the reply:** `parseLoose` strips `<think>` blocks and takes the first `{` to the last `}`. One retry passes the parse error back.
- `expandParts` handles the shapes box, cylinder, sphere, cone, wedge, torus and plane. It expands `repeat` {count, along, mirror x|z} and `on` (rest on top of a part), clamps sizes and positions, caps at 200 parts, and counts what it skipped.
- `cleanParts` grounds the build (unless the request says it floats), centres the footprint, and drops a part that sits wholly inside another of the same shape.
- **Placement:** the result is a `Prop` of type `'build'` with `parts`, `name` and `request` in its `snap()`, built from shared geometries. A small build goes in front of the active figure, turned to face them; a big one (over 3 m) goes at the camera target.
- **Edit selected:** sends the current part list and the instruction, and expects the full updated list back.
- **Look & fix:** three captures (front, three-quarter, side) go to the same endpoint as `image_url` parts. That needs a vision model loaded, e.g. qwen3-vl; otherwise the error says so. Its fixes (or "OK") then go back to the builder as an edit.
- **Also fixed here:** captures now clear the selected prop's highlight tint. It used to leak into every render of a selected prop.

## The short panel (2026-09-30, `posebench_ui_plan.md`)

The rail is now a **Cast** strip, **one card** for the selection (`refreshCard()`: prop → `#cardProp` holding `#propPanel`; else the active figure → `#cardFig`; else `#cardNone`, "start here"), and three folds: Posing options, Scene look (with Body style) and File.

Everything else moved rather than being rebuilt, so every element id and handler is unchanged:
- **Top bar:** Poses ▾ / Props ▾ / Build / ? / Capture ▾ open `.pop` popovers (`openPop(id)`, one at a time; a click outside or Esc closes them).
- **Camera pad:** `#camPad`, bottom-left, holds the old Camera section. It shifts up with the tray (`#stage.has-tray`) and the timeline. Its open state is in localStorage `posebench.camPad`.
- **Joint popover:** `#jointPop` holds the old Joint section plus the hand selects. It opens when a limb is clicked (`openJointPop()` in pointerdown) and closes on an empty click, Esc, ✕ or selecting a prop. `placeJointPop()` runs every frame to keep it beside the joint, flipped and clamped to the viewport.
- **Quick poses:** `LIMB_POSES` per part (arm, leg, head, torso), written for side X; `applyLimbPose` sets the named joints whole. "Camera" sets look-at. "Copy to other side" copies the limb to the other side.
- **Keys:** 1–8 for views, Shift+1–4 for shot size (only while no take is open, because 1–9 cut cameras during takes).

## Floor, Lift, and sitting on anything (2026-09-30)

- **"Keep on floor" grounds what you see.** `visMinY(f, joints)` gives the lowest point of the skinned human body when it's shown (vertices bucketed by joint on first use, in `body.jv`), else the mannequin. Before, the mannequin was grounded and the human body floated 1.5 cm standing and 2.6 cm kneeling.
- **Chair feet land.** `seatFigure` now measures the gap under the feet after `fitFeet` and takes it out of the chair's `seatH`, twice. Seated feet used to hang about 7 cm.
- **Lift** (`f.lift`, metres; figure card slider ±30 cm; Alt+↑/↓ 1 cm, Shift 5 cm; double-click resets) is added after the floor or the seat places the figure. It's saved in `snap()`.
- **Sit on** (figure card): any prop that isn't held (chair, table, desk, or a Build).
  - A chair works as before.
  - Anything else, via `sitOnSurface` → `edgeSeat`: the side the figure is standing beyond, scaled by the prop's size so a bench is sat on along its length. The hips are set in from that edge (0.45 × thigh, at most 70% of the half-width), and the figure faces out.
  - `f.seatAt = [x, z, turn°]` in the prop's space is saved.
  - The height is `seatTop()`: a ray cast straight down onto the prop's meshes, so a Build's top is found without knowing its shape.
  - A low seat slopes the thighs down (hip 88→56°) until the feet reach the floor; a high one leaves them hanging.
  - Moving or turning the prop carries the figure, as with chairs.

## The shot type from the frame (2026-09-30, `shot_type_plan.md`)

`shotFraming(asp)` reads the capture camera, not the last shot-size button:
- **Size** comes from the main figure (the selected one if it's in shot, else the nearest cast figure, else the nearest): full length → Wide; hips up → Medium; head and shoulders → Close-up; a head over 60% of the frame height, or over 42% and cut at the top → Extreme close-up.
- **Two shot:** two or more figures with their heads in shot at Medium or Close-up.
- **Over the shoulder:** the nearest figure has its back to camera, is cut by the edge or looms (head over 1.6× the other's), and faces another.
- **Also measured:** the angle (the same wording as `blockingText`) and `cam.mm`.

It's sent as `framing` in `posebench:done`. Storyboarder stores it on `pose.framing`, sets `sh.type` (falling back to the size when the board doesn't offer the type), and says so in the toast. The lens and angle reach the still's instructions (`SB.Prompts.blockingCamera`).

## Props sit on what's under them, and lift (2026-09-30)

- **Dropping small props:** a laptop, phone or cup, let go after a drag (or newly added), settles onto whatever is under it. `surfaceUnder` casts a ray straight down onto the other props' meshes (tables, desks, Builds; not other small props or its own riders) and sets `p.on` to the prop it hit. With nothing under it, it goes to the floor. Before this, a drag kept the height it started at, so a laptop slid along the floor inside a table.
- **Lift:** `p.lift` (metres) is set by the prop card's slider (0–250 cm; double-click resets) or Alt+↑/↓ (1 cm, 5 cm with Shift; the selected prop first, else the figure). `settleProp` moves riders (`q.on`) and seated figures with it. It's saved in `snap()`.

## Desktop and Table props (2026-09-30)

- **`table4`** ("Table"): a rectangular four-legged table, 1.6 × 0.9 m, `topH` 0.75, with an apron. The old `table` type is still the round café table, now labelled "Round table", so saved scenes keep their props.
- **`monitor`** ("Desktop"): one prop holding a monitor on a stand (back, +z), a keyboard and a mouse (front, -z). The user is at -z, as with the laptop. It's in `SMALL_PROPS`, so it settles onto a desk, table or Build and can be lifted. Anchors: `look` is the screen centre, and `keysL`/`keysR` are on the keyboard. Added beside a figure, it turns to face them and sits toward the far side of the surface.
- **Work preset "Desktop":** chair + desk + monitor, hands typing on the keyboard, looking at the screen (`def.monitor` in `applyWork`).
- Blocking text now uses "an" before a vowel ("an office chair").

## Movable part popover (2026-10-01)

- Drag `#jointPop` by its header (`#jpHead`, ⠿). Once dragged, it stays where you put it for every part. The spot is kept as a fraction of the stage in `localStorage` (`posebench.jointPopAt`, wrapped in try/catch), and `placeJointPop` clamps it to the stage. ⤺ (`#jpDock`) or a double-click on the header clears that, so it follows the joint again.

## Camera bar (2026-10-01)

- `#camPad` is now one row across the bottom of the stage: 📷 toggle | views (`#views`) | shot size (`#shots`) | Lens (`#rLens`, which takes the spare width). The ids are unchanged, so every handler is untouched. It's open by default under a new key, `posebench.camBar` (the old box's "closed" doesn't carry over), and closed by default on a stage under 600 px. Below 1320 px window width the buttons go compact; narrower still, the bar scrolls sideways rather than wrapping.
- `guideRect` insets the capture frame by `barInset()` at the top and the bottom alike, so the frame stays centred on the lens axis (no shifted-lens captures) and clear of the bar. `placeJointPop` keeps the popover above the bar.
- `markView` lights the view button you picked until the camera is moved by hand (checked in `applyCam`).
