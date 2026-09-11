# Reviewing a clip from the board — plan

Status: **planned, not built.**

## What the two buttons do today

| Where | When | Button | What it does |
|---|---|---|---|
| Card, top-left of the frame | the shot **has** a clip | `▷ 2s` badge | opens the player (`SB.Clip.play`) |
| Card, hover tools | the shot has **no** clip | `▷+` | opens a file picker, straight away |
| Prompts panel, video column | the shot **has** a clip | `▷ clip 2s` | opens the player — *the same function* |

So the card and the panel already open the same modal when there is a clip. The mismatch is
the other state: on a card with no clip yet, `▷+` skips the review entirely and goes to the
operating system's file dialog. If that is the button being pressed, nothing pops up at all
— a file picker appears, and there is no clip to look at yet.

Two things follow: the card needs **one** clip affordance rather than two that behave
differently, and the modal both of them open should be worth arriving at.

## One button

The frame carries a single clip control in the same place, always visible, whatever the
state:

- has a clip → `▷ 2s`, as now
- no clip → `▷` dimmed, with a tooltip saying there is none yet

Either way it opens the same thing. `▷+` goes; adding a clip moves inside the modal, which
is where somebody deciding about a clip actually is. Dropping a file on the card keeps
working exactly as it does — that path is faster than any dialog and should not change.

## What the modal becomes

Today it is a `<video>`, one line of detail, **Replace…** and an armed **Remove**. A review
wants a little more, and everything it needs is already in the file:

```
Clip · 1C                                                   [×]
┌──────────────────────────────────────────────┐
│                  the video                   │
└──────────────────────────────────────────────┘
2s · 1184×672 · 1.9 MB · 0012.mp4
Made here on 11 Sep by Kling 3.0 Pro at 1080p, about 300 credits
"She turns from the window, slowly, and the light catches…"     ← the prompt it was made from

        [ Shoot it again ]  [ Replace… ]  [ Remove ]
```

- **Provenance**, from `video.made` — model, when, which door, the resolution asked for. A
  clip that was dropped in by hand says that instead, because that is the distinction the
  export filter turns on.
- **The prompt it was made from**, looked up the way the manifest does it (`made.modelId`
  first, name second), marked as *the prompt on the card now* if it has been edited since.
- **Shoot it again** — the same `SB.Imagine.run(shot, 'video')` the panel's push runs, with
  the same refusals and the same cost confirmation, so the board is a place you can iterate
  from rather than only look at.
- **With no clip**: the frame's still in place of the video, and the two buttons that make
  sense — **Add from a file…** and **Shoot it** (disabled with the row's own reason when it
  cannot run, reusing `pushBlock`).

## Where the code goes

`SB.Clip.play` grows into `SB.Clip.open(p, shot)` — the review — and both the card and the
prompt panel call it. The pieces it needs already exist and are exported:
`SB.Clip.label`, `SB.Renders.videoFile`, `SB.Imagine.run` / `blocker` / `costFor` /
`resolutionFor`, and the prompt lookup in `exportpanel.js`'s `promptFor`, which wants
lifting into `SB.Imagine` so both callers share one implementation rather than two that
drift.

`SB.Clip.play` stays as an alias, because `board.js` and `promptpanel.js` are not the only
things that might call it and a rename that breaks a caller silently is not worth the
tidiness.

## Tests

- the card shows one clip control in both states, and it opens the modal in both
- with a clip: the video mounts, the provenance line names the model and the prompt, and
  Remove still takes the bytes with it
- with none: **Shoot it** carries the same refusal the row would (no prompt, no org, not
  signed in), and **Add from a file…** reaches the same `clipDrop` the drop path uses
- the modal is the same one from both entry points (one function, two callers)

## Order of work

1. `promptFor` moves to `SB.Imagine`, used by both the export manifest and the review.
2. `SB.Clip.open` — the modal, both states.
3. The card's single control; `▷+` retired.
4. The panel points at the same function.
