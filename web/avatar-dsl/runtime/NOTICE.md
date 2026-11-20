# Runtime provenance and licenses

The checked-in `avds.wasm` is built from the firmware's existing `avds-engine.c` and `avds-render.c`, the shared `avds-outline.h`, `bridge.c`, and the installed Moddable SDK's `modules/commodetto/freetype/src/smooth/ftgrays.c`. No JavaScript VM or rasterizer copy is used. `avds-build.json` records source hashes, SDK revision, compiler version and artifact hash.

The native engine derives from ciniml/stackchan-idf commit `419385ef1b875137140085bd50d34dee331f30c2`, copyright 2026 Kenta IDA, under BSL-1.0. Its license and detailed provenance are in `firmware/host/modules/ui/components/face/avatar-native/LICENSE-BSL-1.0` and `PROVENANCE.md`. Strict group clipping comes from Stack-chan PR725 head `97197c362feacd8165158f62da6e917c726ce83d` plus local `9eb5c4aa22a6f1288c7693c3181e792123bdb5b3`. The clip planner and shared outline integration remain Apache-2.0.

The existing firmware `buildOutline` geometry is extracted into `avds-outline.h` and called from both integrations. The shared header is registered in the native manifest for incremental build dependencies.

The preview is based in part on the work of the FreeType Team, copyright 2000-2026 David Turner, Robert Wilhelm, and Werner Lemberg. The SDK's standalone gray rasterizer carries the FreeType Project License, included in LICENSE-FTL.txt. SDK modifications are retained by compiling its source directly.

The bridge's RGB565 compositing follows Moddable Poco's `doOutlineOpaqueSpan`, copyright 2017–2026 Moddable Tech, Inc. The bridge is LGPL-3.0-or-later; the LGPL and GPL texts accompany it. The source and build script permit replacing/relinking this component. Distribution must retain these notices and applicable source/relink rights. No commercial SDK contract or new browser SDK is needed for the local build.

Build tested with installed Moddable SDK revision `6ec053b83d1b00a27a19824e55bdf6a6101507a3`, Emscripten 5.0.1 and Clang 18. The standalone WASM has no host imports; the FreeType longjmp path uses WebAssembly exception handling. Modern browsers must support that WASM feature. Load failures propagate as a normal preview error.

## Current build and verification

The source tree is based on 457096bbad2c7482b14ccee56de0b9a15e27c311. Existing native outline formulas are shared without changing VM opcodes, limits, native interface or LCD transfers. SDK 10.0.1 uses its current FreeType standalone layout. FALL_THROUGH is defined as an empty portable annotation for this standalone build; the SDK raster source is not modified. See avds-build.json for current hashes and ../VALIDATION.md for measured results.

Rebuild with `MODDABLE=/path/to/sdk node web/avatar-dsl/build-wasm.mjs`. Run `MODDABLE=/path/to/sdk AVDS_NATIVE_PARITY=1 node --test web/avatar-dsl/runtime/runtime.test.mjs` to compare native and WASM VM commands, clipping plans and pixels. The optional historical firmware-reference test is not run by default. Old SDK capture results are not evidence of the newly built artifact.
