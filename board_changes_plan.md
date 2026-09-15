# Four changes to the board

## 1. Take the feed strip and "copy image set" off the card

Both go. The strip is `feedRow()` ([board.js:1345](js/board.js)) and the copy
button lives inside it; the panel's lanes already show each call's references,
numbered the way its own prompt cites them, which is the version that is
actually true per call.

**One thing in that row is not information, and I would keep it.** The strip
also carries three *warnings*, and they have nowhere else to appear:

| what | why it matters |
|---|---|
| **link N names** | a name typed without an `@` feeds nothing — the exact mistake the `@` rule exists to prevent |
| a **dead** reference | a subject was deleted and the mark is now plain text |
| **N references** | past the advice limit, image models average faces together instead of reading them |

Proposal: the row disappears entirely on a healthy card, and on a card with
one of those three it collapses to a single line of that warning plus its fix
button — no thumbnails, no numbers, no copy. A clean board shows nothing at
all, which is what you asked for, and a mistake still finds you.

If you would rather they went too, say so and the row goes completely; the
panel's lanes would then be the only place a loose name is visible, and it
does not currently show one.

## 2. Shift-drag duplicates a card

The card already drags by its header ([board.js:1004](js/board.js)) and
already has a modifier gesture: **Alt**-drag swaps two pictures. **Shift**
becomes duplicate, which reads the same way round — a modifier that changes
what the drop means.

- The drop handler decides, from `ev.shiftKey` **on the drop** rather than on
  the dragstart, because a modifier held at the start and released before the
  drop should not still count.
- A duplicate is a full copy of the card's content — everything in
  `CONTENT_KEYS` (type, colour, image, annotation, all three description
  boxes, fields, prompts, cast, comments, render, video, shoot) with a new id
  and new ids for anything that carries one. It does **not** copy the card's
  claim on the master script: two cards claiming one stretch is the one thing
  the script model forbids, so the copy is freestanding with the same text.
- It lands where the drop landed, using the same measured insertion index the
  reorder work uses, and becomes the selected card.
- The cursor says so: `dropEffect = 'copy'` while shift is down, and the
  insertion line draws in a different colour.

New `SB.Model.duplicateShot(p, shotId, toSceneId, toIdx)` — there is no copy
function today; the closest is `swapShotContent`, which is where the
CONTENT_KEYS list already lives.

Worth deciding: **blobs are shared, not copied.** The picture store is keyed
by content hash, so a duplicated card points at the same image and costs
nothing extra — which is right, and means deleting one card cannot take the
other's picture with it (`Blobs.gc` counts references).

## 3. Clicking a picture shows it large

Today a click on a card's frame opens the **file picker**
([board.js:1927](js/board.js)) and the reference frame does the same
([personapanel.js:683](js/personapanel.js)). That is the swap you want to stop
happening by accident.

**New behaviour, both places:**

- A frame **with** a picture → opens a large view.
- A frame **with none** → the picker, as now. There is nothing to look at, and
  "click to load" is the only affordance an empty frame has.
- **Replacing** is then only: drop a file on it, or the **Replace** button
  inside the large view. Removing is the ✕ that is already there.

**The large view** is one shared component — `SB.Viewer.open(p, items, at)` —
because there are four places that want it and they should not each grow their
own:

- the card's frame,
- a reference frame in the library,
- a person in the card's feed *(gone under change 1 — but the same click lands
  on the cast rows and the `@` chips)*,
- the clip window already does this for video, and is the precedent for how it
  should look.

It shows the **full-size original** where the file holds one and the board
copy where it does not, says which it is showing and at what pixel size, and
carries: **Replace…**, **Remove**, **Save a copy**, and ← → to step through
the other pictures on the same card or the same subject. Escape closes. The
modal stack already handles topmost-Escape correctly.

## 4. The same for people in the reference library

Change 3 covers the reference frame itself. Two more places in the library
show a person as a picture and should open the same viewer: the **subject
card's frame**, and any thumbnail the panel draws. The rule you gave is the
one to implement literally — **a picture only changes when you remove it or
drop a new file on it** — so every click-to-replace in
[personapanel.js](js/personapanel.js) becomes click-to-view, and the replace
affordances become the drop target (already there), the ✕ (already there), and
the viewer's own Replace button (new).

## Order, and what each costs

1. **The viewer** — the shared piece, needed by 3 and 4. Biggest of the four.
2. **Click-to-view** on the card frame and the reference frame — small once
   the viewer exists.
3. **Shift-drag duplicate** — self-contained; `duplicateShot` plus a branch in
   the existing drop handler.
4. **Removing the feed strip** — smallest, but do it last so the warnings that
   survive can be placed against a board that already behaves the new way.

## Tests

The viewer opening on a card with only a board copy and saying so; ← → across
a subject's frames; Replace writing through to the right card; Escape closing
the viewer and not the panel behind it. An empty frame still opening the
picker. Shift-drag producing a card whose content matches key for key, whose
ids are all new, which is freestanding rather than claiming the same script,
and which shares its blob rather than duplicating it — plus a plain drag still
moving, and Alt-drag still swapping. And the feed row appearing only for a
loose name, a dead mark or too many references.
