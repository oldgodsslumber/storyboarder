# One photo per reference — plan

Status: **planned, not built.**

## Why

A persona holds an ordered list of reference photos today, and the whole app is shaped around
that list: the cast block cites ranges (`images 3–5 — Nat`), the feed numbers every photo
individually, H3 gets one `<Picture N>` per photo, and the persona panel has add / promote /
label / remove per frame.

None of it reaches a model. `▶ render` sends prompt, model and aspect — no references at all.
`▶ shoot` sends exactly one picture, the shot's own frame. So the numbering is a promise made
to a person who then drags files into ImagineArt by hand, and on a full-reference model (H3)
the prompt actively names `<Picture 1>`…`<Picture n>` for a call that receives one picture.

Three things follow from cutting it to one:

- **The prompt stops promising what the push cannot deliver.** One photo per subject is
  exactly what the platform takes, so the written prompt and the actual call agree.
- **A guard sentence disappears instead of being maintained.** The cast block currently has to
  say *"where more than one image is listed against the same name, they are the SAME subject
  seen from different angles"* — that line exists only because extra photos read to a model as
  extra people. It is a workaround for a feature nobody can currently use.
- **Weight.** Since originals moved into the `.storyboard`, every extra photo is a proxy plus a
  full-size original in the file — roughly 100 KB each, carried by every copy of the board
  forever.

On the real Bridgecrest board, all six personas have exactly one photo. Nothing in practice is
using this.

## What does NOT change

- **Feed numbering.** A shot still feeds several things — each cast subject, plus any other
  card's frame it references — so `image 1 = …` numbering stays exactly as it is. It simply
  becomes one number per subject.
- **Shot-frame references.** A card referencing another card's frame is unaffected.
- **H3 `<Picture N>` anchors** stay; there is just one per subject now.
- **The per-photo label** (`front`, `wardrobe`) stays as a caption on the single photo: it names
  what the reference *shows*, and it rides into export filenames.

## The data change

`per.image = {ref, w, h, label, render}` becomes the live field again — the shape boards had
before the list existed, which `imagesOf()` still reads as a fallback. `per.images` survives
only as migration input.

**Migration keeps the extras rather than deleting them.** The board is now the only copy of
those originals, so throwing them away on open would destroy work silently — the exact class of
bug the last two weeks were spent removing. On migrate:

```
per.image   = images[0]                 the reference, used everywhere
per.retired = images.slice(1)           kept, fed to nothing, exported by nothing
```

`Blobs.referenced()` must mark `retired` refs or the first structural change deletes them.
The persona panel shows a disclosure — *"2 older reference frames are kept in this board but no
longer used — 180 KB"* — with **use this one instead** (swap into the slot) and **delete them**
(frees the bytes). After that it is the user's call, not a silent one.

## API

| now | becomes |
|---|---|
| `Personas.addImage(per, img, label, render)` | `Personas.setImage(per, img, label, render)` — replaces |
| `Personas.imagesOf(per)` | stays, returns 0 or 1, so every caller keeps working during the change |
| `Personas.hero(per)` / `hasImage(per)` | stay; `hero` becomes the plain reader |
| `Personas.makeHero`, `removeImage(idx)`, `labelImage(idx, …)` | `clearImage(per)`, `labelImage(per, label)` — no index |

**Replacing destroys an original**, so the panel's replace is an armed action (`SB.armButton`,
the pattern already used for destructive card actions) rather than a plain drop-to-overwrite.
A dropped photo on an empty slot is unarmed as it is today.

## Code to change

| File | Change |
|---|---|
| `js/personas.js` | the API above; `block()` — `rangeFor()` collapses to `image N — `, and the multi-angle guard sentence is deleted |
| `js/personapanel.js` | one slot per persona instead of a strip: no add, no promote, no per-frame label row; the retired-frames disclosure |
| `js/refs.js` | `feed()` hands `images: [the one]`; numbering untouched |
| `js/mentions.js` | the "N frames" badge becomes "has a reference" / "none" |
| `js/h3.js` | one anchor per subject; check the `retention_analysis` wording for anything that assumes several pictures of one subject |
| `js/blobs.js` | `referenced()` marks `per.retired[].ref` and their `.render.ref` |
| `js/model.js` | migration; `Renders.weigh()` should count retired frames separately so the number in Settings is honest |
| `js/exportpanel.js` | nothing structural — one reference file per subject falls out |

## Tests to rewrite

- `test-core.mjs` — the frames-in-order / promote / label block becomes a replace block; *"a
  subject with two frames takes the next two"* becomes *"each subject takes exactly one number"*;
  new: migration moves extras to `retired`, and `gc()` does not eat them.
- `prompt-scenario.js` — the range wording and the multi-angle guard assertions go.
- `ui-scenario.js` — the persona panel's add-a-second-frame flow becomes replace; new: the
  retired disclosure appears on a migrated board and its delete frees the bytes.

## What someone loses, and what to tell them

Two angles of one subject was never sent to anything, but it *was* a place to keep them. The
answer is a second persona — `Nat (back)` — which numbers as its own reference and can be
marked on the shots that need it. The retired list holds anything already there until it is
dealt with.

## Order of work

1. `personas.js` API + migration to `image`/`retired`, with `blobs.referenced()` taught about
   retired in the same commit (or the first structural change eats them).
2. Prompt wording: `block()` ranges and the guard sentence, then `h3.js`.
3. The panel: one slot, armed replace, the retired disclosure.
4. `refs.js` / `mentions.js` / `weigh()`.
5. Tests and README.
