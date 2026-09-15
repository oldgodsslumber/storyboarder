# The one reference a clip should carry besides its frame

## The circumstance

A subject marked **arrives partway through** is, by definition, not in the
first frame. Their appearance exists nowhere the video model can see it — only
as words in the prompt. That is the one case where a clip needs a picture it
was not handed as its frame, and it is narrow: everybody already in the frame
is already in the frame.

The app knows exactly who they are. It is the ◉ flag (`shot.castEnters`,
`Personas.enters`), which `videoCastBlock` already splits its two lists on and
which now lives on the first-frame lane.

## Why the still is limited to one reference, separately

Not a fact about GPT Image. ImagineArt's own `generate_image` declares:

```
image_url  ["null","string"]   Optional reference image URL.
```

One slot, one string — while `generate_video` on the same account declares
`image_url` as an **array**. The model takes more; the tool gives us one place
to put one. The only multi-image still path on the account is
`composite_shoot` (two or more images reconciled into one frame) which runs
**nano-banana-pro only**, takes **no prompt at all**, and needs a paid
organization. The app's badge should say whose limit it is; it currently reads
as though it were the model's.

## What the contract allows for video

```
Reference-to-video is supported only by these models:
  seedance-2.5, seedance-2.0, seedance-2.0-fast, happy_horse, wan-2.6, veo-3.1
      seedance-2.5 / 2.0 / 2.0-fast : image_url, video_url, audio_url (all optional)
      happy_horse                   : image_url (at least one REQUIRED)
      wan-2.6                       : video_url (at least one REQUIRED)
      veo-3.1                       : image_url (optional)
Sending reference media to any other model falls back to image-to-video
(first image) or text-to-video.
```

**Two things follow, and both matter more than the feature.**

### 1. LTX 2.3 — the board default — cannot take it

It is not on that list. A second image sent to LTX is **silently dropped** and
the call falls back to animating the first image. So on the default model this
feature cannot work at all, and the app must say so rather than appear to send
something it does not.

The five that can take an image reference: `seedance-2.5`, `seedance-2.0`,
`seedance-2.0-fast`, `veo-3.1`, `happy_horse`. (`wan-2.6` wants a *video*.)

### 2. A second image changes what the call IS

> exactly one image and no video_url/audio_url => **image-to-video** (animate a single still)
> two or more images => **reference-to-video**

Adding the arrival's photo stops the call being "animate this still" and makes
it "build a video from these references", of which the approved frame is now
merely the first. That is the same door the lane split closed, opening from the
other side — and it is the reason this has to be a deliberate, per-card
decision rather than something that happens because somebody clicked ◉.

## What I would build

**A per-card opt-in, offered only where it can work.**

On the video lane, when a card has at least one arriving person **and** the
chosen model is one of the five, a control appears beside the shoot row:

```
▸ 1  this card's frame
  2  Nat — arrives during the shot          [ send her picture too ▾ ]
```

- **Off** (the default): today's behaviour. The frame alone goes, Nat is
  described in words, and the lane says so.
- **On**: `image_url` becomes `[frame, natsReference]`, and the call becomes
  reference-to-video. The lane says *that* too, in as many words: "this stops
  the call animating your frame and starts it building from both pictures."

On a model that cannot take it, the row says which models can, and the control
is not offered — rather than offering something that would be dropped in
silence.

**The prompt follows the call.** `videoCastBlock` currently tells the writer
that an arrival's appearance is "the only record there will ever be" of what
they look like. When the picture is actually sent that is false and has to
become a binding — *"the second picture is Nat, who arrives during the shot;
match her to it"* — exactly as the still's mapping does. Two wordings, chosen
by what the call carries.

## Changes, by file

- **`js/imagine.js`** — `videoRefsFor(p, shot, slug)` returning the array to
  send and why; `takesRefs(slug)` parsed from the description's own list; the
  video push sends the array; `refsFor(…, 'video')` reports it.
- **`js/model.js`** — `shot.shoot.sendArrivals` (sparse, like the rest).
- **`js/promptpanel.js`** — the control, the lane's listing of what now
  travels, and the reason when it cannot.
- **`js/personas.js`** — `videoCastBlock` gains the bound wording.
- **`js/brand.js`** — the rider's "the camera is handed one picture" framing
  needs a second case.

## Tests

The array is `[frame]` on LTX whatever is marked; `[frame, ref]` on
seedance-2.5 with the opt-in on and an arriving person who has a reference
frame; `[frame]` with the opt-in on but nobody arriving; the control absent on
a model that cannot take it; the cast block binding the picture when it is sent
and saying "words only" when it is not; and a person arriving who has **no**
reference frame changing nothing, since there is no picture to send.

## The question that decides this

Your board default is LTX 2.3, and LTX cannot do this. Using it means picking
`seedance-2.5` or `veo-3.1` for the shots where somebody walks in — and
accepting that on those shots the model is building from two references rather
than strictly animating your approved frame. If that trade is not worth it, the
alternative is the one that costs nothing: keep the frame-only call and make
the arrival's *description* carry the weight, which is what happens today.
