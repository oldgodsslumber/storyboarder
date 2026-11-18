# Scout clips: drop a MOV, get a storyboard frame

A location scout comes home with a phone full of short clips. Each one should be able to
become a card: drop the file on the card and its frame is the storyboard picture, with the
clip itself kept so the move can be reviewed.

This is deliberately *not* new machinery. Almost all of it exists, for two reasons — the app
already takes dropped clips, and the Getty drawer already does frame-and-clip-in-one-gesture.
The feature is mostly joining those two things up and then being careful about the three
places where own footage is not like a Getty comp.

---

## 1. What already works today

Worth stating plainly, because it is more than it looks:

- **A dropped video on a card is already stored as a clip.** `board.js` routes a drop through
  `SB.videosFromTransfer` → `clipDrop` → `takeClip` → `SB.Clip.attach`
  (`imagine.js:attachClip`). It keeps the bytes, reads duration and dimensions, and adds the
  clip as a take.
- **`.mov` passes the gate.** Chrome reports `video/quicktime` for a QuickTime file and
  `attachClip`'s `/^video\//` test accepts it. No new type handling is needed. (A file with an
  empty `type` would be rejected — rare, and worth a friendlier message than today's "That is
  not a video file.")
- **The awkward cases already ask.** A drop carrying several clips, or a drop onto a card that
  already holds one, both open the `clip-pick` dialog and name what is at stake. That work does
  not need redoing, and the new path must go *through* it rather than around it.
- **The clip window already plays what is on the card**, with takes, since the Getty work made
  that uniform.

## 2. The gap, exactly

`attachClip` stores a clip. It never makes a picture. So dropping a scout MOV on a card today
gives you a card that *holds* footage and still shows as an empty storyboard frame — the one
thing the scout wanted it for.

The Getty path does the whole gesture, in `board.js:placeStock`: get the comp, extract a frame,
`setImage(sh, frame, made)`, then `SB.Clip.attach` for the clip, in that order and with the
failure of either reported rather than swallowed. **That function is the design.** The work is
to give own footage the same treatment, not to invent a second one.

## 3. Which frame — and why not frame zero

The request says "the first frame". For a Getty comp that is right: a comp starts clean. For a
handheld scout clip it is usually the worst frame in the file — a hand still on the record
button, auto-exposure and autofocus settling, sometimes a black lead frame.

Recommendation, in two parts:

- **Seek a little in by default.** `min(0.3s, duration / 4)`, falling back to 0 if the seek
  does not land. Costs nothing and will be right most of the time.
- **Make re-picking cheap**, which matters more than the default. The clip is already on the
  card and the clip window already plays it, so add one button there: **"Use this frame"**,
  taking the frame at the playhead through the same `setImage` call. A bad auto-pick becomes two
  clicks instead of a re-drop, and it is useful on its own for clips that were already attached.

If you would rather the default stayed literally the first frame, it is one constant.

## 4. Reuse, and the one piece that should move

`SB.Getty.firstFrame(blob)` is the decoder: object URL → `<video>` → canvas. It is general
code sitting in a Getty-specific file, and the Getty client keeps a `deps.firstFrame` test seam
in front of it.

- Move it to `util.js` as **`SB.frameFromVideo(blob, atSeconds)`** — `atSeconds` is the only new
  argument — and have `getty.js:firstFrame` call it so the seam and the Getty tests are
  untouched.
- Everything downstream already exists: `SB.toJpegBlob` for the bytes, `setImage` for the proxy
  and the original, `SB.Blobs` for storage.

So: one function moved and given a parameter, one new `scoutDrop` beside `clipDrop`, one
button in the clip window.

## 5. The size problem — the real constraint

**`keepVideo` stores a clip as base64 inside the project JSON** (`renders.js`: `toDataUrl` →
`SB.Blobs.put`). There is no cap and no warning anywhere in the app today. A phone clip is 50
to 200 MB; as base64 that is roughly 1.35× that, the whole project file is rewritten on every
save, and a scout day is *many* clips. This is what will bite, not the decoding.

The saving grace is that the project is a real file through `showSaveFilePicker`, not
localStorage, so there is no hard quota to hit — it degrades as save time and memory rather
than as a wall. That is better, but a 2 GB `.storyboard` is still a dead project.

Options, with a recommendation:

| | Keeps | Cost |
|---|---|---|
| (a) frame only, clip discarded | nothing to review the move with | nothing |
| (b) frame + clip always | everything | the file above |
| (c) frame + transcoded short proxy | most of it, small | needs an encoder in the page |

**Recommended: always the frame; keep the clip only under a threshold, and ask above it.**
Default the threshold around 25 MB. Above it the dialog says the file's size, what it will do
to the project, and offers *frame only* / *keep it anyway*. This mirrors the Getty drawer's
existing "keep the comp" switch, so the concept and the Settings row already exist — and the
asking pattern is already there in `clip-pick`.

(c) is the right answer eventually and should not be attempted now: mediabunny is already in
the build, but only as a CDN URL inside the Pose Bench's `srcdoc` document, and pulling an
encoder into the app proper is its own piece of work.

## 6. Three ways own footage is not a Getty comp

These are the places where copying `placeStock` would be wrong, and they are the whole reason
this plan is longer than its code will be.

1. **No licence, and that is load-bearing.** `markStock` must **not** be called. The register is
   what `SB.Model.isStock` reads, and `modelFrame` holds stock frames out of every model feed.
   Own footage carries no licence, so its frame *is* a legitimate reference to hand a model —
   which is the behaviour you want on a scout plate, and you get it for free precisely by not
   copying the licence call. There should be a test asserting a scout frame **is** offered to
   the model lane, as the mirror of the Getty test asserting a comp is not.
2. **Provenance still matters, differently.** Set `made = { by: 'scout', name: <filename>,
   at: <file.lastModified> }` so `describeMade` can say "Location scout · clip name" on the
   card and in the handoff, and so a frame's origin is answerable six weeks later. It is a
   note, not a restriction.
3. **There is no still to fall back on.** When a comp will not decode, `placeStock` falls back
   to Getty's largest still. A local file has no such fallback, so a decode failure must be
   explicit and actionable rather than a shrug — see below.

## 7. HEVC, and why this needs a real device

An iPhone shooting in "High Efficiency" writes HEVC in a `.mov`. Chrome decodes HEVC only where
a platform or hardware decoder is available; where it is not, `frameFromVideo` will fail and no
amount of care in this app will change that.

So the failure has to be useful: name HEVC as the likely cause, name the iPhone setting
(Settings → Camera → Formats → *Most Compatible*), and offer to keep the clip anyway and take a
picture from a file instead. **I cannot verify this from here** — it wants a real portrait
iPhone clip, in both formats, on this machine. Treat §7 as unverified until that happens.

**Rotation is the same kind of risk.** Phone clips carry a rotation matrix; Chrome's `<video>`
honours it for display, but `videoWidth`/`videoHeight` are the pre-rotation dimensions in some
builds, which yields a sideways or letterboxed frame. The fix if it bites is to size the canvas
from the displayed aspect rather than the track, but it needs to be *seen* first.

## 8. Tests

Node, against the model and the drop logic:

- a dropped video sets both a picture and a clip on the card, in one gesture
- the frame is **not** marked as stock, and **is** offered as a model input (the mirror of the
  Getty assertion)
- `made.by === 'scout'` survives a save/load round trip, and the card says where it came from
- over the threshold, the dialog is raised rather than the bytes being kept silently
- *frame only* keeps no clip and still leaves a picture
- a clip that cannot be decoded still lands as a clip, with the frame reported as failed — the
  shape of the Getty defect that put a comp in the file with nothing counting it
- an empty `type` is refused with a message that names the file

UI, in the scenario: the drop, the threshold dialog, "Use this frame" from the clip window, and
a portrait-aspect fixture to pin the rotation behaviour once it is known.

## 9. What I would want decided before building

1. **Does dropping clips on the *board* create cards?** Today only a card's frame accepts files;
   the board and scene drops handle card moves. A scout day is a dozen clips, and dragging them
   one at a time onto cards that must already exist is a chore. My recommendation: yes — drop
   onto a scene and get one card per clip, in filename order, each with its frame. It is the
   larger half of the work, and it is the half that makes this a scouting tool rather than a
   convenience.
2. **Keep the clips, or just the frames, by default?** §5 recommends keep-under-threshold.
3. **Frame at 0.3s or frame zero?** §3 recommends 0.3s plus a re-pick button.

## 10. Order of work

1. `SB.frameFromVideo` moved into `util.js` with its seek argument; Getty unchanged on top of it.
2. `scoutDrop` in `board.js`: frame + clip in one gesture, through the existing `clip-pick`
   questions, with `made.by = 'scout'` and no licence call. Tests.
3. The size threshold and its dialog, plus the Settings row. Tests.
4. "Use this frame" in the clip window. Tests.
5. Board/scene drop creating cards, if (1) above is a yes.
6. Then, and only then, a real iPhone clip in both formats — portrait and landscape — before
   calling any of it done.
