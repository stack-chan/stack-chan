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
