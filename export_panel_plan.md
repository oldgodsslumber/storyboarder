# The export panel — plan

Status: **built** — [js/exportpanel.js](js/exportpanel.js), toolbar → **Export**, covered by
[test-export.mjs](test-export.mjs). This is the note it was built from; it is kept because
the reasoning is the part worth re-reading, and the last section says what was deliberately
left out.

## Why it has to exist now

The board used to write its full-size originals into a folder you connected, so "get me the
pictures" was answered by the filesystem: open the folder, drag what you want. That folder is
gone — it was a fact about one machine, it never travelled with the file, and it silently
discarded originals for any board that never had one. Everything now lives inside the
`.storyboard`: proxies, full-size originals, clips.

Which means the app has swallowed the only way the pictures used to get out. Right now there
is exactly one exit — **copy image set** on a card's feed row, which downloads the reference
set numbered in feed order — plus the PDF print sheets. That is not enough for the actual
end of the job: handing a cut to an editor, dropping a shot into Premiere, sending a client
twelve frames, getting the clips onto a timeline.

## What the board now records so this is possible

Two things were added ahead of the panel, because neither can be reconstructed afterwards:

- **Provenance.** Anything generated inside the app carries `made` on its record —
  `{by:'imagine', role, model, slug, via, at}` — set when the still or the clip is filed
  ([imagine.js](js/imagine.js) `run()`). Nothing else can tell a generated frame from a
  dropped one later: the prompt on the card gets edited, the model selector moves on. This
  is what makes **"export what we made"** a real option rather than "export everything and
  sort it out by eye".
- **Clips that are actually here.** A clip's record keeps its `ref` into the file, and when
  ImagineArt's link could be read but the bytes could not, the board says so and offers to
  fetch them again while the link is alive (`SB.Imagine.fetchClip`). An export must never
  quietly ship a board that is holding links instead of clips.

## What people actually need out of a board

Named in the order they come up on a real job:

1. **Every original, as files.** `0007.webp` and the rest — the serials are already the
   names. For an editor, for an archive, for re-feeding a model outside this app.
2. **The clips**, same thing, same names — `0012.mp4` — so a clip and the frame it came from
   sort next to each other in the folder an editor opens.
3. **Only what was made here.** The one filter that gets asked for by name: the eleven
   stills and four clips ImagineArt generated, not the forty frames that were dropped in
   from elsewhere. Backed by `made`, with a manifest beside them (below) saying which model
   and which prompt produced each.
4. **One shot's reference set**, numbered in feed order — what "copy image set" does today,
   which the panel should absorb rather than duplicate.
5. **Contact sheets / the PDF**, which already exist in `js/pdf.js` and belong on the same
   panel, because "export" is one idea to the person doing it even if it is two code paths.
6. **The board as a package** — the `.storyboard` plus a folder of originals and clips, for
   handing to someone who does not have the app.
7. **A shot list**, plain text or CSV: code, type, description, both prompts, the model each
   was written for. This is what gets pasted into a call sheet or a ticket.

## Shape

A takeover panel like the Prompts table, opened from the toolbar, with the same
three-part rhythm: *what to write out*, *for which shots*, *where it goes*.

```
Export ─────────────────────────────────────────────────────────
 what        [x] full-size originals   [x] clips
             [ ] board copies (854×480)  [ ] reference sets, per shot
             [ ] shot list (CSV)         [ ] contact sheet (PDF)
             [ ] manifest (what made each one)
 which       (o) whole board  ( ) this scene  ( ) selected shots
             [x] only what was made in here (11 stills · 4 clips)
 naming      (o) 0007.webp — serial      ( ) 1C_0007.webp — shot code first
 where       [ Choose a folder… ]  or  [ Download ]
             ────────────────────────────────────────────────────
             15 files · 31 MB          [ Export ]
             ⚠ 1 clip is a link, not a file — fetch it first
```

Notes that matter more than the layout:

- **A folder picked at export time is not a connection.** `showDirectoryPicker` is called
  inside the click, used, and forgotten — no handle is stored, nothing is remembered between
  sessions. That is the whole difference between this and the thing that was just removed.
- **Downloads are the fallback**, exactly as `downloadFeed` works today, for a browser or a
  context where the picker is unavailable. Forty downloads is unpleasant but it is never
  nothing.
- **Say what you got.** Every export reports counts and says when something fell back to the
  board copy — a board carrying folder-era frames has originals it cannot produce, and an
  export that quietly shipped 854×480 in place of 4K is the same class of bug as the folder
  it replaced.
- **The names come from `SB.Renders.fileName` and `slug`**, which are already the one place
  naming is decided, and already survive scripts other than Latin.
- **Nothing new is stored.** The panel is a reader: everything it writes is already in the
  file, so there is no state to migrate and no way for an export to change a board.
- **The manifest is the point of the generated-only export.** One JSON (or CSV) beside the
  files: shot code, serial, filename, kind, model, slug, the prompt it was made from, and
  when. That is what makes a folder of AI output auditable a month later, and it is the
  thing nobody can rebuild from the pictures alone.
- **Link-only clips are called out before the export runs**, not discovered afterwards —
  the footer counts them and offers the fetch, because the link is the part with a clock
  on it.

## Where it plugs in

| Piece | Where it is now |
|---|---|
| `js/exportoptions.js` | the PDF preset options — becomes a tab of this panel, not a separate dialog |
| `js/pdf.js` | print sheets, unchanged; the panel calls it |
| `board.js` `saveFeed` / `downloadFeed` | today's one exit; moves here and keeps working from the card |
| `SB.Renders.dataUrl / fileName / slug / weigh` | everything the panel needs to read and name; `weigh()` already gives the size estimate for the footer |
| `render.made` / `video.made` | the generated-only filter and the manifest; written since the ImagineArt push |
| `SB.Imagine.fetchClip` | the "one clip is still a link" warning in the footer acts through it |

## What it does not do

Not a sync, not a "publish", not a second copy the board has to keep track of. It writes
files out and forgets them. The `.storyboard` stays the only thing that has to be kept.

---

## What shipped, and what did not

Built as described: originals, clips, board copies, per-shot reference sets, the CSV shot
list, the manifest, the generated-only filter, both naming schemes, folder-or-download, and
a footer that counts link-only clips and folder-era gaps before anything is written. The
pure half is `SB.ExportPanel.plan(project, options)` — it returns the exact file list, which
is what the panel renders and what the tests assert against.

Left out on purpose:

- **The PDF is still its own dialog**, reached by a button on the panel. Absorbing
  `exportoptions.js` wholesale would have meant rebuilding its live preview inside a panel
  that otherwise writes files; the seam is honest and the click count is the same.
- **No zip.** Folder-or-download covers both real cases without a compression library, and
  PNG/JPEG/WebP/MP4 do not compress twice.
- **No "package the board"** (the `.storyboard` plus its assets in one folder) — the file
  already carries everything, so the package is the file. If handing someone a folder they
  can open without the app ever becomes the ask, it is one more checkbox here.
