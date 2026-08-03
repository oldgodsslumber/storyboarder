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
2. **Settings** → paste your Google (Gemini) API key. It is stored in this browser only
   and is **never** written into the project file, so a board can be shared safely.
3. Re-opening the app offers to reopen the last project — click the file name in the
   top bar (Chrome requires a click to re-grant file permission).

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

## Board

- Scenes auto-number, shots auto-letter inside their scene: `1A 1B 1C`, `2A`…
- Drag a card by its header to reorder it, or drop it on another scene. Drag scenes in the
  left list to reorder. Everything renumbers automatically.
- Images: drop, paste (with a card selected), or click the frame. Everything is downscaled
  to a ≤480p JPEG proxy and stored inline — no full-res copies anywhere.
- Card colour is a fixed palette of ten mid-tone hues, each legible on the light and the
  dark board. Click the swatch in a card's header.
- Rich text in the script box is **Ctrl+B / Ctrl+I / Ctrl+U** only, by design — no toolbar.
- **no shot** marks a fragment that stays on the board but is excluded from prompt
  generation and from the PDF.

## Comment mode

Toggle **Comment mode** to add comments under a card and to draw over a frame. Ink is kept
as a transparent PNG layer on top of the image, never baked into it. Comments and ink
belong to the current version.

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
  family, 3.1 Pro, and the 2.5 family). Default is **gemini-3.6-flash**.
- Opening an older project silently moves it off a dead id (`gemini-2.0-flash`,
  `gemini-flash-latest`, …) onto the default.
- **Settings → API → Refresh list from my key** calls Google's ListModels with your key and
  replaces the dropdown with what that key can actually reach today (cached locally,
  *Back to curated list* undoes it). A 404 from a prompt run says to do exactly this.
- **Free calls** counts every request this browser sent today, per model, resetting at
  midnight. Google no longer publishes the free-tier daily cap per model, so the limit box
  next to the counter is yours to set from your AI Studio rate-limit page — leave it blank
  and you just get a running count. A 429 marks that model spent for the day.

Prompts are stored **per model**, all at once — switching target models only changes what is
displayed; every model's prompts stay saved. Each card's prompt box names the model it came
from, and *generate* on a box rewrites just that one.

Templates live in **Settings → Models & templates**, collapsed behind a *templates* button
per model so the list stays readable. They accept:
`{{MODEL}} {{SHOT_TYPE}} {{SCENE}} {{SCENE_DESC}} {{SCRIPT}} {{DESCRIPTION}} {{CODE}}`

## Settings

Three tabs: **General** (shot types, light/dark), **Models & templates** (the model list and
its per-model image/video templates), **API** (Google key + the Gemini model used to write).

## Light / dark

The ☀/☾ button in the top bar flips the theme; it also lives in Settings → General. The
choice follows your OS preference on first run and is stored per browser — it is never
written into the project file.

## PDF

**PDF** opens a print view: a contact sheet, 6 shots per page, each cell showing the frame,
shot code, scene heading, shot type, script and description. Comments, ink and “no shot”
fragments are excluded. Print → *Save as PDF*.

## Tests

```
node test-core.mjs   # the anchored-range engine, numbering, key-never-in-file
node test-ui.mjs     # boots the built file in headless Chrome and drives the UI
```

## Files

```
index.html        dev shell
storyboarder.html built single file  (node build.mjs)
css/app.css
js/theme.js       light / dark
js/util.js        helpers, image downscale, modal
js/doc.js         Doc + position transforms (the anchoring core)
js/geminimodels.js writer model list, ListModels refresh, daily call counter
js/model.js       project schema, numbering, all mutations
js/store.js       File System Access autosave, API key in localStorage
js/editor.js      contenteditable window onto a Doc slice
js/board.js       scenes, cards, drag & drop
js/scriptmode.js  master script panel, capture, highlights
js/comments.js    comment list + ink layer
js/prompts.js     Gemini prompt writing
js/promptpanel.js the Prompts panel
js/settings.js    tabbed settings
js/versions.js    whole-project versions
js/pdf.js         contact-sheet print view
js/app.js         boot + wiring
```
