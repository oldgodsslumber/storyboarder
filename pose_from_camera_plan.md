# Pose from camera — plan

Status: **planned, not built.** Builds on `pose_bench_plan.md` (built on `V3-posebench`).

## Why

Posing a mannequin with IK and presets is fast for a stock action and slow for a *specific*
one: the way someone leans on a desk, a half-turn while listening, one hand on the back of a
chair. It is much quicker to stand up and do it. The goal is that someone on the team can:

1. open Pose Bench (from a card, or on its own),
2. stand in front of their webcam and strike the pose,
3. have the selected mannequin take it — live, or on a countdown snapshot,
4. then do what Pose Bench is for: move the figure, place the others, and **frame the camera**.

The webcam supplies the *pose*. It does not supply the shot: the point is to pose once and
then try lenses and angles freely.

## What Zhu's editor does, and what it doesn't

`zhuyu1997.github.io/open-pose-editor` (MIT) has "Detect from image":

- It runs `@mediapipe/pose` (the legacy BlazePose solution) **once on an uploaded photo**
  (`src/utils/detect.ts`).
- It takes `poseWorldLandmarks`: 33 points in metres, centred on the hips.
- It converts axes with `(x, −y, −z)`.
- It points each limb of its skeleton along the matching segment (`body.ts: SetPose`, a
  `rotateTo` per bone).

What it doesn't have:

- a webcam or live follow;
- smoothing;
- confidence handling (a hidden leg is posed anyway);
- hands (only three hand points), and forearm twist;
- head orientation;
- seated or upper-body use.

It also *resizes* its skeleton to the photo's proportions, which is wrong for us: our figure
has a chosen build and height.

We take the idea, not the code. We use the current `@mediapipe/tasks-vision` (Apache-2.0,
v1.0.1 on jsdelivr) and write the retargeting against our own rig.

## The pipeline

```
webcam (getUserMedia)          photo (drop / pick)
        \                         /
   PoseLandmarker (VIDEO | IMAGE mode, numPoses 1–2)   + HandLandmarker (optional)
        |  33 world landmarks (m, hip-centred) + visibility, 33 image landmarks (0–1)
   One-Euro smoothing (live) / N-frame average (snapshot)
        |
   retarget onto the selected figure (directions, not positions)
        |
   clampJoint limits -> ground (or seat) -> resolve other figures' look-at
```

**Loading.** `tasks-vision` is loaded with dynamic `import()` from jsdelivr, pinned to one
version. Models come from Google's model bucket:

| file | size |
|---|---|
| `pose_landmarker_lite.task` | 5.8 MB |
| `pose_landmarker_full.task` (default) | 9.4 MB |
| `pose_landmarker_heavy.task` | 31 MB, better for photos |
| `hand_landmarker.task` | 7.8 MB |
| the WASM runtime | 11.8 MB |

Everything is fetched **only on first use** of the panel and cached by the browser.

**No frames leave the machine.** Inference runs in the browser. The panel says so, and it
never records or stores video.

## Retargeting — the part that decides whether it feels right

**Axes.** MediaPipe world space is x = image right, y = down, z = away from the camera (with
hips at the origin). For a person facing the camera, that maps to our figure's frame as
`(x, −y, −z)` (left, up, forward). This matches Zhu's conversion.

**Directions, not positions.** Every segment gives a *direction*, and the figure keeps its own
bone lengths. So a 1.6 m performer can drive a 1.9 m figure, or a child build.

Joint by joint, reusing Pose Bench's solvers:

- **Pelvis**
  - hip line → yaw and roll;
  - hip midpoint to shoulder midpoint → pitch.
  - Yaw is split: it goes to the figure's **turn** (option "follow facing"), or the figure keeps
    its facing and only the body twists.
  - Keeping facing is the default, so framing someone who is turning doesn't swing the whole
    figure off its mark.
- **Spine and chest:** the shoulder line and the hips-to-shoulders direction, shared between
  waist and chest (`aimJoint`, the CCD already used for spine drags).
- **Arms:** shoulder → elbow → wrist targets, **rescaled to our arm lengths**.
  - `solveChain` (analytic two-bone), then `swivel` with a pole at our shoulder plus the
    performer's upper-arm direction. That reproduces both segment directions *and* which
    way the elbow points.
  - With the hand model on, **forearm twist and wrist** come from its palm orientation via
    `orientHand`, the same function the work presets use.
  - Without it, the pose's three hand points (wrist, index, pinky) give a rough palm.
- **Legs:** hip → knee → ankle, the same way. Heel and foot-index points set the ankle so
  feet land flat or pointed.
- **Head:** nose, eyes and ears give yaw, pitch and roll, split neck/head the way
  `aimHead` splits a look-at.
- **Hands (optional):** 21 hand landmarks. Finger curl classifies the hand into Pose Bench's
  shapes (**relaxed / grip / flat**, plus a *point* shape added for this).
- Everything passes through `clampJoint`, so a bad frame can't hyperextend a knee.

**Confidence gating — essential for a webcam at a desk.**
- A joint whose landmarks have `visibility < 0.5` is **left as it was**, not guessed. Sitting at a
  laptop, the camera sees head, shoulders and arms, so only those move, and a seated figure
  stays seated.
- An explicit **Body: full / upper** switch makes that choice without relying on thresholds.
  Upper body is the default when the figure is seated.

**Smoothing.** A One-Euro filter on each landmark when live, which is standard for this jitter.
Snapshot mode averages the last ~10 frames at the moment of capture.

**Mirror.** Selfie mode is on by default: your right hand moves the figure's *right* hand, as in
a mirror, and the preview is mirrored to match. It can be turned off.

## The panel (Pose Bench)

A **"Pose from camera"** button in the Pose section opens a floating panel over the viewport:

- **Live preview**, small and mirrored, with the detected skeleton drawn over it. Joints it is
  ignoring (low confidence, or outside the body mode) are drawn dim.
- **Follow live**: the selected figure mirrors you in real time. It's great for finding a
  pose, and you stop it when you have it.
- **Snap (3 s)**: a countdown, then one averaged capture. This is the hands-free way when you're
  standing back from the laptop. Space triggers it.
- **Applies to:** the selected figure, with a one-click switch between figures. It never moves
  or turns the figure unless "follow facing" is on.
- **Body:** full / upper. **Hands:** off / shapes. **Mirror:** on / off.
- **From a photo…**: the same pipeline in IMAGE mode on a dropped picture, with the heavy
  model by default. This matches what Zhu's has.
- Each snap is **one undo step**. Live follow commits one step when you stop it.

Presets and hand goals don't fight it. Applying a camera pose **releases** the goals on the
limbs it moves (`releaseFor`, the same rule as dragging), but keeps held props attached and
keeps the seat.

**Two people (later phase):** `numPoses: 2` assigns detected people to figures left to right
in the frame, so a pair can act out a two-shot together.

## Framing (the point of the exercise)

Once the figure has the pose, the existing camera tools do the framing: views, shot sizes,
lens, the capture guide, and in the storyboarder, **Use for 1B**. Two small additions:

- **"Match the webcam's view"** (optional, phase 3): set Pose Bench's camera to the viewpoint
  the webcam saw. The 33 image landmarks and 33 world landmarks give 2D–3D correspondences, and
  a small PnP solve (fixed focal length from the lens slider) returns the camera's height,
  distance and angle. Useful when the webcam angle *is* the shot; off by default, since the
  webcam is usually just a sensor.
- **Freeze on stop:** stopping live follow leaves the figure exactly in the last smoothed pose.
  Framing then starts from something stable.

## Storyboarder side

Very little changes, which is the benefit of it living inside Pose Bench.

- `js/pose.js`: the iframe gets **`allow="camera"`**. Without it, `getUserMedia` inside the
  embedded Pose Bench is refused.
- Nothing about `shot.pose` changes. A webcam pose is just a pose; it's saved, fed and flagged
  exactly like a hand-made one.
- The deployed copy is served over https, and `file://` counts as a secure context in Chrome, so
  the camera works in both. The host page's own permission prompt applies once.

## Code to change

| File | Change |
|---|---|
| `posebench/pose.html` | "Pose from camera" panel; lazy `tasks-vision` loader; `PoseSource` (webcam/photo → smoothed landmarks); `retarget(fig, landmarks, opts)` built on `solveChain` / `swivel` / `aimJoint` / `orientHand` / `aimHead`; confidence gating; body/hands/mirror/facing options; *point* hand shape; one-undo-step commits |
| `js/pose.js` (storyboarder) | `allow="camera"` on the editor iframe |
| `posebench/HANDOFF.md` | the axes, the retarget order, the gating rule, model URLs and versions |
| `README.md` | one paragraph under "Blocking a shot in 3D" |

## How it gets tested (no webcam in a test run)

- **Fake camera:** Chrome's `--use-fake-device-for-media-stream
  --use-file-for-fake-video-capture=clip.y4m` feeds a recorded clip as the webcam. A few short
  clips of known actions (arm raise, turn, sit and type, phone to ear) run through live follow
  in headless Chrome, and the figure's joint angles are checked against the expected ones
  within tolerances.
- **Photos:** IMAGE mode on stock photos of the work poses, compared with Pose Bench's own
  presets, plus contact sheets (front, ¾, side) as used for every preset so far.
- **Retarget unit checks:** synthetic landmarks generated *from* Pose Bench's own posed rig
  (project the rig's joints into MediaPipe's format), then retargeted back. The round trip
  must reproduce the pose. This catches axis and sign mistakes without any model in the loop.
- **Gating:** landmarks with the legs marked invisible must leave the legs untouched, and a
  seated figure must stay seated.

## Limits to say out loud

- **One camera, estimated depth.** BlazePose's z is inferred. Arms reaching straight at the
  camera, or crossed in front of the body, are its weakest case, and the result may need a quick
  drag. The live preview makes that obvious in the moment.
- **Hands at arm's length from a laptop camera** are small. Hand shapes are a best guess;
  exact finger poses are out of scope.
- **Forearm twist** is not visible in the 33 body points. It needs the hand model on, or it
  keeps its current value.
- **First use downloads ~21 MB** (full model plus WASM runtime) and needs a network, like
  three.js already does.

## Order of work

1. Retarget core against **synthetic landmarks** (the round-trip test). Axes, directions,
   two-bone plus swivel, spine, head, gating.
2. Loader and **photo mode**: parity with Zhu, testable on stills.
3. **Webcam** live follow plus snapshot, smoothing, mirror, the panel and undo steps.
4. **Hands** (HandLandmarker → forearm twist, wrist, hand shape, new *point* shape).
5. Storyboarder `allow="camera"`, a fake-camera end-to-end test, docs.
6. Later: two performers → two figures; "match the webcam's view".

## Decisions to confirm

1. **Pose only, or follow facing too?** The default keeps the figure on its mark and facing,
   and applies the body's twist only (recommended for framing). The alternative lets the
   figure turn when you turn.
2. **Mirror on by default** (recommended: it matches the preview, so it feels natural), or
   anatomical (your right is the figure's left when you face each other).
3. **Hands in the first build**, or body first and hands as a follow-up (recommended: body
   first, since hands are the least reliable part from a laptop camera).
