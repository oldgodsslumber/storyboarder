# Clay references for GPT Image and Seedance, and no invented details

Status: **§2 and §3 built on `V3-posebench` (2026-09-29).** The no-invention rider, check, marks and wardrobe

**2026-09-30: the wardrobe lock was taken out** at the user's request. Every prompt got an app-written clothing paragraph tacked on the end, which was clutter; the writer rider and the invention check (with one rewrite and the card mark) stay. Prompts stored with the paragraph have it stripped on load (`stripLocks` in model.js).
lock work for every model, with a board switch. The GPT Image clay-render opening is built, along with the
panel/template fix. Tests: `test-lock.mjs`.

Decisions taken as recommended:
- one corrective rewrite plus a mark;
- the opening and lock are visible in the stored prompt;
- the wardrobe comes from the description's clothing clause.

**Still to do:**
- **§4, Seedance reference mode.** It waits on experiments E1–E3, which spend credits on the ImagineArt account,
  so they need a go-ahead.
- **§1, the shared manifest refactor.** It's only needed once Seedance reference mode is built.

It follows `minimax_export_plan.md` (built) and reuses its manifest.

## Why

The team has had great results feeding the clay render, the grey mannequin blocking, to GPT Image and
Seedance by hand. But those prompts were hacked together. Two problems keep coming back:

1. **The clay render's role is left to chance.** Unless a prompt says exactly what each reference is *for*,
   models copy the grey material, draw mannequins, copy the floor or grid, or ignore the layout.
2. **Models invent details.** Coats, jackets, hats, bags and props appear that no description asked for.
   - Neither GPT Image nor Seedance has a negative-prompt field.
   - Nothing in the app tells the writer model not to add them. The nearest rule is "where [the picture]
     does not [show it], say nothing about it".

## What the app does today (from the code)

| | GPT Image (`gpt-image-2`) still | Seedance (`seedance-2.5`) clip |
|---|---|---|
| **Clay still** | **Sent.** It is image 1, or the **top-left panel** of a reference sheet when the card also has subjects (`refs.js:185`, `imagine.js:2491-2561`) | **Never sent.** The video feed skips the blocking (`refs.js:185`) |
| **Clay clip** (performance) | — | **Never sent.** No `video_url` anywhere (`imagine.js:2066`) |
| **Upload** | **One** `image_url` string. An array was accepted and then silently ignored, so up to 4 references become one sheet PNG | `image_url` array: the frame, plus arrival pictures if opted in |
| **Blocking in the prompt** | "THE BLOCKING — image 1 is a 3D blocking… Match its camera angle… Do NOT draw mannequins…", plus the colour→person map (`personas.js:658-705`) | Nothing. `VID_TPL` says the frame shows everything |
| **Against invention** | Nothing general | "Describe appearance only where it changes" |
| **Labels** | "image N", or "the top-left panel" | "picture N" |

## What the research says

Sources are in the review notes. Items marked *unverified* are gated behind experiment E1–E5 below.

**GPT Image 2**
- Cite each input as "Image N: [role]", in upload order; up to 16 inputs on OpenAI's own endpoint.
- Keep layout with an explicit preserve list, repeated on every request: "Preserve the exact layout,
  proportions, perspective… Do not add new elements."
- There is no negative prompt, so state exclusions in the prompt: "do not add accessories, text, logos".
- *Unverified:* how faithfully it follows a *grey mannequin* render. Nobody has published this.

**Seedance 2.x**
- References are `@Image1`, `@Video1` and `@Audio1`, numbered per type in upload order.
  - **2.0:** up to 9 images, 3 videos (2–15 s combined, MP4/MOV), 12 files in all; output is 4–15 s.
  - **2.5:** up to 30 images, 10 videos (combined 30.2 s or less); output is 4–30 s.
- **Reference-video mode and first-frame mode are mutually exclusive.** To anchor the opening, the still
  goes in as `@Image1` with "@Image1 is the opening frame". *Unverified* whether it is honoured strictly.
- **Reference media that looks like a real person's face is rejected** (HTTP 400 PrivacyInformation).
  Photos of real people as subject references will fail. AI-made likenesses and grey mannequins are
  reported to pass (*unverified*).
- **Motion transfer from a reference video works best when:**
  - the move is simple and the subject is centred;
  - the clip is 3–8 s;
  - no more than about 3 style adjectives are used, or the model drops the motion to satisfy the look.
- **Phrasing that works:**
  - "Copy ONLY the camera path, timing, positions and body motion of @Video1; do not copy its material,
    figures, floor, grid or lighting."
  - Give every reference an explicit role.
- There is no negative prompt; use constraint sentences instead.

## The plan

### 1. One reference manifest for every target (from `mxm.js`)

`SB.Mxm.manifest()` already knows the ordered files, the clay clip or still, the approved frame, each
subject's picture, which clay figure is whom (colour and side) and the warnings. It moves to a shared
**`js/refcall.js`**, and each target is a **labeller** over the same assets:

| Target | Clay still | Clay clip | First frame | Subject |
|---|---|---|---|---|
| MiniMax Image | `[Image 1]` | — | — | `[Image N]` |
| MiniMax H3 | `<Picture N>` | `<Video 1>` | `<Picture N>` | `<Subject N>` + `<Picture N>` |
| GPT Image (sheet) | "the top-left panel" | — | — | "the top-right panel", … |
| Seedance (reference mode) | `@Image1` if there is no still | `@Video1` | `@Image1` (opening frame) | `@ImageN`, off by default |

The prompt and the files come from the same list, so labels and upload order cannot disagree. That's
the guarantee the MiniMax work already has.

### 2. The no-invention rule: the wardrobe lock (every model, every lane)

This is the part that fixes the coats. It works at three layers:

1. **The writer is told.** A new `NO_INVENT_RIDER` goes into every image and video writer request:
   - Every garment, accessory, prop and person comes **only** from the subject descriptions and the shot
     text.
   - Never add clothing layers (coat, jacket, blazer, cardigan, hoodie, scarf), headwear, glasses,
     jewellery, watches, bags, lanyards, headphones, umbrellas, extra props or extra people.
   - If a description doesn't say, the answer is **nothing**. Plain is correct.
   - Weather, season and a location are not reasons to dress someone.
2. **The prompt carries a lock the app writes, not the writer.** Every person in frame gets one line:
   *"Gus wears exactly: white shirt, headset, dark slacks. Nothing else."* Then one exclusion line:
   *"No coats, jackets, hats, bags, jewellery, props or people beyond those described."*
   - The line is appended to the stored prompt, so it's visible and editable, and removable per card.
   - It's built from the persona's wardrobe. To start, that's the persona description's clothing clause;
     an optional explicit **Wardrobe** field on the persona can come later.
3. **The app checks the answer.** `inventedProblems(prompt, shot)` scans the written prompt for garment
   and accessory words (a maintained list) that appear in no cast description and no shot text.
   - Any it finds earn **one corrective rewrite**, the same mechanism as `genderProblems` and the H3
     label check.
   - Anything that survives is kept but **marked on the card** ("added: trench coat"), as camera moves
     are today.
   - It's deterministic and testable, and it catches the coat before a single credit is spent.

This applies to GPT Image, Seedance, MiniMax (brief and H3) and every other model: the rider and the
check sit in `prompts.js`, and the lock sits in the per-target assembly.

### 3. GPT Image stills: clay render by role, not by hope

- **What travels:** unchanged. The blocking is the top-left panel, or the only image. ImagineArt takes
  one picture, so the sheet stays (`SHEET_MAX = 4`).
- **Wording, from the research:**
  - The app writes a fixed **reference preamble** at the head of the stored prompt, not the writer:
    > *The top-left panel is a grey clay layout render of this exact shot. Use it ONLY for camera
    > angle, framing, lens and perspective, where each person stands, their pose and silhouette,
    > and scale. Do not reproduce its grey untextured material, mannequin bodies, featureless faces,
    > studio floor, grid or backdrop. The tan figure is Gus (top-right panel); the blue figure is
    > Nat (bottom-left panel). Take each person's face, hair, skin tone and build ONLY from their
    > panel.*
  - Then the writer's scene paragraph, then the wardrobe lock.
  - The preamble replaces the THE BLOCKING instructions in the system block, which is where they were
    getting lost. The writer still gets the blocking in words as context.
- **Fixed as part of this:** a sheet mapping that says "panel", with a template that says "the person in
  image N".
- **Later, separate:** an **Export for GPT Image** package (separate files, "Image N" labels) for people
  using ChatGPT or OpenAI directly, where 16 inputs are allowed. It's the MiniMax export with a GPT
  labeller.

### 4. Seedance clips: a reference mode with the clay clip

Two modes, chosen per card:

- **Frame mode**, today's behaviour and the default for cards *without* blocking: first frame plus motion
  prompt. It gains the no-invention rider and lock.
- **Reference mode**, the new default for cards *with* a performance clip:
  - **Files:**
    - `@Video1` is the clay clip (`SB.Pose.clip`, 3–8 s ideal, within Seedance's limits);
    - `@Image1` is the approved still as the opening frame;
    - arrival pictures follow as `@Image2…`.
  - **Persona photos are off by default:** real-face photos are rejected, and the still already carries
    the look.
  - **Prompt, assembled by the app:**
    > *@Video1 is a grey clay blocking animation of this shot. Copy ONLY its camera path, timing,
    > where each person is and how their body moves. Do not copy its grey material, mannequin
    > figures, floor, grid or lighting. @Image1 is the opening frame: the shot starts exactly as it
    > looks. The tan figure in @Video1 is Gus; the blue figure is Nat.*
  - Then the writer's action paragraph (at most 3 style words), then the wardrobe lock and the
    no-extras line.
  - **Duration** comes from the clip, clamped to the model's range (2.0: 4–15 s, 2.5: 4–30 s).
- **The upload:** `video()` sends `video_url` (the contract already allows it for seedance-2.x).
  - The clip needs to reach ImagineArt as a URL. **Step one is to verify** that ImagineArt's upload takes
    MP4.
  - If it doesn't, reference mode ships as **Export for Seedance** (a package, like MiniMax) until it
    does.
- **Cards with blocking but no performance** stay in frame mode. The clay still adds nothing a first
  frame doesn't already have.

### 5. Where it shows up

- **Create panel:**
  - The video lane lists Seedance reference-mode files the way it lists H3's (`@Video1` clay clip,
    `@Image1` opening frame).
  - A **Frame / Reference** switch sits per card.
  - The wardrobe lock shows in the prompt, where it can be edited.
- **Card:**
  - "added: …" marks from the invention check, next to the existing camera-move and gender marks.
- **Settings → Models:**
  - Seedance gets "reference mode when a performance clip exists" (on by default).
  - The wardrobe lock can be turned off per board.

## Experiments first: small, before building the parts they gate

| # | Question | How | Gates |
|---|---|---|---|
| E1 | Does ImagineArt pass `@Image1`/`@Video1` through to Seedance, and take `video_url` + `image_url` together? | One 4 s push with a clay clip, prompt citing `@Video1` | §4 push |
| E2 | Is "@Image1 is the opening frame" honoured in reference mode? | Same card, compare the first output frame to the still | §4 default |
| E3 | Are persona photos rejected (real faces)? Is the clay clip accepted? | Push with one persona photo | Persona photos off/on |
| E4 | Does GPT Image follow the clay layout on a sheet as well as the clay alone? | Same card: sheet vs. clay only | Sheet wording and order |
| E5 | Does the wardrobe lock stop invention? | 5 cards known to grow coats, before/after, 2 seeds each | §2 wording |

Each is a few credits. Results are recorded in this file.

## Code to change

| File | Change |
|---|---|
| `js/refcall.js` (new, from `mxm.js`) | shared manifest; labellers for MiniMax, H3, GPT sheet and Seedance; wardrobe-lock and preamble builders |
| `js/mxm.js` | uses `refcall.js` (behaviour unchanged; `test-mxm.mjs` stays green) |
| `js/brand.js` | `NO_INVENT_RIDER` in `systemFor` for every role |
| `js/prompts.js` | `inventedProblems()` in every job's `check`; GPT Image and Seedance assembly (preamble + writer prose + lock); Seedance reference-mode job |
| `js/personas.js` | THE BLOCKING section trimmed to context; the panel/image template conflict fixed; wardrobe clause extraction (`wardrobeOf`) |
| `js/imagine.js` | Seedance `video_url` + clip upload (after E1); duration from the clip; a reference-mode push reason when the upload path is missing |
| `js/promptpanel.js`, `js/board.js` | Frame/Reference switch, file list, "added: …" marks |
| `js/model.js` | Seedance reference-mode setting; wardrobe-lock setting; migrate |

## Tests

- **Labels equal files, per target:** GPT sheet panels, Seedance `@VideoN`/`@ImageN` numbered per type,
  MiniMax unchanged.
- **The wardrobe lock:**
  - each person in frame gets exactly their described clothing, plus "nothing else";
  - an arrival isn't locked into the still;
  - a rename and an edited description reach it.
- **The invention check:**
  - "a man in a trench coat" is caught when no description has a coat;
  - "white shirt" is not caught when the description has it;
  - one corrective call is made, and a survivor gets a card mark.
- **Preamble:** GPT Image's has the role list and "do not reproduce" list, and names the right panels;
  Seedance's names `@Video1`'s role and the figure bindings.
- **Pushes:**
  - GPT Image still uploads exactly one `image_url` (unchanged);
  - Seedance reference mode sends `video_url` + `image_url[]`, and frame mode is unchanged;
  - duration comes from the clip.

## Order of work

1. **The no-invention rule** (§2): rider, lock and check, for every model. It's needed everywhere and
   blocked by nothing.
2. **GPT Image preamble** (§3) and the panel/template fix.
3. **Experiments E1–E3**, then **Seedance reference mode** (§4). If E1 fails, it ships as Export for
   Seedance.
4. **E4–E5** tune the wording. Export for GPT Image comes later.

## Decisions to confirm

1. **Seedance reference mode by default** for cards with a performance clip, still as the opening frame
   and persona photos off (recommended); or opt-in per card.
2. **When the invention check finds something:** one automatic corrective rewrite plus a mark
   (recommended), or just the mark.
3. **Where the preamble and lock live:** visible in the stored prompt (recommended, so you can see and
   edit what's sent), or added silently at push time.
4. **Wardrobe source:** the persona description's clothing clause to start (recommended), or a separate
   Wardrobe field on each persona now.
