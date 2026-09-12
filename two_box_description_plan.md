# Two boxes: the frame, and what happens — plan

Status: **planned, not built.**

## Why

A card has one description box, and two prompts are written from it. Everything between those
two facts is the app guessing which half of a sentence is which.

Count what exists only to do that guessing:

- `FIRST_FRAME_RIDER` in `brand.js` — eleven lines teaching a model that *"then"*, *"after"*,
  *"as"*, *"walks in"*, *"reaches for"* mark what happens **after** the frame, and that none of
  it is in the picture.
- `IMG_TPL`'s middle paragraph — *"The description below is a short sequence. You are writing
  only its FIRST INSTANT"* — saying the same thing again, per board, in a template each board
  carries its own copy of.
- `shot.castEnters`, `Personas.arriving()`, the ◉/▷ toggle on every feed chip, and the
  `MARKED AS ARRIVING, AND THEREFORE ABSENT FROM THE FIRST FRAME` paragraph — a whole per-person
  per-card data field whose only job is to answer *"is this person in the frame or do they walk
  in during it"*, which is a question about a sentence the user already knows the shape of.
- The cast block's *"This block says how these subjects LOOK. It is not a list of who or what is
  visible in the frame you are writing"* paragraph.

Every one of those is a workaround for one box doing two jobs. And they are the *successful*
cases: each was added after the thing it prevents had already happened on a real board.

There is one case none of them reach at all. **"Danny is typing" when you never see his hands.**
He is in the shot's world and not in its frame. Today the app has no way to express that — being
cast on the card puts him in `Refs.feed()`, which puts his description into the cast block, which
is declared authoritative, and he gets drawn. The framing layer (shipped; see below) answers it
with a rule the model has to apply — *"anyone the description has DOING something who does not
fit inside this frame is doing it off camera"* — which is inference again, just better-aimed.

Two boxes answer all of it by construction. What the frame shows is one box; what happens is the
other. Nothing to infer, nothing to guess, nothing to ride along and explain.

## What it builds on

The framing layer is already in: `settings.shotFraming` gives every shot type a sentence saying
what it shows, `Brand.framingBlock()` sends it with the precedence rule, the cast block is scoped
to the frame, and the badge catches a description that disagrees with the dropdown. **None of
that is replaced.** A frame box still needs to be told that a close-up has nothing below the
chest. The two compose: the shot type says how much is visible, the frame box says what is in it.

## The shape

**`shot.frame` is a new box, and it is optional.**

- **Empty** — which is every card on every existing board — behaves *exactly* as it does today.
  The description drives both prompts, the riders do the inferring, the arrival toggles matter.
  Nothing about an existing board changes on open, and nobody is made to go and fill in a second
  box on two hundred cards.
- **Filled** — it is the truth about the first frame. The image prompt is written from it and
  from nothing else. `FIRST_FRAME_RIDER` is not sent, the template's FIRST INSTANT paragraph is
  overridden, and the arrival marks are ignored: the box already says who is in the picture.

This is the whole design. The optionality is not a hedge — it is what makes the change shippable
mid-project and what lets a card be as precise as it needs to be and no more.

**`shot.description` keeps its name and its meaning.** It is what happens in the shot, which is
what most cards already say, and it is what the video prompt is written from. Renaming it to
`videoDescription` would churn migration, every frozen version snapshot, `coverage.js`,
`Refs.plain()`, the PDF and the prompt table for no gain anyone can see.

**"Draft it"** sits on the frame box: one call to the writer model, from the description, into
the box, where it can be read and edited. This is the same inference the app does invisibly on
every single generation today — done once, visibly, into text a person owns. That is the whole
argument for the feature in one sentence.

## The marks question

The description is a reference box: `@Danny` in it is a mark, and `Refs.feed()` reads marks to
decide which pictures the card hands over and in what order. The frame box must be a reference
box too — `@Danny` in it means *his picture is fed*, which is exactly right when the frame is of
his hands.

`Refs.feed(p, shot)` currently walks `marked(p, shot)` over the description alone. It becomes:

```
frame-box marks first, in their order     what is IN the picture
then description marks not already seen   what is in the shot but not the frame
then cast with no mark at all             unchanged
```

Frame-first is deliberate: the feed's order is the order files are dropped into a model, and the
subject the frame is *of* should be `image 1`. An entry's `mentioned` flag gains a sibling —
`inFrame` — and the cast block uses it for the sentence the arrival marks used to write:

> NOT IN THIS FRAME — described in the shot but outside what the camera sees: Danny. His action
> is happening; none of him is drawn.

That paragraph is the "Danny is typing" case, stated as fact rather than derived by a model from
a rule.

## What does NOT change

- **Every existing board**, until somebody types into a frame box.
- **The description box**, its name, its contents, its position, its `@` marks.
- **Feed numbering** and the image mapping in the prompt — the order changes, the scheme does not.
- **`castEnters`** — kept, and still the answer on a card with no frame box. On a card with one,
  the frame box wins and the arrival paragraph is not sent. Do not delete the field; a card can
  go back to an empty frame box.
- **H3's `subject_definitions` / `retention_analysis`** — they describe subjects, not framing, and
  the framing scoping already shipped.
- **Frame-only video models** still get no framing prose: they are handed the picture.

## The data change

```
shot.frame = ''        // new; a reference-box string, same shape as description
```

No migration is required — absent is empty is today's behaviour — but `Model.migrate()` should
still set `sh.frame = sh.frame || ''` so every reader can stop writing `|| ''`, and
`newShot()` gains the field.

Version snapshots carry whole shots, so frozen versions need nothing.

## Prompt assembly

`Prompts.contextFor()` gains `FRAME`, and the two blocks change which one they send:

| job | today | becomes |
|---|---|---|
| image | `DESCRIPTION` = description | `DESCRIPTION` = frame if filled, else description |
| video | `DESCRIPTION` = description | unchanged — always the description |
| both (one model) | one `DESCRIPTION` for two prompts | frame for the still half, description for the video half |

The combined image+video job is the awkward one: it is a single call whose two halves now want
different text. Either send both under named headings, or stop combining when a frame box is
filled. **Stop combining** is the honest answer — it is one extra call on cards that have opted
into precision, and the combined job exists only to save a call.

`Brand.systemFor()` takes the shot already, so `FIRST_FRAME_RIDER` becomes conditional on
`!shot.frame` in one line. The template's FIRST INSTANT paragraph cannot be edited out of boards
that carry their own copy, so it is overridden by a rider the way `DERIVED_RIDER` already
overrides *"describe subject, setting, composition, lens…"*:

> THE FRAME IS WRITTEN DOWN. The shot description below IS the first frame, exactly. It is not a
> sequence and nothing in it happens after anything else. Ignore any instruction above about
> first instants, about what happens next, or about who arrives during the shot.

## Code to change

| File | Change |
|---|---|
| `js/model.js` | `newShot()` gains `frame`; `migrate()` normalises it |
| `js/board.js` | a frame box above the description, with its label and **Draft it**; `refreshFeed` reads both boxes |
| `js/refs.js` | `feed()` walks frame marks then description marks; entries gain `inFrame` |
| `js/personas.js` | `block()` uses `inFrame` for the NOT IN THIS FRAME paragraph; the arrival paragraph is suppressed when a frame box is filled |
| `js/prompts.js` | `contextFor()` gains `FRAME`; `jobsFor()` picks the text per role and stops combining when a frame box is filled |
| `js/brand.js` | `FIRST_FRAME_RIDER` conditional; the new override rider |
| `js/promptpanel.js` | the Description column becomes two stacked boxes, or a column — decide against the real width |
| `js/coverage.js` | **decision needed**: does *Generate shots* write a frame box as well? It writes descriptions today, and writing both is the difference between the feature being adopted and being ignored |
| `js/pdf.js`, `js/exportpanel.js` | **decision needed**: which text appears under a board image. Probably the frame box where there is one, since that is what the picture IS, with the description below it |

## Tests

- `test-core.mjs` — `newShot`/`migrate` carry `frame`; `Refs.feed()` ordering with marks in both
  boxes, including the same subject marked in both (one entry, `inFrame` true, frame's position).
- `prompt-scenario.js` — a filled frame box drives the image prompt and not the video prompt; the
  FIRST INSTANT rider is absent when it is filled and present when it is not; the combined job
  splits; `NOT IN THIS FRAME` names somebody the description acts and the frame box omits.
- `ui-scenario.js` — the box appears, takes marks, feeds in the right order; **Draft it** fills it;
  emptying it puts the arrival toggles back in charge.
- `test-typing.mjs` — real keys into the frame box, since it is a reference box and the caret work
  applies to it (`.fr-box[data-shot]` needs the same identity attributes as `.desc-box`).

## What someone loses

Nothing, unless they fill the box. The risk is not loss, it is **two boxes to read** on a card
that only ever needed one — which is why the frame box should collapse to a single line of hint
text when empty, and why *Generate shots* has to fill both or the feature dies on contact with a
forty-card board.

## Order of work

1. `shot.frame` in the model, the box on the card, marks working, the feed ordering. No prompt
   changes yet — the box exists and does nothing.
2. Prompt assembly: `FRAME` in the context, the per-role pick, the override rider, the combined
   job split. This is the commit where it starts mattering.
3. `Refs.feed()` `inFrame` and the cast block's NOT IN THIS FRAME paragraph — the "Danny is
   typing" case.
4. **Draft it**.
5. The prompt table, then the PDF/export decision, then `coverage.js` writing both boxes.
6. Once boards are actually using it: revisit whether `FIRST_FRAME_RIDER` and the arrival
   toggles are still earning their place, or whether the frame box has quietly replaced them.
