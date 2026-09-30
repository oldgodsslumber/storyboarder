# Build: a local LLM makes set pieces out of simple shapes

Status: **phase 1 built on `V3-posebench` (2026-09-30)**: Build box, Edit selected, Look & fix (a button), Storyboarder's Local provider as the endpoint. The library and the MCP bridge are phase 2, not built. `response_format` is not sent (Oobabooga ignores or rejects it depending on loader); the reply is parsed leniently, with one retry.

## Why

Pose Bench can pose people precisely, but the world around them is six hand-made props: chair, desk, table, laptop,
phone and cup. A shot in a car, a bus stop, a reception desk or an open-plan office has nothing to stand in, so the
blocking render shows figures in a void. MiniMax and Seedance then invent the set, and the framing and scale go
with it.

The idea: type "a sedan" or "an office with four desks facing a window", and the local model (Qwen 30B) builds it
from boxes and cylinders. A clay render only needs the set to read right in grey: the right size, in the right
place, the right shape at a glance.

## What you get

- **A Build box** in Pose Bench's Props panel. Type a request and press Build. A few seconds later it lands in the
  scene as one prop: movable, turnable, deletable, saved with the scene. Figures stand, sit and are framed against it
  like any prop, and it appears in the clay render and in the depth, normal and mask passes.
- **Refining by talking.** With a build selected, the same box edits it ("make it a pickup", "add a door on the
  left", "turn the desks to face the window"). The model gets the current parts and returns an edited list.
- **Look and fix** (optional, one click): the app captures the build from three angles and asks the vision model
  (qwen3-vl) "does this read as <request>? what's wrong?", then passes the fixes back to the builder once. This
  matters because spatial layout is a text model's weak spot (floating wheels, mirrored rooms), and a look catches
  most of it.
- **A library** (phase 2): save a build by name ("Gus's car", "our office"). Library builds live in the board, so
  every scene and teammate can drop them in.

## The part format (what the model writes)

The model returns JSON only, checked against a schema. It uses metres and Y up. The front of a build faces +Z, the
same as a figure.

```json
{
  "name": "sedan",
  "parts": [
    { "id": "body",  "shape": "box",      "size": [1.8, 0.7, 4.5], "at": [0, 0.55, 0] },
    { "id": "cabin", "shape": "box",      "size": [1.6, 0.6, 2.4], "at": [0, 1.2, -0.2], "shade": "dark" },
    { "id": "wheel", "shape": "cylinder", "size": [0.66, 0.24, 0.66], "at": [0.85, 0.33, 1.4], "rot": [0, 0, 90],
      "repeat": { "mirror": "x", "along": [0, 0, -2.8], "count": 2 } }
  ]
}
```

- **Shapes:** box, cylinder, sphere, cone, wedge (a ramp or windscreen), torus and plane. Each has `size`
  (a bounding box, in metres), `at` (its centre), and optionally `rot` (degrees), `shade` (light, mid or dark; clay
  stays grey) and `group`.
- **Helpers, so the model doesn't do the arithmetic:**
  - `repeat` (count, offset, or `mirror` across x or z) for wheels, desks, windows and chair rows;
  - `on` ("on": "desk_2") to sit a part on another's top;
  - `against` to butt it up to a side.

  These are the places models get numbers wrong.
- **Limits:** at most 200 parts after repeats, sizes between 1 cm and 30 m, and the whole build within 40 m. Anything
  outside is clamped, and the status line says so.

## How the model is steered

- **A system prompt:**
  - the format;
  - a short table of real sizes (car 4.5 × 1.8 × 1.5 m, door 0.9 × 2.1 m, desk 1.4 × 0.75 × 0.7 m, seat 0.45 m,
    ceiling 2.7 m, bus shelter, counter, bed, sofa);
  - rules: build on the floor (y ≥ 0), front faces +Z, rooms are open on the camera side (−Z wall and ceiling left
    off unless asked), 5 to 60 parts, no decoration below 5 cm.
- **Three worked examples** (a chair, a sedan, a small office), since a 30B model follows examples far better than
  rules.
- **Structured output:**
  - the JSON schema is sent as `response_format` / `json_schema`, which llama.cpp and recent Oobabooga loaders
    enforce;
  - where the loader ignores it, the reply is parsed leniently (first `{` to last `}`) and retried once with the
    parse error.
- **Qwen3 reasoning:** thinking stays on for the builder. It plans layouts better, and only the final JSON is read.
  (Liveplay found that qwen3-vl must never get `think:false`; the same care applies here.)

## After the model answers (app-side cleanup)

1. Expand the helpers (repeat, mirror, on, against) into plain parts.
2. Clamp the limits and drop anything malformed, counted in the status line ("2 parts skipped").
3. **Ground:** the lowest part's bottom goes to y = 0, unless the request says "floating" or "on the desk".
4. **Centre** the build on its footprint, so it drops where the camera is looking, like other props.
5. **Overlap sanity:** parts entirely inside another are removed (a model often doubles a body).

## Where it lives in the code

| File | Change |
|---|---|
| `posebench/pose.html` | `Prop` type `'build'` with `this.parts` (the expanded list) built from shared geometries; `snap()` stores `parts` and `name`, and older scenes simply lack the type. Build box, Build/Edit/Look buttons and status in the Props panel; `buildFromText(text, base)`, `expandParts(json)`, `cleanParts()`; the vision pass (three captures via `PoseBench.capture`) |
| `posebench/pose.html` (endpoint) | standalone: a Local model URL/model field in Pose Bench settings (default `http://127.0.0.1:5000`). Inside Storyboarder: the host sends its Local provider settings (URL, model, key) with the `posebench` open message, so there's no second place to set it. Calls go straight to `/v1/chat/completions` from the page (Oobabooga's API allows cross-origin) |
| `js/pose.js` | pass the Local provider settings to the bench; library builds stored on the project (phase 2), with `migrate` |
| `posebench/HANDOFF.md`, `README.md` | the format, the prompt, the limits |

A build is plain data in the scene, so a blocking with a car in it re-renders identically for anyone, with or
without a local model.

## Phase 2: an MCP bridge (so other tools can drive the scene)

A small Node server, `posebench/mcp/bridge.mjs`:

- **Its two sides:**
  - MCP (stdio) toward any client: Claude Desktop, LM Studio, Open WebUI, or Claude Code;
  - a WebSocket toward the open Pose Bench tab, which connects when "Allow remote control" is switched on
    (off by default; localhost only).
- **Tools:**
  - `list_scene`: figures, props and builds, with positions and sizes;
  - `add_build`: the part format above;
  - `edit_build`, `move` and `remove`;
  - `pose_figure`: a preset name or joint angles;
  - `set_camera`;
  - `capture`: returns the clay render as an image, so a client can look and iterate.
- Same part format, same validation. A client can't do anything the Build box can't.

## Tests

- **Parser and cleanup** (node, no model):
  - repeat, mirror, on and against expand to the right coordinates;
  - clamps, malformed parts dropped, grounding, centring, nested-duplicate removal;
  - old scenes load unchanged.
- **Round trip:** a build survives the scene JSON, undo/redo, the Storyboarder save, and a re-render at the same
  pixels.
- **Passes:** a build appears in depth, normal and mask (as a prop grey, never a figure colour).
- **Live model** (manual, with Qwen 30B loaded): ten stock requests. Car, van, bus stop, reception desk, 4-desk
  office, kitchen counter, sofa and coffee table, bed, park bench, lectern. Each checked in a front and a
  three-quarter capture, and the look-and-fix pass run on the failures. The results set the prompt and examples.

## Decisions to confirm

1. **Endpoint:** reuse Storyboarder's Local provider (Oobabooga, the Qwen you already run) (recommended), or a
   separate URL just for building.
2. **Look and fix:** a button you press (recommended, since it costs a vision call and some seconds), or always on.
3. **Library:** phase 2 as described, or straight away.
4. **MCP bridge:** phase 2 after the Build box works (recommended), or not at all.
