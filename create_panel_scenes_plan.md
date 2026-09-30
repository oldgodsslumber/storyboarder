# Create panel: collapsible scenes, and a button per scene

Status: **built on `V3-posebench` (2026-09-30)**, with the recommended answer to all three decisions: the board's scene opens first, bands get **Write missing (n)**, the Missing/Stale filters are gone.

## Why

The Create panel opens as one long table: every shot of every scene, each with its thumbnail, description and both
prompt lanes. A board of eight scenes is a long scroll before you reach the one you came to work on. The scene bands
between the rows are thin labels and can't be acted on.

The filters in the header ("All · Missing · Stale · This scene") go unused. "This scene" is the only one aimed at
the real job, working a scene at a time, and it depends on which scene happens to be selected on the board.

## What changes

### 1. Every scene band becomes a header you can fold

```
▸ SCENE 3  Parking garage, night          5 shots · 2 prompts to write · 1 stale · ▶ 3/5 ready   [▢▢▢▢▢]
▾ SCENE 4  Gus's office                   4 shots · all written                                  [▢▢▢▢]
    (rows as today)
```

- **Click the band** (or ▸/▾) to fold or unfold that scene. Folded, the scene is one line.
- **The line always shows the scene's state:**
  - shots;
  - prompts still to write (the old Missing count);
  - prompts behind their cast (the old Stale count);
  - how many can be pushed now (the same count as the header's ▶ chip, for this scene);
  - a strip of tiny thumbnails (the frame, or the blocking render if there's no frame yet), so a folded scene is
    still recognisable at a glance.
- The counts go red or amber when there's work left, so the folded list works as a to-do list.
- **Alt-click a band** folds or unfolds every scene, the usual outliner gesture. There's also an explicit
  **Fold all / Unfold all** in the header for people who don't know it.

### 2. How the panel starts

- The **scene selected on the board** opens unfolded, and every other scene opens folded. If none is selected, the
  first scene with work left opens; if nothing has work left, the first scene.
- The panel opens **scrolled to that scene**.
- Fold states are remembered per board in this browser (localStorage, keyed by project id), so reopening the panel
  mid-session keeps what you had open. The scene you jump to from the board always opens, whatever was saved.
- This is a viewing preference, so it isn't saved in the project file, and teammates' boards open their own way.

### 3. Scene buttons replace the filter tabs

Header row 1 becomes:

```
Create   [1 Opening ●2] [2 Lobby] [3 Garage ●2 ▲1] [4 Office] [5 Rooftop ●4] …   Fold all · Unfold all   ✕
```

- **One button per scene**, showing its number and a short heading (full heading on hover). Small marks show work
  left: ● prompts to write, ▲ stale.
- **Click** a scene button to unfold that scene, fold the others and scroll to it. It's the quick "work on this
  scene" button.
- **Ctrl/Cmd-click** unfolds it as well, without folding the others, for comparing two scenes.
- **The button of any scene that's open is lit**, so the row doubles as a map of what's on screen.
- **Many scenes:** the row scrolls sideways instead of wrapping into a second header line. The buttons shrink to
  the number alone below a width (the heading is on hover).
- **The old filters go:** All, Missing and Stale disappear. Their counts now live on the scene buttons and bands,
  where they say *where* the work is, not only how much. This removes the "pinned rows" machinery (`pinned`,
  `pinFilter`, `visible`, `settled` and the "done" badge), which existed only to stop a filter pulling a row out
  from under the caret. With folding, a row never disappears while you're in it: folding is always something you
  did yourself.

### 4. Scene actions on the band (optional, see decision 2)

If wanted, each unfolded band gets a small action on its right: **Write missing (n)**. It writes every missing prompt
in that scene with the same writer the per-row buttons use, one call at a time, with the usual progress in the
status line. There's no push-all: pushes cost credits and stay per row.

## Files

| File | Change |
|---|---|
| `js/promptpanel.js` | the band becomes a header (`sceneBand(sc, rows)` with counts, thumb strip, fold toggle); fold state (`folded` map, `loadFolds`/`saveFolds` keyed by project id); scene button row replaces `lib-tabs` in `head()`; `renderNow` skips the rows of folded scenes; start-up rule in `open()`; filter and pinning code removed |
| `css/app.css` | `.pt-scene` as a sticky, clickable header (chevron, counts, thumb strip); `.pt-scenebtns` scrolling button row |
| `ui-scenario.js` | the filter-tab tests (Missing tab, "this scene" count, the pinned-row test around line 4110) are rewritten for folding: bands fold and unfold, the start state follows the board's selection, scene buttons open and scroll, counts match, and a row being typed in survives a render while its scene is open |
| `README.md` | the Create panel section |

## Tests

- **Start state:**
  - one scene open (the board's), the rest folded;
  - with nothing selected, the first scene with work;
  - scrolled to it.
- **Folding:** fold, unfold, Alt-click all, Fold all and Unfold all. The state survives closing and reopening,
  per project, and a missing or broken localStorage entry falls back to the start rule.
- **Scene buttons:** click opens one and closes the others; Ctrl-click adds; lit state matches what's open; the row
  scrolls sideways with twelve scenes.
- **Counts:** band and button counts equal what the old Missing and Stale filters counted, scene by scene, and they
  update live as a prompt is written, without a re-render stealing the caret.
- **No lost typing:** type in a row, have a clip land and the table re-render. The row, caret and text stay.

## Decisions to confirm

1. **Start state:** open only the scene selected on the board (recommended), or open everything folded.
2. **Per-scene "Write missing" button on the band:** add it (recommended, it's the natural scene-sized action), or
   leave writing per row as today.
3. **Remove the Missing and Stale filters outright** (recommended, their counts move onto the scenes), or keep them
   as a small "only show scenes with work left" toggle.
