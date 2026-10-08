# Avatar DSL Face MOD

Release impact: **minor** (`stack-chan`). This opt-in MOD uses a native AVDS engine in the host. The standard Face and the existing `robot.ui.setFace(container)` API retain their behavior. Editor import and HTTP/NVS upload are outside this implementation.

## Build and use

Use Node, Moddable SDK **9.5.0**, and the repository build environment from `firmware/`:

```sh
npm run avatar-dsl:compile
npm run test:avatar-dsl
# Select the named build for your board. This command builds; it does not flash.
npm run build:release:m5stackchan_cores3
npm run mod:build -- mods/examples/avatar-dsl/manifest.json
```

**The native backend requires a newly built host.** An XSA MOD cannot install native C code. Loading this MOD on an old host reports the missing backend before replacing its Face. Build output is under `firmware/dist/`; installing a host or MOD is a separate operation.

`mod.js` selects `default`. To choose a preset within a MOD:

```js
import { createAvatarFace } from 'avatar-dsl/face'
const face = createAvatarFace({ preset: 'omega' }) // default / omega / aokko
robot.ui.setFace(face.content)
// When the MOD no longer needs the face:
face.dispose()
```

Include custom `.avbc` resources in the MOD manifest and pass `bytecode: new Resource('custom.avbc')`. Compile on PC or browser using the unchanged ESM `compile(source)` in `firmware/tools/avatar-dsl/compiler/compile.js`; the compiler is absent from the device bundle. Production manifest alias `avatar-dsl/face` selects `native-face.js`. Legacy `face.js`, `vm.js`, and `driver.js` remain reference implementations for testing and are absent from the production MOD.

Options remain MOD-local: `width/height/circular`, `variables` (AVDS IDs 12..40), `mouthForm`, `breathSource: 'state'`, and `budget: { instructions, draws }`. ID 32 initializes unspecified accessory slots from its mask; explicit IDs 33..40 override it. For example `{ 32: 255, 34: 0 }` disables only slot 1; `{ 27: 1, 32: 1 }` enables cheeks and accessory slot 0.

## Pinned compatibility

- Target develop base: `876b91ebc475fc05d8e196659c315bebca11bb7c`; native work starts from PR725 head `55d7785cedbb2cc386952850051db679b20c395f`.
- Reference: [ciniml/stackchan-idf](https://github.com/ciniml/stackchan-idf/tree/419385ef1b875137140085bd50d34dee331f30c2), commit `419385ef1b875137140085bd50d34dee331f30c2`.
- AVDS v1, numeric constants, pinned numeric opcodes, functions/locals/while, rectangle/circle/triangle, group hints, context IDs `0x00..0x28`, mouth_form, and accessories 0..7.
- The three preset sources and ESM compiler are unmodified; LF-normalized SHA-256 values are in [vendor/PROVENANCE.json](vendor/PROVENANCE.json). Generated preset bytecode is unchanged.
- User fork `meganetaaan/stackchan-idf` at `f2a04dd1c0ffb8a61e9f34588a2fca3bd41f2a90` lacks mouth_form/accessories. AVDS version alone does not identify these context additions.

Compatibility follows the pinned code: float32 operations, C++ `round(-0.5) == -1`, int16 coordinates truncated toward zero, RGB565 colors, boolean XOR for `~=`, and emitter `and/or` short-circuit operand values. User functions are void. The same code is tested against the upstream C++ RecordingCanvas; Piu and upstream LovyanGFX pixel equivalence is not promised.

| Host state | DSL context |
|---|---|
| NEUTRAL / ANGRY / SAD / HAPPY / SLEEPY / DOUBTFUL | 0 / 3 / 2 / 1 / 5 / 4 |
| COLD / HOT / unknown | NEUTRAL fallback |
| primary RGB | primary RGB565 |
| secondary RGB (host background) | background RGB565 |
| MOD accent (default yellow) | DSL secondary |
| independent eye openness | minimum, multiplied by native blink |
| independent gaze X/Y | average into shared gaze_h/v |
| mouth.open | mouth_open; unspecified mouthForm follows mouth_open |
| breath | default four-second sin `[-1,1]`; state mode uses clamped host breath |
| time | active elapsed milliseconds, uint32 wrap |

The shared DSL state cannot preserve independent winks or independent gaze. No additional saccade is added. The implemented `sin[-1,1]` follows upstream runtime behavior despite its documentation discrepancy. `preservePositionOnSwap=false` and `breathPixels=0` prevent host positional carryover and double breath movement.

## Native execution and safety

The native Piu Content owns its 33ms idle clock, blink/breath/time, bytecode VM, fixed Outline geometry, and Poco drawing on the XS/Piu thread. There is no JS `onTimeChanged`, JS VM, Shape/path construction loop, separate renderer task, or mandatory full framebuffer. JS performs configuration and marshals changed host FaceState. While visible with motion enabled, changed state is evaluated on the next native tick; motion-disabled or unbound faces prepare immediately. All 41 context float bits participate in reuse, including time; inputs are not decimated. Equal command buffers avoid redundant invalidation. Palette-only changes reuse geometry.

A bounded pool contains 32 native Outlines, each with space for 13 points. The renderer uses actual Piu/Poco/FreeType APIs. Groups retain upstream buffered-canvas ordering hints; they do not add clipping or coordinate transforms. Changed drawing invalidates the canvas and supports Piu partial redraws.

Programs own immutable copies of caller bytecode. Validation checks size (70,000 bytes), header/version/reserved fields, exact sections, finite constants, opcode operands/references, instruction-boundary jumps/functions, reachable local references, and fallthrough. Per frame: 12,000 instructions (maximum configurable 50,000), 96 drawing/group commands, 64 operand slots, 256 aggregate locals, 16 call frames, 16 nested groups, plus the 32-primitive pool limit. Finite/range checks reject invalid arithmetic, negative extents, out-of-range coordinates/colors, and unsafe buffer accesses. Construction has bounded temporary validation allocations; fixed per-frame storage does not establish an allocation-free claim for the whole host.

Frames are published only after successful execution. Decode, execution, pool, or configuration errors select the validated default preset, discard tuning/budget overrides, and retain validated canvas geometry. Failed code is not repeatedly executed. Read `content.behavior.failure` and `renderer.stats.failures` for diagnostics.

Pause, visibility loss, unbind, motion disable, and disposal stop the native clock; resume/show/reattach restores it. Hidden time is not added. Use `content.behavior.pause(content)` / `resume(content)` for explicit lifecycle control. Dispose is idempotent, stops and hides; native memory stays alive until the Piu object is collected, protecting pending draw references. Bytecode and native storage are then freed. ESP32 uses PSRAM for face storage when configured, with a normal heap fallback.

`renderer.stats` exposes VM/geometry times and counts, ticks, updates, preparations, raster submissions, failures, and fixed native storage bytes. `rasterSubmitUs` measures command submission only. Instrumented builds additionally measure the face's raster work with paired native Poco markers (`rasterUs`); neither includes panel transfer time. ESP32 durations use its microsecond clock; the desktop fallback uses process CPU time. `allocationStats()` and `NativeVM` are diagnostic exports. No physical 30fps, allocation-free, or whole-host leak-free result is claimed.

## Verification

```sh
npm run test:avatar-dsl
npm run test:unit
npm run check:architecture
# Linux C compiler; optional ASan/UBSan:
npm run test:avatar-dsl:native
AVDS_SANITIZE=1 npm run test:avatar-dsl:native
# Linux + SDK 9.5.0 + glib headers:
npm run test:avatar-dsl:native:render
# Recreate the independent oracle from a pinned checkout + tl_expected + g++:
AVATAR_DSL_UPSTREAM=/path/to/stackchan-idf npm run test:avatar-dsl:oracle
```

Native tests compare 192 pinned C++ command sequences, exercise numerical/corruption/budget cases and 500 deterministic mutations, verify caller mutation cannot alter decoded code, and run under sanitizers. XS tests exercise buffer views/receiver guards, safe fallback, repeated GC/disposal, one native evaluation clock, visibility/swap/pause/resume/motion stop, and absence of JS timer callbacks. The native render runner compares 73 frames with the unchanged JS/Piu implementation, nine cached redraw images, 36 state/full pairs and three actual cached partial/full sequences. A full automatic blink/breath cycle is checked against the reference. See [VALIDATION.md](VALIDATION.md) for results and remaining gaps.

The historical `tests/avatar-dsl-device` MOD measures the JS backend. The native diagnostic MOD is `tests/avatar-dsl-native-device`; it requires an instrumented host and driver `none`, and can be built without accessing hardware:

```sh
npm run mod:build -- mods/examples/avatar-dsl/tests/avatar-dsl-native-device/manifest.json
```

## Licenses

Target integration, binding, context, and tests are Apache-2.0. The native C engine is a **BSL-1.0** adaptation of the pinned upstream decoder/VM; its copyright, [license](../../../host/modules/ui/components/face/avatar-native/LICENSE-BSL-1.0), and [provenance](../../../host/modules/ui/components/face/avatar-native/PROVENANCE.md) remain distinct. The compiler, presets, bytecode, and legacy JS VM retain **BSL-1.0** and `2026 Kenta IDA <fuga@fugafuga.org>`; see [vendor/LICENSE-BSL-1.0](vendor/LICENSE-BSL-1.0) and the [compiler license](../../../tools/avatar-dsl/LICENSE-BSL-1.0). Moddable SDK sources keep their own licenses.
