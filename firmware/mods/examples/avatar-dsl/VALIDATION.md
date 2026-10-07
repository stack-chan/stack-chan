# Initial prototype validation — 2026-10-07

## Isolation and provenance

- Branch: `feat/avatar-dsl-face-mod`; independent worktree `task-2/stack-chan`.
- Fetched `origin/develop` and recorded base `876b91ebc475fc05d8e196659c315bebca11bb7c` before implementation.
- Original checkout retained its three untracked STL files; its tracked files, branch and HEAD were not changed.
- Reference: `ciniml/stackchan-idf@419385ef1b875137140085bd50d34dee331f30c2`. Compiler and three preset sources are unmodified; normalized-LF hashes and BSL-1.0 provenance are in `vendor/PROVENANCE.json`.
- Isolated Moddable SDK **9.5.0**, commit `b6e06ba70506a7381ffb28e09e3175bf4e99f305`; WSL OpenClaw/Linux x86-64, Node 24.19.0, g++20. Existing SDK installation was preserved. Builds used repository npm wrappers.
- No device connection, scan, BLE operation, flash, printer operation, push, PR or merge was performed.

## Checks and evidence

| Check | Result |
|---|---|
| `npm run test:avatar-dsl` | 9 tests passed; all three compiled `.avbc` files byte-identical to the pinned compiler output |
| Independent C++ oracle | 192 exact RecordingCanvas command-sequence matches: 144 preset/expression/context cases and 48 numeric cases |
| Corrupt/hostile inputs | Header, sections, opcodes, references, jumps, finite/range, loop/draw budgets, stack/locals/call limits, transactional failure and 500 seeded mutations passed |
| Unit suite | TypeScript test compilation passed; 430 tests passed with Node `--test-concurrency=1` |
| Linux XS/Piu renderer | 36 partial/full framebuffer pairs identical within Piu; 3 presets, 6 expressions, eyes/gaze/mouth, palette/accessories; native lifecycle and fallback passed |
| Safety fallback in native Piu | Malformed bytecode, infinite jump loop and 33 drawable primitives recovered to safe default |
| Face lifecycle | Actual detach/reattach, outgoing active timer suspension, pause/resume, motion disable/dispose; elapsed clock freezes during suspension |
| Visual inspection | 3×6 expression contact sheet inspected; RGB565-to-Piu palette checked, including BGRA capture red collar channel assertion |
| MOD local build | `npm run mod:build -- mods/examples/avatar-dsl/manifest.json` passed; `avatar-dsl.xsa` **31,534 bytes** |
| Bundle resources | Explicit three AVBC resources; DSL source/compiler excluded except runtime opcode definitions |
| Static checks | Biome and `git diff --check` passed |

The ordinary concurrent `npm run test:unit` run encountered an existing generated module-alias race in `event-frame-queue.test.js` (428 passed, one file failed). That file passed independently; the same complete suite passed serially. No unrelated host/test changes were made for this race.

Generated evidence is local and ignored by Git:

- `firmware/dist/avatar-dsl-unit-focused.log`
- `firmware/dist/avatar-dsl-unit-serial.log`
- `firmware/dist/avatar-dsl-render/test.log`, `render.log`, frame captures, `contact-sheet.png` and `contact-sheet.html`
- `firmware/dist/avatar-dsl-mod-build.log`
- `firmware/dist/bin/esp32/debug/avatar-dsl/avatar-dsl.xsa`

Reproduce normal checks using the README commands. Regenerating the oracle requires the pinned upstream checkout and its `tl_expected` submodule; normal tests use the checked-in fixtures and require neither C++ nor network access.

## Measurements and limits

These are **Linux XS measurements**, not ESP32 throughput. Millisecond resolution, one final run; no statistical confidence or device FPS claim. VM timing excludes Piu drawing. Render preparation includes context update, VM execution and changed Outline/Skin construction, but excludes asynchronous rasterization and display transfer.

| Preset | VM 500 frames total / mean | Render preparation 120 frames total / mean | Maximum instructions / commands observed |
|---|---|---|---|
| default | 705 ms / 1.410 ms | 236 ms / 1.967 ms | 710 / 25 |
| omega | 854 ms / 1.708 ms | 267 ms / 2.225 ms | 848 / 34 |
| aokko | 606 ms / 1.212 ms | 237 ms / 1.975 ms | 534 / 21 |

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
