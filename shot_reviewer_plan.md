# The Shot Reviewer

## What is wrong

Render a shot three times and the board remembers one: `setImage`
([board.js:2101](js/board.js#L2101)) overwrites `sh.image` (the proxy) and
`sh.render` (the original) on every landing. The take you liked second-best
is gone the moment a new one arrives — the exact problem clips had before
takes, and clips got fixed (`sh.video` chosen + `sh.videoAlts`,
[model.js:332-424](js/model.js#L332)). Stills never did.

And there is nowhere to *judge*. The Viewer shows one picture big; the clip
window lists takes in a strip under a small player. Neither is "the image at
full size on the left, every take on the right, pick the keeper".

## Part 1 — stills get takes (model)

Mirror the clip model exactly, because it is proven and every reader in the
app already understands "chosen + alts":

- **Chosen take** stays where it lives today: `sh.image` + `sh.render`.
  Nothing that reads a card changes — board, feed, prompts, push, PDF,
  export all keep reading the same two fields.
- **`sh.imageAlts`**: array of `{ image:{ref,w,h}, render:rec|null, at }` —
  each alt keeps its own proxy (for thumbnails) and its own full-size record
  (for judging and for a model to be fed if it is ever chosen). Purely
  additive; a board that never keeps one behaves as it always has.
- `model.js` gets the still twins of the clip functions, same semantics:
  `stillTakes(sh)` (chosen first flag, numbered by `at` — a take number is a
  fact about the shoot), `stillTakeCount`, `addStillTake` (the one-step
  swap: old chosen joins the alts *in the same assignment* the new one takes
  the slot — the two-step version is how clips once stranded takes),
  `useStillTake`, `dropStillTake` (dropping the chosen promotes the newest
  remaining, so a card with takes never shows empty while holding three).

**When is a take kept?** Every time a picture lands on a card that already
holds one:

- a **generated** still (`fileImage` → `Board.setImage`) — always keeps the
  old as a take. This is the case you named: re-render, compare.
- a **dropped/pasted** file — same. The clip side asks "Add another take?"
  in a modal ([board.js:2092](js/board.js#L2092)); stills follow the same
  convention so the two behave alike.
- **Replace** in the Viewer/Reviewer — replace means replace; the old one
  becomes a take too, and if you truly wanted it gone, delete is right there.

**Plumbing that must not be forgotten** (each is a lesson clips already paid
for):

| where | change |
|---|---|
| [blobs.js:107](js/blobs.js#L107) walker | mark `imageAlts[].image` and `imageAlts[].render`, or the next gc eats every kept take's bytes |
| `CONTENT_KEYS` ([model.js:1342](js/model.js#L1342)) | add `imageAlts` — a swap/duplicate that separates the chosen still from the takes it was chosen against repeats the videoAlts bug |
| `duplicateShot` | alts travel like `render` does: shared blobs, new serials |
| Settings → Originals weight count | alts' renders count; they are exactly the kind of weight that page exists to show |
| `dropImage` ([board.js:1854](js/board.js#L1854)) | clearing the card clears takes too — with the same armed confirm, saying how many go |

**One consequence to surface, not hide:** choosing a different take changes
the picture the clip animates and the picture the prompts were written
about. Choosing a take therefore marks the card's written video prompt stale
(`pr.stale = 'the frame changed'`) — the mechanism just built for the
arrival toggle — so the Create panel says the prompt is out of date instead
of quietly describing the wrong picture.

## Part 2 — the Reviewer (UI)

A new module, `js/reviewer.js`, full-screen overlay (same modal stack as the
Viewer so Esc/arrow gating via `SB.isTopModal` is free):

```
┌────────────────────────────────────────┬──────────────────┐
│                                        │  take 3  chosen  │
│                                        │  [thumb] use ✕   │
│         the take, full size            │  take 2          │
│   (original where the file holds one,  │  [thumb] use ✕   │
│    board copy where it doesn't —       │  take 1          │
│    and it says which, like the Viewer) │  [thumb] use ✕   │
│                                        ├──────────────────┤
│  0007.webp · 1184×672 · full-size      │ 🖼️ render another │
│                                        │ + add from file  │
└────────────────────────────────────────┴──────────────────┘
```

- **Left**: whichever take is highlighted, at full size, with the Viewer's
  honesty line (dimensions, file, "full-size original" vs "the board's own
  copy") — `Viewer.srcOf` is already exported and does exactly this.
- **Right**: every take, newest first, thumbnail + when it was made + what
  made it (`rec.made` — model and slug — or "added from a file", same
  wording as the clip takes strip). Click a row → it shows on the left.
  - **use this one** on any non-chosen take → `useStillTake`, board updates,
    stays open so you can keep comparing.
  - **✕** with the same two-press arming every destructive button has;
    deleting the chosen promotes the newest remaining.
  - **render another take** → the same push the Create panel's 🖼️ Frame
    button runs (`Imagine.run(sh,'image')`, gated by the same `whyNot`),
    with the current chosen kept as a take when it lands. The reviewer shows
    the job ticking the way the push button does.
  - **add from file** → picker, lands as a new chosen take.
- **Keys**: ↑/↓ walk takes, Enter chooses the highlighted one, Delete arms
  the delete. ←/→ stay free for a later "next/previous shot" if wanted;
  not in this build.

**Where it opens from:**

- the card's frame click, when the card is a shot — today that opens the
  Viewer ([board.js frame()](js/board.js#L1863)); it opens the Reviewer
  instead. The Viewer keeps every other caller (references, persona frames,
  thumbnails) — it is the right tool for "one picture, big"; the Reviewer is
  the right tool for a shot.
- the Create panel's still lane could add an entry later; not in this build.

**The Viewer's Replace/Remove contract carries over**: pictures change only
on an explicit act. Nothing in the Reviewer swaps a picture as a side effect
of looking.

## Out of scope, said now

- Takes for reference images / personas (same idea, different day).
- Exporting non-chosen takes (export and PDF stay chosen-only).
- A compare/AB split view — the column layout is the comparison for now.

## Tests

- model: add/use/drop round-trips; dropping the chosen promotes newest;
  `CONTENT_KEYS` carries `imageAlts` through swap and duplicate; the blob
  walker keeps alt bytes across a gc (the exact regression test the clip
  takes have).
- ui-scenario: render lands on an occupied card → old becomes take 1, badge
  or count reflects it; open reviewer, use take 1 → board frame changes and
  video prompt is marked stale; delete chosen → newest remaining shown;
  frame click on a shot opens the Reviewer, on a reference still the Viewer.
- imagine: `fileImage` on an occupied card calls the take-keeping path.

## Size

Part 1 is a day of careful plumbing (five integration points, each with a
known failure mode already documented in the clip code). Part 2 is a new
~300-line module plus CSS, mostly assembled from parts that exist (`srcOf`,
takes strip wording, `whyNot`, the push). Nothing migrates; old boards open
unchanged.
