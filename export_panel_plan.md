# The export panel — plan

Status: **planned, not built.** Written the day the originals moved inside the `.storyboard`
(branch `V3`), because that move is what makes this panel necessary.

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

## What people actually need out of a board

Named in the order they come up on a real job:

1. **Every original, as files.** `0007.webp` and the rest — the serials are already the
   names. For an editor, for an archive, for re-feeding a model outside this app.
2. **The clips**, same thing, and the same names — so a clip and the frame it came from sort
   next to each other.
3. **One shot's reference set**, numbered in feed order — what "copy image set" does today,
   which the panel should absorb rather than duplicate.
4. **Contact sheets / the PDF**, which already exist in `js/pdf.js` and belong on the same
   panel, because "export" is one idea to the person doing it even if it is two code paths.
5. **The board as a package** — the `.storyboard` plus a folder of originals and clips, for
   handing to someone who does not have the app.
6. **A shot list**, plain text or CSV: code, type, description, both prompts, the model each
   was written for. This is what gets pasted into a call sheet or a ticket.

## Shape

A takeover panel like the Prompts table, opened from the toolbar, with the same
three-part rhythm: *what to write out*, *for which shots*, *where it goes*.

```
Export ─────────────────────────────────────────────────────────
 what        [x] full-size originals   [x] clips
             [ ] board copies (854×480)  [ ] reference sets, per shot
             [ ] shot list (CSV)         [ ] contact sheet (PDF)
 which       (o) whole board  ( ) this scene  ( ) selected shots  ( ) shots with a clip
 naming      (o) 0007.webp — serial      ( ) 1C_0007.webp — shot code first
 where       [ Choose a folder… ]  or  [ Download ]
             ────────────────────────────────────────────────────
             38 files · 47 MB          [ Export ]
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

## Where it plugs in

| Piece | Where it is now |
|---|---|
| `js/exportoptions.js` | the PDF preset options — becomes a tab of this panel, not a separate dialog |
| `js/pdf.js` | print sheets, unchanged; the panel calls it |
| `board.js` `saveFeed` / `downloadFeed` | today's one exit; moves here and keeps working from the card |
| `SB.Renders.dataUrl / fileName / slug / weigh` | everything the panel needs to read and name; `weigh()` already gives the size estimate for the footer |

## What it does not do

Not a sync, not a "publish", not a second copy the board has to keep track of. It writes
files out and forgets them. The `.storyboard` stays the only thing that has to be kept.
