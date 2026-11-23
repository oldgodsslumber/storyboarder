# PowerPoint slides export — plan

Status: **planned**. A fifth export: the board as a `.pptx` deck, laid out **three or six
frames a slide**. Unlike the four existing documents, the output is a real file the browser
downloads, not an HTML page handed to Chrome's print dialog — so it gets its own small module
[js/pptx.js](js/pptx.js) and its own button, not a new `doc:` value on the PDF dialog.

## Why

Everything the board makes today is either **print** (contact sheet, references, shot list —
all HTML through [js/pdf.js](js/pdf.js) → Chrome's *Save as PDF*) or **loose files** (originals,
clips, CSVs — written to a folder by [js/exportpanel.js](js/exportpanel.js)). What neither
produces is the object a director or client actually presents from and marks up in a meeting:
a slide deck. A PDF contact sheet is for printing; a `.pptx` is for *projecting and editing* —
the people on the other end drag frames around, retype a caption, drop in a slide. That is a
different deliverable, and it is the one most often asked for when a storyboard goes to a
pitch or a review.

The classic shape for that deck is the **panel strip**: three big frames across for a beat, or
a six-panel 3×2 grid for a denser pass. Both are 16:9 widescreen — PowerPoint's own default —
so the deck opens full-bleed with no reformatting.

## What the data already gives us

This is a new **packaging** of the same per-shot data the contact sheet already lays out, so
there is no new model state:

- **Order, code, frame, type, description, scene, stock/blocking tags** — all of it is exactly
  what `cells()` in [js/pdf.js](js/pdf.js) already returns (`{code, scene, type, img, blocked,
  stock, script, desc, …}`, skipping `noShot`). The slide builder consumes that list unchanged;
  the first thing to do is **export `cells` from `SB.Pdf`** (it already is) and call it.
- **Frame bytes** — `SB.Blobs.src(p, sh.image)` is the ≤480p proxy the board draws; optionally
  `SB.Renders.dataUrl(p, sh.render)` for the full-size original where the board has one (a
  projected deck wants the crisp frame). Same fallback to the 3D blocking image
  (`sh.pose.image`) the sheets use.
- **Caption toggles** — reuse `showType` / `showScript` / `showDesc` / `showSceneHeading` from
  `defaultExport()` ([js/model.js](js/model.js)); the caption under each panel is the same text
  the card's meta bar and boxes print.
- **Scene grouping** — `sc.heading` + `SB.Refs.plain(p, sc.description)`, same as the scene
  banner, for an optional section slide.

No schema bump. New options live beside the rest of `defaultExport()` so they travel in the
`.storyboard` like the PDF options do.

## The format, concretely

A `.pptx` is a Zip (OPC package) of XML parts plus the image media. The app already has a
**store-only Zip writer**, [js/zip.js](js/zip.js) (`SB.Zip.store([{name, data}]) → Blob`), and
PowerPoint, Keynote and Google Slides all open store-only (uncompressed) packages — frames are
already-compressed JPEG/PNG, so deflate would buy almost nothing anyway. **No new library.**

The package is mostly fixed boilerplate written once, plus two things that vary per deck
(the slide list) and per slide (the shapes):

```
[Content_Types].xml                 overrides: one <Override> per slide + default jpeg/png
_rels/.rels                         → ppt/presentation.xml
ppt/presentation.xml                <p:sldIdLst> one entry per slide; <p:sldSz cx=12192000 cy=6858000/>  (16:9)
ppt/_rels/presentation.xml.rels     → master, theme, each slide
ppt/presProps.xml                   (empty-ish, fixed)
ppt/theme/theme1.xml                one minimal theme (fixed)
ppt/slideMasters/slideMaster1.xml   + .rels → layout, theme   (fixed)
ppt/slideLayouts/slideLayout1.xml   + .rels → master          (one blank layout, fixed)
ppt/slides/slideN.xml               + ppt/slides/_rels/slideN.xml.rels → its images
ppt/media/imageN.jpg                the frame bytes
```

Everything but the four lines above (`presentation.xml`, its rels, the per-slide XML, and the
content-types overrides) is a constant string template. The only arithmetic is **EMU
geometry**: 914400 EMU to the inch, slide 12192000 × 6858000. A panel is a `<p:pic>`
(`<a:blipFill><a:blip r:embed="rId_N"/>` → the media rel) sized to a 16:9 box with
`object-fit: contain` emulated by fitting the box to the frame's aspect; its caption is a
`<p:sp>` text box directly under it. Positions come from a tiny grid helper (cols, rows, gaps,
margins) — the same mental model as the CSS grid in `sheetCSS`, in EMU instead of mm.

## What changes

### 1. The 3/6 model — `slidePreset`

Two presets, both landscape 16:9, mirroring `PRESETS` in pdf.js but tuned for a projected
slide rather than a printed sheet:

- **`six`** (default) — **6 panels, 3 across × 2 down.** The dense storyboard slide; caption is
  a one/two-line strip under each frame (code · type, then a clamped description).
- **`three`** — **3 panels, 3 across × 1 row.** The beat strip; bigger frames, room for the
  script snippet and a fuller description under each.

Stored as `slidePreset: 'six'` in `defaultExport()`. (A later `one` — one frame a slide, the
pitch/animatic cut — is an obvious third entry but out of scope for v1; see below.)

### 2. `js/pptx.js` — the builder

A new module, `SB.Pptx`, pure except for the final download, so the parts are testable in Node:

- `plan(p, o)` → `{ slides: [...], count }` — walks `SB.Pdf.cells()`, groups by scene when
  asked, chunks each run into panels-per-slide, and returns a flat slide list of
  `{ kind: 'panels'|'section', panels: [...], scene }`. This is the pure spine the tests hold.
- `slideXml(slide, i, grid, o)` → the `ppt/slides/slideN.xml` string and its rel list.
- `pkg(p, o)` → `[{name, data}]` — the full part list (fixed templates + the generated slides +
  media), ready for `SB.Zip.store`.
- `build(p, o)` → `Promise<Blob>` — resolves the media first (see §4), then `SB.Zip.store(pkg)`.
- `exportPptx(o)` → `build()` then a download `<a>` named `<slug>.pptx`, the same download path
  the export panel already uses.

### 3. `SB.PptxOptions` — a compact dialog

A sibling of [js/exportoptions.js](js/exportoptions.js), opened from a new **"Slides
(PowerPoint)…"** button in the Export panel's **"on paper"** group (beside "Contact sheet
(PDF)…", [js/exportpanel.js](js/exportpanel.js) `renderNow()`). It offers:

- the **3 / 6** preset,
- the caption toggles (type / script / description / scene heading), reused as-is,
- **originals where available** (default off) — embed the full-size frame instead of the proxy,
- **a section slide per scene** and **start each scene on a new slide** (the `sceneBanner` /
  `scenePageBreak` pair, reused), and
- **footer** (board · version · N) reused.

**Preview:** PowerPoint can't render in an iframe, so the preview is an **HTML approximation**
of the slide — the same grid-of-panels drawn in CSS, honestly labelled "approximate layout —
the .pptx is editable." It reuses the panel markup, so what you see is the arrangement the
deck ships with, minus PowerPoint's own font metrics. (Alternative considered: fold these into
the existing PDF dialog as a sixth `doc`. Rejected — the Export button there *prints*, and a
file download wants its own verb and its own button.)

### 4. Image compatibility — the one real gotcha

Board proxies are often **WebP**; older PowerPoint chokes on WebP media. So `build()` runs each
frame through a canvas and emits **JPEG** (`image/jpeg`, quality ~0.86) — already the app's
idiom (`SB.Blobs`, canvas re-encode) — keeping `image/png` only where transparency matters
(it doesn't, for frames). That is also where originals-vs-proxy and the blocking/stock fallback
are resolved, so the media list and the slide rels are built from one decode pass. Missing
frames become a labelled empty panel (a grey box with the code), exactly as the sheets print
"no frame" — never a broken image in someone's deck.

### 5. Tests

Extend [test-export.mjs](test-export.mjs) with a Node pass over a fixture board (frames stubbed
as tiny data-URL JPEGs so no canvas is needed — inject the decode step, or let `pkg` take
pre-resolved media):

- `plan()` chunks correctly: 7 shots at `six` → 2 slides (6 + 1); at `three` → 3 slides; a
  section slide appears once per scene when asked; `noShot` cards drop out.
- `pkg()` is a **well-formed OPC package**: `[Content_Types].xml` present with an `<Override>`
  for every `ppt/slides/slideN.xml` and a default for `jpeg`; `presentation.xml` has exactly
  `count` `<p:sldId>` entries and the 16:9 `<p:sldSz>`; every `r:embed` in a slide resolves to
  an entry in that slide's `.rels`, and every rel target exists in the part list.
- The bytes round-trip through `SB.Zip.store` → a Blob whose central directory lists every
  part (reuse the zip's own CRC path; no unzip library needed for the structural checks, which
  run on the part list before zipping).

A manual open in PowerPoint / Keynote / Google Slides is the acceptance check the automated
pass can't give — called out in the status line when built.

### 6. Build + ship

New file `js/pptx.js` and `js/pptxoptions.js` → add two `<script>` tags to
[index.html](index.html) (unlike the shot list, this is genuinely new code, not an edit to
pdf.js), then `node build.mjs` folds them into `storyboarder.html` and re-stamps every asset
`?v=` — the standing cache rule, or the deck button never appears in the browser.

## Deliberately left out (v1)

- **One-frame-a-slide / animatic cut.** A natural `slidePreset: 'one'` (full-bleed frame, caption
  below), and the seam for a later animatic that reads clip durations into slide timings. Easy
  third preset; not needed to ship the 3/6 ask.
- **Speaker notes from the script.** The script window could fill each slide's notes pane
  (`ppt/notesSlides/…`) — a clean add once the panel path is proven, but another part family to
  template.
- **Scope (scene / selected).** The PDF dialog exports the whole board; this matches it. Scene
  and selection scoping already exist in the export panel and can be threaded through `plan()`
  later with no format change.
- **Theme / brand colours.** v1 ships one neutral theme and the card accent on the caption
  strip (reusing `CARD_COLORS`); a branded master is a template swap, not new machinery.
- **PDF-of-the-deck.** Redundant — the contact sheet already is the printed form.
