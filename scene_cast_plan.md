# Scene generation: new people unless mentioned

**Status: built 2026-09-29.** Decisions confirmed: (1) this scene's own cast counts as mentioned, (2) people only, (3) plain names count.

## The rule

When "Generate shots" boards a scene, a person already on the board is used **only if the
scene mentions them**. Anybody else the scene needs is a **new** subject, even if somebody
on the board would fit.

## Why it is inconsistent today

`coverage.js` → `buildGenPrompt` / `generate` leaves the choice to the writer model and
then quietly overrides what it chose:

1. **The prompt pushes reuse.** Every person on the board is listed under "THE BOARD'S
   PEOPLE — reuse one of these by name if they fit this scene", with "Reuse beats inventing,
   every time." Whether somebody "fits" is a judgement call, so it goes differently from run
   to run.
2. **Mentions are lost before the writer sees them.** The scene description goes through
   `SB.Refs.plain()`, which turns `@Nat` marks into the plain word "Nat". The writer can't
   tell a deliberate reference from an ordinary word.
3. **Name collisions reuse silently.** `findByName` matches any returned name against the
   whole board. If the writer invents a "Barista" and the board already has a Barista from
   scene 2, the new person becomes that existing Barista.
4. **Linking after the fact picks up more.** `SB.Refs.linkAll()` marks *every* board name
   that appears in the returned prose. The phrase "the barista" ends up linked to scene 2's
   Barista, who then gets pinned to the card along with their reference picture.
5. Smaller issues: the same "Name the places and things…" line appears twice in the system
   prompt, and places and things are listed under the heading "THE BOARD'S PEOPLE".

## The change: decide in code, then tell the writer

### 1. Work out who is mentioned before the call (`coverage.js`, new `mentionedCast(p, sc)`)

A person counts as **mentioned** if any of these is true:

- **Marked:** an `@` mark to them in the scene description (`SB.Refs.parse`).
- **Named:** their name appears as a whole word, ignoring case, in the scene description,
  the scene heading, the script stretch the scene claims, or the generate note. Use the same
  longest-name-first matching as `SB.Refs.unlinked`, so "Ops lead" wins over "Ops".
- **Already on this scene:** they are cast on one of this scene's existing cards
  (`castFor`). The scene already has them in it. *(Decision 1 below.)*

Only people count (`kindOf(per).id === 'person'`). *(Decision 2 below.)*

### 2. The prompt only offers the mentioned people (`buildGenPrompt`)

- Replace the "WHO IS ON CAMERA" rules with:
  - "IN THIS SCENE — reuse by exact name: …", listing the mentioned people only, with their
    descriptions.
  - "Everyone else the scene needs is a NEW person. Give each a short handle and a full
    description."
- Remove the "THE BOARD'S PEOPLE" list of people entirely. If they aren't in the prompt,
  the writer can't pick them.
- Add "NAMES ALREADY TAKEN — do not use these as handles: …" with every unmentioned
  person's name, so a new person doesn't arrive already wearing someone else's name.
- Delete "Reuse beats inventing, every time." Keep "Keep the cast as small as the scene
  honestly needs".
- Fix the duplicated system-prompt line, and make it point at the places/things list.

### 3. Enforce it when the results come back (`generate`)

- **Resolve returned names against the mentioned set only.** A match reuses that person.
  Anything else is minted as new.
- **A new name that collides** with an unmentioned person gets a numbered suffix
  ("Barista 2"), because names are how cards link to subjects and two with the same name
  break that link. It's still a new person.
- **Link only this run's cast.** Replace `SB.Refs.linkAll(p, description)` with a version
  limited to the resolved ids (`linkAll(p, text, { only: ids })`, a new option in
  `refs.js`). An unmentioned Barista is never marked, never pinned to the card, and never
  sends its picture.
- `idsFor`'s "one person in play owns the hands" fallback stays. It already works from
  this run's cast.

### 4. Say what happened (`board.js` → `runGen` status)

Currently the status reads "3 shots added · cast Ops lead". Change it to, for example:
"3 shots added · new: Ops lead, Barista 2 · reused: Nat". Then a reuse the user didn't
expect is obvious straight away, and the fix is to edit the description (add or remove the
mention) and regenerate. Undo already removes the people a run created.

### 5. Tests (`test-core.mjs`, stubbing `SB.Prompts.raw` as the coverage tests do)

- An unmentioned board person who would fit is **not** offered in the prompt and **not**
  reused, even when the writer returns their exact name. The result is a new "Barista 2".
- An `@`-marked person is offered and reused.
- A person named in plain text in the description or the claimed script is reused.
- A person already on this scene's cards is reused (per Decision 1).
- Returned prose that mentions an unmentioned name doesn't get it marked or pinned.
- Places and things are handled as Decision 2 settles.

Files: `js/coverage.js` (most of it), `js/refs.js` (the `only` option on `linkAll`),
`js/board.js` (the status line), `test-core.mjs`, then `node build.mjs`.

## Decisions to confirm

1. **People already on this scene's cards count as mentioned.** *Recommended: yes.*
   Generating more shots into a scene that already has Nat on its cards should keep Nat.
   A rule that minted a second Nat-alike there would be the bug in a new form.
2. **The rule covers people only.** *Recommended: people only for now.* Places and things
   keep today's behaviour: listed as "reuse if the scene is set there / uses it", never
   minted. The alternative is the same mention-only rule for locations too, so a scene
   that doesn't name "the Loading Dock" never gets it.
3. **A plain-text name counts as a mention, not just an `@` mark.** *Recommended: yes.*
   Scenes written before marks existed, and scripts, only have plain names. The downside:
   a generic handle like "Barista" matches the word "barista" in a new scene. The status
   line from step 4 makes that visible, and marks-only would be the stricter option.
