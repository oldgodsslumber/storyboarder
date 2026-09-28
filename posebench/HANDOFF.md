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
(lite / full / heavy) and **Swap sides**. The plan is `pose_from_camera_plan.md` in the storyboarder repo.

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
- **Storyboarder embed:** the iframe is `allow="clipboard-write *; camera *"`. A plain `camera` is refused, because a
  srcdoc frame on a file:// page has an opaque origin.
- **Next:** hands (HandLandmarker → forearm twist, wrist, finger shapes, a *point* shape), then two performers →
  two figures, then "match the webcam's view".
