# Prompt targeting — spec

Companion to `storyboard_app_spec.md`. Covers how a shot's tagged reference feed
reaches a target model, and what changes so that it reaches *every* target model
rather than MiniMax H3 alone.

Written against commit `e439f09`.

> **Status.** The video-inheritance work below the line is **done** — see
> "Shipped" at the end. What remains open is the numbering reconciliation (§2)
> and the rest of the capability profile (§1, §5). The one profile field that
> shipped is `videoRefs: 'frame-only' | 'full-reference'`, because it was the
> only capability fact that changed what a prompt CONTAINS rather than how it
> was worded. Treat §1's `refs` block as extending that field, not replacing it.


---

## 0. The principle this is built on

There are two kinds of unknown in a prompt request, and the current code gets
both of them backwards.

**What the board already knows.** Who is in the feed, in what order, which images
define them, which subject arrives partway through, which frame this shot is a
riff on. `h3.js` states the rule for these outright:

> Nothing here is guesswork, so none of it is worth a model call.

That is correct and it should be the rule everywhere. Today it is the rule in
exactly one file.

**What the board cannot know.** How *Kling* expects to be told about a reference
image. Whether *Ideogram* accepts one at all. That Runway names references with
an `@tag` and MiniMax with `<Picture N>`. The app has no source of truth for any
of this — it is baked into `MODEL_TPLS` by hand, and `MODEL_TPLS` has one entry.
Every other model falls back to `DEFAULT_REF_TEMPLATE`, which is one person's
guess, phrased for Qwen, and applied to sixteen models and three subject kinds.

So: **never ask a model what the board knows; ask it what only it knows, once,
and freeze the answer where a person can read and correct it.**

That split is the whole design below. §1–§4 remove model calls from the first
category. §5 adds them, carefully, to the second.

---

## 1. Data: the model profile

Replace the lone `referenceTemplate` string with a structured `refs` block on
each model record.

```js
{
  id: 'm_…',
  name: 'MiniMax H3 (Hailuo)',
  kind: 'video',                     // which role this model can be selected for
  imageTemplate: '…',
  videoTemplate: '…',

  refs: {
    image: {
      accepts: 3,                    // 0 = takes none · N = advisory cap · null = no known cap
      syntax: 'image {n}',           // how a slot is named in the written prompt
      subjectSyntax: '',             // optional second vocabulary (see below)
      wording: '…'                   // the old referenceTemplate, per role
    },
    video: {
      accepts: 4,
      syntax: '<Picture {n}>',
      subjectSyntax: '<Subject {n}>',
      firstFrameIsSlot1: true,       // does the shot's own first frame occupy slot 1
      wording: '…'
    }
  },

  tplSource: 'shipped@3',            // or 'user' once a template is edited
  profileSource: {
    by: 'shipped' | 'drafted' | 'user',
    model: 'gemini-2.5-pro',         // which writer drafted it, if drafted
    at: 1789000000000,
    note: 'Gen-4 references are named @tags, max 3.',
    confidence: 'high' | 'low'
  }
}
```

### Field notes

| Field | Meaning | Consequence when wrong |
|---|---|---|
| `accepts: 0` | This model is shown **no** images. | Feed images are described in full prose instead of cited. |
| `accepts: N` | Advisory cap; replaces the global `IMAGE_ADVICE = 4`. | Card warns past N instead of past 4 for everything. |
| `syntax` | Template for one slot; `{n}` = slot number, `{name}` = subject name. | The user hands files over in an order the prompt does not describe. |
| `subjectSyntax` | Present when the model separates *pictures* from *subjects* (H3 does; nothing else shipped does). Blank means one vocabulary. | H3's `<Subject N>` lines vanish or get invented. |
| `firstFrameIsSlot1` | Video only. `true` = the shot's own frame is slot 1 and references start at 2. | The off-by-one in §2. |
| `wording` | Free prose appended to the mapping — the current `referenceTemplate`, now per role. | "The person in image N" said about a location. |

`accepts` being per-role is the point. Today `personas.js` hardcodes the claim
that *every* video call gets exactly one picture, which is false for H3 (the
model that was supposedly fixed), and false for Kling elements, Veo, Runway
references, Seedance and Wan/VACE.

### Shipped seed values

Ship a table keyed by the names in `defaultModels()`.

**These are seeds, not gospel.** I do not have current, verified reference-input
limits for every model on that list, and they change with each release. Ship the
ones that are certain, mark the rest `confidence: 'low'`, and let §5.1 fill them
in. A wrong seed silently mis-numbers the files a person hands over, so a seed
nobody has confirmed must announce itself rather than sit there looking
authoritative.

| Model | image.accepts | video.accepts | Notes |
|---|---|---|---|
| MiniMax H3 (Hailuo) | — | ≥1, `firstFrameIsSlot1: true` | Known good; this is today's H3 path, generalised. |
| Nano Banana (Gemini Image) | multi | — | Known good; current default wording is roughly right. |
| Qwen-Image | multi | — | Known good; `DEFAULT_REF_TEMPLATE` was written for it. |
| Runway | — | small N, `syntax: '@{name}'` | Named tags, not numbers — closest thing to the app's own `@` marks. |
| Kling / Veo / Seedance / Wan / LTX / Sora / Flux 3 | — | low confidence | Reference support varies by version and tier. Draft and confirm. |
| Imagen / Ideogram / Midjourney | low confidence, likely `0` | — | Midjourney takes refs only via flags the app does not emit. |

The honest position on the bottom two rows is *the app does not know*, and the
profile should say so rather than default to "numbered, unlimited, phrased as a
person".

---

## 2. One numbering authority

Today there are two numbering schemes live in the same request:

```
personas.js block()          h3.js scaffold()
  image 1 = Ana (front)        <Picture 1> = the first frame
  image 2 = Ana (profile)      <Subject 1> = Ana (<Picture 2> and <Picture 3>)
  image 3 = The Floor (wide)   <Subject 2> = The Floor (<Picture 4>)
```

…and a third on disk, because `renders.js writeFeed()` names files from
`Refs.images()`, so the frame the prompt calls `<Picture 1>` is never written
into the feed folder at all.

**New: `SB.Feed.slots(p, shot, role)`** — the single ordered list, in `js/feed.js`.

```js
SB.Feed.slots(p, shot, 'video')
// → [
//   { n: 1, kind: 'frame',   id: null,   label: 'the first frame',
//     subjectN: null, img: {…}, render: null, sent: true,  why: '' },
//   { n: 2, kind: 'subject', id: 'per_a', label: 'Ana',
//     subjectN: 1,    img: {…}, render: {…}, sent: true,  why: '' },
//   { n: 3, kind: 'subject', id: 'per_a', label: 'Ana',
//     subjectN: 1,    img: {…}, render: null, sent: true,  why: '' },
//   { n: 4, kind: 'subject', id: 'per_b', label: 'The Floor',
//     subjectN: 2,    img: {…}, render: null, sent: false,
//     why: 'past this model’s 3-reference limit' }
// ]
```

Rules, all of them derived from the profile rather than assumed:

1. Order is `Refs.feed()`'s order, unchanged. Marks in the order written, then
   cast-but-unmentioned. That ordering is the one thing the person writing the
   sentence controls and it is not up for revision.
2. The shot's own first frame is prepended as `n: 1` **iff**
   `role === 'video' && profile.refs.video.firstFrameIsSlot1 && shot.image`.
3. `subjectN` counts distinct subjects, in feed order, skipping frames and
   anchors — this is `<Subject N>`. Null when `subjectSyntax` is blank.
4. Slots past `accepts` get `sent: false` and a `why`. They are still listed, so
   the card can say what is being left out rather than silently truncating.
5. When `accepts === 0`, every slot is `sent: false` with
   `why: 'this model takes no reference images'`, and the description-in-full
   fallback (§4) turns on.

**`SB.Feed.cite(profile, role, slot)`** renders one slot: `image 2`,
`<Picture 2>`, `@Ana`. Nothing else anywhere formats a slot reference.

### Consumers to rewire

| Consumer | Today | After |
|---|---|---|
| `board.js` feed strip | `Refs.images()` | `Feed.slots()` — shows the real numbers, greys out unsent slots |
| `board.js` "copy image set" tooltip | hand-written H3 caveat about the +1 offset | reads the slot list; the caveat becomes unnecessary |
| `personas.js block()` mapping | `image N = …` | `Feed.cite()` per slot |
| `h3.js labelTable()` | own numbering | `Feed.slots()` |
| `h3.js definitions()/retention()` | own numbering | `Feed.slots()` |
| `renders.js writeFeed()` | `e.n` from `Refs.images()` | `Feed.slots()`, **including the first frame** when it is slot 1 |
| `board.js` reference-count warning | global `IMAGE_ADVICE` | `profile.refs[role].accepts` |

`Refs.images()` stays as the thin "just the pictures" helper it is, but nothing
outside `feed.js` calls it for numbering.

### The export fix

`writeFeed()` must write the first frame as `1_frame_<code>.png` when it is slot
1, so the folder a person drags into MiniMax matches the prompt they pasted.
Also write a `_manifest.txt` beside the images:

```
Shot 1A — MiniMax H3 (Hailuo)
1  <Picture 1>  the first frame of this shot     1_frame_1a.png
2  <Picture 2>  Ana (front)                      2_00041_ana_front.png
3  <Picture 3>  Ana (profile)                    3_ana_profile.jpg
4  <Picture 4>  The Floor (wide)                 4_the-floor_wide.jpg
```

Cheap, and it is the artefact that makes a mis-numbering visible before the
render rather than after.

---

## 3. Kill the contradictions

Three edits, each removing a hardcoded assumption the profile now answers.

**3a. `personas.js:388` — the one-picture claim.**

```js
// today, fires for every video job except stock H3, which names its own cast:
'The image-to-video call is given ONE picture — the first frame — so the video
 prompt must not refer to image numbers. Name people and things by name there.'
```

Gate it on `profile.refs.video.accepts`. Emit it only when `accepts <= 1`. When
the model does take references, emit the mapping instead — the same mapping the
image role gets, cited with the video role's `syntax`.

**3b. `personas.js:342` — `{{N}}` → literal `'N'`, and "the person".**

`wording` becomes per-role and per-kind. Split `REF_TEMPLATES.numbered` into
three, one per `KINDS` entry, and emit only the ones the shot actually uses:

```
Refer to each recurring person as "the person in image N" and keep their face,
hair and wardrobe exactly as in that image.
Refer to each recurring location as "the place in image N" and keep its
architecture, surfaces and light exactly as in that image.
Refer to each recurring object as "the object in image N" and keep its form,
finish and markings exactly as in that image.
```

`KINDS` already carries `label`, `descLabel` and `noImage` per kind; this is the
fourth string that should have been there.

**3c. The H3 job's system block.** Once 3a is gated, the block stops telling the
H3 writer not to use the labels its own user prompt demands. Verify with the
§8 golden-request test.

---

## 4. Generalise H3 into "a labelled model"

`h3.js` is a good module that is named after one model. Nothing in it is
MiniMax-specific except the section list and the two constant soundscape
strings. Split it:

- **`js/scaffold.js`** — `slots`-driven; produces the label table, the
  definitions block and the retention block for any profile with a
  `subjectSyntax`. Generic.
- **`js/h3.js`** — keeps `SECTIONS`, `SOUNDSCAPE`, `MUSIC`, `assemble()` and the
  H3-shaped `problems()`. It becomes *the six-section format*, which is genuinely
  MiniMax's, and nothing else.

Template placeholders get renamed, `{{H3_LABELS}}` → `{{REF_LABELS}}`,
`{{H3_TASK}}` → `{{REF_TASK}}`, so any labelled model's template can use them.
`prompts.js contextFor()` populates them whenever the profile is labelled, not
when the model is H3.

### The `accepts: 0` fallback

When a model takes no references, the feed is not wasted — it becomes prose. The
subject descriptions the block already holds get promoted from "how they look,
for when you cite the image" to "how they look, because there is no image":

```
NO REFERENCE IMAGES ARE SENT TO THIS MODEL. Everything below has to survive in
the words alone — describe each subject fully, every time, in the terms given.
```

`KINDS[].noImage` already says exactly this per kind. Reuse it.

---

## 5. Where the thinking models help

Now the second category: what the board cannot know. Three jobs, in descending
order of value, each one call, each with a human gate.

### 5.1 Draft a profile — the main one

**Trigger:** user adds a model, renames one, or clicks *draft profile* on a row
whose `profileSource.confidence` is `low`. Never automatic, never per shot.

**Shape:** identical to `Personas.generate` — one `SB.Prompts.raw(text, schema,
system)` call returning records a person then edits. That precedent already
exists and works; this is the same pattern pointed at a different object.

```js
const PROFILE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    takesImageRefs: { type: 'BOOLEAN' },
    takesVideoRefs: { type: 'BOOLEAN' },
    maxRefs:        { type: 'INTEGER' },
    slotSyntax:     { type: 'STRING' },   // e.g. "image {n}", "<Picture {n}>", "@{name}"
    subjectSyntax:  { type: 'STRING' },   // "" when the model has one vocabulary
    firstFrameIsSlot1: { type: 'BOOLEAN' },
    wording:        { type: 'STRING' },   // one or two sentences, the model's own idiom
    note:           { type: 'STRING' },   // how it knows — a doc, a guide, a release
    confidence:     { type: 'STRING' }    // 'high' | 'low'
  },
  required: ['takesImageRefs', 'takesVideoRefs', 'maxRefs', 'slotSyntax',
             'wording', 'note', 'confidence']
};
```

The prompt tells it what the answer is *for* — that a person will physically drag
N files into this model in this order, and a wrong syntax means the numbering the
prompt promises is not the numbering the model reads. It is also told to answer
`confidence: 'low'` rather than guess, and that low confidence is a useful
answer, not a failure. That instruction matters more than the schema: the
failure mode here is not refusal, it is a confident invention.

**Guardrails** — a bad profile misdirects a person's files, so it does not go
live on the model's say-so:

1. **Human-confirmed.** The draft lands in the Settings row as a filled-in form,
   marked *drafted, unconfirmed*. Nothing uses it until the user hits *confirm*,
   which sets `profileSource.by = 'user'`.
2. **Show the consequence, not the JSON.** Under the form, render a live preview
   of the actual mapping block this profile would produce for a real shot:
   ```
   <Picture 2> = Ana (front)
   <Picture 3> = Ana (profile)
   ```
   Nobody can review `slotSyntax: "<Picture {n}>"`. Everybody can review that.
3. **Second opinion on demand.** A *check* button re-asks with the first answer
   withheld. Agreement raises confidence; disagreement pins the row to `low` and
   says the two answers differed. Self-consistency is cheap and it catches the
   confident invention that a single call cannot.
4. **Stamped.** `profileSource` records which writer, when, and the `note`. When
   the prompt is wrong six weeks later, the row says where the claim came from.
5. **Never silently re-drafted.** Renaming a model offers a re-draft; it does not
   perform one.

### 5.2 Draft the model-specific template

`MODEL_TPLS` has one entry because writing the H3 one meant reading a published
guide and turning it into 700 words. That is a task a thinking model does well
and a task that is currently the reason fifteen models share a generic template.

Same mechanism as 5.1, same gate: one call, the draft lands in the existing
template textarea in Settings, the user reads it and saves. Seeded with the shot
context so the placeholders come back correct, and validated on return —
a template referencing a placeholder that does not exist is rejected before it
is offered.

This is the step that actually answers "we fixed Minimax but nothing else". The
fix for Minimax was a person reading a spec. This makes that repeatable without
being a person-week per model.

### 5.3 One judgement-shaped check on the written prompt

`verify()` exists but only H3 supplies a `check`, and H3's check is a regex.

**Keep the regexes and generalise them.** Everything currently in
`h3.problems()` is deterministic and derivable from the profile — unknown label,
missing task bracket, forbidden dialogue syntax, short section. Build that
validator from `Feed.slots()` for any labelled profile. Do not spend a call on
what a regex can decide.

**Add exactly one model-shaped check**, because there is one failure regexes
cannot catch and the codebase keeps writing comments about it:

> Does the written prompt put someone in the first frame whom the description
> only had arriving later?

`personas.js` has three separate paragraphs fighting this, `brand.js` has a
whole rider, and `board.js` has a heuristic nudge button. It is a judgement
call about prose, which is precisely the shape of thing to ask. One call,
`{ ok: boolean, who: string[], why: string }`, feeding the existing corrective
pass.

Opt-in per project (Settings toggle, default on), and only on shots that have
someone marked as arriving — so it costs nothing on the shots where it cannot
fire.

### 5.4 What they must never be asked

Stated as a rule so it survives the next feature:

- The feed order, the slot numbers, `subject_definitions`, `retention_analysis`.
- Who is cast, who is marked, who arrives during the shot.
- Which images exist, which have full-size originals, what the files are called.
- Whether a shot is derived from another shot's frame.

All of it is on the board. All of it was once inferred and all of it was wrong
often enough to be worth writing down. `h3.js` fixed this for one model by
computing it; §2 does the same for the rest.

---

## 6. Fix `stock()`

```js
function stock(m) {
  return isH3(m) && m.videoTemplate === SB.Model.tplsFor(NAME).video;
}
```

Byte-identical comparison. Add a space to the template — or rename the model —
and the job silently drops to the plain path. Confirmed by running it: `LABELS`
renders empty, `{{REF_TASK}}` renders empty, the wrapper asks for key
`videoPrompt` while the template body asks for `summary` and
`detailed_description`, and `map`/`check` are both absent, so the four
app-written sections are never assembled. No warning anywhere.

The bug is that one flag is carrying two questions. Separate them:

- **Does this model use labels?** → `profile.refs[role].subjectSyntax` is
  non-empty. Survives template edits, which is the point: a person tweaking the
  wording did not ask to lose `subject_definitions`.
- **Has the user edited the shipped template?** → `tplSource !== 'shipped@N'`,
  set on edit in `settings.js`. Used only to decide whether a migration may
  overwrite the template, which is what the existing migrations already want.

Then a job is scaffolded whenever the profile is labelled, and the six-section
assembly runs whenever `profile.format === 'h3-six-section'` — a third small
field, explicit, rather than inferred from a string comparison.

**Also:** if a template contains `{{REF_LABELS}}` while the profile is not
labelled, that is a broken combination and the Settings row should say so
inline. It is the exact state the current code enters silently.

---

## 7. Migration

Runs in `model.js migrate()` beside the existing model fixups. Idempotent.

```js
s.models.forEach(function (m) {
  if (m.refs) return;                       // already migrated
  const seed = SEED_PROFILES[m.name] || null;
  const old  = typeof m.referenceTemplate === 'string' ? m.referenceTemplate : null;
  const edited = old !== null &&
                 old !== SB.Personas.DEFAULT_REF_TEMPLATE &&
                 old !== tplsFor(m.name).reference;

  m.refs = seed ? clone(seed) : defaultProfileFor(m.kind);

  // an edited wording is the user's and outranks the seed, in both roles
  if (edited) {
    m.refs.image.wording = old;
    m.refs.video.wording = old;
    m.profileSource = { by: 'user', at: Date.now() };
  } else {
    m.profileSource = seed
      ? { by: 'shipped', at: Date.now(), confidence: seed.confidence || 'high' }
      : { by: 'shipped', at: Date.now(), confidence: 'low' };
  }
  // a blank wording meant "send nothing" and still does — honour it (see cd44320)
  if (old === '') { m.refs.image.wording = m.refs.video.wording = ''; }
  delete m.referenceTemplate;
});
```

Notes:

- **`referenceTemplate` is dropped, not kept in parallel.** Two sources for the
  same string is how this file got here.
- **A blank wording keeps meaning "send nothing"** — commit `cd44320` made that
  deliberate and a migration that resurrects the default would undo it.
- **Existing H3 rows** get `firstFrameIsSlot1: true` and the labelled syntax, so
  boards mid-project keep behaving as they do now, minus the contradiction.
- **Unknown / user-added models** get `confidence: 'low'`, which surfaces the
  *draft profile* button rather than silently applying Qwen's phrasing.
- Frozen version snapshots hold whole model records. `versions.js` restores them
  through `migrate()` already; confirm a restored pre-migration snapshot comes
  back with `refs` populated — it should, but it is the case worth a test.

---

## 8. Tests

`test-prompts.mjs` already stubs the endpoint and inspects the request that
*would* be sent, which is exactly the right instrument. Add to
`prompt-scenario.js`:

1. **Golden request per profile shape.** One shot, first frame, two refs on a
   person, one on a location. Assert the built request for `accepts: 0`,
   `numbered`, and `labelled + firstFrameIsSlot1`. These are the three shapes;
   everything else is wording.
2. **No contradiction.** In a labelled video job, assert the system block does
   **not** contain `must not refer to image numbers`. This is defect 1 and it
   deserves a test that names it.
3. **One numbering.** Every slot citation in the system block and in the user
   text resolves to a slot in `Feed.slots()`, and the `n` values agree. This is
   defect 2, and it is a property, not an example — assert it over all three
   shapes.
4. **Kind-correct wording.** A location-only shot must not contain
   `the person in image`.
5. **Edited template keeps its scaffold.** Append a space to the H3 template;
   assert `REF_LABELS` still renders and the six sections still assemble. This
   is §6, and it is the regression that is easiest to reintroduce.
6. **Cap.** With `accepts: 2` and four feed images, assert slots 3–4 come back
   `sent: false` with a `why`, and that the card and the manifest both say so.
7. **Migration.** An old project with an edited `referenceTemplate` keeps that
   wording in both roles and comes out `by: 'user'`; one with a blank keeps the
   blank.

For §5, stub the drafting call and assert the *gate*, not the answer: a drafted
profile is inert until confirmed, and an unconfirmed row never reaches
`jobsFor`.

---

## 9. Order of work

Each step is shippable and testable on its own.

| # | Step | Why here |
|---|---|---|
| 1 | `js/feed.js` + `Feed.slots()`/`cite()`, `Refs.images()` left in place | Nothing depends on it yet; pure addition |
| 2 | Profile field + seeds + migration (§1, §7) | Data before behaviour |
| 3 | Rewire the six consumers to `Feed.slots()` (§2) | Kills defect 2 and the export mismatch |
| 4 | Gate the one-picture line and split the wording by kind (§3) | Kills defects 1 and 3 |
| 5 | Split `scaffold.js` out of `h3.js`, fix `stock()` (§4, §6) | Now safe: the profile answers what the string comparison was guessing |
| 6 | `accepts: 0` prose fallback (§4) | First new capability the profile buys |
| 7 | Profile drafting + Settings form and preview (§5.1) | Needs 2–5 to have something to fill in |
| 8 | Template drafting (§5.2) | Same UI surface as 7 |
| 9 | Generalised validator + the arrival check (§5.3) | Last; needs the profile to build the regexes from |

Steps 1–6 remove model calls and fix three confirmed defects. Steps 7–9 add
model calls, all of them gated, none of them per shot.

---

## Appendix — the confirmed defects

Reproduced by building a real request through `jobsFor()`: one shot with a first
frame, a person with two reference frames, a location with one, video model
MiniMax H3, image model Nano Banana.

**1. The H3 call contradicts itself.** `personas.js:388` fires for every video
job — personas.js has no H3 awareness. The system block says *"the video prompt
must not refer to image numbers. Name people and things by name there"* while the
user prompt demands `<Subject N>` labels and `h3.problems()` spends a corrective
call if the writer obeys the system block.

**2. Two numbering schemes, off by one, in one message.** `image 1 = Ana` beside
`<Subject 1> = Ana (<Picture 2> and <Picture 3>)`. On disk it is a third: the
frame the prompt calls `<Picture 1>` is never written to the feed folder.

**3. One generic wording, phrased for one model and one subject kind.**
`DEFAULT_REF_TEMPLATE` renders as *"Refer to each recurring subject as 'the
person in image N'"* — `{{N}}` substituted with the literal `N` — under a
`LOCATIONS` heading.

**4. `stock()` is a byte comparison.** One edited character silently drops the
scaffold, the labels, the task bracket, the corrective check and four of the six
sections, with no warning.


---

## Shipped — video prompts inherit the frame

The complaint that prompted it: video prompts came back re-describing the set,
the wardrobe and the grade — all of it already in the picture being handed over
— with the action reduced to a clause at the end. Image prompts were fine.

The cause was not the templates. A frame-only video job received four
instructions asking for the look and one asking for motion:

| Source | What it told the video writer |
|---|---|
| HOUSE STYLE, in full | focal length, aperture, depth of field, *"Finishing: Capture RAW, muted professional grade, subtle cinematic grain"* |
| `brand.js` closing line | *"Fold these requirements into the prompt itself as concrete description"* |
| `VIDEO_RIDER` | *"Hold the natural-light look and the clean exposure through the whole move"* |
| `personas.block()` | full wardrobe and appearance, *"the CURRENT and AUTHORITATIVE record of how these look"* |
| `VID_TPL` | *"Describe only what MOVES"* — one line, against all of the above |

`brand.js` already had the right reasoning written down for a **still derived
from another shot's frame** (`DERIVED_RIDER`: *"Do not re-describe the place, the
light, the lens, the grade or the wardrobe… Rebuilding the scene in words is what
makes an edit come back as a different shot"*), and `REFERENCE_RIDER`'s comment
already recorded the lesson that an exemption must be stated *after* the brand
and *phrased as an exemption* or the house style wins. An image-to-video call is
always in the derived position — the frame is always supplied — and nothing said
so.

**Changes**

- `model.js` — `videoRefs` on every model record; `videoInherits(m)` helper.
  H3 is `full-reference`, everything else `frame-only`. Migrated by name, so an
  edited template does not change what a model *is*.
- `model.js` — `VID_TPL` rewritten to lead with the frame being supplied and to
  ask for specific action (which hand, which direction, how far, how fast).
  `VID_TPL_V1` kept, and untouched copies are migrated forward; edited ones are
  left alone, same as the `IMG_TPL_V1` precedent.
- `brand.js` — the house style is no longer sent on a frame-only video job,
  replaced by the exemption paragraph. New `VIDEO_INHERIT_RIDER`. `VIDEO_RIDER`
  loses the line that asked for the look and gains "name the move and its speed"
  and "end the shot somewhere". The closing fold-in asks for *concrete MOVEMENT*
  instead of *concrete description*. `sequenceBlock`'s coherence line is scoped.
- `personas.js` — a frame-only video job gets a short cast block: subjects in
  the frame are **named, not described**; subjects who **arrive** during the shot
  keep their full description, because they are the one thing the frame cannot
  show. No numbered mapping, because that call is shown no reference images.
- A full-reference model keeps the long block, the mapping and the house style
  unchanged — there the appearance lines are the format, binding a label to a
  picture.

**Defect 1 from the appendix is fixed as a side effect.** The line telling every
video job it *"must not refer to image numbers"* was the thing contradicting
H3's own labels; it is now scoped to the combined job on a frame-only model,
where it is true. Asserted in `prompt-scenario.js`.

**Still open:** defects 2 (two numbering schemes, off by one, plus the export
mismatch), 3 (*"the person in image N"* said of a location) and 4 (`stock()` is
a byte comparison). §2, §3b and §6 respectively.
