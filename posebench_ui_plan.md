# Pose Bench: a shorter panel, controls where you're looking

Status: **built on `V3-posebench` (2026-09-30)**, recommended answers to all four decisions. One change: shot-size keys are **Shift+1–4**, not W/F/M/K (F already frames and M mirrors). Body style moved from Capture to Scene look.

## Why

The left panel is nine stacked sections: Figures, Pose, Props and Build, Joint, Camera, Scene, Capture, Scene file
and Controls. That's roughly 80 controls, and most sessions use four or five of them: pick a pose, nudge a limb,
turn the camera, capture. Everything else sits between you and those, every time. The Joint sliders, the thing
you touch most while posing, are fourth in the list, far from the limb you just clicked.

## The idea in one line

**The panel shows what's selected; actions live on the viewport; settings fold away.**

## 1. The panel becomes "what's selected"

The top of the panel is always the **cast strip**: figure chips, + Figure, + Prop ▾. Below it is **one card for
whatever is selected**:

| Selected | The card shows |
|---|---|
| a figure (clicked on its body, or its chip) | Man/Woman/Child, colour, height, build, facing, look at, who this is; Duplicate / Remove |
| a prop | turn, seat on it / hold it, delete; for a build: its request, Edit, Look & fix |
| nothing | a short "start here": + Figure, + Prop, Build, Pose from camera, the scene's work poses |

Below the card, **folded by default** (a single line each, remembering open/closed):

- **Scene look:** background, key light, shadow, grid, move/turn ring, body style.
- **Poses library:** My poses and the full preset list (see 3).
- **File:** export, import, new.

The keyboard cheat sheet moves behind a **?** button in the top bar.

## 2. The camera goes on screen

A small floating **camera pad** at the viewport's bottom left, a 📷 button that opens a compact panel above it:

```
[📷]  →   ┌──────────────────────────────┐
          │ ¾L  Front  ¾R   ·  High  Low │
          │ Side L  Back  Side R         │
          │ Wide  Full  Medium  Close    │
          │ Lens ───●────── 35 mm        │
          └──────────────────────────────┘
```

- It stays open while you work (a pin toggles close-on-click-away), and it's remembered.
- **Keys:** 1–8 for the eight views, W / F / M / K for shot size (next to the existing F frame and C capture).
- The rail's Camera section is removed.

## 3. Posing happens at the limb

**Click a limb** (or its joint) and a small **joint popover** opens beside it, anchored to where the joint is on
screen. It flips to stay inside the viewport and follows the joint as the camera moves.

```
        ┌─ Right arm ──────────────── ✕ ┐
        │ Down  On hip  Raise  Wave     │   ← quick poses for THIS limb
        │ Point  Reach  Across  To ear  │
        │ ─────────────────────────────  │
        │ Raise fwd  ───●───  45°        │   ← the joint's sliders (what the
        │ Raise side ──●────  28°        │     Joint section showed)
        │ Twist      ────●──  12°        │
        │ ‹ elbow   hand ›   Mirror  Reset│
        └────────────────────────────────┘
```

- **Quick poses per body part** set that limb only, mirrored for the other side, as partial poses:

  | Part | Quick poses |
  |---|---|
  | Arm | Down, On hip, Raise, Wave, Point, Reach forward, Across chest, Hand to ear |
  | Hand | Relaxed / Grip / Flat (moved here from the figure section) |
  | Leg | Straight, Step forward, Step back, Knee up, Kneel |
  | Head / neck | Level, Look left / right, Up / down, Tilt, Look at camera |
  | Torso / hips | Upright, Lean forward / back, Twist L / R, Slouch |

- **The sliders** are the existing joint axes, unchanged. ‹ › walks along the limb (shoulder → elbow → hand), like
  `[` and `]`.
- **Whole-body poses** (Work poses, two-person scenes, More, My poses, Pose from camera) move to a **Poses ▾**
  button in the top bar. It opens a grid popover, shown only when asked for.
- **Dragging a limb** still poses it directly, and the popover follows. Clicking empty space or pressing Esc
  closes it.

## 4. Capture settings go behind the Capture button

The top bar's **◉ Capture** gets a small **▾**. It opens aspect, long edge, format, transparent background, grid in
captures, passes (Depth / OpenPose / Normal / Mask), floor in depth, OpenPose face points, frame guide and thirds.
Turnaround sits there too. The rail's Capture section is removed.

## 5. The top bar, after

```
[↶][↷]   Poses ▾   Props ▾   Build   ·····   [?]   [◉ Capture ▾]   (Cancel) (Use for shot)
```

- **Props ▾** lists chair, desk, table, laptop, phone and cup.
- **Build** opens the build box as a popover. The rail's Props and Build section becomes the prop card from 1.
- On a narrow window the labels shorten to icons. Nothing wraps to a second row.

## What doesn't change

Every control still exists; they just live somewhere else. Keyboard shortcuts, the timeline, the camera-pose panel,
takes, the Storyboarder host protocol and saved scenes are all untouched. The stored scene is the same data, and
this is layout only.

## Files

| File | Change |
|---|---|
| `posebench/pose.html` | the rail: the cast strip + the selection card (`refreshCard()` replacing the always-on Figures/Joint/Props sections) + folded Scene look / Poses library / File; the camera pad (`#camPad`) with keys 1–8 and W/F/M/K; the joint popover (`#jointPop`, positioned from the joint's screen projection in the render loop, flip and clamp); per-part quick poses (`LIMB_POSES`, partial maps applied with side mirroring and limits); Poses ▾ / Props ▾ / Build / ? / Capture ▾ popovers in the top bar; the old sections removed (the existing element ids move rather than being rebuilt, so their handlers keep working) |
| `posebench/HANDOFF.md`, `README.md` | where everything went |

## Tests

- **Every old control reachable:** a check that every id the old rail had still exists and responds (captures,
  passes, toggles, sliders, file buttons). Nothing is lost in the move.
- **Selection card:** figure → figure card, prop → prop card, build → Edit / Look & fix, nothing → start-here.
- **Joint popover:**
  - opens on a limb click, anchored within 40 px of the joint;
  - stays in the viewport at the edges;
  - follows an orbit;
  - quick poses change only that limb (the other limbs' angles are unchanged);
  - mirrored correctly on the left side;
  - joint limits respected.
- **Camera pad:** each view and shot size, keys 1–8 and W/F/M/K, lens, remembered open state.
- **Regressions:** the Pose Bench suite (rt, gate, fresh, seq, trust, motion_rt, foot, glitch, keys, edit) and the
  Storyboarder suites. The Storyboarder embed opens and Uses a shot as before.
- **Look:** screenshots at 1400 px and 900 px wide, rail open and closed.

## Decisions to confirm

1. **Joint popover contents:** quick poses AND the sliders (recommended), or quick poses only, with the sliders
   staying in the panel.
2. **Camera pad position:** bottom-left of the viewport (recommended; the timeline and tray are at the bottom
   centre), or top-left under the rail toggle.
3. **Camera keys:** 1–8 for views and W/F/M/K for shot size (recommended), or no new keys.
4. **Whole-body poses:** the Poses ▾ popover in the top bar (recommended), or keep them in the panel when nothing
   is selected.
