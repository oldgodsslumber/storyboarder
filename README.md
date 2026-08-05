# Storyboarder

A local, single-file storyboarding tool for client-success videos. Chrome/Edge only.
No server, no accounts, no Firebase — the whole project is one `.storyboard` JSON file
on your machine.

Built from [storyboard_app_spec.md](storyboard_app_spec.md).

## Run it

- **Shippable:** open `storyboarder.html` (everything inlined — hand this file to anyone).
- **Development:** open `index.html` (same app, split into `css/` + `js/`).
- **Rebuild the single file:** `node build.mjs`

## First run

1. **Save as…** → pick where the `.storyboard` file lives. From then on every change
   autosaves to that file (~500 ms after you stop typing). There is no Save button.
   **Copy** downloads a standalone duplicate at any time — the escape hatch if a file
   ever becomes unwritable.
2. **Settings** → paste your Google (Gemini) API key. It is stored in this browser only
   and is **never** written into the project file, so a board can be shared safely.
3. Re-opening the app offers to reopen the last project — click the file name in the
   top bar (Chrome requires a click to re-grant file permission).

### Opening from file:// (and why the app forgets your project)

IndexedDB does not work on `file://` in Chrome — it neither succeeds nor errors, it simply
never answers. That is where the app stores the handle to your last project, so **opened as
a local file, Storyboarder cannot remember your board between sessions**: use **Open…** each
time. The top bar says `no file — Open…` when it detects this. Autosave itself is
unaffected — it works normally as soon as a file is open.

Serve the folder over http (any static server) and the reopen-last-project prompt returns.

### How images are stored

Every image — shot frames, persona references, comment ink — is stored **once**, under a
hash of its bytes, in a `blobs` map on the project. Shots and personas hold a short
reference. The map lives inside the `.storyboard` file, so a board is still one thing you
can hand to someone.

Two consequences:

- **Cutting a version is nearly free.** A version snapshot used to deep-copy every frame it
  froze — on a measured board that was 47% of the file. It now copies references: a new
  version costs a few hundred bytes instead of hundreds of kilobytes.
- **The same picture used twice costs once.** A persona reference frame on ten shots is
  stored once.

Old files migrate on open, and identical bytes collapse automatically — a test board went
from 182 KB to 74 KB with nothing else changed. Nothing above this layer knows where the
bytes live, so when a board goes online those same references become object-store keys.

### How the file is protected

- Writes go through a swap file opened with `keepExistingData`, then truncate to length, so
  a write that fails part-way can never leave a 0-byte project.
- A save that fails **stops the app and says so**, offering a rescue download — it is never
  reported only in the small status label.
- The app refuses to write an empty or unserialisable project over a real one.
- A project file that will not open is reported as an error. The blank board you get is
  never silently treated as your project, and your file is not written over.

## How the script sync works

There is one canonical **master script** per project. A shot's script box is not a copy —
it is an **anchored range** into the master:

- Type in the master or in *any* shot box; every window covering those characters updates,
  master included.
- **Overlapping ranges are supported** — a master shot and an insert shot can share text.
  Editing shared text updates both; editing a unique region updates only that shot.
- Anchors are transformed through every edit (never re-found by string matching), so they
  survive insertions and deletions elsewhere in the document.
- Typing at a shot's **trailing edge grows that shot**; typing at its leading edge grows it
  too when you type inside that shot's own box.
- Deleting the master text that a shot points at leaves the box **flagged “link broken”**,
  not silently blank.
- **Break link** turns the box into freestanding local text that syncs to nobody.
- Deleting a *shot* leaves its text in the master script.

Master-script highlighting shows what is captured: light = one shot, stronger = two,
amber = three or more. The selected card's range gets an amber underline.

**Capture** remembers the last selection you made in the script, so clicking a card (or a
dropdown, or anything else) in between doesn't lose it — the button only goes dark when
there is genuinely nothing selected. Any edit to the script clears it.

**Ctrl+Z / Ctrl+Shift+Z** undo and redo script edits, and the ↶ ↷ buttons in the script
panel do the same. A run of typing collapses into one step. Undo covers script *text* only —
it will never make a card or scene reappear or vanish.

## Board

- Scenes auto-number, shots auto-letter inside their scene: `1A 1B 1C`, `2A`…
- Drag a card by its header to reorder it or move it to another scene. Any of these are a
  valid drop: another card, a scene's shot row, a scene's **heading**, its *+ Add shot*
  button, or **the scene in the left-hand list** — the last one is the quickest way to
  reach a scene that is scrolled off the board. The board auto-scrolls while you drag near
  its top or bottom edge, and every valid target lights up. Drag scenes in the left list to
  reorder them. Everything renumbers automatically.
- Images: drop, paste (with a card selected), or click the frame. Everything is downscaled
  to a ≤480p JPEG proxy and stored inline — no full-res copies anywhere.
- Card colour washes the **whole card**, not a stripe down its edge. It's a fixed palette of
  ten mid-tone hues, mixed into the card surface at a strength chosen per theme so text and
  the text boxes keep their contrast. Click the swatch in a card's header.
- Rich text in the script box is **Ctrl+B / Ctrl+I / Ctrl+U** only, by design — no toolbar.
- **no shot** marks a fragment that stays on the board but is excluded from prompt
  generation and from the PDF.

## Card fields

Every board wants something different under the description, so the set of extra text boxes
is **per project** and lives in the project file. **Settings → Card fields**:

- Ships with **Art direction**, **Context** and **SFX**, all switched off — turn on what this
  board needs.
- **+ Add a field** for anything else; custom fields can be renamed and removed. Removing one
  tells you how many cards have text in it before it goes.
- Values live on the shot, so switching a field off hides it without losing what you wrote.

Anything filled in is **handed to the prompt writer** — art direction only the storyboard can
see isn't much use. Each field also gets a template placeholder shown next to it
(`{{ART_DIRECTION}}`, `{{SFX}}`, `{{CLIENT_NOTE}}` from a field called "Client note"), plus
`{{FIELDS}}` for all of them at once. If a model template doesn't place a field itself, the
filled-in ones are appended to that request automatically rather than being dropped.

## Comment mode

Toggle **Comment mode** to add comments under a card and to draw over a frame. Ink is kept
as a transparent PNG layer on top of the image, never baked into it. Comments and ink
belong to the current version.

### Comments on the script

Comment mode also opens the script. Select any part of it and press **+ Comment**:

- Commented phrases are **underlined** in the script — captures are a background wash, so a
  line that is both still reads as both. Click a phrase to jump to its note, or a note to
  highlight its phrase.
- A comment is **anchored to the words**, not to a character position. Edit the script above
  it, or inside it, and the comment stays on the phrase it was written about — the same
  anchoring the shot links use, and undo takes the anchors back with the text.
- Typing against either edge of a commented phrase stays outside it, so a note never quietly
  swallows the next sentence.
- If the words a comment points at are **deleted**, the comment is flagged rather than
  disappearing, and still shows what it was written about.
- Script comments belong to the current version, freeze into it, and are listed alongside
  card comments in **Versions → comments**.

## Versions

**Versions → New version…** freezes the whole project (including that version's comments
and ink) and starts the new one clean. You can restore any earlier version — the current
state is auto-saved as a version first — and read a version's comments without restoring it.

## Prompt export

Prompt boxes are **hidden on the cards by default** — cards stay compact until you want
prompts. Everything prompt-related lives in one **Prompts** panel (top bar):

- **Target models** — a first-frame model *and* a video model, chosen independently. The
  image model writes the first-frame prompt; the video model writes the image→video prompt.
- **Write prompts** — tick which of the two to write, choose the scope (whole project /
  selected scene / selected shot), hit **Generate**. Gemini writes them from each shot's
  **description** plus that model's templates. The app never generates images or video.
- **Show on cards** — the two independent hide/show toggles. Generating turns the matching
  one on for you, so results appear as soon as they exist.
- **Prompt writer** — which Gemini model does the writing, picked from a dropdown of the
  current text models (plus *Custom…* for anything not listed), and a **free-call counter**
  for that model.

Gemini is only ever asked for **text**. The app never requests an image or a video from it —
"Nano Banana", "Veo" and friends are *target* names written into the prompt, not endpoints
that get called. The writer dropdown filters out image/TTS/live/embedding/video models for
that reason.

### Model ids and quota

Google retires model ids on its own schedule, so:

- The dropdown ships with the models documented as current (Gemini 3.6 / 3.5 / 3.1 Flash
  family, 3.1 Pro, the 2.5 family, and **Gemma 4 31B**). Default is **gemini-3.6-flash**.
- Gemma runs on the same endpoint but is not a Gemini model — it has no JSON mode, so the
  app asks it for JSON in words rather than sending a response schema, and parses what
  comes back. Any other model that rejects a schema gets the same treatment on retry.
- Opening an older project silently moves it off a dead id (`gemini-2.0-flash`,
  `gemini-flash-latest`, …) onto the default.
- **Settings → API → Refresh list from my key** calls Google's ListModels with your key and
  replaces the dropdown with what that key can actually reach today (cached locally,
  *Back to curated list* undoes it). A 404 from a prompt run says to do exactly this.
- **Free calls** counts every request this browser sent today, per model, resetting at
  midnight. Google no longer publishes the free-tier daily cap per model, so the limit box
  next to the counter is yours to set from your AI Studio rate-limit page — leave it blank
  and you just get a running count. A 429 marks that model spent for the day.

### When a prompt run fails

A run that writes nothing reports **why**, in the panel, instead of "0 of 1 done":

- **No API key** — stops before sending anything and says so.
- **404, the writer model isn't available to your key** — the app then asks your key what it
  *can* reach and rebuilds the writer dropdown from the answer, leaving the unavailable one
  visible and marked. Pick one from the list and run again.
- **429** — names the model that ran out and marks it spent for the day.
- Shots with no description, and "no shot" cards, are skipped with a reason rather than
  silently producing nothing.

### Brand style

The house style lives in **Settings → Brand style** and rides along with every prompt the
app writes, as a system instruction on top of the per-model templates: the creative
constraints, style guidance, camera and technical feel, environment, and overall mood.
It is stored in the project file, so a board carries its own house style. The toggle is in
the Prompts panel (*apply house style*) and in the Settings tab.

The house style is only stored in the project file once you edit it. A board left on the
stock text follows the app, so a correction to the style reaches every board that never
customised it.

Two things the app adds that a style guide can't know on its own:

- **Scene context.** Each request carries the scene heading and note, the scene's beat list
  in order, and which beat this frame is — so the writer isn't composing in a vacuum, and
  the location, lighting mood and grade stay coherent across a scene. "No shot" fragments
  are left out. *Who* is in the frame is the personas layer's job, below.
- **The no-gendered-language rule is verified, not just requested.** Returned prompts are
  scanned for gendered nouns, titles and pronouns; if any appear the app asks for one
  rewrite naming the offending words, and if they survive that, the prompt box gets a
  **gendered** badge listing them. (`human`, `manager` and the like are not false positives.)

Video prompts get the same house style plus motion rules — wardrobe and location must not
change mid-shot, camera moves stay restrained and motivated.

## Personas

**Personas** (top bar) is how the same face and the same clothes come back shot after shot.
Each persona holds a **name**, a **description carrying the wardrobe**, the **reference image
prompt**, and the **reference frame** itself (dropped, pasted or loaded; stored as a ≤480p
proxy like everything else).

- **Generate** reads the master script and the shot descriptions and invents recurring
  people through the house style — names, full wardrobe descriptions, and a reference-frame
  prompt for each. Everything is editable afterwards, and **+ Blank persona** skips the
  model entirely.
- **write it for me** on a persona turns its description into a reference-frame prompt;
  **copy prompt** puts it on the clipboard for whichever image model you're using.
- Cards get a **cast row**: click *+ cast* to tick who appears in that shot. The order you
  add them is the order their reference images are fed.

When a shot has cast, its prompt request carries a CAST block — each person's description
and wardrobe, plus the reference-image wording **that model expects**. That wording is a
per-model field (Settings → Models & templates → *reference-image wording*), because models
differ: Qwen wants "the person in image 1", others want them named. `{{N}}` is the image
number and `{{NAME}}` the names; the app appends the actual mapping (`image 1 = Ops lead`).
A persona with no reference image is described in full instead, so it still stays consistent.

**Preview what a shot sends** in the Brand style tab shows the exact system instruction for
the selected shot, continuity block included.

Prompts are stored **per model**, all at once — switching target models only changes what is
displayed; every model's prompts stay saved. Each card's prompt box names the model it came
from, and *generate* on a box rewrites just that one.

Templates live in **Settings → Models & templates**, collapsed behind a *templates* button
per model so the list stays readable. They accept:
`{{MODEL}} {{SHOT_TYPE}} {{SCENE}} {{SCENE_DESC}} {{SCRIPT}} {{DESCRIPTION}} {{CODE}}`

## Settings

Five tabs: **General** (shot types, light/dark), **Card fields** (the extra text boxes this
project's cards carry), **Brand style** (the house style every prompt obeys),
**Models & templates** (the model list and its per-model image/video templates),
**API** (Google key + the Gemini model used to write).

## Light / dark

The ☀/☾ button in the top bar flips the theme; it also lives in Settings → General. The
choice follows your OS preference on first run and is stored per browser — it is never
written into the project file.

## PDF

**PDF** opens a print view: a contact sheet, 6 shots per page, each cell showing the frame,
shot code, scene heading, shot type, script and description. Comments, ink and “no shot”
fragments are excluded. Print → *Save as PDF*.

The sheet is sized to print whole on **both A4 and Letter** (186 × 251 mm inside 12 mm
margins). Frames are a fixed height so every picture sits on the same baseline whatever its
shape or the length of the text beneath it; any aspect ratio letterboxes inside. Script and
description are clamped to two and three lines with an ellipsis rather than being cut
mid-line, and printing waits for the frames to decode. `test-ui.mjs` renders the sheet into
an iframe and measures it — page count, cell overflow, cell width, image containment,
uniform frame height — so the layout can't quietly rot again.

## Data tracker

The top bar shows what the board currently weighs. Click it for the breakdown:

- **Headline** — total size, what share of it is images, how many times this session has
  saved plus how many bytes that moved, and what deduplication is saving.
- **Where the bytes are** — frames, persona references, comment ink, saved versions, and
  script/prompts/structure. The parts add up to the file exactly (they're measured from the
  string the app actually writes, not estimated), and every part is written out as text as
  well as colour.
- **Heaviest single items** — usually the frames, so you can see which ones.
- **On Firebase's free (Spark) plan** — measured against the published limits, with a
  verdict.

Figures used, checked Aug 2026:

| Limit | Value |
|---|---|
| Firestore document ceiling | **1 MiB (1,048,576 bytes)** — hard, not a quota |
| Spark Firestore storage | 1 GiB |
| Spark writes / reads per day | 20,000 / 50,000 |
| Cloud Storage on Spark | **not available** — needs the Blaze plan |

Sources: [Firestore quotas](https://firebase.google.com/docs/firestore/quotas),
[Firebase pricing](https://firebase.google.com/pricing).

### If this ever goes online

Storing each image once (above) was step one, and it is the one that matters: without it a
board's frozen versions duplicate every frame, and nothing fits anywhere. With it, the plan
that fits the free tier is:

| Piece | Where | Size |
|---|---|---|
| script, structure, prompts | `boards/{id}` | tens of KB — nowhere near 1 MiB |
| each image, by hash | `boards/{id}/blobs/{hash}` | ~45 KB each, each well under the ceiling |
| edits | `boards/{id}/ops/{seq}` | ~100 bytes each |

That sidesteps Cloud Storage, which Spark does not include. Blobs dedupe across versions and
across boards.

**Still to do (step two):** every autosave rewrites the whole board — ~500 KB a write, ~100 MB
in a working session. Every text edit already funnels through one primitive,
`replace(start, end, text)`, with anchors transformed through it, so an append-only op log is
a small step from here and would cut writes to ~100 bytes each. Worth doing when sync is
actually wanted; it buys nothing offline.

## Premiere Pro panel

`premiere-plugin/` is a UXP panel that builds a `.storyboard` file straight from a
sequence — one card per cut, each with a frame grabbed from that shot and the words spoken
under it, taken from an exported transcript. Everything lands in scene 1. See
[premiere-plugin/README.md](premiere-plugin/README.md).

## Tests

```
node test-core.mjs     # the anchored-range engine, numbering, key-never-in-file
node test-ui.mjs       # boots the built file in headless Chrome, drives the UI
node test-typing.mjs   # real mouse + keyboard over the DevTools protocol
node test-store.mjs    # autosave/open against a stubbed File System Access API
node test-prompts.mjs  # the prompt pipeline against a stubbed Gemini endpoint
```

`test-typing.mjs` exists because `test-ui.mjs` dispatches synthetic `beforeinput` events,
which cannot catch focus, selection or caret bugs — real clicks and keypresses can.

## Files

```
index.html        dev shell
storyboarder.html built single file  (node build.mjs)
css/app.css
js/theme.js       light / dark
js/util.js        helpers, image downscale, modal
js/doc.js         Doc + position transforms (the anchoring core)
js/blobs.js       content-addressed image store (one copy per picture)
js/geminimodels.js writer model list, ListModels refresh, daily call counter
js/model.js       project schema, numbering, all mutations
js/store.js       File System Access autosave, API key in localStorage
js/usage.js       size measurement + Firebase free-tier maths
js/usagepanel.js  the data readout
js/history.js     undo/redo for script text
js/editor.js      contenteditable window onto a Doc slice
js/board.js       scenes, cards, drag & drop
js/scriptmode.js  master script panel, capture, highlights
js/comments.js    comment list + ink layer
js/brand.js       house style, scene context, gendered-language check
js/personas.js    recurring people + per-model reference-image wording
js/fields.js      the extra card text boxes, per project
js/personapanel.js the Personas panel
js/prompts.js     Gemini prompt writing
js/promptpanel.js the Prompts panel
js/settings.js    tabbed settings
js/versions.js    whole-project versions
js/pdf.js         contact-sheet print view
js/app.js         boot + wiring
```
