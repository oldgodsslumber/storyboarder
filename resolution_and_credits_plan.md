# Resolution, and what a push will cost — plan

Status: **built.** Resolution policy, the scraped price table, balance-delta measurement and
the clip confirmation are all in. Kept for the reasoning and for the numbers.

## 1. Resolution

`generate_video` takes a `resolution`, and the tool description carries a per-model
allow-list whose **first value is the default when you omit it** — which is the whole
problem:

| model | offers | gets by default |
|---|---|---|
| `ltx-2.3` | 1080p, 1440p, 2160p | **1080p** |
| `veo-3.1`, `veo-3.1-fast` | 720p, 1080p, 4k | 720p |
| `seedance-2.5`, `seedance-1.5-pro` | 480p, 720p | **480p** |
| `seedance-2.0`, `seedance-pro-fast` | 480p, 720p, 1080p | 480p |
| `wan-2.6`, `happy_horse` | 720p, 1080p | 720p |
| `pixverse-v6` | 360p, 540p, 720p, 1080p | 360p |
| `kling-2.6-pro`, `kling-o3`, `kling-3.0-pro`, `wan-2.2` | — | resolution is ignored |

So LTX is already giving you 1080p, and Seedance has been quietly giving you **480p**. That
is the bug hiding inside this request: no resolution was ever sent, so every model fell to
its own floor, and the floors are not the same.

`generate_image` has `resolution` and `quality` too, and its own per-model rules.

**The setting.** One per board, in Settings → ImagineArt, beside the aspect ratio:

```
Resolution   (o) the best each model offers
             ( ) 1080p where it is offered, otherwise the best below it
             ( ) whatever the model defaults to
```

Default it to **the best each model offers** — that is what "any model should be 1080p"
means once you notice LTX can do 2160p.

**Resolving it** at call time: take the model's allow-list (already parsed by `allowFor`),
order it numerically (`4k` = 2160), pick by policy, and send `resolution` only when the
model has a list. A model that ignores resolution is sent nothing, and the UI says so rather
than implying a choice was made.

**Saying it.** The push tooltip and the row's note carry the resolved value — `▶ shoot ·
kling-3.0-pro · 1080p` — because a silent downgrade to 480p is exactly the class of thing
this app has spent the week removing.

## 2. What it will cost

There is no cost estimate in any of the 96 tools. `get_balance` returns a balance, and
ImagineArt's own docs say the in-app tooltip is authoritative. But the docs also publish
**base credit tables** for every model, in markdown, which is a real source:

```
| Kling 3.0 Pro     | 300 | 3s–15s | 1080p             | …
| LTX 2.3           | 215 | 6s–10s | 1080p, 2160p      | …
| Google Veo 3.1    | 900 | 4s–8s  | 720p, 1080p, 4K   | …
| Seedance Pro Fast | 150 | 3s–12s | 480p, 720p, 1080p | …
| Wan 2.2           |  30 | 5s     | 720p              | …
```

…and for images, per-image and per-tier: `Nano Banana 2 — 49 (1K) / 73.5 (2K) / 98 (4K)`.

Three layers, the same shape as the model catalog, for the same reason:

1. **Published base cost.** `fetch-models.mjs` scrapes both credit pages into
   `js/imaginemodels.js` alongside the model list. Display names have to be matched to slugs
   (`Kling 3.0 Pro` → `kling-3.0-pro`, `Happy Horse` → `happy_horse`, `Seedance 2 Fast` →
   `seedance-2.0-fast`) — mostly mechanical, with a small override map for the rest.
2. **Measured cost, which is exact.** Read `get_balance` immediately before and after a
   push; the delta is what that generation actually cost at that model, duration and
   resolution. Record it per `(model, duration, resolution)` and prefer it over the base
   from then on. One real clip teaches the app the true price of that configuration, and it
   is the only figure that accounts for duration and resolution multipliers — which the
   published table explicitly does not.
3. **The balance itself**, already fetched, shown in the Prompts panel chip.

**Where it shows.**

- The push tooltip: *"about 300 credits — measured last time"* or *"about 215 credits — base
  price; longer or higher-resolution costs more"*, so the hedge is honest about which layer
  it came from.
- A confirmation before an expensive clip, with the number and the balance: *"Kling 3.0 Pro,
  10s, 1080p — about 300 credits. You have 4,210."* This is the thing the plan for the
  ImagineArt push promised and could not deliver without a price.
- The header chip goes amber when the balance would not cover the next push, and the Export
  panel's footer is the model for how to say it.

**What it cannot do, and should say:** the base table is the price at the model's *minimum*
duration and default settings. Until a configuration has been measured once, an estimate for
10 seconds at 2160p is a floor, not a price. The wording has to carry that, and the measured
layer is what removes the hedge.

## Order of work

1. Resolution policy: setting, resolver, and the resolved value on the tooltip. Small, and
   it stops the silent 480p today.
2. Credit scrape into the generated file, with the name→slug map.
3. Balance-delta measurement and the per-configuration store.
4. The confirm dialog for clips, and the amber balance.
