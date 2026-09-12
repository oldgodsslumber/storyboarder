# Export names the files by shot code — plan

Status: **planned, not built.**

## Why

An export hands somebody a folder. The person opening it is cutting the film, and the thing they
need from a filename is *which shot is this and where does it go* — which is `1A`, `1B`, `1C`,
the same codes on the board, in the PDF, in the CSV and in every conversation about the edit.

What they get instead is `0007.webp`. The serial is a real number with a real job (below), but it
is the app's number, not the edit's, and nothing outside the manifest connects it to a shot.

Half of this already exists and is the wrong half. `opts.naming` has two modes today
([exportpanel.js:46](js/exportpanel.js#L46)), and the `code` mode **prefixes** rather than
renames: `1C_0007.webp`. That is the belt-and-braces answer to a question nobody asked; the ask is
`1C.webp`.

## What the serial is for, and why this does not delete it

`renderSeq` is a high-water mark that only ever goes up, and
[model.js:403](js/model.js#L403) says why in as many words:

> *A number belonging to a deleted shot is never handed out again, so a file that has already left
> the app never comes to mean something else.*

A shot code is the exact opposite of that. It is **positional** — `code(sceneIdx, shotIdx)` — so
inserting a shot at the top of scene 1 renames every file after it. `1B.mp4` from this morning and
`1B.mp4` from this afternoon can be two different shots.

That is not a reason to refuse; it is the reason editors want codes in the first place, and the
board's order is what they are cutting to. But it means the plan has to carry three things the
serial gave away for free: a way back to the serial, a way to sort, and something said out loud
about re-exporting into a folder that already has yesterday's names in it.

**The serial stays exactly as it is inside the file.** Nothing about storage changes. This is a
naming decision at the moment bytes leave the app, and nowhere else.

## The three modes

`opts.naming` becomes three, and the panel's radios say what each one produces:

| mode | frame | clip | why |
|---|---|---|---|
| `code` **(new default)** | `1A.webp` | `1A.mp4` | what the edit calls it |
| `code-serial` | `1A_0007.webp` | `1A_0012.mp4` | the code, and a name that can never collide |
| `serial` | `0007.webp` | `0012.mp4` | what the app calls it; a clip sorts beside its frame |

`nameFor()` ([exportpanel.js:85](js/exportpanel.js#L85)) is the only place that has to know. The
existing `code` mode becomes `code-serial` — nobody loses the naming they had, it just stops being
the one called "code".

## Making it actually sort

This is the half that makes it useful to an editor, and the half a straight rename does not give.

`1A`, `2A`, `10A` sorted by name is `10A`, `1A`, `2A` — `"0"` sorts before `"A"`. Past 26 shots in
a scene, `SB.letters()` gives `AA`, and `1AA` sorts before `1B`. So on any board bigger than nine
scenes or twenty-six shots, "rename them to their codes" produces a folder in the wrong order,
which is precisely the thing this is for.

**Pad the scene number to the widest one in the export.** A board with nine scenes or fewer gets
exactly what was asked for — `1A`, `1B`, `2A`. A board with twelve gets `01A`, `10B`, and sorts.
No new option, no decision to make, and the common case is the literal thing requested.

The letters are left alone. Twenty-seven shots in one scene is rare enough that the honest answer
is a note in the export panel rather than `1_A`/`1AA` padding that makes every normal board ugly.

**What this costs:** a board that crosses from nine scenes to ten renames every exported file. The
manifest is the map back, and the panel should say so where the naming is chosen.

## Collisions

Serial names cannot collide. Code names can, in one place: a card whose **original** and **board
copy** are both exported are both images for the same code.

Today that is `0007.webp` and `1C_board.jpg` — different by accident. Under `code` it is `1A.webp`
and `1A.jpg`, which do not collide either, unless the board copy happens to share the extension.
So: the board copy keeps its suffix — `1A_board.jpg` — and the rule is stated rather than relied
upon.

Everything else is already safe. A frame and a clip differ by extension. Reference sets live under
`refs/<code>/` with their own per-feed numbering
([exportpanel.js:185](js/exportpanel.js#L185)). Download mode flattens `sub` into the name
([exportpanel.js:333](js/exportpanel.js#L333)), which keeps them distinct.

**A guard is still worth writing**: `plan()` already builds the whole list before anything is
written, so it can check for duplicate names and refuse with the pair that clashed, rather than
discovering it as a silent overwrite in somebody's folder.

## What has to say both names

- **The CSV** ([exportpanel.js:267](js/exportpanel.js#L267)) puts the *serial* filename in its
  `Original` and `Clip` columns. Those must become the name actually written, or the shot list
  hands an editor filenames that are not in the folder. Add `Original serial` / `Clip serial`
  columns beside them — the CSV is the sheet somebody keeps.
- **The manifest** ([exportpanel.js:276](js/exportpanel.js#L276)) already records `file`, `shot`
  and `serial` per entry, which is exactly the map back. It needs nothing but a check that `file`
  is the final name.

## Re-exporting into a folder that already has an export in it

Under serials this was safe by construction. Under codes it is not, and the app knows enough to
say so: in folder mode it is writing into a directory it can read first.

Before writing, count how many of the planned names already exist there. If any do, say it in the
confirmation — *"9 of these 14 names are already in that folder and will be replaced. If that
export was made before the board was reordered, they are not the same shots."* — and let them go
ahead. One sentence, at the only moment it can be acted on.

## Code to change

| File | Change |
|---|---|
| `js/exportpanel.js` | `nameFor()` takes the mode and the scene-width; `plan()` computes the width once and passes it; the third radio; the duplicate-name guard; the CSV columns; the folder-overwrite count |
| `js/model.js` | nothing — `code()` is already the one definition |
| `js/renders.js` | nothing — `fileName()` and `slug()` stay exactly as they are |
| `js/pdf.js` | nothing — the contact sheet already labels cards by code and never mentions a serial |

Small enough to be one commit, which is worth saying: it is a naming decision at the edge of the
app, not a change to how anything is stored.

## Tests

- `test-export.mjs` — the three modes over one fixture: `1A.webp` / `1A_0001.webp` / `0001.webp`.
- Padding: a nine-scene board gives `1A`, a ten-scene board gives `01A`, and a sort of the planned
  names comes back in board order (the assertion that actually matters).
- An original and a board copy on one card do not collide, and the board copy keeps `_board`.
- The duplicate guard fires on a fixture built to collide, and names both files.
- The CSV's `Original` column equals the name in the plan for that row, under every mode.
- `refs/` naming is unchanged under all three.

## Order of work

1. `nameFor()` and the scene-width, with the three modes and the tests. This is the whole feature.
2. The CSV columns and the manifest check.
3. The duplicate-name guard in `plan()`.
4. The folder-overwrite count, which is the only part that touches the writing path.

## Open

**Should `code` or `code-serial` be the default?** `code` is what was asked for and what an editor
wants. `code-serial` can never collide, never renames on a reorder, and still sorts and still says
the shot — at the price of eight uglier characters. The plan above defaults to `code` on the basis
that the request was explicit; it is one line to change.
