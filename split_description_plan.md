# Splitting the description: one for the frame, one for the motion

## What is being asked

The still and the clip are different jobs and they want different words. Right
now a card has **one** description, and both prompts are written from it — so a
line that belongs to the motion ("she turns and walks out") is fed to the
first-frame writer, which then has to be told, in the template, that it is
writing "the state of things as the shot opens, before anything it says happens
next has happened." That sentence exists because the description is shared.

Same for references. A reference is not a list somewhere — it is an `@` mark
**inside** the description text (`refs.js`: `@{id|Name}`), and the feed is
whatever those marks resolve to. So today the image call and the video call are
handed the same references, in the same order, because they are reading the same
sentence.

The ask: image description and image references separate from video description
and video references, with a plain description box still on the card.

## The one thing that makes this small

**References follow the text they are written in.** Split the description and the
references split themselves — no new concept, no second list to keep in sync, no
UI for "attach a reference to the video side". The `@` already means *the model
will be shown this*; putting the mark in the video box means *the video model
will be shown this*.

Everything below is the consequence of that one decision.

## The shape

Three boxes, one of them shared:

| box | what it is for | who reads it |
| --- | --- | --- |
| **description** | what we see. The card's plain box, unchanged. | both prompts |
| **first frame** | only what is true of the opening instant | the image prompt |
| **motion** | what moves, in what order, how it ends | the video prompt |

Both new boxes are optional and start empty. A board that never touches them
behaves exactly as it does today — which is also the migration story: nothing is
split automatically, because guessing which half of an existing sentence belongs
to the clip is not a guess worth making silently.

Feeds become three, derived not stored:

```
image feed = marks in [description] + [first frame] + enabled fields
video feed = marks in [description] + [motion]      + enabled fields
all        = union, in first-seen order   (card strip, export, PDF)
```

## The prompt panel

Today the table is five columns and the two prompts sit side by side in the
middle, with one Description at the left and one Feed at the right — a layout
that says the two prompts share their inputs, which is exactly what is changing.

**It becomes two lanes.** Everything about the still in one column, everything
about the clip in the next, each lane in the order you use it: say it, see what
goes with it, read what was written, act on it.

```
┌─────────┬───────────────┬──────────────────────┬──────────────────────┐
│ Shot    │ Description   │ First frame · GPT    │ Video · LTX 2.3      │
├─────────┼───────────────┼──────────────────────┼──────────────────────┤
│ [thumb] │ what we see   │ ▸ first frame        │ ▸ motion             │
│ SC1-3   │ @Nat at the   │   (empty — using     │   she lets go of the │
│ Close   │ desk, lamp on │    the description)  │   cup, @Nat looks up │
│ [16:9]  │               │ ─────────────────── │ ─────────────────── │
│         │ feed: 1 Nat   │ feed: 1 Nat          │ feed: 1 Nat 2 SC1-2  │
│         │               │ ─────────────────── │ ─────────────────── │
│         │               │ [ the image prompt ] │ [ the video prompt ] │
│         │               │ copy · ▶ push · ✦    │ copy · ▷ clip · ✦    │
└─────────┴───────────────┴──────────────────────┴──────────────────────┘
```

- The **Feed column goes away.** It showed one list for two calls that are
  handed different things; each lane now shows the list that lane will actually
  send, numbered the way the prompt cites it ("image 1 = Nat").
- An empty role box says **"using the description"** rather than sitting blank,
  so the shared case is visibly the default and not an omission.
- The role box is a `RefBox` like every other, so `@` works in it identically.

**Narrow windows** collapse the two lanes into one with a `first frame | video`
toggle above it — the toggle the ask mentioned, kept as the fallback rather than
the everyday case. Nothing is behind a click at full width, because the whole
point of the panel is reading twenty rows quickly.

## The card

The card keeps its plain **description** box under the frame, exactly where it
is. Under it, where the feed strip already sits, two chips:

```
description  [ what we see … ]
feed  1 Nat  2 SC1-2
       ⊕ first frame    ⊕ motion          ← click to open a box
```

- A chip with text in it is filled in and shows a dot; clicking opens the box
  inline under the description.
- A chip with nothing in it is a `⊕` and stays closed — a card that does not use
  the split never grows.
- Boxes that have content are open on render, so nothing is hidden from someone
  who did not do the typing.

This keeps the card the small object it is, and puts the split where you are
already looking when you notice you need it.

## Changes, by file

**`js/model.js`**
- `newShot`: `imageDescription: ''`, `videoDescription: ''`.
- `CONTENT_KEYS`: add both, or the swap-pictures gesture leaves them behind.
- `migrate`: coerce to strings; no data moves.

**`js/refs.js`** — the seam
- `marked(p, shot, role)` — `role` of `'image' | 'video' | undefined`; undefined
  keeps today's union so every existing caller is unchanged.
- `feed(p, shot, role)`, `images(p, shot, role)` pass it through.
- The union order stays first-seen across description → role box → fields, so
  the card strip does not reshuffle when a role box is edited.

**`js/prompts.js`**
- `contextFor(shot, role)`: `DESCRIPTION` becomes the shared box plus the role
  box, so **every existing template keeps working unchanged**. Add
  `{{FIRST_FRAME}}` / `{{MOTION}}` for templates that want them placed
  separately.
- The "write a description first" gate passes if *any* of the three has text.
- The combined one-model job keeps working: `imageBlock` and `videoBlock` each
  build their own context.

**`js/personas.js`**
- `block(p, shot, model, role)` already takes `role`; give it to
  `Refs.images(p, shot, role)` so the numbered mapping matches what is sent.
  **This is the correctness-critical one** — a mapping that says "image 2 = the
  technician" when image 2 was never sent is worse than no mapping.

**`js/imagine.js`**
- `refsFor(p, shot, role)` already takes `role`; give it to `Refs.images`.
- The push that carries references uses its own lane's feed.

**`js/brand.js`**
- `castSides` and `moveAsked` read all three boxes — the camera and gender
  checks ask "did the board say this?", and the board can now say it in three
  places.

**`js/h3.js`** — scaffold and labels from the **video** feed.

**`js/board.js`** — the two chips, the inline boxes, `refreshFeed` aware of all
three; the card strip stays the union.

**`js/promptpanel.js`** — the lanes, the per-lane feed, the narrow-window
toggle, `refreshFeedCell` per lane.

**`js/pdf.js`, `js/exportpanel.js`** — union feed, unchanged behaviour.

**`js/settings.js`** — the template preview shows a shot with all three filled.

## What this fixes on the way

- The first-frame template's paragraph explaining that the description is a
  sequence and only its first instant is wanted becomes unnecessary when there
  is a first-frame box. It stays for boards that do not use the split, but a
  card that does gets a cleaner call.
- The Feed column currently lies by omission on any card whose two calls carry
  different things. After this it cannot.

## Tests

- `test-core`: role feeds (marks in the shared box reach both; a mark in the
  motion box reaches video only and never image); union order stable; numbering
  per role; `CONTENT_KEYS` swap carries both boxes; migration of an old board.
- `test-prompts`: the image job's `DESCRIPTION` contains the first-frame text
  and not the motion text, and the reverse; the cast mapping numbers only what
  that lane sends; the gate passes on a card with only a motion box filled.
- `test-ui`: the chips open and close; a filled box is open on render; typing an
  `@` in the motion box adds to the video lane's feed and not the image lane's;
  the lanes collapse under a narrow window.

## Risk, and the one judgement call

The real risk is **two boxes nobody fills in**, leaving the split as clutter on
every card. That is why the shared description stays the default, both new boxes
start closed, and an empty one says it is deferring to the description rather
than looking broken.

The judgement call I would make without asking: **do not migrate existing text.**
A board's description is a sentence someone wrote; splitting it by heuristic
("everything after the first comma is motion") would be wrong often enough to be
worse than leaving it. Old boards keep working; the split is something you start
using on the next card.
