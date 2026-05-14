# WASM camera preview rendering notes

This branch exposes a WASM camera preview through the simulator drawer. The camera backend returns `rgb565le` frames so the preview can stay close to the CoreS3 display format.

## Moddable references checked

The dynamic image path in Moddable splits into two layers:

- **Commodetto / Poco** can render pixels from an `ArrayBuffer`.
  - `documentation/commodetto/commodetto.md` shows `new Bitmap(width, height, Bitmap.RGB565LE, pixels, 0)` where `pixels` is an `ArrayBuffer`.
  - `commodetto/Poco` exposes `drawBitmap(...)` and `fillPattern(...)`.
  - Examples such as `examples/commodetto/jpeghttp/main.js` and `examples/commodetto/jpegstream/main.js` decode JPEG streams and draw the resulting bitmap with Poco.
- **Piu high-level Image / documented Texture use** is mostly resource-path based.
  - `documentation/piu/piu.md` documents `Image({ path: "...cs" })` and `Texture({ path: "...png" })`.
  - `Image` assets are compiled into `.cs` resources, and the documented/typed `Texture` constructor takes a path or `{ path }` dictionary.
  - However, `modules/piu/MC/piuMC.js` has an implementation-level `Texture(it, alphaBitmap, colorBitmap)` path. If `alphaBitmap` or `colorBitmap` is provided, it calls `PiuTexture_create` directly with Commodetto `Bitmap` host chunks. This means runtime bitmap texture may be possible on MC/Piu even though it is not exposed in the TypeScript typings.

## Current preview strategy

`camera-preview.ts` now tries the runtime texture path first:

1. Create a retained RGB565BE texture buffer by byte-swapping the `rgb565le` frame.
2. Create `new Bitmap(frame.width, frame.height, Bitmap.RGB565BE, textureBuffer, 0)`.
3. Wrap it with the MC implementation-level texture constructor: `new Texture(null, undefined, bitmap)`.
4. Draw it with the existing Piu `Port.drawTexture(...)` method.
5. If that path fails, try a hypothetical `Port.drawBitmap` method.
6. Otherwise fall back to the coarse `fillColor` mosaic preview.

The runtime `Bitmap` and `Texture` objects must be retained by the Piu behavior, not created as short-lived locals inside `onDraw`. `PiuTexture` stores pointers to the Commodetto bitmap pixels but does not mark the JS bitmap object, so letting the bitmap/texture go out of scope before the queued draw command runs can display random noise even though `render mode=texture` is reported. Browser-origin `Host.Camera` buffers are also copied once in the WASM camera shim before constructing the firmware frame, so the Bitmap sees an XS/WASM-owned `ArrayBuffer` rather than a transient bridge object.

The fallback is still important because the Piu `Port` public JS surface exposes `drawTexture`/`fillTexture`, but not `drawBitmap`:

- `modules/piu/All/piuAll.js` defines `Port.drawTexture`, `Port.fillTexture`, and `Port.fillColor` only.
- `modules/piu/All/piuPort.c` provides native `PiuPort_drawTexture`, `PiuPort_fillTexture`, and `PiuPort_fillColor` bindings, but no `PiuPort_drawBitmap` binding.
- `modules/piu/MC/piuMC.js` exposes a non-typed `Texture(it, alphaBitmap, colorBitmap)` path that can wrap Commodetto `Bitmap` host chunks.
- `commodetto/Poco.d.ts` exposes `drawBitmap(...)`, so the raw pixel path also exists one layer below Piu.

The simulator build succeeds with the feature-detected texture path, while preserving the already-smoked mosaic path. Browser smoke reports `render mode=texture`, confirming that `new Texture(null, undefined, rgb565Bitmap)` plus `Port.drawTexture(...)` avoids a custom Port for the WASM preview.

## Capture size

The drawer preview now requests `200x120` instead of `320x240`. That matches the preview rectangle and keeps a raw RGB565 frame at about 48 KiB. This is safer for both WASM and CoreS3-oriented experiments than allocating a full 320x240 frame for the first UI proof.

## Next likely direction

The first mainline path is now **runtime `Bitmap` -> implementation-level `Texture` -> `Port.drawTexture`**:

1. Create `new Bitmap(width, height, Bitmap.RGB565LE, frame.buffer, 0)`.
2. Wrap it with the MC implementation-level texture constructor, likely `new Texture(null, undefined, bitmap)` for color bits.
3. Draw it with the already-public `Port.drawTexture(texture, color, x, y, sx, sy, sw, sh)` path.
4. Keep the existing mosaic renderer as fallback and regression oracle.
   - Runtime texture success logs `render mode=texture`.
   - If not, smoke logs stay `render mode=mosaic`.

Because the texture path works in WASM, a custom native content/port is not the next step. If a later runtime needs one anyway, the name should stay camera-agnostic: `RuntimeBitmapPort` is the clearest name for a general Piu content that draws caller-provided pixel buffers; `BitmapPort` is shorter but easier to confuse with ordinary Commodetto `Bitmap` usage.

After WASM is green, map the same `rgb565le` frame contract onto CoreS3 camera capture. Start with single-frame preview, then move to repeated/live frames because repeated `ArrayBuffer` allocation and Piu invalidation cadence are the likely pressure points.
