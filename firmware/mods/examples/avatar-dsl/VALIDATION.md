# Strict group clipping and damage — 2026-10-09 build/raster validation

Base: PR725 remote head `97197c362feacd8165158f62da6e917c726ce83d`, independently cloned on branch `feat/avatar-dsl-group-clip`. No other checkout was modified. No push/merge or device access was performed. Earlier validation sections below describe historical implementations and device measurements; their group-hint and unchanged-preset claims do not describe this change.

`begin_group` now provides an absolute, half-open clip intersected with the canvas and all parents. Empty/offscreen groups suppress their children; `end_group` restores the parent. Ungrouped primitives retain the whole canvas. This is an intentional compatibility break from the prior PR and upstream group-hint renderer. Numeric VM/compiler/AVDS format and Face API remain unchanged. Release impact is **minor** for the new unreleased opt-in feature; existing preview custom programs must audit their declared extents. Bundled omega floor and collar group bounds are expanded and AVBC regenerated; pinned originals remain in `tests/upstream-presets`, and the original PR renderer in `tests/historical-face.js`.

Native preparation retains each visible clip/bounds in bounded storage. Damage unions old and new changed primitive bounds with conservative AA padding inside the clip. Common unchanged prefixes/suffixes avoid invalidating the collar when eye primitives are inserted/removed. Draw clears background in the damage area then replays intersecting current shapes in source order, including unchanged foreground/masks. First frames/background changes request full canvas; externally requested full redraws remain valid. 33ms native evaluation and raster quality are unchanged. No production JS drawing loop is added. Flattened clips use one temporary Poco stack entry, including correct pop handling on an empty intersection. Visible cached CBoxes avoid SDK int16 extent overflow while retaining full FreeType geometry.

Validation: Ubuntu 24.04 WSL x86_64, clean Moddable SDK 9.5.0, GCC 13.3.0:

- **432** serial unit tests, **78** architecture checks, full Biome (one existing informational constructor diagnostic), legacy-name and whitespace checks passed.
- Portable VM: **870** cases, including **192** archived pinned C++ sequences, **144** current preset contexts and **500** corruptions. ASan/UBSan passed.
- Render planner: **2,594** cases, including **1,005** independently rasterized continuous frame comparisons and **144** adapted preset images identical with/without clipping. Empty/offscreen/nested/16-depth/invalid/overflow cases passed; ASan/UBSan passed. The binary-coverage oracle computes the original command group stack independently; it does not stand in for actual AA testing.
- XS/Piu: existing **82** native/reference and cached redraw images passed (**25,190,400 BGRA bytes**), with native clock, full blink/breath cycle, lifecycle and fallback checks.
- New XS/Piu at **0/90/180/270 degrees**: per rotation **18** continuous damage/full pairs, **18** strict-clip JS reference pairs, **2** initial/runtime fallback pairs, **1** both-VM-failed retained-image pair, and **18** original preset appearance pairs: **228 pairs / 70,041,600 compared BGRA bytes**. Tests include AA at group edges, movement/shrink/removal, unchanged overlap/background masks, clip restoration, empty/offscreen children, 16 nested groups, nonzero canvas origin, background full damage, wide clips and extreme valid operands. Added explicit zero-size rect/circle 0/positive/0 slot shifts, overlapping primitive order changes and geometry-unchanged clip movement/shrink. The unchanged historical group-hint renderer explicitly differs outside the new clip. Each angle compares with a same-angle reference; orientation-dependent FreeType AA means no cross-angle byte identity claim.
- **All six release builds passed** with SDK 9.5.0, ESP-IDF v6.1 and Xtensa GCC 15.2.0: M5Stack, Core2, CoreS3, M5StackChan CoreS3, Stack-chan RT and Takao Core2 SG90. Build-only npm wrappers were used; IDF images and four staged bundle-target artifacts validated. Existing SDK/font warnings remain; one M5Stack directory timestamp was 0.01s ahead, but compilation/link and image/partition validation completed.
- Actual ESP32-S3 native C compilation passed for **0/90/180/270** using flags extracted from the completed release build. DWARF confirms `FT_Pos=4`, `PocoCoordinate=2`, `PocoDimension=2`, `PocoOutlineRecord=16` at 0 / `20` otherwise. Fixed `AvdsFaceState` storage is **13,872 bytes** at 0 / **14,128** otherwise on this MCU ABI; this is not live free-heap measurement.
- Independent read-only review found no confirmed production defect and also reviewed the additional test diff.

CI environment correction: the first group-only [Bundle run](https://github.com/stack-chan/stack-chan/actions/runs/38000664322) compiled all six release firmwares, but the separate CoreS3 ABI step could not find `xtensa-esp32s3-elf-gcc`. The build wrapper's ESP-IDF environment does not persist into another step. The ABI step now explicitly sources `$IDF_PATH/export.sh` after the xs-dev exports. This correction changes only the test environment, not the renderer or SPI implementation. The [Build run](https://github.com/stack-chan/stack-chan/actions/runs/38000664307) passed all tests, including the strict-clip raster suites.

Host payload estimates over 120 evaluations per workload, including the first full frame and retaining the old implementation's unchanged-command suppression:

| Preset | Mouth bytes / reduction | Blink bytes / reduction | Breath bytes / reduction | Dynamic bytes / reduction |
|---|---:|---:|---:|---:|
| default | 721,792 / 96.1% | 200,052 / 83.7% | 313,648 / 92.1% | 2,112,480 / 88.5% |
| omega | 540,976 / 97.0% | 200,052 / 83.7% | 434,832 / 71.7% | 2,048,878 / 88.5% |
| aokko | 721,792 / 96.1% | 280,482 / 77.2% | 554,170 / 86.1% | 1,128,908 / 93.9% |

Bytes = requested damage area × 2 for RGB565, before Piu merges invalidations and driver overhead. The old full-canvas policy uses the **same changed-command draw count**, not 120 mandatory redraws. The deterministic dynamic workload varies mouth, breath and expressions; this is not a reproduction of the earlier device benchmark. CPU clock over **165,696** repeated C prepare/damage calls took **34,471 μs** (~**0.208 μs/call**) on this host, including a volatile sink. It excludes VM/raster/transfer and is not a CPU improvement or ESP32 timing claim. XS reports **17,208 fixed native bytes** on the Linux 64-bit ABI. Native counters expose requested damage pixels/updates/full updates for future device measurement. One union rectangle includes gaps between distant changes; broad changes can still require full transfer.

Evidence and exact metrics: [group-clip-host-20261009.json](tests/measurements/group-clip-host-20261009.json). Logs/raw framebuffers are under `firmware/dist/avatar-dsl-{native,groups,damage}`. Reproduce from `firmware/`: `npm run test:avatar-dsl:native`, `AVDS_SANITIZE=1 npm run test:avatar-dsl:native`, `npm run test:avatar-dsl:damage`, `AVDS_SANITIZE=1 npm run test:avatar-dsl:damage`, `npm run test:avatar-dsl:native:render`, `npm run test:avatar-dsl:groups:rotations`; after `npm run build:release:m5stackchan_cores3`, run `npm run test:avatar-dsl:esp32:abi` in the same Linux SDK/ESP-IDF environment. Damage and all-rotation raster suites are wired into Build CI; the CoreS3 ABI check is wired into Bundle CI.

Remaining limits: actual device CPU/FPS/SPI bytes, panel flicker/trails, long soak and normal concurrent host effects remain unmeasured. At nonzero rotation the SDK places 8-byte `FT_Pos` after its 20-byte header on Linux64, a pre-existing unaligned layout. Normal x86 raster comparisons passed; the portable engine/planner sanitizer results do not claim complete rotated native/SDK alignment coverage. ESP32 uses 4-byte `FT_Pos`, and actual compilation verifies alignment for all four angles. No SDK modification was made. No prior device numbers below are attributed to the new clip implementation.

# Initial prototype validation — 2026-10-07

## Isolation and provenance

- Branch: `feat/avatar-dsl-face-mod`; independent worktree `task-2/stack-chan`.
- Fetched `origin/develop` and recorded base `876b91ebc475fc05d8e196659c315bebca11bb7c` before implementation.
- Original checkout retained its three untracked STL files; its tracked files, branch and HEAD were not changed.
- Reference: `ciniml/stackchan-idf@419385ef1b875137140085bd50d34dee331f30c2`. Compiler and three preset sources are unmodified; normalized-LF hashes and BSL-1.0 provenance are in `vendor/PROVENANCE.json`.
- Isolated Moddable SDK **9.5.0**, commit `b6e06ba70506a7381ffb28e09e3175bf4e99f305`; WSL OpenClaw/Linux x86-64, Node 24.19.0, g++20. Existing SDK installation was preserved. Builds used repository npm wrappers.
- Initial validation used no device connection, BLE operation, flash or printer operation. PR #725 is now Ready with auto-merge disabled; no merge has been performed. Subsequent user-authorized COM12 testing is recorded separately from these Linux measurements.

## Checks and evidence

| Check | Result |
|---|---|
| `npm run test:avatar-dsl` | 9 tests passed; all three compiled `.avbc` files byte-identical to the pinned compiler output |
| Independent C++ oracle | 192 exact RecordingCanvas command-sequence matches: 144 preset/expression/context cases and 48 numeric cases |
| Corrupt/hostile inputs | Header, sections, opcodes, references, jumps, finite/range, loop/draw budgets, stack/locals/call limits, transactional failure and 500 seeded mutations passed |
| Unit suite | TypeScript test compilation passed; 430 tests passed with Node `--test-concurrency=1` |
| Architecture | `npm run check:architecture`: 78 tests passed after the import layout correction |
| Linux XS/Piu renderer | 36 partial/full framebuffer pairs identical within Piu; 3 presets, 6 expressions, eyes/gaze/mouth, palette/accessories; native lifecycle and fallback passed |
| Safety fallback in native Piu | Malformed bytecode, infinite jump loop and 33 drawable primitives recovered to safe default |
| Face lifecycle | Actual detach/reattach, outgoing active timer suspension, pause/resume, motion disable/dispose; elapsed clock freezes during suspension |
| Visual inspection | 3×6 expression contact sheet inspected; RGB565-to-Piu palette checked, including BGRA capture red collar channel assertion |
| MOD local build | `npm run mod:build -- mods/examples/avatar-dsl/manifest.json` passed; `avatar-dsl.xsa` **31,586 bytes** |
| Bundle resources | Explicit three AVBC resources; DSL source/compiler excluded except runtime opcode definitions |
| Static checks | Full Biome CI (`--error-on-warnings`, 771 files), legacy-name check and `git diff --check` passed |

The initial concurrent `npm run test:unit` run encountered an existing generated module-alias race in `event-frame-queue.test.js` (428 passed, one file failed). That file passed independently. During import-layout revalidation, the local parallel run had 427 passes and 3 failures with generated `timer`/`mc` alias ENOENTs; the same complete suite passed serially (430/430). No unrelated host/test changes were made for these local alias failures. CI at the initial head `24b334b9` passed all 430 unit tests; its failure was the separate architecture import check described below.

Generated evidence is local and ignored by Git:

- `firmware/dist/avatar-dsl-unit-focused.log`
- `firmware/dist/avatar-dsl-unit-serial.log`
- `firmware/dist/avatar-dsl-unit-parallel.log`, `avatar-dsl-architecture.log`, `avatar-dsl-oracle.log`, `avatar-dsl-biome-ci.log`, `avatar-dsl-legacy-names.log`
- `firmware/dist/avatar-dsl-render/test.log`, `render.log`, frame captures, `contact-sheet.png` and `contact-sheet.html`
- `firmware/dist/avatar-dsl-mod-build.log`
- `firmware/dist/bin/esp32/debug/avatar-dsl/avatar-dsl.xsa`

Reproduce normal checks using the README commands. Regenerating the oracle requires the pinned upstream checkout and its `tl_expected` submodule; normal tests use the checked-in fixtures and require neither C++ nor network access.

## Measurements and limits

These are **Linux XS measurements**, not ESP32 throughput. Millisecond resolution, one final run; no statistical confidence or device FPS claim. VM timing excludes Piu drawing. Render preparation includes context update, VM execution and changed Outline/Skin construction, but excludes asynchronous rasterization and display transfer.

| Preset | VM 500 frames total / mean | Render preparation 120 frames total / mean | Maximum instructions / commands observed |
|---|---|---|---|
| default | 705 ms / 1.410 ms | 238 ms / 1.983 ms | 710 / 25 |
| omega | 858 ms / 1.716 ms | 266 ms / 2.217 ms | 848 / 34 |
| aokko | 602 ms / 1.204 ms | 240 ms / 2.000 ms | 534 / 21 |

After explicit GC, Instrumentation reported these XS byte counts for the **whole three-face test application**, not an isolated face. Native Outline/OS memory is not included. Instrumentation GC counters reset between samples and are not a per-frame allocation estimate.

| Point | XS slots bytes | XS chunks bytes |
|---|---:|---:|
| Three faces created | 86,496 | 127,720 |
| Render warmup | 87,168 | 131,440 |
| 360 changed render preparations | 95,488 | 137,720 |
| 72 render steps and lifecycle checks | 95,072 | 144,368 |

The command buffers and 96-Shape pool retained their identity over repeated frames. Paths, Outlines, Skins and typed-array views still allocate; the above snapshots do not establish a leak-free or allocation-free renderer. A representative native rendering run used up to 2,520 display-list bytes and 1,132 command-list bytes, within the host's existing 4,096-byte limits.

The renderer limits drawable primitives to 32 before handing them to Piu. A separate 3-preset × 6-expression × 101-mouth-level sweep with cheeks/accessory enabled used at most 26 primitives. This guard is an initial bound, not a proof that arbitrary custom geometry or simultaneous full host effects/status UI fit Piu's global lists.

Remaining validation: physical device RAM/GC/native Outline cost, real display-transfer FPS, complete host UI/effects/controller integration under load, every supported hardware target and long-duration soak. Piu and LovyanGFX rasterization differ; no upstream pixel identity is promised. Further performance work should measure on the device first, then consider Outline reuse and reducing changed path construction. Editor import, HTTP/NVS upload and host API expansion remain a later phase.

## PR #725 import layout correction

The initial [Build workflow](https://github.com/stack-chan/stack-chan/actions/runs/37567413202) at `24b334b9` passed the 430 unit tests but failed one architecture check (77/78): production imports must use manifest module names. It flagged five imports in `face.js`/`vm.js` and five in the unmodified PC compiler. This was not the local alias failure. The initial [Bundle workflow](https://github.com/stack-chan/stack-chan/actions/runs/37567413270) passed all six release targets and bundle assembly.

The correction changes the five runtime imports to existing `avatar-dsl/...` aliases and adds MOD-local package exports for the Node pure modules. The complete PC/browser compiler moves, without source edits, to `firmware/tools/avatar-dsl/compiler/`, outside the production-source roots. Its runtime opcode snapshot stays in the MOD. Both opcode copies and all relocated sources are hash-checked against the same pinned provenance; BSL-1.0 text is present beside the desktop compiler as well as in the MOD.

No host implementation/API, manifest alias, architecture rule or CI configuration was changed. Local revalidation passed 78 architecture tests, 9 focused tests, all 192 regenerated upstream C++ command sequences, 430 serial unit tests, 36 Piu framebuffer pairs/lifecycle checks, the MOD local build, full Biome CI and legacy-name checks. Recompilation/regeneration leaves the three AVBC presets and oracle fixtures unchanged. The measurements above are from this revalidation run; new-head CI results are tracked on PR #725.


## Review corrections

Release impact: **minor** for `stack-chan`; `.changeset/avatar-dsl-face-mod.md` records the new opt-in installable feature. PR #725 is Ready, not Draft.

Explicit accessory IDs 33..40 now take precedence over mask ID 32. Regression coverage exercises all eight slots, explicit enable/disable with a mask, accepted numeric-key spellings, and command equivalence against mask-driven rendering for all three presets.

Both constructor/decode failure and runtime failure preserve validated width, height and circular geometry while dropping tuning/budget overrides. Native Piu tests exercise 240x240 circular fallback, hostile tuning reset, and subsequent fallback frames.

After these corrections: 10 focused Node tests, 431 serial unit tests, 78 architecture checks, all 192 checked-in C++ oracle comparisons, 36 partial/full Piu framebuffer pairs, native lifecycle/recovery, MOD build (31,934 bytes), full Biome CI and legacy-name validation passed. The temporary device-host manifest added one locally scanned file; it is excluded from the commit. No compiler/preset/resource source changes were made.

This run's Linux VM means were 1.448 / 1.756 / 1.234 ms and render preparation means 1.975 / 2.242 / 2.008 ms for default / omega / aokko. After the final explicit GC, the whole test application used 95,456 XS slot bytes and 144,368 XS chunk bytes. These remain desktop measurements, excluding panel transfer and native Outline memory.

Read-only device preflight matched COM12, USB 303A:1001, serial/MAC 44:1B:F6:E2:82:B0, ESP32-S3 revision 0.2 and 16MB. The existing app descriptor is 9.5.0+stackchan.1 (Moddable 9.5.0, host API 1). Only partition/app-descriptor/boot-header metadata were read; no NVS backup or full-flash backup was created. Hardware render validation is a separate, subsequently authorized phase.

## Measured optimization — 2026-10-08 JST

The user accepted the previous default face as having no missing pixels, clipping, flicker or trails, and authorized continued optimization, MOD writes and updates to PR #725. Local/remote/PR heads matched `fbf282f88f837fec2e77a5bc2e8342999fcda067` before work and again before device writes. Original checkout and host product code were preserved.

The physical comparison used **the same instrumented diagnostic host**, SHA-256 `e6a951d4eee308fd06ff26b809629875ebf0e7ada9d42ff810da8a76061a1401`, 6,782,768 bytes: **driver none locked, Wi-Fi manifest skip, head LED null**. The live app digest matched before both XS-only installs; the host was not rewritten. This is not a #724 fix or verification of the normal host's Wi-Fi/head LED/effects/servo path. No NVS/settings erase, new device backup, full erase, Offline choice, servo command, BLE or printer action occurred.

At boot, SDK 9.5.0 `fxMapArchive` legitimately rewrites XSA symbol/profile identifiers in flash, so an installed MOD does not retain its preboot whole-file digest. Initial identity verification compared every immutable byte and all 1,381 mapped references to the original 31,934-byte default archive (immutable SHA-256 `19b2549dcc477d71c661bdb9ababaa699b1d3c4db647e9955931cc81b16a827a`). The optimized diagnostic archive was likewise checked before restoring the usual MOD. These checks read only the known XS archive span into memory and did not save device contents. Each replacement used the existing partition-discovery installer and passed immediate preboot digest verification.

Changes: predecode validated instructions into fixed opcode/operand arrays, translate jumps/function entries once, bind pinned opcode values once, keep execution cursors/storage references local and round through Float32Array writes. Each original instruction still consumes the same budget; stack64/locals256/call16/groups16, finite/range checks, draw budgets and atomic fallback remain. Renderer reuse requires bit-identical values for **all 41 context slots**, including time and signed zero. Changed clock/state values evaluate immediately. Palette-only changes retain geometry; command copying no longer allocates a subarray view. No timer frequency, input function or meaningful frame is reduced.

An intermediate implementation hit native XS stack overflow on the 12,000-instruction infinite-loop test: `continue` inside `switch` left switch values on the XS stack. The final loop finishes each switch before advancing, and native bounded-loop recovery passes. This was detected before device installation. SDK/host code was not modified.

Final local verification: **11 focused tests, 432 serial unit tests, 78 architecture checks**, all 192 C++ command sequences, 500 seeded corruptions, numeric/range and execution-budget tests. Added mixed-width backward/forward branch coverage, exact budget counts, maximum 65,535-byte code-section jump indices and fixed predecoded-storage identity. Native Piu verifies identical-context reuse, immediate clock/mouth/palette changes, palette geometry identity, existing lifecycle/recovery and 36 partial/full pairs. **All first 73 captured frames match the previous head byte for byte: 22,425,600 BGRA bytes, no differences.** Full Biome CI, legacy-name checks and production/diagnostic MOD builds passed. Production archive is 33,634 bytes (previous 31,934); diagnostic archive is 39,722 bytes.

| Same physical dynamic workload | default before → after | omega before → after | aokko before → after |
|---|---:|---:|---:|
| VM mean, 100 frames (ms) | 101.24 → 73.26 | 123.19 → 89.14 | 88.19 → 67.83 |
| Render preparation mean (ms) | 89.298 → 68.647 | 120.494 → 91.944 | 141.013 → 108.817 |
| Frames drawn/s | 3.273 → 5.200 | 3.364 → 4.000 | 2.636 → 3.636 |
| Active CPU mean (%) | 99.0 → 99.0 | 99.091 → 99.0 | 99.182 → 99.091 |
| Whole-app GC/s | 0.182 → 0.300 | 0.545 → 0.600 | 0.545 → 0.364 |

The checked-in `tests/avatar-dsl-device/manifest.json` reproduces the previous workload: six host expressions, eye/mouth/shared-gaze mapping, 100 standalone VM calls, a 12-second dynamic phase with both the unchanged 33ms state timer and Face timer, motion stop, swap/disposal, hidden-main/show-face, and circular malformed/infinite-loop fallback. **65 checks passed.** FPS uses actual SDK `Frames drawn` counters; there is no FPS target or skipped-frame counter. Discard first/last instrumentation interval at phase boundaries: 11 samples/preset before, 10/10/11 after. Single runs, millisecond VM timing; preparation excludes asynchronous rasterization/panel transfer. Different contexts are used for standalone VM and preparation measurements, so their means cannot be subtracted to isolate renderer cost.

| After explicit GC, whole diagnostic application | XS slots before → after (bytes) | XS chunks before → after (bytes) | System free before → after (bytes) |
|---|---:|---:|---:|
| Host before face | 284,000 → 285,456 | 61,360 → 61,508 | 8,030,103 → 8,030,103 |
| Default after dynamic | 284,752 → 285,856 | 102,528 → 107,060 | 8,006,871 → 8,006,891 |
| Omega after dynamic | 294,896 → 295,840 | 137,108 → 144,972 | 8,003,779 → 8,003,803 |
| Aokko after dynamic | 294,816 → 295,760 | 133,540 → 139,996 | 8,004,847 → 7,984,375 |
| Completed default recovery | 300,000 → 300,976 | 153,548 → 160,584 | 7,985,383 → 7,985,383 |

Raw resident decoded arrays use 4,931 / 5,496 / 2,765 bytes per default / omega / aokko program, plus VM buffers and object overhead. They replace retained bytecode/constant/boundary buffers. Each Face also owns a safe-default VM. At most 65,535 decoded instructions and 256 functions give 329,211 array bytes/program; temporary validation/translation buffers are additionally allocated at construction. Whole-application heap snapshots include test locals, other faces and framework activity; native Outline memory is outside XS heap counts. These results are not a leak-free/allocation-free claim.

Linux XS VM means improved from 1.448 / 1.756 / 1.234 ms to **0.918 / 1.118 / 0.784 ms**; preparation means are 1.458 / 1.600 / 1.408 ms. Native limits and pixel comparisons passed. These desktop numbers are not physical throughput.

Generated evidence: `dist/avatar-dsl-optimization/baseline/` (previous local captures/results), `pixel-comparison.json`, `serial.log`, `device-result.json`, `device-install.log`, `current-mod-verify.log`, `default-install.log`, `default-serial.log`; existing focused/unit/static/render/build logs remain under `dist/`. These contain no device backup.

Performance remains CPU-bound and far below 30fps. Next work should profile opcode dispatch and Piu path/rasterization independently under the same workload, then measure bounded fast paths; arbitrary frame decimation is not a solution. A native VM or broader host change needs separate scope. Long soak, simultaneous full host effects, normal Wi-Fi/LED startup, servo motion and updated physical visual acceptance remain unverified. Usual default MOD restoration and its steady FPS are recorded below.

The **usual default MOD** was installed, digest-verified and rebooted to `app behaviors ready` on the unchanged diagnostic host. Repeated before/after 35-second captures use the same **21 interior one-second samples after readiness**, excluding the first interval: **5.190 → 6.048 Frames drawn/s**, ranges 2..8 → 2..9, active CPU 98.952% → 99.000%, whole-app GC/s 0.143 → 0.190. The earlier baseline run was 5.381 FPS; run-to-run variation is visible. This is the final device state, with default shown. `default-result.json` records the comparison. The user's prior visual acceptance applies to the baseline; updated physical clipping/flicker/trails/blink observation has not been independently confirmed.

## Native backend validation — 2026-10-08

Native branch starts at PR725 head `55d7785cedbb2cc386952850051db679b20c395f`; pinned target develop remains `876b91ebc475fc05d8e196659c315bebca11bb7c`. The original dirty checkout's local develop `b31bc0d9c8b87a4d1a6bdcf3df1343aae925c322` was preserved. No preset/compiler/bytecode source changed.

Production animation now runs its clock, AVDS VM, geometry and Poco drawing in C on the XS/Piu thread. JS only constructs/configures the face and forwards changed host state. Visible motion updates share the next native 33ms evaluation tick; motion-disabled/unbound updates prepare immediately. This requires a rebuilt host. The host Face API and standard face behavior are unchanged.

Local verification passed:

- Portable C: **726 cases**, including **192 exact pinned C++ RecordingCanvas sequences**, **500 deterministic corruptions**, numerical/range/stack/locals/call/draw limits, infinite loops and immutable caller buffers. Normal and ASan/UBSan builds passed with `-Wall -Wextra -Werror`.
- Linux XS/Piu: all 192 oracle cases, unaligned bounded buffer views, invalid receiver/buffer/disposed guards, safe tuning/geometry/breath recovery, primitive-pool overflow, atomic retention even when both selected code and fallback fail, and repeated constructor/disposal/GC resource accounting passed.
- **73 unchanged reference images + 9 cached redraw images**, **25,190,400 BGRA bytes**, matched exactly. There are 36 state/full pairs and three additional change-free full/partial/full sequences, one per preset. The added sequences exercise partial dirty regions independently of full invalidation caused by a state change.
- Automatic native time/blink/breath matched the reference through a full cycle: 200 observations, minimum eye openness 0, both positive and negative breath. Native animation never called a JS `onTimeChanged` handler. Visibility, pause/resume, swap/unbind, motion stop and idempotent disposal passed. Native raster markers produced positive measured work.
- All six release targets passed: `m5stack`, `m5stack_core2`, `m5stack_cores3`, `m5stackchan_cores3`, `stackchan_rt`, `takao_core2_sg90`. Instrumented M5StackChan host, production MOD, native diagnostic MOD and WASM also built. ESP32 object imports confirm `esp_timer_get_time` and PSRAM `heap_caps_calloc` are selected.
- Unit tests: **432 passed with concurrency 1**. The normal parallel run failed an existing shared `time` shim race (`ENOENT`); no production fix was applied to unrelated tests. Architecture: **78 passed**. Biome CI and legacy-name checks passed; Biome reports one pre-existing informational unnecessary-constructor diagnostic in `connectivity/__tests__/fakes/crypt.ts`.

Single Linux XS run, SDK 9.5.0, during local build work; these are **desktop** measurements, not ESP32 FPS/CPU results:

| Preset | Legacy VM, 500 calls (ms) | Native binding, 5,000 calls (ms) | Native VM-only total (us) | Legacy preparation, 120 updates (ms) | Native preparation, 120 updates (ms) |
|---|---:|---:|---:|---:|---:|
| default | 458 | 66 | 38,249 | 170 | 4 |
| omega | 564 | 74 | 46,343 | 193 | 4 |
| aokko | 406 | 61 | 34,499 | 169 | 3 |

The native VM benchmark repeats the legacy 500-context sweep ten times. Binding time includes context/output copying; production idle has no JS binding call. The preparation sweep uses the same 120 host contexts and includes adapter work. Millisecond resolution and competing build load limit precision. Native VM/geometry totals for those preparation sweeps are respectively 1,083/305, 1,300/373 and 1,194/286 microseconds. Fixed face storage is **16,016 bytes on this 64-bit Linux ABI**, excluding owned programs/bytecode, construction temporaries and SDK/JS storage. This is not an ESP32 heap, allocation-free or whole-host leak-free claim.

`vmUs` and `geometryUs` cover native work. `rasterSubmitUs` covers command submission; instrument-only `rasterUs` uses paired, rotated/clipped Poco markers around face rasterization. Neither measures panel transfer. ESP32 uses a wrap-safe microsecond wall clock; Linux uses process CPU time. Historical SDK `Frames drawn` values are counts for its nominal instrumentation intervals, not precisely timestamped panel FPS. Its CPU percentages describe non-idle work from all tasks per core, not isolated MOD CPU. Upstream C++ sleeps 33ms after work; this is not equivalent to guaranteeing 30fps.

Evidence is generated under `dist/avatar-dsl-native/`: `engine-result.json`, `sanitized.json`, `pixel-result.json`, `render.log`, `legacy-render.log`, release/instrument/WASM/MOD build logs, serial unit/architecture/Biome checks, and `final-evidence.json`. Native C/sanitizers and native XS render regression subsequently passed remotely at `ad80d1b5`, together with all six release targets: [Build](https://github.com/stack-chan/stack-chan/actions/runs/37793719932), [Bundle](https://github.com/stack-chan/stack-chan/actions/runs/37793719882).

The initial native branch validation stopped before hardware access. The subsequent direct user authorization allowed the installation and automatic measurements below. Long soak, physical clipping/flicker/trails, nonzero-rotation visual comparisons and simultaneous host effects remain unverified.

## Physical native comparison — 2026-10-08

M5StackChan CoreS3, ESP32-S3, CPU 240 MHz, DIO flash 80 MHz, SDK 9.5.0. One shared instrument host based on `5dbc157`; the legacy JS backend is byte-for-byte unchanged from `55d7785`. This comparison isolates the two face engines under the same host rather than comparing whole old/new host binaries. Driver is locked `none`, Wi-Fi manifest overrides are empty, and head LED is null. The board's NVS, PHY, storage, bootloader and partition layout were retained and verified.

Native device diagnostics passed **347 automatic checks**. The diagnostic assertion now waits for the existing 33ms host FaceState propagation before taking its state snapshot; production timing is unchanged.

The paired benchmark ran **24 phases**, each after 3 seconds warmup for at least 15 seconds, with backend order reversed on the second repetition. All **163 checks** passed, including 90 exact command comparisons at identical VM contexts. Dynamic input uses a 33ms timer and a function of actual elapsed time; overloaded callbacks skip deadlines instead of stretching the input sequence. Built-in blink/breath schedulers retain each backend's behavior.

| Preset / input | Actual FPS JS → native | VM ms/evaluation | Raster ms/draw | Core 0 non-idle % | Core 1 non-idle % |
|---|---:|---:|---:|---:|---:|
| default / animation | 5.260 → 6.967 | 60.576 → 0.372 | 2.917 → 3.583 | 99.0 → 41.7 | 0.0 → 0.0 |
| default / dynamic | 3.623 → 20.504 | 76.309 → 0.535 | 4.741 → 6.073 | 99.0 → 98.7 | 0.0 → 0.1 |
| omega / animation | 2.332 → 2.998 | 69.859 → 0.416 | 3.254 → 3.925 | 99.0 → 26.8 | 0.0 → 0.0 |
| omega / dynamic | 2.535 → 20.369 | 100.977 → 0.614 | 6.205 → 6.488 | 99.2 → 98.7 | 0.0 → 0.4 |
| aokko / animation | 3.284 → 7.080 | 95.862 → 0.537 | 6.561 → 7.058 | 99.0 → 43.2 | 0.0 → 0.0 |
| aokko / dynamic | 2.944 → 20.461 | 95.828 → 0.612 | 7.203 → 8.007 | 99.1 → 98.6 | 0.0 → 0.9 |

FPS uses SDK `Frames drawn` divided by actual monotonic serial capture time, excluding boundary intervals. It is not a camera/panel measurement. Normal animation suppresses unchanged images, so its draw rate differs from VM evaluation rate. Raster timing uses the same outer Piu container and paired no-pixel Poco markers for both engines, excluding panel transfer. VM and geometry counters cover the full phase; FPS/CPU use its steady interior. CPU values include all tasks; SDK samples each core every 1,250us and truncates each percentage to an integer, so fractional aggregate values do not establish sub-percent single-sample precision.

Dynamic FPS improved 5.7–8.0 times while raster cost did not improve. Native VM plus geometry averages 1.325–1.704ms per dynamic evaluation, compared with 108.253–162.168ms for JS. Further profiling must separate host state adapter work, frame scheduling, geometry, raster execution, display transfer and waits before assigning the remaining bottleneck.

Reproducible diagnostic sources are in `tests/avatar-dsl-comparison/`; diagnostic host manifests are under `host/app/` so font character-file paths resolve correctly. Build from `firmware/` with `npm run build:m5stackchan_cores3 -- --mode=instrument --manifest host/app/manifest_avatar_dsl_comparison.json`, then `npm run mod:build -- mods/examples/avatar-dsl/tests/avatar-dsl-comparison/manifest.json`. Capture timestamped serial JSONL (`t` monotonic seconds, `line` decoded trace), then run `python mods/examples/avatar-dsl/tests/avatar-dsl-comparison/analyze.py LOG --output dist/avatar-dsl-comparison`. Installation must target the verified live app/XS partitions and retain configuration partitions.

Checked-in evidence: `tests/avatar-dsl-comparison/measurements/cores3-native-20261008.{json,csv,jsonl}`. JSON records phase totals, checks, methods, limitations and evidence hashes; JSONL is the original instrument trace. The normal native instrument host and default MOD were restored and verified, with `app behaviors ready` and 110 subsequent drawn frames in the final 25-second automatic capture. Configuration partitions remained byte-identical. No merge was performed.

## Separated loop profiling and optimization — 2026-10-09 JST

Native backend plus the old/native measurements were pushed to existing PR725; Build and Bundle passed at `ad80d1b5`. This subsequent comparison isolates native-loop optimization under the same diagnostic settings above. The XS thread is unpinned in SDK 9.5.0: an initial optimized boot ran on core 0, so the capture script automatically rebooted and selected core 1 to match the baseline. The paired data below contains only the matching core-1 boot, with 12 phases and 37 checks per binary. Each condition has two 15-second repetitions after 3-second warmup, with reversed preset order. No manual observation gate was used.

Changes retain the native 33ms timer, input timer, geometry/palette/pixels and 40MHz LCD SPI. Stable Outline slots rebuild only changed geometry, and command publication copies only changed records. The state adapter's finite clamp uses equivalent comparisons with fewer JS calls. On M5StackChan CoreS3 only, two fixed eight-row pixel buffers replace one-row buffers: 240 → 30 raster/send callbacks per full 320×240 frame, with the same 153,600 pixel bytes. Explicit Piu/Poco pixel-buffer overrides keep their previous behavior. This adds **8,960 fixed bytes (8.75 KiB)** at startup; profiling counters add 24 bytes per native face versus the previous PR head. Neither change adds per-frame buffer allocation.

| Dynamic input | default before → after | omega before → after | aokko before → after |
|---|---:|---:|---:|
| Actual FPS | 19.446 → 20.848 | 19.078 → 20.805 | 19.125 → 21.105 |
| Loop elapsed ms/draw | 51.211 → 48.084 | 52.224 → 48.201 | 52.096 → 47.484 |
| State adapter ms/write | 2.144 → 1.997 | 1.885 → 2.016 | 1.882 → 1.993 |
| VM ms/evaluation | 0.520 → 0.525 | 0.602 → 0.606 | 0.597 → 0.595 |
| Geometry ms/evaluation | 0.806 → 0.805 | 1.079 → 0.891 | 0.705 → 0.414 |
| Raster ms/draw | 7.376 → 2.565 | 7.900 → 2.807 | 9.770 → 2.961 |
| LCD send/queue/wait ms/draw | 27.390 → 29.510 | 27.293 → 29.258 | 25.896 → 29.073 |
| Core 0 non-idle % | 2.128 → 3.200 | 1.918 → 3.501 | 1.955 → 3.545 |
| Core 1 non-idle % | 98.706 → 98.960 | 98.876 → 98.665 | 98.793 → 98.875 |
| Native explicit copied bytes/evaluation | 1415.622 → 1340.780 | 1622.455 → 1405.045 | 1530.117 → 1018.583 |

The dominant cost is LCD send/queue/wait (~29ms/draw after optimization), not VM (~0.5–0.6ms/evaluation). At unchanged 40MHz, 153,600 payload bytes alone need 30.72ms of ideal wire time; this is a throughput calculation, not measured bus occupancy. Larger bands cut measured raster cost by 65–70%, but LCD send API time increases because DMA overlap moves between raster and wait attribution. Total display begin-to-end wall time improves; it must not be added to raster, because it includes raster and overlapping transfer. The remaining ~11ms/dynamic draw includes unmeasured framework traversal, scheduling, bookkeeping and idle/wait; it is not labeled purely idle. State adapter and VM changes are small and mixed across presets. FPS improves 7.2–10.4%; it does not reach 30fps.

Ordinary blink/breath draw rates remain approximately 7 / 3 / 7 FPS for default / omega / aokko, retaining unchanged-image suppression. Explicit native copies per evaluation drop by roughly 60–66% there. Full phase counts and per-draw context generation, Piu/native command submission, LCD begin/end, synthetic input and unaccounted wall time are retained in JSON/CSV. State adapter time includes the C state-binding call and is not double-counted. Timing is exclusive XS-thread API wall time, with original C pixel-out dispatch buffer pointers, lengths, async flags and driver waits preserved; the probe adds no flush or delay.

Regression validation passed the same **82 pixel images / 25,190,400 BGRA bytes** with both ordinary and eight-row buffers, including partial redraw, plus the native lifecycle/oracle/safety checks. Portable C and ASan/UBSan each passed 726 cases. The complete serial unit suite passed 432 tests, architecture passed 78 checks, and full Biome CI and legacy-name checks passed. The preset/compiler/AVBC resources remain unchanged. These automatic pixel comparisons validate software raster output, not panel flicker or a long soak.

Reproduce from `firmware/` with `npm run build:m5stackchan_cores3 -- --mode=instrument --manifest host/app/manifest_avatar_dsl_profile.json` and `npm run mod:build -- mods/examples/avatar-dsl/tests/avatar-dsl-comparison/manifest.profile.json`. Capture timestamped instrument JSONL and run `python mods/examples/avatar-dsl/tests/avatar-dsl-comparison/analyze-profile.py LOG --output RESULT.json`. In an isolated checkout, use `git apply --unidiff-zero firmware/mods/examples/avatar-dsl/tests/avatar-dsl-comparison/measurements/cores3-loop-20261009-baseline.patch` from the repository root to reproduce the previous geometry/copy/adapter/one-row pipeline while retaining the same profiling counters. Remove that patch to rebuild the optimized candidate. Both host artifacts must be rebuilt and separately sealed before partition-preserving app/XS writes.

Evidence: `measurements/cores3-loop-20261009.{json,csv}` and `cores3-loop-20261009-{before,after}.jsonl`. JSON includes artifact hashes, normalized trace hashes, conditions and limitations. SDK CPU includes all tasks and integer samples. The data is two repetitions, not statistical confidence or normal-peripheral/effects validation.

For restoration under these retained diagnostic settings, build `host/app/manifest_avatar_dsl_native_device.json` with the same instrument mode and `mods/examples/avatar-dsl/manifest.json` as the MOD. This normal host uses the production screen adapter and omits the display/raster profiling probes; the default preset runs on the native backend. Preserve and verify NVS/PHY/storage/bootloader/partition bytes when replacing the app and XS partitions.
