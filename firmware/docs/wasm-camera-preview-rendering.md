# WASM camera preview rendering notes

This branch exposes a WASM camera preview through the simulator drawer. The camera backend returns `rgb565le` frames so the preview can stay close to the CoreS3 display format.

## Moddable references checked

The dynamic image path in Moddable splits into two layers:

- **Commodetto / Poco** can render pixels from an `ArrayBuffer`.
  - `documentation/commodetto/commodetto.md` shows `new Bitmap(width, height, Bitmap.RGB565LE, pixels, 0)` where `pixels` is an `ArrayBuffer`.
  - `commodetto/Poco` exposes `drawBitmap(...)` and `fillPattern(...)`.
  - Examples such as `examples/commodetto/jpeghttp/main.js` and `examples/commodetto/jpegstream/main.js` decode JPEG streams and draw the resulting bitmap with Poco.
- **Piu high-level Image / Texture** is mostly resource-path based.
  - `documentation/piu/piu.md` documents `Image({ path: "...cs" })` and `Texture({ path: "...png" })`.
  - `Image` assets are compiled into `.cs` resources, and `Texture` takes a file URL/path.
  - I did not find a public Piu `Image`/`Texture` constructor path that accepts an arbitrary runtime `ArrayBuffer` frame.

## Current preview strategy

`camera-preview.ts` now tries the direct-bitmap path first:

1. Create `new Bitmap(frame.width, frame.height, Bitmap.RGB565LE, frame.buffer, 0)`.
2. If the active Piu `Port` implementation exposes a `drawBitmap`-compatible method, draw the frame directly.
3. Otherwise fall back to the coarse `fillColor` mosaic preview.

The fallback is still important because the Piu `Port` public JS surface exposes `drawTexture`/`fillTexture`, but not `drawBitmap`:

- `modules/piu/All/piuAll.js` defines `Port.drawTexture`, `Port.fillTexture`, and `Port.fillColor` only.
- `modules/piu/All/piuPort.c` provides native `PiuPort_drawTexture`, `PiuPort_fillTexture`, and `PiuPort_fillColor` bindings, but no `PiuPort_drawBitmap` binding.
- `commodetto/Poco.d.ts` does expose `drawBitmap(...)`, so the raw pixel path exists one layer below Piu.

The simulator build succeeds with the feature-detected bitmap path, while preserving the already-smoked mosaic path. The browser smoke currently reports `render mode=mosaic`, which confirms that today’s Piu `Port` runtime does not expose a direct bitmap draw method.

## Capture size

The drawer preview now requests `200x120` instead of `320x240`. That matches the preview rectangle and keeps a raw RGB565 frame at about 48 KiB. This is safer for both WASM and CoreS3-oriented experiments than allocating a full 320x240 frame for the first UI proof.

## Next likely direction

The mainline direction is now **custom native content / binding that calls the Commodetto bitmap path**, not Piu `Image`/`Texture`.

Recommended next slice:

1. Add a tiny `CameraBitmapPort`-style module for WASM first.
   - JS side owns `frame.buffer` and dimensions.
   - Native side receives a Piu draw callback context or a Poco-compatible output and calls the same bitmap draw primitive used by Commodetto examples.
2. Keep the existing `Port` mosaic renderer as fallback and regression oracle.
   - If the native binding is absent, the preview still renders.
   - Smoke logs must say `render mode=bitmap` when the native path is active, otherwise `render mode=mosaic`.
3. After WASM is green, map the same `rgb565le` frame contract onto CoreS3 camera capture.
   - Start with single-frame preview.
   - Only then move to repeated/live frames, because repeated `ArrayBuffer` allocation and Piu invalidation cadence are the likely pressure points.

This points more strongly at `Bitmap + Poco.drawBitmap` through a small native seam than at dynamic `Image`/`Texture` resources.
