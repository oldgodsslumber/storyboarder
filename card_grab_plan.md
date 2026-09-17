# Grab the card anywhere

## What is wrong

The only drag handle a card has is its header ([board.js:1202-1203](js/board.js#L1202) —
`head.draggable = true`, `cursor:grab` in [app.css:258](css/app.css#L258)). Everything
below the header is dead weight for dragging: the frame, the labels, the padding, the
gaps between boxes. You reach for the card and it doesn't come.

## The rule

**Anything that isn't an element you interact with is a handle.** One list of
exceptions, written once:

```
button, select, input, textarea, [contenteditable], img, video,
.desc-box, .prompt-box, .clip-badge, .frame, .comments
```

- Text boxes stay text boxes — clicking into a description places the caret,
  and dragging inside one selects text, exactly as now.
- The frame stays a viewer-opener (and, empty, a file picker). Its image also
  has a native browser drag of its own we must not fight.
- Buttons, selects, the colour swatch, the clip badge all keep their jobs.
- Everything else — the head (as now), the `description` / `first frame` /
  `motion` labels, the card's own background and padding, the strip of card
  around the boxes — grabs the card.

## Why it can't be `card.draggable = true`

A `draggable` ancestor is the classic way to kill text selection in its
children: the browser starts a drag where the user meant to select, and on
some engines `contenteditable` inside a draggable element becomes untypeable.
The card is full of editable boxes, so the card must not be *statically*
draggable.

**The pattern: arm it per-press.** In the card's existing `mousedown` handler
([board.js:1185](js/board.js#L1185), which already computes "is this an
interactive target"):

1. If the press target matches the exception list → `c.draggable = false`,
   handler proceeds as today.
2. Otherwise → `c.draggable = true`. The browser can now begin a drag from
   this exact press; a click that never moves is still just a click
   (selection works unchanged, since `selectShot` already runs on mousedown).
3. `dragend`, `mouseup` and `mouseleave`-after-up all reset
   `c.draggable = false`, so the next press decides afresh.

The `dragstart`/`dragend` listeners **move from the head to the card**
(same bodies — `DND_SHOT` payload, `effectAllowed = 'copyMove'`, group-drag
via `B.dragging`). The head stops carrying its own `draggable` attribute; it
is inside the card's grab zone anyway, so nothing changes about dragging by
the head. The two existing modifier reads stay where they are: shift/alt are
read **at the drop** ([board.js:1171-1176](js/board.js#L1171)), and the
`shift + card-head` mousedown guard at :1191 generalises to
`shift + (any grab zone)` — same reason, the guard just stops being
head-specific.

Scene blocks get the same treatment if it proves wanted, but this plan is
cards only — the scene banner is one row and its handle problem is not the
one you named.

## Cursor

`.card{cursor:grab}` with the exceptions restoring their own:
`.desc-box`/`.prompt-box` → `text`, buttons/selects already show `pointer`
or default, `.frame` → `zoom-in` (it opens the viewer, and saying so at the
cursor is free). While a drag is armed and moving, the browser shows its own
move/copy cursors as it does today.

## What can go wrong, and the tests

Synthetic `DragEvent`s cannot prove a drag actually *initiates* (the
shift-drag bug taught us that), so the tests check the arming state plus a
source-level assertion:

- mousedown on the card's padding → `c.draggable === true`; mouseup → back
  to `false`.
- mousedown inside a `.desc-box`, on the type `select`, on the 🗑️ button,
  on the frame image → `c.draggable === false`, and (desc box) the caret
  landed / selection still possible.
- shift-mousedown on the padding is not `preventDefault`ed (the duplicated
  card gesture must still be able to begin anywhere a drag can).
- dragstart from the card fires with `DND_SHOT` set and
  `effectAllowed === 'copyMove'` (existing assertions, retargeted from the
  head to the card).
- a real-mouse press-and-release on the frame still opens the Viewer
  (existing test, must not regress — the frame is in the exception list
  precisely so this survives).
- source assertion in test-core: the card's dragstart sets `copyMove` (the
  head-based version of this already exists; it follows the listener).

## Size

Small: one exception selector, the mousedown arming, moving two listeners,
one CSS block, tests. No model change, no storage change.
