# Shot type: editable in Create, and set by the blocking

Status: **plan, not built** (2026-09-30).

## Why

- **Create can't change the shot type.** The panel shows the type (Wide, Medium, Close-up…) as plain text. Changing
  it means closing the panel and using the card's dropdown, and the type decides a lot: the framing rule the writer
  is given, what the cast block leaves out, and the framing badge.
- **The blocking already knows the framing.** When you press **Use for shot**, Pose Bench measures the frame for
  its written summary. For each figure it records seen full length, from the hips up, head and shoulders only, or
  out of frame, plus left/centre/right, near/far and facing. It also records the lens and angle ("Camera: 35mm
  lens, eye level"). None of that sets the card's shot type, so a Close-up blocking can sit on a card still saying
  Wide, and the writer is told Wide.
- **The lens is carried but not used.** It's stored on the card (`shot.pose.lens`) and in that summary, but the
  writer is never told to use it. The new look check asks for a focal length, and the writer may invent one that
  doesn't match the blocking.

## What changes

### 1. A shot-type dropdown in Create

The Shot column's type line becomes the same dropdown the card has: the board's own list of types, including one
added by hand. Changing it updates the card, the framing badge and the row's prompts' framing on the next write,
exactly as the card's dropdown does. It's one shared helper, so the two can't drift.

### 2. The blocking sets the type when you press Use for shot

Pose Bench works out the type from what the camera actually shows (not which shot-size button was last pressed),
using the same measurements it already makes for the summary:

| What the frame shows | Type |
|---|---|
| Main figure full length, or the figures small in a wide space | **Wide** |
| Main figure from the hips / waist up | **Medium** |
| Head and shoulders | **Close-up** |
| The head partly out of frame, or a face / hands filling it | **Extreme close-up** |
| Two cast figures, both in frame from about the waist up | **Two shot** |
| The nearest figure seen from behind and cut by the frame edge, another figure facing the camera | **Over the shoulder** |

- The **main figure** is the one selected in Pose Bench, else the cast figure nearest the camera.
- The type is only set if the board offers it. A board that removed "Two shot" falls back to the size (Medium).
- The toast says what happened: *"Blocking saved on 3B. Shot type → Close-up (from the blocking)."*
- **Cancel** changes nothing. Only **Use for shot** sets the type.

### 3. The lens goes into the prompt

With a blocking, the writer is told the lens and angle to use: *"The blocking is framed on a 35mm lens at eye level:
use that focal length and camera height."* This goes into the still's instructions next to the look line. The
look check then finds the lens that matches the blocking, not an invented one.

The Create row shows it under the type, e.g. **35mm · eye level**, so you can see what the blocking decided.

## Files

| File | Change |
|---|---|
| `posebench/pose.html` | `shotTypeFromFrame()` built from `blockingText`'s measurements (visible extent of the main figure, cast figures in frame, facing); sent as `framing: {type, angle}` in `posebench:done` |
| `js/pose.js` | `save()` stores `pose.framing`, sets `sh.type` when the board offers it (fallback: the size), and says so in the toast |
| `js/board.js` | the card's type dropdown becomes a shared `typeSelect(sh)` |
| `js/promptpanel.js` | the Shot column uses `typeSelect(sh)`, plus the lens / angle line under it |
| `js/prompts.js` / `js/brand.js` | the blocking's lens and angle, in the still's instructions beside the look line |

## Tests

- **Pose Bench:** the same figure framed full length, hips up, head and shoulders, and face-filling reads Wide /
  Medium / Close-up / Extreme close-up. Two cast figures read Two shot. A back-to-camera near figure plus a facing
  one reads Over the shoulder.
- **Storyboarder:**
  - Use for shot sets the type and the toast names it;
  - Cancel doesn't;
  - a board without the type falls back to the size;
  - the Create dropdown changes the card like the card's own.
- **Prompt:** a blocked card's still request carries "35mm lens at eye level", and a prompt using 35mm passes the look
  check.

## Decisions to confirm

1. **A type you changed by hand, then a new blocking:** the blocking sets it again on Use for shot (recommended: it's
   the latest decision about the frame, and the toast says so). Or: the blocking only sets it while the card still
   has its default type.
2. **Two shot and Over the shoulder:** detected from the blocking too (recommended), or the blocking only ever sets
   the size (Wide / Medium / Close-up / Extreme close-up).
3. **The lens:** tell the writer to use the blocking's lens and height (recommended), or leave it to the writer.
