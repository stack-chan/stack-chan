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
