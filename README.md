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
2. **Settings → API** → get a key and paste it in. That tab now carries the five steps end
   to end: open [aistudio.google.com](https://aistudio.google.com/), accept the terms
   (which is also what unblocks the API on the Pega network), **Get API key → Create API
   key** against a Google Cloud project of your own, paste the `AIza…` string in, then
   **Refresh list from my key** to prove it works. The key is stored in this browser only
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

### Making the picture: ImagineArt

The Prompts panel writes the prompt and now also sends it. Each prompt cell has a **▶
render** (first frame) or **▶ shoot** (clip) beside `copy` and `✦ generate`. One press is
one generation — nothing is batched, nothing fires on its own.

- A generated still lands on the card exactly like a dropped one: the ≤480p proxy the
  board draws, and the full-size original beside it, both inside the `.storyboard`.
- A clip is kept in the file too, and the card grows a ▷ badge that plays it. If
  ImagineArt made the clip but the browser could not read the bytes back, you keep the
  remote link only and the app says so — that link expires.
- **▶ shoot** animates the shot's own full-size frame when it has one, and falls back to
  text-to-video when it does not. The button's tooltip says which it will do.

**Settings → ImagineArt** picks how it is paid for:

- **Sign in with ImagineArt** — ImagineArt's own OAuth (dynamic registration, PKCE, refresh
  tokens). A window opens, you approve, it closes; the board never reloads. Generations come
  out of the credits on the imagine.art account. Nothing is stored but the token, and the
  token lives in this browser, never in the `.storyboard`.
- **API key** — a key from [platform.imagine.art](https://platform.imagine.art/), billed
  against a separate metered API balance.

Sign-in needs the app served over `http://` — the redirect has to come back to a real
address, and `file://` has none. Opened straight off the disk, use the API key.

**Settings → Models & templates** gains one field per model: which ImagineArt model it
means (`flux-dev`, `kling-1.0-pro`, …). A model with none is never pushed; its prompts are
still written and copied as before.

### How images are stored

Every image — shot frames, persona references, comment ink, the full-size originals and
any clips — is stored **once**, under a hash of its bytes, in a `blobs` map on the
project. Shots and personas hold a short reference. The map lives inside the
`.storyboard` file, so a board is one thing you can hand to someone.

**Two copies of every picture, both in the file.** The board draws a ≤480p proxy — forty
of those is what makes a wall of cards scroll — and keeps the full-size original beside
it under a serial, because that is what gets fed back into an image model. Originals are
re-encoded at native size (WebP q90) on the way in: a 1184×672 render off ImagineArt is
about 1 MB as the PNG it arrives as and 63 KB re-encoded, which is the difference between
a 7 MB board and a 73 MB one at forty shots. **Settings → General** shows what the board
is carrying, broken down by kind, and offers `source` instead if you want the bytes
exactly as they arrived.

This replaced a renders folder that the browser remembered. That folder was a fact about
one machine: it was never in the file, so handing the board to someone else handed over
serial numbers pointing at nothing, silently, with the 480p copies standing in — and
renaming a board orphaned every original it had, because the folder was named after the
project. Boards written in that era open fine; their frames say so, and dropping the
picture in again brings the original with it.

Clips are the one heavy thing: they go in as they arrive, since a browser has no cheap
re-encode, so a board with a lot of them can reach tens of megabytes. Autosave scales its
wait with the size of the board for that reason (half a second, up to three), and
Settings warns when a board is heavy enough to feel.

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

### Scene sections — claiming a stretch before you know the shots

Anchoring a shot to script text assumes you already know the shot. Coming out of the
Premiere panel you do. Early on you don't: you read the script and think *"this stretch is
Scene 3, I'll work out the shots later."* A **scene section** is that thought, written down.

Select some script, press **Capture**, and choose **a scene section** instead of a shot. The
scene now claims that stretch. Nothing else about the scene changes — it keeps its heading,
its description and whatever shots it already has.

The point is what you can then see. The master script carries two independent layers at once:

- a **background wash** — how many *shots* cover these characters (the precise, later layer)
- a **teal rule above the line** — a *scene* claims this section (the loose, earlier one),
  brighter on the scene you have selected

They are genuinely independent. A scene's claim may overlap any number of its shots' ranges,
sit beside them, or exist with no shots at all — nothing is kept "consistent" behind your
back. The panel also reports what share of the script any scene has claimed, so *"have I
covered it all yet?"* is answerable rather than eyeballed.

A claimed scene grows a script box on its header that behaves exactly like a card's: type in
it and the master changes, **break link** turns it into the scene's own freestanding text,
and **untie** hands the section back. One consequence worth knowing: freestanding scene text
claims *nothing* in the master — no teal rule, and it counts toward no coverage — because the
whole point of the layer is what is covered **in the master script**. If a scene has drifted
that way, untie it and capture it again.

Once a scene claims a section, **✦ Generate shots** will board from that script even with no
scene description written — which is the workflow this exists for: claim a section loosely,
then ask for shots that cover it.

### Pasted line endings

Windows puts a carriage return before every newline on the clipboard, so text pasted in
from Word, Outlook or a transcript arrives as `\r\n`. The browser cannot show a `\r` — the
HTML parser folds it into `\n` the moment the text reaches the page — so a script holding
them measured **longer than what was on screen**, and every offset read back off a
selection came up short by one character per line above it. Capturing a shot part-way down
a pasted script gave you a card whose text started a few characters early.

Carriage returns are now folded to newlines as the text enters the document, and a board
saved with them still in it is repaired when it opens: the text is folded and every anchor
into it — shot links, script comments, bold/italic runs, and the same inside every frozen
version — is moved by the same amount, so nothing shifts. Nothing above the document layer
ever sees a `\r`.

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

### Boarding a scene from its description

Under every scene description sit two writer-model actions. Both need a Google API key
(Settings → API) and both cost one call.

- **✦ Rewrite** turns a rough draft into something shootable — same subject, same place,
  same point, but concrete and visual, with the hedging cut. It swaps the text in place and
  leaves a **revert** link next to the button until you edit the description yourself.
- **✦ Generate shots** boards the description as a run of **consecutive beats of one
  moment**: an entry into the action, the action, and the beat that lands it. Framing stays
  mostly tight — close-ups, extreme close-ups, inserts on hands, faces, objects — with one
  wider shot for rhythm when there are three or more. The dropdown next to it is **Auto**
  (the writer picks 2 or 3, which is what these scenes usually want), or force 2, 3 or 4.

Continuity is the point of the feature, so the subject is pinned down once and repeated in
every description it writes — each shot's prompt is later written on its own and cannot see
the others. If the scene's cards already have **cast** on them, those are the subject:
they're described back verbatim and attached to every generated shot instead of a new one
being invented.

Generated shots land at the end of the scene (a brand-new scene's single empty card is
filled first rather than left blank), take their type from **this project's** shot-type list,
and get freestanding script boxes — capture from the master script separately if you want
them linked. Script undo deliberately never removes cards, so the row offers its own
**undo** for the shots it just made.

### Selecting several cards

Click a card to select it; **Ctrl/Cmd-click** adds or removes one; **Shift-click** takes the
whole run between the last card and that one; **Ctrl+A** takes every card on the board.
**Esc**, or a click on empty board, clears it.

With more than one selected, a bar appears at the foot of the board: **new scene from these**,
**colour** them all at once, **toggle "no shot"**, **delete**, **clear**. Dragging any card in
the group moves the whole group — into another scene, onto a scene in the left list, or to a
new position — keeping the order they had on the board.

### Starting a new scene between two cards

Hover the gap between any two cards and a **new scene** marker appears; click it and that
card and everything after it in the scene move into a fresh scene inserted straight after.
Everything renumbers.

This is the tool for a **Premiere import**, which arrives as one long scene of cuts: walk the
board, click the gap wherever the scene changes. The alternative for scattered cards is to
select them (above) and use **new scene from these**.

### Swapping two shots

Dragging a card *moves* it, dialogue and all. To trade two shots over while each bit of
dialogue stays where it is in the script, either:

- **Alt-drag** one card onto another — the target says **⇄ swap pictures** instead of the
  usual move outline; or
- click **⇄** in a card's header, then either press **⇄ on the other card** or click that card
  anywhere (Esc cancels). While one is armed, the other cards' ⇄ buttons light up as
  "swap with this one".

What moves is the picture and everything describing it: frame, ink, shot type, card colour,
description, card fields, prompts, cast and comments. What stays is the **script window**
(linked or freestanding), the card's position, and the **no shot** flag — those describe the
fragment of script the card sits on, not the image. Swapping again puts it all back.

## Card fields

Every board wants something different under the description, so the set of extra text boxes
is **per project** and lives in the project file. **Settings → Card fields**:

- Ships with **Art direction**, **Context** and **SFX**, all switched off — turn on what this
  board needs.
- **+ Add a field** for anything else; custom fields can be renamed and removed. Removing one
  tells you how many cards have text in it before it goes.
- Values live on the shot, so switching a field off hides it without losing what you wrote.
- Turning one on or off does not move the board under you — the card you were looking at
  stays where it is on screen, even though every card changes height.

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

A version freezes the **reference library** with it: the cast, the locations and the objects
as they read at the time. Without that, a snapshot held cards naming subjects it did not
carry, so deleting one afterwards collected its reference frames as orphans and restoring
that version brought back cards whose cast had quietly evaporated. Frames are stored by
content hash, so a subject appearing in ten versions still costs its bytes once. Restoring
puts the snapshot's cast back and **keeps** anything created since, which simply arrives
unused; if a card still names something that cannot be found, the toast says how many.

## Prompt export

A board is made one card at a time; prompts are written a whole film at a time. So
**Prompts** (top bar) is a full-page **table** — one row per shot, five columns:

| | |
|---|---|
| **Shot** | code, the serial its render is filed under, a thumbnail, the type. Click the thumbnail to jump to that card. |
| **Description** | the same reference box as the card, so marks stay live links and `@` works |
| **First frame** | a large prompt box, with its own ✦ generate, a *gendered* flag and a *cast changed* badge |
| **Video** | the same again for the image→video prompt |
| **Feed** | the reference files this row hands over, in order — named by file (`0007.png`), because those are what you go and find — with **copy image set** |

Rows group under their scene, the header sticks, and the filters are the point of a table:
**Missing** (no prompt yet), **Stale** (a subject on the card was edited after the prompt was
written), **This scene**. Each filter carries its count, zero included — so "what is left to
do" is a list you can work down.

**Prompts are written one shot at a time**, from the ✦ generate under each box. There is no
button that writes a whole board: it was a fast way to produce text nobody had read, since
every prompt it wrote was one you then opened and edited anyway. Generating over an existing
prompt replaces it, and says so. "No shot" cards and empty descriptions can't be generated at
all, and their buttons say why.

The prompt boxes are deliberately much larger than the card's, because editing a paragraph in
a box the width of a thumbnail is how prompts end up unedited.

Everything the panel used to hold came with it, in the header: target models (a first-frame
model *and* a video model, chosen independently), the prompt writer, the free-call counter,
and the two **on cards** toggles — prompt boxes are still hidden on the cards by default, and
generating still turns the matching one on for you.

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
- **"Google's API is being blocked"** — see below.

### When the API is blocked

On a locked-down network the request never leaves the browser: `fetch` rejects with a
`TypeError`, there is no status and no body, and the raw error is the useless string
*"Failed to fetch"*. On the Pega network this means one thing — Google's API stays blocked
until **aistudio.google.com** has been opened once in this browser and the terms accepted.

So the app names it instead. Any prompt run, rewrite, persona or model refresh that hits it
opens a dialog with the explanation, an **Open AI Studio** link (a real new tab), and a
**Try again** button that re-runs exactly the thing that failed — accept in the other tab,
come back, click it. It appears **every time** it happens: the fix is one click, and hiding
it behind "don't show again" only moves the confusion later.

Two details that matter in practice:

- A block that would fail every job **stops after the first request**. The first job of a run
  goes out alone as a canary; the rest only follow once it proves the network is there. A
  wall costs one failed request and one message, not one per shot.
- The detection is deliberately narrow. A rejected `fetch` or a proxy's own HTML error page
  reads as blocked; a genuine `403 API key not valid` from Google still reports itself as
  that. Offline gets its own wording — no point blaming the proxy for dropped wifi.

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
  are left out. *Who* and *what* is in the frame is the reference library's job, below.
- **The no-gendered-language rule is verified, not just requested.** Returned prompts are
  scanned for gendered nouns, titles and pronouns; if any appear the app asks for one
  rewrite naming the offending words, and if they survive that, the prompt box gets a
  **gendered** badge listing them. (`human`, `manager` and the like are not false positives.)

Video prompts get the same house style plus motion rules — wardrobe and location must not
change mid-shot, camera moves stay restrained and motivated.

## References — the library

**References** (top bar) opens a full-page takeover holding the two things that are true of
the whole board rather than of one card: every **recurring subject**, and the **scenes** in
the order they play.

A subject is anything that has to look the same twice, and there are three kinds:

| | what it is | what the description carries |
|---|---|---|
| **Person** | who is on camera | age range, build, hair, and the exact outfit — fabric and colour |
| **Location** | a place that recurs | architecture, surfaces, light sources, time of day — what never changes |
| **Object** | a prop, product or screen | form, material, finish, and any logo or screen state that must be exact |

They are one record with one set of behaviour, because to an image model a room that must
not change is the same problem as a face that must not change. Each holds a **name**, a
**description**, the **reference image prompt**, and its **reference frames**.

- **Several frames per subject.** One angle rarely pins a face or a room down, so a subject
  holds as many as it needs — drop, paste or load them into the filmstrip, label each one
  ("front", "3/4", "wide establishing"), and click a thumbnail to promote it to the **hero**
  frame, which is the one the board shows and the one a single-reference model gets. Past
  four, the panel says so: most image models start averaging references together instead of
  reading them.
- **✦ Generate from script** reads the master script and the shot descriptions and invents
  recurring people — or locations, or objects — through the house style. Everything is
  editable afterwards, and **+ Person / + Location / + Object** skip the model entirely.
- **write it for me** turns a description into a reference-frame prompt, worded for what
  kind of thing it is; **copy prompt** puts it on the clipboard.
- There is no cast row: the **feed** under each description is the record of what a card
  shows, because it names the actual pictures in the order they go in. A subject fed but not
  mentioned is marked as such and can be taken off from there.
- Renaming a subject offers to update the descriptions that spell out the old name. It never
  does it behind your back.

### Typing @

**@ means the model will be shown a picture of this.** One rule, and everything follows:

- `@a subject` — its reference frames go into the feed
- `@another shot` — that shot's rendered frame goes into the feed
- **the order of the marks in your sentence is the order of the images**
- no mark — not shown, only described

Type `@` in a shot description, a custom field or a scene description and the list opens,
filtered as you keep typing, showing what each pick would actually feed — *2 frames*, *no
reference image*, *not rendered yet*. If nothing matches, the last rows mint a new person,
location or object with the name you just typed. A mark is drawn as an underlined link:
click it to open the subject, or to jump to the shot.

Knowing when to hand a model a reference image is expertise. Written as one rule with a
visible consequence, it is a process somebody can follow on their first day — which is the
whole point.

Under every description is the **feed**: the images this card hands over, numbered in order,
with thumbnails. **copy image set** saves them named `1_`, `2_`… so a folder sorts into the
order the prompt promises. A mark with nothing behind it goes amber and takes no number. A
name typed *without* a mark feeds nothing, so the card offers to **link** it. Past four
images it says so, because that is where most models start averaging references instead of
reading them.

Marks are stored as ids, so renaming a subject or renumbering the board rewrites nothing.
Deleting a subject leaves its last known name behind as ordinary prose. Nothing but prose
ever reaches a model: the marks resolve on the way out.

The master script and tied scene boxes are deliberately left out: every shot anchor there is
an offset into one shared string, and inserting text behind that machinery would desync the
file.

### Riffing off a shot

A board gets made by standing on a finished shot and wanting the next one *off* it — the
reverse, tighter, a moment later. **▸ riff** on a card adds a shot straight after it,
carrying its cast across and seeding the description with a reference to it. Then you only
have to say what changes:

> Reverse of **1C** — camera behind **Colleague**, looking back at **Writer**.

That one line is the relation, the feed and the prose at once. The feed becomes `1 ▸ 1C's
frame, 2 ▸ Colleague, 3 ▸ Writer`.

A derived shot's prompt is written as an **edit of that frame**, not a fresh description of a
scene: it opens by naming the image, states only what changes — the camera, the framing, the
moment — and inherits the place, the light, the lens, the grade and the wardrobe rather than
rebuilding them in words. **The house style is not sent on those**, deliberately: it is a
list of things to put *into* the words, and the source frame already carries every one of
them, so restating it is what turns an edit into a re-render. The frame is the style
reference now.

If the source has not been rendered yet, the card says so instead of feeding nothing; if it
has been deleted, the mark goes dotted red and the strip says the reference is gone.

### The scene organizer

The lower half of the takeover lists every scene in order — number, heading, description,
how many shots it holds and whether it claims a section of the script. **No shots are shown**:
this is the shape of the film, and shots have a board. Drag a scene by its handle to
reorder, click its shot count to jump to it, and the **✦ Rewrite** and **✦ Generate shots**
buttons are the same ones that live under the scene banner. Drag the divider to give either
half more room; where you leave it is remembered.

### Who is in the first frame

A shot description is usually a little story — *he writes at the desk; a moment later somebody
walks in behind him.* The first-frame prompt is a photograph of **one instant**, so the second
half of that sentence has not happened yet.

Nothing used to say so. The template called the job a "first-frame prompt" — a label, not a
rule — and then handed over the whole paragraph, while the CAST block named everybody on the
card and supplied a numbered reference image for each. Read cold, that is a guest list, and
the person who walks in later got drawn standing in the opening frame.

Three things fix it, and the third is the one that actually settles it:

- The first-frame request now carries a **rider** saying the still is the state of things as
  the shot opens, and naming the tells — *then, after, walks in, enters, arrives, turns to,
  reaches for, reveals* — as things that happen afterwards and belong to the video prompt. It
  ships whether or not the house style is on, because it is not a matter of taste.
- The **cast block knows which prompt it is serving**. For the first-frame job it says outright
  that it describes how subjects *look* and is not a list of who is in the frame.
- **Click the ◉ beside a person in the feed** to mark them as arriving partway through: it
  becomes an amber ▷. The block then names them as absent from the first frame — and
  tells the video prompt their arrival is movement it owns. This is the deterministic one:
  nothing is inferred from your prose. When a description reads like an arrival and nobody is
  marked, the feed says **someone arrives?**

Everyone is "present when it opens" until you say otherwise, so every board written before
this means exactly what it meant.

### What the prompt gets

When a shot has cast, its prompt request carries a **CAST** block, plus **LOCATIONS** and
**OBJECTS** blocks for whatever else is on the card — each subject's description, and the
reference-image wording **that model expects**. That wording is a per-model field (Settings →
Models & templates → *reference-image wording*), because models differ: Qwen wants "the
person in image 1", others want them named. `{{N}}` is the image number and `{{NAME}}` the
names; the app appends the actual mapping (`image 1 = Ops lead (front)`), numbered once
across the whole block in the order the images are handed over. Where a subject has more
than one frame, the block says outright that they are the same subject from different
angles — otherwise the second frame walks a second person into the shot. A subject with no
reference image is described in full instead, so it still stays consistent.

Boards written before any of this still open, and are brought up to date as they load: every
persona becomes a person, its single image becomes the first frame, nobody is marked as
arriving (so every shot means what it meant), an image template still identical to the old
default is replaced while an edited one is left alone, and a version snapshot from before the
cast froze with it is given the cast as it stands — the only recoverable answer, and the one
that keeps its cards' cast resolvable and their frames from being collected as orphans.

**Preview what a shot sends** in the Brand style tab shows the exact system instruction for
the selected shot, continuity block included.

The starter model list is user-extensible in Settings. A model added to the app later — such
as **Flux 3** — is offered once to boards that predate it; delete it there and it stays
deleted.

A model that takes no reference wording gets none: clear the box in Settings and it stays
clear. The `image N = name` mapping still goes, because that is what tells you which file is
which.

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

**PDF** opens an export dialog with a live preview of the real sheet beside the controls.
Print → *Save as PDF*. Comments, ink and “no shot” fragments are never printed.

**Layout** is one of six named presets. Each fixes the orientation — the print dialog opens
already turned the right way — along with the grid and how much text a card can hold:

| Preset | Sheet | Cards | Shape |
| --- | --- | --- | --- |
| Contact sheet — 6 up | portrait | 6 | 2 × 3, frame above the words |
| Index sheet — 12 up | portrait | 12 | 3 × 4, one line of text a box |
| Script pass — 4 up | portrait | 4 | 1 × 4, frame *beside* the words |
| Wide — 6 up | landscape | 6 | 3 × 2 |
| Wide notes — 3 up | landscape | 3 | 3 × 1, room for a paragraph |
| Presentation — 1 up | landscape | 1 | one card a sheet, text unclamped |

**On each card** — shot type, script, description and scene name each switch off
independently. Whichever text box comes last takes the leftover height, so turning
description off doesn't leave a hole.

**Scenes** — optionally band the scene heading and its description where a scene starts, and
optionally start each scene on a fresh sheet. The band sits in the grid as a full-width item
so the remaining rows keep their height rather than squeezing their text; on the 1-up preset
it becomes its own title sheet.

**Colour** — card colours reach the paper by default: the card edge and meta bar are tinted
toward the colour rather than printed at full strength, and a solid stripe carries the colour
itself so cards stay tellable apart on a greyscale printer. Set it to plain grey to drop it.

The choices are stored on the board in `settings.export`, so a project carries its own print
setup; a file written before this existed opens with the defaults.

Each sheet is sized to print whole on **both A4 and Letter** — 186 × 251 mm portrait,
255 × 186 mm landscape, inside 12 mm margins. Frames are a fixed size so every picture on a
sheet sits on the same baseline whatever its shape or the length of the text beside it; any
aspect ratio letterboxes inside. Text is clamped with an ellipsis rather than cut mid-line,
and printing waits for the frames to decode. `test-ui.mjs` renders **every preset** into an
iframe and measures it — page count, sheet overflow, cell overflow, cell width, image
containment, uniform frame height — plus the scene, toggle and colour options, so the layouts
can't quietly rot again.

## If this ever goes online

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
js/history.js     undo/redo for script text
js/editor.js      contenteditable window onto a Doc slice
js/board.js       scenes, cards, drag & drop
js/scriptmode.js  master script panel, capture, highlights
js/comments.js    comment list + ink layer
js/brand.js       house style, scene context, gendered-language check
js/personas.js    recurring people, places and things + reference-image wording
js/fields.js      the extra card text boxes, per project
js/personapanel.js the reference library + scene organizer
js/renders.js     full-size originals and clips, kept in the file by serial
js/refs.js        marks, the feed, and the boundary a model reads
js/refbox.js      the description box that draws a mark as a link
js/mentions.js    the @ popover
js/prompts.js     Gemini prompt writing
js/coverage.js    scene description -> shots, and the description rewrite
js/promptpanel.js the prompt table
js/settings.js    tabbed settings
js/versions.js    whole-project versions
js/pdf.js         contact-sheet print view
js/app.js         boot + wiring
```
