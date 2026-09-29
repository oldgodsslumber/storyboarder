# Glitch frames: find the haywire ones and repair them

Status: **built on `V3-posebench` (2026-09-29).** Decisions taken as recommended:
- Auto by default;
- rebuild only the broken limb;
- live follow holds bad readings;
- photos warn only.

What real footage changed:
- **Runs over 8 frames** of one limb are *sustained misreads*, not glitches. They're left as read and shown as a
  hollow bar, because rebuilding hidden arms from equally wrong neighbours only froze them.
- **Strong's joint-limit pass** ignores the straight end of elbows and knees.

Details: `posebench/HANDOFF.md`. It builds on the motion takes (`pose_motion_plan.md`, built) and runs inside
`bakeTake`, before retargeting.

## Why

Takes read from a video or a recording are mostly right, but now and then a frame or two goes haywire. The
skeleton's geometry is simply wrong for that instant: an arm points somewhere impossible, the legs swap, the body
folds. It's worst side-on or from behind, and when the person is partly hidden.

The two-way smoothing spreads such a frame into its neighbours instead of removing it. A single bad frame becomes
a visible lurch lasting about a quarter of a second.

## What a glitch looks like

The frames either side are usually fine, so each failure leaves a fingerprint:

| Failure | Fingerprint | Frequency |
|---|---|---|
| **Left/right swap:** the model swaps the labels, often side-on or from behind | the frame matches its neighbours much better with left and right swapped back | common |
| **Limb jump:** one arm or leg lands wrong for 1–3 frames, then returns | a displacement spike on that limb that returns: far from both neighbours, while they're close to each other | common |
| **Bone blow-out:** a bad depth reading on one joint | a bone's length jumps well off the take's median (bones don't change length) | common from behind |
| **Collapse:** the model half-loses the person; the whole body shrinks or folds | many bones off at once, and body height or shoulder width far off the median | rare |
| **Impossible pose:** a knee bent backwards, an elbow past straight | the retargeted joint pinned hard against its limit | occasional |

## The plan

### 1. Detection (per frame, per limb)

This runs on the resampled landmark sequence, before smoothing. Every check uses the take's own statistics, so a
child, a crouch or a wide lens doesn't trip it.

- **Bone lengths.** Each of the 12 bones (upper and lower arms and legs, shoulder width, hip width, both torso
  sides) is compared with its median over the take. A bone more than 30% off (tunable) flags its limb. Many bones
  off at once flags the whole frame as a collapse.
- **Spikes.** For each joint, the frame's distance from the average of its neighbours is compared with how far
  apart those neighbours are from each other. It uses a Hampel-style test: median and MAD over a short window.
  A large jump that comes straight back is a glitch. A fast move doesn't come back, so it isn't flagged, which is
  the difference between a punch and a glitch.
- **Swap test.** Each frame is compared with its neighbours twice: as read, and with left and right swapped. If
  the swapped version fits clearly better, the frame is **unswapped**, not thrown away. Nothing is lost.
- **Joint limits.** After the retarget, a joint pinned against its limit where its neighbours aren't is flagged.
  It runs as a second pass.
- **Low confidence.** A frame where the model is unsure of most of a limb counts toward that limb's flag. It's
  only a tie-breaker, since "unsure but right" is common (the unsure-joints switch exists for that).

The output is a **mask**: for each frame and each limb (left arm, right arm, left leg, right leg, torso, head),
*good / swapped / glitch*.

### 2. Repair: only what's broken

- **Swapped frames** are unswapped: exact, no loss.
- **A glitched limb** is rebuilt from the good frames either side of it, for up to 0.5 s (the same span as
  today's gap bridging). The rest of that frame is kept as read. One bad arm no longer costs the frame's good
  legs and head.
- **A whole-frame glitch** becomes a gap, bridged the same way.
- **Longer runs of glitches** (over 0.5 s) aren't guessed at. They stay gaps and show on the timeline, where the
  figure holds still through them, as today.
- Smoothing then runs on the repaired sequence, so nothing bad spreads.
- The raw landmarks stay stored, and repair runs at bake time. So changing the setting, or un-marking a frame,
  just re-bakes. Nothing is destroyed.

### 3. Where it shows

- **The timeline track:** a red tick under every repaired frame, with a stronger mark for a whole-frame repair.
  Hovering says what was wrong ("right arm jumped; rebuilt from 0.43–0.53 s") and clicking jumps there.
- **The take settings** (⚙), a new **Fix glitches** control:
  - **Off:** as today.
  - **Auto** (default): swaps, limb jumps and bone blow-outs.
  - **Strong:** tighter thresholds, plus the joint-limit pass.
  - A line under it: "4 frames repaired (2 swaps, 2 limb jumps)".
- **At the frame:** scrubbed to any frame, **Mark as glitch** (the frame, or the limb currently selected) and
  **Keep as read** override the detector for that frame. They're stored on the take, like correction keys, and
  survive re-bakes.
- **Right after import:** "✓ read from the video — a person in 240 of 241 frames, 4 glitches repaired."

### 4. Live follow and recording

- **Live follow:** the same checks run against the last second of readings, and a reading that fails is held
  (the figure keeps its last good pose for that limb). The glide from live smoothing hides the hold.
  - The swap test runs live too: a frame that fits better swapped is unswapped on the spot.
  - This fixes the jolt you'd see live, not just in recordings.
- **Recording:** the raw frames are recorded as read, glitches included, so the bake can repair them with both
  neighbours available.

### 5. Photos (one frame, nothing to compare)

- **The problem:** without neighbours, only the bone-length and joint-limit checks apply. They're measured against
  the figure's own proportions rather than a take median.
- **Response:** a photo that fails gets a warning in the panel rather than an automatic change, for example "the
  left leg reads 45% too long — probably hidden; check it". A photo pose is chosen deliberately, and guessing
  without neighbours would be worse.

## Code to change

| File | Change |
|---|---|
| `posebench/pose.html` | `glitchMask(seq)`, which runs the bone-length, spike, swap and confidence checks. `repairSeq(seq, mask)` unswaps, rebuilds limbs and turns bad frames into gaps. It's called in `bakeTake` between resampling and `smoothSeq`, followed by a joint-limit second pass. Also: timeline ticks and tooltips; ⚙ **Fix glitches**, with the repaired count; **Mark as glitch** / **Keep as read** overrides stored in the take (`tk.glitch`) and in `takeSnap`/`takeLoad`; the live-follow hold-and-unswap in `camTick`/`camTickTwo`; photo warnings in `camFromImage`; the import status line |
| `posebench/HANDOFF.md` | the detector, its thresholds, and the override format |

## Tests

- **Injected glitches, synthetic:** generate a clean take from the rig (as `motion_rt` does), then corrupt known
  frames:
  - a 1-frame left/right swap;
  - a 2-frame arm jump of 90°;
  - a thigh 50% too long;
  - a 1-frame whole-body collapse;
  - a real 0.3 s fast punch that must **not** be flagged.
- **Pass criteria:**
  - every injected glitch is caught at the limb level, with no flag on the punch;
  - the repaired take is back within 5° of the clean one;
  - the swap is restored exactly.
- **Real footage:** the squat-from-behind and jumping-jack clips. Count the flags, look at each flagged frame
  against the video, and check that none of the repaired frames look worse than before.
- **Overrides:** Mark and Keep survive a re-bake and the scene file; **Off** gives exactly today's bake.
- **Live:** a synthetic webcam stream with glitch frames spliced in. The figure never jumps, and a swapped frame
  is unswapped.

## Order of work

1. Detection and repair in the bake, with the synthetic tests.
2. Timeline ticks and the ⚙ control.
3. Overrides.
4. Real-footage check.
5. Live follow.
6. Photo warnings.

## Decisions to confirm

1. **Default:** Fix glitches on **Auto** for every take (recommended), or off until switched on.
2. **Repair scope:** rebuild only the broken limb (recommended), or drop the whole frame whenever anything in it
   is wrong. Dropping is simpler, but loses the good parts.
3. **Live follow:** hold bad readings live too (recommended), or leave live as raw as it is now and fix only takes.
4. **Photos:** warn only (recommended), or also auto-correct a limb that fails the proportions check.
