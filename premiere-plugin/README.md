# Storyboarder — Premiere Pro panel

A UXP panel that turns the active sequence into a `.storyboard` file: **one card per
cut**, each card holding a frame grabbed from that shot and the words spoken under it.

Everything lands in a single scene. The panel does not try to work out where scenes
begin and end.

## Install

Needs Premiere Pro 25.0 or newer (UXP).

1. Install the [UXP Developer Tool](https://developer.adobe.com/photoshop/uxp/guides/devtool/)
   and open it.
2. **Add Plugin** → pick `premiere-plugin/manifest.json`.
3. **Load** (⋯ → *Load*) with Premiere running.
4. In Premiere: **Window → Extensions → Storyboarder**.

## Use

1. Open the sequence you want. The panel reads it on load — **Refresh** after you re-cut.
2. Leave the mode on **Every clip boundary on one track** and make sure that track is
   ticked — see *The workflow this is built around* below. The card count updates live, so
   you can check it before committing to an export run.
3. Export your script from the **Text** panel (*Transcript* tab → **Export** → SRT, or the
   transcript `.json`) and choose that file under **Transcript**.
4. Set how many **frames into each shot** to grab — 2 by default, which steps past a
   dissolve sitting on the cut. Set it to 0 for the exact first frame.
5. **Build storyboard…**, pick where the `.storyboard` file goes.
6. In Storyboarder: **Open project…** and select that file.

## The workflow this is built around

**Export flat, re-import, run Scene Edit Detection, board that.**

1. Export the cut as a single flat file.
2. Import it and drop it on V1 of a new sequence.
3. Right-click the clip → **Scene Edit Detection** → *Apply cuts*.
4. Point the panel at that sequence, leave the mode on **Every clip boundary on one
   track**, and build.

The whole point is that the cut list then comes from the **picture**, not from anyone's
track discipline. A nine-track timeline with graphics scattered across V2–V9 collapses to
one track of clean boundaries, and none of it has to be untangled.

In this mode the seconds threshold does not apply — every clip on a scene-detected export
is a real cut, including a 6-frame one, and nothing is dropped for being short.

### The other mode

**Any change across the ticked tracks** exists for boarding a live edit directly, without
the export round-trip. It treats a cut as any change in the composited picture: every in
and out point across the ticked tracks, with ones landing on the same frame collapsed, and
black stretches dropped. It's there if you want it, but it depends on the timeline being
readable — which is the assumption the flat-export route removes.

Its two filters:

- **Ignore anything under N seconds** (0.5 s) drops *short elements*, so a lower-third
  flashing up for 8 frames doesn't split the shot it sits over. It never shortens the
  board — something ignored at the very start or end is still covered by its neighbour.
- **Skip adjustment layers** treats a grade as a grade, not a shot.

Hidden (muted) tracks contribute nothing to the picture, so they contribute no edit points
and come unticked.

Source clip names are deliberately kept out of the card descriptions. On a flat export
every card would name the same file, and the description is what the prompt writer reads.

## Why a transcript file and not the Text panel

The Text panel is not scriptable. Neither UXP nor the old ExtendScript API exposes its
contents, and nothing exposes where the caret is — so "read the cursor position for each
shot" is not something a plugin can do.

An exported transcript is strictly better anyway: every cue carries real timecodes, so
each word is pinned to the timeline rather than inferred from a caret. The panel
intersects those timings with the cut points, which produces exactly the split you'd get
by hand — the first word under the cut through to the word before the next one.

Word-level timings are used when the file has them (transcript JSON). Cue-level formats
(SRT, VTT) have one timestamp per caption, so a cue's duration is spread evenly across its
words; a cut landing mid-sentence still splits at a sensible word.

No word is dropped: anything before the first cut or after the last is pulled into the
nearest card.

## What each card gets

| Card field | Filled with |
|---|---|
| Frame | JPEG exported from the sequence at the grab time, stored once in the project's blob map |
| Script | The words spoken between this cut and the next, anchored into the master script |
| Description | Timecode range and duration — feeds the prompt generator |
| Shot type | Left blank for you to set |
| Fields, personas | Left empty — a timeline says nothing about who is in shot |

Timecodes in the description follow the timeline, so a sequence starting at `01:00:00:00`
reads `01:00:…` — frame grabs stay zero-based underneath. Non-integer rates (29.97, 23.976)
are shown non-drop-frame.

The script is written as a real **anchored range** into the master script, not a copy, so
the two-way sync works the same as text you typed yourself. Cards over silence get an
empty freestanding box rather than a broken link.

## Formats accepted

- **SRT** — Text panel → Transcript → Export → *Subtitles/SRT*
- **WebVTT** — cue markup (`<c>`, inline timestamps) is stripped
- **Transcript JSON** — Premiere's transcript export. The reader walks the file for timed
  text segments rather than assuming one schema, and handles times given in seconds,
  milliseconds or Premiere ticks.

## Tests

```
node test-plugin.mjs
```

Covers the parsing, the word→cut assignment and the generated project — everything that
doesn't need Premiere running. The sequence walk and frame export have to be tested in the
app.

## Files

```
manifest.json      UXP manifest (v5)
index.html         panel UI
index.js           sequence walk, frame export, file IO
lib/b64.js         ArrayBuffer → base64 (UXP has no Buffer)
lib/host.js        probing around differences between Premiere builds
lib/transcript.js  SRT / VTT / JSON → timed words; assignment to cuts
lib/cuts.js        stacked tracks → the list of shots; which frame to grab
lib/blobs.js       the project's image store (must match the app's hash)
lib/board.js       timed shots + words → .storyboard project JSON
test-plugin.mjs    tests for the lib files
```

Load order matters: `b64`, `host`, `transcript`, `cuts` and `blobs` before `board`, which
reaches for them as globals.

### Frames and the blob store

Images do not sit on the shot. The card holds `{ref,w,h}` and the base64 lives once in
`project.blobs`, keyed by the hash of its bytes — so a held frame or a repeated title card
costs one copy, and cutting a version copies references rather than pictures.

`lib/blobs.js` reimplements the app's hash (`js/blobs.js`) and **must stay byte-identical
to it**. If the two drift, a frame written by the plugin and the same frame added by hand
in the app would be stored twice. `test-plugin.mjs` pins the reference for known inputs;
the app's own implementation is the authority if they ever disagree.

### Version drift

The UXP API is not stable across Premiere builds — `getVideoFrameRate()` is missing from
the settings object on some of them, and `TickTime` has exposed its value as `.seconds`,
`.ticksNumber` and `.ticks` at different times. `lib/host.js` probes every accessor it
knows and falls through, so a metadata lookup can never stop the panel finding the
sequence. Frame rate comes from `getTimebase()` first, frame size from `getFrameSize()` —
both live on the sequence itself rather than on settings.

If it ever has to guess, the log says so and prints the method names the objects actually
have, along with the Premiere version. Paste that in and the fallback list can be extended.

Frame export gets the same treatment. `exportSequenceFrame`'s argument convention is
ambiguous in Adobe's own docs — the example passes a full path as the *filename* while
also taking a separate directory — and it is undocumented whether the directory wants a
trailing separator or which slash. The panel tries each convention once on the first
frame, in three shapes (scaled JPEG, PNG, then the sequence's native size), keeps whichever
one actually put a file on disk, and reuses it. If none work it prints every attempt with
its reason rather than reporting a bare count.

Premiere writes those files with native code rather than through UXP's filesystem, so the
panel polls for the file to appear and re-lists the folder to bust UXP's cached view of it.

**Premiere doubles the extension.** `exportSequenceFrame` appends the extension to the
filename you pass, so a frame requested as `sb_0001.jpg` lands on disk as
`sb_0001.jpg.jpg`. This is a known Adobe bug — their own sample code logs
*"Exporting output.png.png (We do double extension)"* — acknowledged by Adobe staff on the
[forums](https://community.adobe.com/t5/premiere-pro-discussions/premier-pro-25-3-exportframepng-exports-with-an-extra-quot-png-quot-in-filename/m-p/15371366)
and slated to be fixed "in UXP's official initial release".

The panel therefore never looks for the filename it asked for. It matches on the
**basename** and takes whatever turned up, so `sb_0001.jpg`, `sb_0001.jpg.jpg` and
`sb_0001.jpg.png` all work and the fix survives Adobe fixing the bug. It also sniffs the
file's magic bytes rather than trusting the extension, since the format written is not
necessarily the one requested.

**If every attempt still returns false or no file appears**, suspect the destination:
UXP's temporary folder sits inside the plugin's own sandboxed storage, and the host
exporter can refuse to write there even though the plugin can. Use **Frames folder →
Choose…** to point it at an ordinary folder — Documents, or next to the project — and
build again. The frames are deleted as they are read; nothing is left behind.

The log distinguishes the cases for you: it reports whether the *plugin* can write to the
folder, and runs a sanity export at 00:00:00:00 at native size. If that one works, the
destination is fine and the grab times are being rejected — set the frame offset to 0.

**The odd frame missing** rather than all of them is a different problem, and usually one
of two:

- *Off-grid grab times.* Shot times arrive as floating-point seconds, so adding an offset
  of 2/29.97 lands between frame boundaries and Premiere may refuse to render there. Grab
  times are calculated in whole frame numbers and converted back, so they always sit on
  the grid.
- *A slow frame.* Long-GOP source or a stack of effects can take seconds to render, and
  the panel used to stop looking after about one. It now waits up to 15 seconds per frame.

If a frame still will not come, the panel tries three others from the same shot — its
midpoint, its first frame, then its last — because another frame from the right shot beats
an empty card. Anything that still fails is listed by **card code and timecode**, so you
can find it on the board.

`lib/board.js` writes a deliberately minimal project — Storyboarder's own `migrate()`
supplies ids, settings, models, fields and templates when the file is opened. What the
plugin must get right is only what `migrate()` cannot invent: the master script, each
card's anchored range into it, and the blob references for the frames.
