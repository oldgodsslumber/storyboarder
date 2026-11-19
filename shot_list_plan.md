# The shoot shot list — plan

Status: **built (2026-11-19)** — toolbar → **PDF** → Print: *Shot list*. Code in
[js/pdf.js](js/pdf.js) (`listPages`), dialog in [js/exportoptions.js](js/exportoptions.js),
covered by test-core ("the shot list is the page carried on the day") and ui-scenario. A
printable, on-set shot list: one row per shot, a small frame, grouped by scene, with an empty
tick-box to check off as each is in the can. Print only — no in-app tracking, no state
written to the file (confirmed with the user).

**Changed while building:** the planned "Dur." column was dropped. A card's duration is the
AI generator's clip length, not how long the shot runs on set, so it would mislead a crew. An
optional **Cast** column (people on the card, by name; places and objects left out) replaced
it. Rows are fixed-height and paginated in pdf.js, not left to the browser as a flowing
table (§3 below). That way a scene band never sits alone at the foot of a page, and the
dialog's sheet count is exact.

## Why

The board prints beautifully as a storyboard — contact sheets, script-pass sheets, a
presentation — all through [js/pdf.js](js/pdf.js) and the options dialog in
[js/exportoptions.js](js/exportoptions.js). And the export panel can already drop a
`-shots.csv` ([js/exportpanel.js](js/exportpanel.js) `csv()`), which is the right data for
an **editor** but the wrong object for a **shoot**: a crew on set does not open a spreadsheet,
they hold one page and tick boxes.

What's missing is the thing an AD actually carries to set: every shot in order, scene by
scene, each with a thumbnail small enough that five or six fit on a line of sight, and a box
to mark done. The storyboard sheets are too big (2–12 cards a page) and have no way to track
progress; the CSV has no picture and no box. This is a third document, not a preset of either.

**Tested (2026-11-19)** by two independent passes: 128 option combinations across 52 boards
in Node, and real Chrome measurement plus Letter/A4 PDF prints. The fixed heights held
exactly. Fixes that came out of it: the title block and footer stay one line and end in an
ellipsis, because a long project name used to wrap them and push an extra page onto Letter.
Unbroken words wrap inside their cell. A long custom type clamps like the text columns, and
"(continued)" survives a long heading. Empty name or version leaves no stray "·". The "nothing
to shoot" sheet keeps its header and footer. Description and notes split the spare width 3:2.
The dialog preview leaves room for its scrollbar (that also fixes the storyboard preview's
clipped right edge).

## What the data already gives us

Everything the row needs is on the shot and reachable the same way the contact sheet reaches
it — so this is a new **layout** over existing data, not new model state:

- **Order and code** — `SB.Model.code(sceneIdx, shotIdx)` → `1A`, `2C`, matching the board,
  the storyboard sheets and the CSV. Scenes are `p.scenes[]`, shots `sc.shots[]`, already in
  shoot order.
- **Thumbnail** — `SB.Blobs.src(p, sh.image)` is the ≤480p proxy the board draws; falls back
  to the 3D blocking frame (`sh.pose.image`) exactly as `cells()` in pdf.js does, tagged so
  clay is never mistaken for a final frame.
- **Type** — `sh.type` (Wide / Close-up / …).
- **Description** — `SB.Refs.text(p, sh)`, the same resolved text the sheets print.
- **Scene heading + description** — `sc.heading`, `SB.Refs.plain(p, sc.description)` for the
  band at the top of each scene's block.
- **Shoot hints (optional column)** — `SB.Model.windowFor` / `sh.shoot` already carry
  duration/resolution where a card overrode the board; a "Dur." column is a cheap add.
- **Skips** — `sh.noShot` cards drop out, same rule as the sheets.

No `done` flag, no new fields, no schema bump. The tick-box is an empty printed square.

## What changes

### 1. A new document type: `doc: 'shotlist'`

`defaultExport().doc` in [js/model.js](js/model.js) stays `'board'`; the dialog gains a fourth
choice. In [js/exportoptions.js](js/exportoptions.js) `open()`, the document `<select>` that
today offers board / refs / both gains **"Shot list — for the shoot"**. A third options
group, `listWrap` (sibling of `boardWrap` / `refWrap`), shows only when `doc === 'shotlist'`
and is hidden otherwise in `draw()`. The live preview (`SB.Pdf.html` into the preview window)
and the shot/ref count line work unchanged — `layout()` just reports the new page count.

### 2. Shot-list options (small, its own set)

Stored on the export object beside the board/ref options so they travel in the file like the
rest of `defaultExport()`:

- `listThumbs` (default **on**) — show the frame column. Off = a dense text-plus-boxes list.
- `listDesc` (default **on**) — the description column; off for a one-line-per-shot sheet.
- `listType` (default on), `listDur` (default off) — the thin columns.
- `listScenePageBreak` (default off) — each scene starts a fresh page (big shoots, one scene
  a day).
- `listNotes` (default off) — a blank wide "Notes" column for on-set jots, printed empty.
- `footer` — reused as-is (name · version · page N of M).

Thumbnail size is fixed by the layout (a shot list is a known shape); no preset dropdown.

### 3. `shotlistPages(o)` in pdf.js

A new builder beside `boardPages` / `refPages`, returning the pages' HTML. Reuses the existing
machinery rather than inventing a second one:

- **Rows** — walk `p.scenes` → `sc.shots`, skip `noShot`, build a flat list of
  `{code, img, blocked, type, desc, dur, sceneIdx, sceneFirst, heading, sceneDesc}` — the same
  shape `cells()` already produces, so the thumbnail/blocking/stock logic is shared (extract
  the per-shot bit of `cells()` into a helper both call).
- **Grouping** — a full-width **scene band** row (`heading` + `sceneDesc`) before each scene's
  first printing shot, the same idea as `bannerHTML`/`sceneBanner` already on the sheets.
- **Table** — clone the `table.feed` pattern that the reference-mapping page already uses
  (`feedRows()` + its CSS block in `refCSS`): `<table class="shotlist">` with a thead
  (**✓ · Shot · Frame · Type · Description · [Dur] · [Notes]**) and a `<tbody>`. The tick
  column is a cell holding an empty `<span class="box">` (a ~6mm bordered square,
  `print-color-adjust:exact`). Rows are `break-inside:avoid`; the thead repeats per printed
  page via `thead{display:table-header-group}`, so no hand pagination — the table flows and
  the browser breaks it, unlike the grid sheets which must be paginated by `paginate()`.
- **Frame cell** — `<img>` at a fixed box (~26×15mm, 16:9) with `object-fit:contain`;
  blocked frames tagged `clay`, stock tagged like the sheets.

### 4. `shotlistCSS(o)` and the wiring in `html()` / `layout()`

- `shotlistCSS` — a trimmed sibling of `refCSS`: `@page{size:portrait;margin:12mm}`, the
  shared body/page chrome, the `table.shotlist` rules, `.band` (scene header row), `.box`
  (the tick square), `.clay`/`.warn` reused. Portrait by default (a list reads down a page).
- `html(o)` — add the `o.doc === 'shotlist'` branch alongside the `refs`/`both` branches:
  title `"<name> — shot list"`, `shotlistCSS` + `shotlistPages`.
- `layout(o)` — report `shots` (already computed) and page count so the dialog's preview and
  count line light up; `exportPdf(o)` opens the print window unchanged (it is doc-agnostic —
  it just writes `html(working)` and calls `window.print()`).

### 5. Tests

Extend [test-export.mjs](test-export.mjs) (or a small `test-pdf`-style check) with a Node
pass that builds `html({doc:'shotlist'})` on a fixture project and asserts: one `.band` per
scene with shots, one `<tr>` per non-`noShot` shot, a `.box` in every shot row, the shot
`code`s present and in order, and the thumbnail `<img>`/`clay` fallback chosen correctly. The
PDF layer has no DOM, so this is string assertions over generated HTML, same as the existing
export tests.

### 6. Build + ship

Edit under `js/`, run `node build.mjs` to fold into `storyboarder.html`, bump the `?v=` cache
stamp on every `<script>` in [index.html](index.html) (the project's standing rule — the fix
never reaches the browser otherwise). No new `<script>` tag: the code lands in the existing
[js/pdf.js](js/pdf.js) and [js/exportoptions.js](js/exportoptions.js).

## Deliberately left out

- **In-app check-off / progress tracking.** The user chose print-only; the box is ink. No
  `done` flag, no localStorage, nothing added to the `.storyboard`. If that changes later, a
  per-shot flag + an interactive view is a clean second phase that reuses this same row model.
- **A new preset dropdown.** A shot list is one shape. The handful of toggles above cover the
  real variation (thumbs, description, notes column, per-scene page break) without a preset
  table to maintain.
- **Reordering / call-sheet fields (cast, location, time of day).** Out of scope for v1 — the
  list is the storyboard's shoot order with pictures and boxes. Cast is derivable from
  `sh.personaIds` later if wanted as an optional column.
