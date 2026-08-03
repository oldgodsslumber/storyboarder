# Storyboard App — Build Spec

A local, single-file storyboarding tool for client-success videos. Chrome-only. No Firebase, no server, no accounts. Everything lives on the user's machine.

---

## 1. Platform & storage (the foundation)

- **Runtime:** A single HTML file (app + vanilla HTML/CSS/JS, split into files during development, shippable as one file). Runs in **Chrome/Edge only** — this is a hard requirement, not a preference.
- **Autosave:** Constant, silent autosave to a local project file using the **File System Access API**. On first save the user picks/creates a `.storyboard` file (JSON); after granting permission, the app writes to that same file handle on every change (debounced, e.g. ~500ms). No download prompts, no manual "Save."
- **Project file format:** A single JSON document (the `.storyboard` file) containing the whole project: scenes, shots, master script, versions, comments, annotations, prompts, settings.
- **Images:** Stored **inline** as base64 JPEGs, downscaled to **≤480p** ("small proxies"). No full-res storage anywhere. This keeps the project portable as one file.
- **Portability:** Because the project is one self-contained JSON/HTML artifact, it can be handed to someone else and opened in their Chrome. **The Google API key is NEVER written into the project file** — it lives in browser storage (localStorage/IndexedDB) separately, so sharing a board never leaks the key.

**Decision still open:** confirm the project is a separate `.storyboard` JSON file opened by the app (recommended), vs. each project being its own self-exporting HTML file. The autosave design above assumes the former.

---

## 2. Core hierarchy

```
Project
 └─ Scene   (has its own heading + description; shown in left-hand list)
     └─ Shot (a card)
```

- **Scenes** appear in a list on the **left**. Each scene has a **heading** and a **description** of its own.
- **Scenes auto-number, and shots auto-letter within their scene** (Scene 1 → shots 1A, 1B, 1C; Scene 2 → 2A, 2B…). Numbering/lettering recalculates automatically on reorder and drag-between-scenes. *(Confirm this is the intended "auto number and letter" scheme.)*
- **Shots** are cards within a scene.
- **Drag & drop:** shots can be reordered within a scene **and dragged into another scene**. **Scenes themselves can be dragged up/down in the left list to reorder**; scene numbers and all shot letters **recalculate automatically** on any reorder or move.

### The shot card

Each card has three stacked zones plus styling:

1. **Image** — top. Sourced by drag-in, paste, or click-to-load from computer. (In-app sketching is a *later* addition, not v1.)
2. **Script box** — smaller, directly below the image. Rich text: **bold, italic, underline** only, no toolbar/controls. This is the text captured from the master script (see §3).
3. **Description box** — larger, below the script box. This is the human-written description that feeds prompt generation (see §5).
4. **Card color** — user can change each card's color.
5. **Prompt box(es)** — appear below the description in export mode; **hideable** so cards don't grow unbounded (see §5).

---

## 3. Script processing & live sync (the hardest part — build carefully)

### Model
There is **one canonical master script** per project. When the user enters script-processing mode, they **highlight a span of text**; a new shot box appears; they pick a **shot type**; on **Complete**, the highlighted text populates the new shot's **script box**.

A shot's script box is **not independent text** — it is an **anchored range** (start/end anchors) pointing into the master script. The script box is a live *window* onto that slice of the master.

### Sync rules
- Editing text through **any** window (master script or any shot) edits the underlying master characters, and **every other window covering those characters updates too** — master included.
- **Overlapping ranges are supported and expected.** Two shots (e.g. a master shot and an insert shot) can cover partially overlapping regions of script. This *will* happen regularly and must be planned for from the start.
  - Edit inside a shared/overlapping region → all shots covering it + master update.
  - Edit in a region unique to one shot → only that shot + master update.
- **Edge insertion default:** typing at the boundary of a shot's range **grows that shot** (anchors extend). Flag if a different rule is wanted.
- **Freestanding shots:** a shot created by hand (not from the script) gets a script box **anchored to nothing** — pure local text that syncs to no one.
- **The master script is saved with the project** and can be re-opened/edited later.

### Link state must be visible (requested)
The user needs to *see* linking state, not guess at it:
- **Captured spans are highlighted in the master script** so it's obvious which text drives shots (overlapping captures should read clearly — e.g. layered/interleaved highlight or a stacked indicator).
- **Each shot's script box shows a link indicator** — linked vs. freestanding.
- **If master-script text is deleted and empties a linked shot box, that box is flagged** with a clear "orphaned / link broken" state rather than silently going blank.
- **"Break link"** is an explicit per-shot action; once broken, the box switches to the freestanding (unhighlighted) state and edits stop propagating.

### Implementation note for the builder
This is an anchored-range-over-a-shared-document problem (think ProseMirror marks / CRDT-style position anchors). Do **not** implement sync by string-matching — matching breaks the moment text is edited. Ranges must survive insertions/deletions elsewhere in the document. Define explicit behavior for: link identity, overlapping ranges, edge growth, deletion, and unlinking. (Deletion/unlink semantics still need a ruling — see Open Questions.)

### Shot types
- A named list: Wide, Medium, Close-up, etc.
- **User-editable in Settings.** Ships with a starter set the user can change.

### "No shot / no storyboard" flag
Some captured fragments (e.g. cutting back to the speaker) are marked **"no shot."** These:
- **Stay visible** on the board — they're still part of the storyboard.
- Are **excluded from prompt generation and PDF export.**

---

## 4. Versioning

- **Scope:** versions are of the **whole project**.
- **Create:** user presses **New Version**, names it; version number **auto-increments**.
- **Restore:** user can **revert to an older version**, and **read that version's comments**.
- **Images:** each version keeps its own ≤480p JPEGs.
- **Comments & drawings do NOT carry forward.** A new version starts **clean** — the prior version's comments and annotation PNGs are frozen with the version they were made in.

---

## 5. Comment mode & annotations

- **Solo use.** Reviews happen live over screen-share; no multi-user, no realtime.
- **Comment mode toggle.** In comment mode the user can:
  - **Draw over an image** — the drawing is stored as a **transparent PNG overlay** on top of the frame (separate layer, not baked into the image).
  - **Leave comments** — a simple **text list under the card** (not pinned to image coordinates).
- Comments and drawings belong to the **current version** and start clean on each new version (see §4).

---

## 6. Prompt export mode (Google API-driven)

### What it does
A mode where the app turns each shot's **description into model-specific prompts** using the **Google (Gemini) API**. Google is the **prompt-writing engine** — the app does **NOT** generate images or video, and is **not** connected to ComfyUI. Images remain hand-loaded ≤480p proxies.

### Behavior
- User selects an **image/video model** from a **user-extensible** list. Starter set (current popular models as of 2026 — user can add/remove/rename in Settings):
  - **Video:** Wan, LTX (LTXV / "LTX 2.3"), Veo, Kling, Sora, Runway, Hailuo (MiniMax), Seedance. *(Team accesses these via ImagineArt — noted as the access platform, not itself a model.)*
  - **Image:** Nano Banana (Gemini image), Qwen (Qwen-Image), FLUX, GPT Image, Imagen, Ideogram, Midjourney.
- For each shot, the app calls Gemini with the shot's **description + the user's per-model template** and produces **two prompts**:
  1. **First-frame (image) prompt**
  2. **Image-to-video prompt**
- Each prompt appears in a **new text box below the description**, and boxes are **hideable** to keep cards compact.
- **Two independent toggles:** show/hide the image prompt, show/hide the video prompt.

### Prompt persistence (important)
- Each shot stores prompts **per model** — a `{ imagePrompt, videoPrompt }` pair for **every** model it's been run against.
- **All model prompts persist simultaneously.** Switching the active model only changes which pair is displayed; the others stay saved. (Start in Qwen, switch to Nano Banana → the Qwen prompts remain, so the user can switch back.)

### Templates
- **Per-model templates**, defined by the **user in Settings**, for **both image and video** prompts. The template shapes how Gemini writes each model's prompt (Midjourney-style params vs. natural-language, etc.).

### API key
- Stored **locally in browser storage, never in the project file.** Sharing a `.storyboard` file must not leak the key.

---

## 7. PDF export

- **Contact-sheet grid: 6 shots per page.**
- Each cell shows: **image, script, description, and the scene heading** (with the shot's auto number/letter, e.g. "1B").
- **Excludes** comments and annotation drawings, and excludes "no shot" fragments.

---

## 8. Settings

- Editable **shot-type list.**
- **Per-model prompt templates** (image + video) for each supported model.
- Google API key entry (stored locally, separate from project file).

---

## Resolved decisions

1. **Project file shape** — ✅ separate `.storyboard` JSON file, opened/autosaved by the app.
2. **Delete a shot holding a linked fragment** — ✅ the text **stays in the master script**; only that shot's window goes away.
3. **Edge-insertion rule** — ✅ typing at a range boundary **grows the shot**.
4. **Model list** — ✅ user-extensible; starter set populated in §6.
5. **Scene numbering** — ✅ scenes auto-number, shots auto-letter within scene; scene heading shown in PDF cells.

## Resolved (round 2)

6. **Master deletion empties linked windows** — ✅, and the emptied box is **flagged as orphaned/broken**, not silently blank (see §3 "Link state must be visible").
7. **"Break link" action** — ✅ exists per shot.
8. **Numbering scheme (1A / 1B)** — ✅ confirmed.
9. **Scene drag-to-reorder with auto-renumber** — ✅ (see §2).

*No open blockers remain — the spec is complete for handoff.*
