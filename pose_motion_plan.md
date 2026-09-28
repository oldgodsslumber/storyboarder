# Motion takes — record a performance, recut it from any angle

Status: **built on `V3-posebench` (2026-09-28): all seven steps.** It builds on `pose_from_camera_plan.md`.

- **Decisions taken:** no footage kept; full-body takes travel and upper-body takes stay in place; takes live on
  the scene; exports at 24 fps.
- **What differs from the text below:**
  - In the Storyboarder the scene key is `scene.performances[]`, because "take" already means a render there. A
    card's link is `shot.pose.perf`.
  - Foot lock became root pinning (`footPin`).
  - A card's range comes from the segment under the playhead when the edit is on.
- **Still waiting:** the `video_url` push, which needs the arrival plan's video path.
- **Details:** `posebench/HANDOFF.md`.

## Why

Pose from camera already reads a performer's pose accurately enough to drive a mannequin. A still pose is one
frame of that. Recording a few seconds gives a **performance**, and once a performance lives on a 3D figure the
camera is free:

- act the scene once, in front of a laptop;
- film it from as many angles as you like — a wide, a close-up, an over-the-shoulder, a slow push-in — without
  acting it again;
- cut between those angles on a timeline, like a multi-camera edit;
- hand the result on as a **reference video**: to a video model on a card, to ComfyUI / Wan VACE as depth or
  OpenPose video, or to an editor as a previz cut.

The same take seen through different cameras gives the same action, so the cards of one scene cut together.
Continuity is the thing that is hardest to get from generating each shot separately.

## The one decision that shapes everything: record the pose, not the video

A take stores **the landmarks the model read, frame by frame**, not the camera footage.

- **It is tiny.** 33 points × (x, y, z, confidence) per person per frame, quantised, is under 1 KB a frame.
  Ten seconds at 30 fps is about 250 KB. The same ten seconds of video is megabytes.
- **It can be re-read.** Change the figure's build, turn "use unsure joints" off, adjust smoothing, swap sides:
  the take re-bakes from the same landmarks without anyone performing again.
- **It stays private.** Like everything else here, it's read in the browser. The source footage is **not kept by
  default**. An option keeps it on this machine only, as a picture-in-picture guide while editing; it is never
  put in a board file or sent anywhere.

A take is baked into an **animation track** (joint rotations plus the figure's position, per frame) for playback,
but the landmarks stay the source of truth.

## 1. Recording

The Pose-from-camera panel gains a **● Record** button. A 3-second countdown (Space starts it, the same as Snap)
is followed by recording until you stop it, with a time counter in the preview.

- **Webcam:** the live path you already use. Each frame's smoothed landmarks, one or two people, are appended with
  their timestamps.
- **Import a video file:** drop a clip on the panel. It is read **offline**, frame by frame, at its own frame rate.
  Offline can afford the accurate model (the 31 MB "heavy" one) and two-way smoothing, so an imported clip gives a
  cleaner take than live.
- **Two performers:** People: Two works as it does now, so each performer's track drives their own figure.
- **Frame rate:** takes are stored at the source's rate and played at any rate (24 for film, 25, 30).

## 2. Cleaning up a take (the part that makes it look right)

Live smoothing only sees the past. A recorded take can look both ways:

- **Zero-lag smoothing.** The One-Euro filter is run forward and backward, so there's no lag and less jitter.
- **Root motion.** MediaPipe's 3D points are centred on the hips, so on their own a person walking across the
  room would walk on the spot. The figure's travel across the floor is estimated per frame the same way
  "Arrange like the photo" places people: position from the hips in the picture, and distance from the torso's
  size against its real length. A switch offers **in place** (the default for desk and upper-body takes)
  or **travels**.
- **Turning.** The figure keeps its *starting* facing, and the performer's turns during the take are applied
  relative to it, so turning around on camera turns the figure around.
- **Feet planted.** When a foot is still and on the ground, it is locked there with leg IK so it doesn't slide
  (the usual weakness of camera capture). Pose Bench already has the pieces for this in the "crouch with feet
  planted" drag.
- **Gaps.** A frame where nobody is found is filled by interpolating the frames either side. A long gap is
  marked on the timeline instead of being filled with guesses.

## 3. Playback and trimming

A timeline strip appears along the bottom of Pose Bench while a take is loaded:

- **play / pause / loop**, scrub, frame step, and **in / out** trim handles;
- the pose panel's sliders show the current frame;
- **fixing a frame:** dragging a limb on a paused frame makes a **correction key**, blended in and out over a
  few frames. You can fix the one frame where an arm clipped through the body without re-recording.

Props held in a hand follow automatically, since they are already parented to the wrist. Seated figures stay
seated (upper-body take). Look-at targets still apply on top, so a figure can keep its eyes on another figure while
it moves.

## 4. Cameras and the recut

- **Cameras:** "＋ Camera from this view" saves the current view as **Cam A, B, C…**, with its position and lens.
  - **Moves:** a camera can have a start and end position over the take (a push-in, a pan, an orbit), eased.
  - **Follow:** a camera can keep a figure framed, as a tracking shot.
- **The edit:** a second timeline row, **the cut**. Pressing a camera's number while the take plays drops a cut to
  that camera at that moment, the way a live multi-camera switcher works. Cuts can be dragged afterwards, and
  "cut on this frame" works while paused. The preview plays the edit, switching angles at each cut.
- **Per-camera clips:** any camera can also be exported on its own, over the whole take or just the edit's range,
  for a card that needs just that angle.

## 5. Export

Rendering happens offscreen, one exact frame at a time (never screen-captured), at the chosen resolution and
frame rate:

- **MP4 (H.264)** via WebCodecs `VideoEncoder` and **Mediabunny** (MPL-2.0, from jsdelivr). It's used unmodified,
  so the file-level copyleft puts no terms on our code. It's the maintained successor to mp4-muxer, which is now
  deprecated.
- **What you can export:**
  - the **recut**: the edit, switching cameras;
  - **each camera's clip**;
  - the **control-pass videos** for each: depth, OpenPose, normals and mask. These are what Wan VACE and
    ControlNet-video take, and they fit the ComfyUI route in `pose_bench_plan.md`;
  - a **PNG frame sequence** for tools that prefer one.
- A **marker track** is exported beside the video as JSON (cut times, camera names, figure↔subject links). An
  editor or the Premiere panel can use it.

## 6. The Storyboarder

**One performance, many cards.** A take belongs to the **scene**, and each card references it with its own camera
and its own in/out range:

- **Storage.** `scene.takes[]` holds each take's landmarks, bake settings and cameras. The landmarks are a blob,
  so `Blobs.referenced()` must mark them. A card gets `shot.pose.take = {takeId, camera, in, out}`.
- **The card's still:** the take's frame at the card's in-point through the card's camera. It becomes that
  card's blocking automatically, so the still lane works as it does today.
- **The card's clip:** the take through the card's camera, from in to out, rendered as a mannequin reference video.
  - `arrival_reference_plan.md` already records that ImagineArt's reference-to-video models take a
    `video_url`: `seedance-2.x` optionally, `wan-2.6` requires one.
  - A card's clip on those models can then carry the mannequin motion: the character comes from the frame, the
    movement from the take.
  - This depends on the video lane's upload path in that plan, which isn't built yet. Until it is, the
    reference clip is exported per card for hand-feeding.
- **Re-cutting a scene** means changing cameras or in/out points on its cards. Nobody performs again, and every
  card stays consistent with the others.
- **Staleness:** a card's still and clip record the take version they were made from, as `made.pose` does for
  blocking now. Re-baking a take flags them.

## What stays out of scope, and what to say about it

- **One camera, estimated depth.** Anything the model misjudges on a still, it misjudges on a take: arms straight
  at the lens, a limb hidden behind the body. Two-way smoothing and correction keys make it cheap to fix, not
  unnecessary.
- **Travel across a room** from one webcam is an estimate. Good for blocking a walk; not survey-accurate.
- **Hands and fingers** follow the hands build (next in `pose_from_camera_plan.md`); until then hand shapes are
  per take, not per frame.
- **No audio.** A take is movement. Timing to dialogue happens in the edit, or later.

## Code to change

| File | Change |
|---|---|
| `posebench/pose.html` | Record control and countdown; video-file import (offline read); `Take` model (landmark frames, bake, gaps); two-way smoothing, root motion, turn, foot lock; timeline strip (play, scrub, trim, correction keys); cameras (A/B/C, moves, follow); the cut track; offscreen frame renderer; WebCodecs + Mediabunny export (recut, per camera, passes, PNG sequence, marker JSON); take save/load in the scene file |
| `js/pose.js` (storyboarder) | open Pose Bench on a scene's take; receive takes; render a card's still/clip by `{takeId, camera, in, out}` through the offscreen worker, as passes are rendered now |
| `js/model.js` | `scene.takes[]`; `shot.pose.take`; `CONTENT_KEYS` / copy / migrate |
| `js/blobs.js` | `referenced()` marks take landmark blobs |
| `js/board.js` / `js/reviewer.js` | a take badge on cards using one; "from an earlier take" staleness |
| `js/exportpanel.js` | per-card reference clip, recut, pass videos |
| `js/imagine.js` | (with the arrival plan's video path) `video_url` = the card's mannequin clip on the models that take one |

## Tests (no webcam, no actor)

- **Synthetic performance round trip:** animate the rig through a sequence of presets (stand → walk → turn → sit),
  generate MediaPipe-format landmarks for every frame from the rig itself (`synthLandmarks`, as the pose tests do),
  record them as a take, bake onto a different figure, and compare per frame. This also checks the timing, the
  root travel and the turning.
- **Foot lock:** in a synthetic walk, planted feet must not slide by more than a centimetre.
- **Real footage:** a short public-domain clip of a person walking, run through import. Check the take has no
  gaps, the figure travels in the clip's direction, and there are no sudden flips.
- **Live path:** a synthetic webcam stream (as in the current tests) drives Record → Stop → a take of the right
  length.
- **Export:** a recut of known cuts encodes to MP4 with the right frame count and duration, and the camera
  switches at the cut frames (checked by rendering one frame before and one after each cut).

## Order of work

1. **Takes in Pose Bench:** record from webcam, the take model, bake, playback, trim. This is the core, and useful on
   its own.
2. **Cleanup:** two-way smoothing, gap filling, root motion (in place / travels), turning, foot lock.
3. **Video-file import** (offline, accurate model).
4. **Cameras and the recut:** A/B/C, moves, follow, the cut track, preview.
5. **Export:** MP4 recut, per-camera clips, control-pass videos, PNG sequence, marker JSON.
6. **Correction keys** on paused frames.
7. **Storyboarder:** scene takes, card camera plus in/out, card still from the take, reference clip export,
   staleness. The `video_url` push arrives with the arrival plan's video path.

## Decisions to confirm

1. **Keep the source footage?** The recommendation is no by default: landmarks only, tiny, and nothing to leak. An
   opt-in keeps it on this machine as a guide overlay.
2. **Root motion default:** *in place* for desk and upper-body takes, *travels* for full-body takes (recommended),
   or always in place.
3. **Where takes live in the Storyboarder:** on the **scene**, shared by its cards, each card choosing camera and
   range (recommended). The alternative is one take per card.
4. **Frame rate for exports:** 24 (film, recommended), 25 or 30.
