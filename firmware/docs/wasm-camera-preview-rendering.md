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
  - `modules/piu/MC/piuMC.js` has an implementation-level `Texture(it, alphaBitmap, colorBitmap)` path, but it is not safe for `ArrayBuffer`-backed camera frames in this branch. See the texture probe note below.

## Current preview strategy

`camera-preview.ts` now uses a custom `RuntimeBitmapPort` for runtime camera frames:

1. The WASM camera shim returns a local `ArrayBuffer` containing `rgb565le` pixels.
2. `camera-preview.ts` creates `new Bitmap(frame.width, frame.height, Bitmap.RGB565LE, frame.buffer, 0)`.
3. `RuntimeBitmapPort.drawBitmap(...)` stores that bitmap on the Piu Port object, then queues a custom native draw-content command.
4. The native `runtime-bitmap-port.c` draw callback runs during the queued Piu/Poco draw phase. It resolves the `Bitmap` host chunk, handles `ArrayBuffer`-backed bitmaps by reading `cb->bits.offset` plus the current ArrayBuffer pointer, disables GC while Poco consumes that pointer, and calls `PocoBitmapDraw(...)` directly.

This keeps the bridge camera-agnostic: `RuntimeBitmapPort` draws any runtime Commodetto `Bitmap`, not just camera frames.

## Why the earlier texture path is disabled

A runtime texture probe was tried with this shape:

1. Copy browser-origin `Host.Camera` frames once in the WASM camera shim so firmware receives a local `ArrayBuffer`.
2. Retain `buffer`, `Bitmap`, and `Texture` on the Piu behavior instead of creating them as locals in `onDraw`. This avoids a concrete lifetime bug: `PiuTextureMark` is empty, and `PiuTexture_create` copies raw pixel pointers into the texture host chunk, so local-only JS `Bitmap`/`Texture`/`ArrayBuffer` objects can be collected after `onDraw` queues the draw command but before the queued command consumes those pointers.
3. Byte-swap the `rgb565le` frame into an RGB565BE texture buffer.
4. Create `new Bitmap(frame.width, frame.height, Bitmap.RGB565BE, textureBuffer, 0)`.
5. Wrap it with the MC implementation-level texture constructor: `new Texture(null, undefined, bitmap)`.
6. Draw it with the existing Piu `Port.drawTexture(...)` method.

That removed the colorful random noise but still rendered effectively black/grayscale for `ArrayBuffer`-backed camera frames. The root cause is more specific than byte order: `PiuTexture_create` copies `cb->bits.data` into the texture, while `commodetto/Bitmap` uses `havePointer == 0` and stores a byte offset for relocatable `ArrayBuffer`-backed bitmaps. In other words, the MC runtime texture path cannot resolve arbitrary `ArrayBuffer` pixels without a native bridge.

## Fallback and logging

The coarse mosaic renderer remains as a fallback and regression oracle because it uses only public Piu `Port.fillColor(...)` calls. Expected smoke logs are now:

- `render mode=runtime-bitmap-port` when the native port is available.
- `render mode=mosaic` if the custom port cannot draw the frame.

## Capture size

The drawer preview requests `200x120` instead of `320x240`. That matches the preview rectangle and keeps a raw RGB565 frame at about 48 KiB. This is safer for both WASM and CoreS3-oriented experiments than allocating a full 320x240 frame for the first UI proof.

## Next likely direction

After WASM is green, map the same `rgb565le` frame contract onto CoreS3 camera capture. Start with single-frame preview, then move to repeated/live frames because repeated `ArrayBuffer` allocation and Piu invalidation cadence are the likely pressure points.
