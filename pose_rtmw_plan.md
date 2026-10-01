# Pose Bench: RTMW3D as a second pose reader

Status: plan, 2026-10-01. Nothing is built yet.

## Why

The MediaPipe reader gets three things wrong most often:

- **Left/right flips:** it decides it is seeing someone from behind.
- **Limb depth:** an arm reaching toward the lens reads as hanging down.
- **Small or distant people:** feet, hands and the far side of the body fall apart.

RTMW3D, from the MMPose family (OpenMMLab, Apache-2.0), was trained on 14 merged datasets. It reads **133 whole-body points in 3D**: body, feet, 21 points per hand and 68 face points. It runs in the browser through ONNX Runtime Web, so the team needs no install.

## What exists (checked 2026-10-01)

| Item | Detail |
|---|---|
| Model | RTMW3D-X, 384×288 input, Cocktail14, Apache-2.0 |
| ONNX file | `https://huggingface.co/Soykaf/RTMW3D-x/resolve/main/onnx/rtmw3d-x_8xb64_cocktail14-384x288-b0a0eab7_20240626.onnx`, **369 MB** (fp32) |
| fp16 copy | not published; converting ourselves should give **~185 MB** |
| Runtime | `onnxruntime-web` 1.2x from jsDelivr, WebGPU first, wasm fallback |
| Speed | ~28 ms/frame for detector + RTMW3D on WebGPU with a discrete GPU (rtmlib-ts benchmark); ~110 ms on wasm. Integrated laptop GPUs will be slower; not measured |
| Reference code | `GOH23/rtmlib-ts` (Apache-2.0): SimCC decoding, preprocessing, the `zRange` 2.1745 constant |
| Output | per point: x, y in the crop (SimCC bins, split ratio 2), z in metres relative to the root, and a score |

**Not using:** the YOLO detectors that rtmlib-ts defaults to. They are Ultralytics, AGPL-3.0. We keep the MediaPipe EfficientDet person finder we already load.

## The design: a second engine behind the same pose object

Everything after detection already works on one shape:
`pose = {p: [33 × V3, hip-centred metres, figure space], v: [33 visibilities], img: [33 normalised image points], face?}`.

`retarget`, the glitch scan, `labelSwap`, smoothing and the head add-on all read only that. So RTMW3D comes in as **another way to fill that object**, and nothing downstream changes in phase 1.

```
photo / frame
   ├─ person boxes: MediaPipe EfficientDet (unchanged)
   └─ per box:
        engine = 'mediapipe' → poseInBox (unchanged)
        engine = 'rtmw3d'    → rtmCrop → ORT session → simccDecode → rtmToPose → same pose object
```

### New pieces (all in pose.html, beside the MediaPipe code)

1. **`rtmLoad()`**:
   - Lazily imports `onnxruntime-web` from jsDelivr, only when RTMW3D is picked, so nobody pays for it otherwise.
   - Fetches the model through the existing `modelBytes()` IndexedDB cache, with download progress shown in the panel.
   - Creates the session with `executionProviders: ['webgpu','wasm']`.
   - Handles 185–370 MB going over the browser's storage quota: it warns, runs from memory, and downloads again next session (rtmlib-ts does the same).
2. **`rtmCrop(src, box)`**:
   - Applies the RTMPose top-down affine: box centre and scale padded 1.25×, at a 288:384 aspect.
   - Normalises with the ImageNet mean/std.
   - Returns the tensor plus the inverse transform.
   - Colour order (RGB or BGR) is to be confirmed against rtmlib in M0.
3. **`simccDecode(outX, outY, outZ)`**:
   - argmax per point; x and y ÷ 2 (split ratio), mapped back through the inverse affine.
   - z bin → metres via `zRange`.
   - The score is the peak value, which becomes visibility.
4. **`rtmToPose(k133, scores, W, H)`**: the adapter to our 33 points.

   | MediaPipe 33 | from COCO-WholeBody 133 |
   |---|---|
   | nose, eyes, ears | 0, 1–2, 3–4 |
   | mouth corners 9/10 | face points 71/77 (68-point layout offsets) |
   | shoulders, elbows, wrists | 5–10 |
   | hips, knees, ankles | 11–16 |
   | heels 29/30 | feet 19 / 22 |
   | foot index 31/32 | big toes 17 / 20 |
   | pinky 17/18, index 19/20, thumb 21/22 | hand points: pinky MCP, index MCP, thumb tip (91+ left, 112+ right) |

   Then:
   - centre on the hip midpoint;
   - convert axes to figure space, with signs pinned down in M0 against a known photo;
   - check that left and right are the person's own, not the image's.
5. **Engine choice**: the Model dropdown gains **"Best: RTMW3D (≈185 MB once)"** under the three MediaPipe options. It's remembered per browser like the model choice is now.
   - The **webcam live mode stays MediaPipe**, because its per-frame tracking is what makes it smooth.
   - RTMW3D is for **photos and video files**, where a few tens of ms per frame doesn't matter.

### Phase 2 wins MediaPipe can't give

- **Real fingers.** We get 21 points per hand. Fit the existing `CURL` table per finger from the joint angles, so a pointing finger, a fist or a hand around a cup comes from the photo instead of a hand preset.
- **Head without the face model.** The 68 face points give the head's turn and tilt directly. That replaces the separate face-landmarker pass for photos.
- **Feet.** Toes and heels give real foot angles, for planted or tiptoe feet.

## Milestones

- **M0, spike and go/no-go (small).**
  - Load the ONNX in Chrome with real WebGPU, not headless swiftshader, which has no WebGPU; the headless tests use wasm.
  - Run it on 6–10 photos MediaPipe gets wrong, decode, and draw the 2D points over the photo.
  - Pin the axis signs and colour order.
  - **Compare depth on the arm-toward-lens cases.** RTMW3D's z is learned from fewer 3D datasets than its 2D is, so it may not beat MediaPipe on depth. If it doesn't, the fallback is its 2D points plus our own bone-length depth (the cheap fix #4).
  - **This decides whether the rest goes ahead.**
- **M1, photos.** Add `rtmLoad`, `rtmCrop`, `simccDecode` and `rtmToPose`, plus the engine choice, wired into `findPeople` / `camFromImage`. A/B renders: the same photos through both engines, side by side.
- **M2, video files.** Wire it into the clip scan. The glitch scan and smoothing are unchanged. Measure left/right swaps and jitter per clip against MediaPipe.
- **M3, hands, head and feet** from the extra points (phase 2 above).
- **M4, fp16 and hosting.**
  - Convert to fp16 once (Python `onnxconverter-common`).
  - Host the ~185 MB file where we control it, not a third party's repo that could vanish. Options: a Hugging Face repo you own (CORS is fine), or split into <100 MB parts on GitHub Pages and joined in the browser.
  - Check that fp16 keeps the accuracy.

## Risks

- **Download size:** 185 MB (fp16) once per browser, then cached. Fine on a desk; slow the first time on weak Wi-Fi. It's opt-in, never the default.
- **Weak GPUs:** team laptops with integrated graphics may run at hundreds of ms per frame. Fine for photos; a 30-second clip could take a minute or two. M2 measures this.
- **Depth may not improve** (see M0). Its 2D and left/right handling should still beat MediaPipe, and the hands are a gain either way.
- **storyboarder.html build:** ONNX Runtime is loaded from the CDN at run time, never inlined by `build.mjs`.

## Decisions needed

1. **Hosting (M4):** your own Hugging Face repo, or split parts on GitHub Pages?
2. **Default:** stay MediaPipe with RTMW3D opt-in (recommended), or make RTMW3D the default for photos once it's cached?
