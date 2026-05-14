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

The fallback is still important because the Piu `Port` public typings expose `drawTexture`/`fillTexture`, but not `drawBitmap`. The simulator build succeeds with the feature-detected bitmap path, while preserving the already-smoked mosaic path.

## Capture size

The drawer preview now requests `200x120` instead of `320x240`. That matches the preview rectangle and keeps a raw RGB565 frame at about 48 KiB. This is safer for both WASM and CoreS3-oriented experiments than allocating a full 320x240 frame for the first UI proof.

## Next likely direction

For a true non-mosaic live preview, the cleanest route is probably one of these:

1. Add/confirm a Piu `Port.drawBitmap` binding for the target runtime.
2. Add a tiny custom Piu content/native binding that draws a runtime `Bitmap` from an `ArrayBuffer`.
3. Keep Piu UI but render the camera frame with a lower-level Poco surface outside the normal `Image`/`Texture` resource path.

The contributed/examples research points more strongly at `Bitmap + Poco.drawBitmap` than at dynamic `Image`/`Texture` resources.
