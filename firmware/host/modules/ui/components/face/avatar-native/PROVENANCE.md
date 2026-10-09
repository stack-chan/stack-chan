# Native AVDS engine provenance

`avds-engine.c` and `avds-engine.h` adapt the decoder, VM, opcodes and numeric semantics of **ciniml/stackchan-idf** at commit **419385ef1b875137140085bd50d34dee331f30c2**:

- `components/avatar_vm/decoder.cpp`
- `components/avatar_vm/vm.cpp`
- `components/avatar_vm/include/avatar_vm/bytecode.hpp`

Reference: https://github.com/ciniml/stackchan-idf/tree/419385ef1b875137140085bd50d34dee331f30c2/components/avatar_vm

Copyright **2026 Kenta IDA <fuga@fugafuga.org>**. These adaptation files are **BSL-1.0**, with the full license in `LICENSE-BSL-1.0`. They are not relicensed under the target repository's Apache license. Changes include a portable C representation, immutable bounded decoding, control-flow validation, fixed runtime storage, finite/range checks, execution/drawing budgets and atomic command publication.

AVDS version 1 is pinned to this commit's context IDs 0..40, including mouth_form and accessories. Later or earlier files sharing that version are not automatically compatible. Existing compiler/preset hashes and the target develop base are recorded in the MOD's `vendor/PROVENANCE.json`. The native work begins at target PR725 head `55d7785cedbb2cc386952850051db679b20c395f`.

`native.c`, `native.js`, `avds-render.c`, `avds-render.h`, and `manifest.json` are new **Apache-2.0** integration code. They call the normal Moddable SDK 9.5.0 Piu/Poco/FreeType APIs; SDK sources remain under their existing licenses. Fixed circle geometry uses four cubic Bezier arcs and is verified against Piu's prior CanvasPath raster output. Production native code does not include the PC compiler or JS VM.

Strict absolute group clipping and old/new visible damage planning begin at PR725 head `97197c362feacd8165158f62da6e917c726ce83d`. This deliberately changes the earlier group-hint rendering contract while retaining the VM's numerical semantics. Original pinned presets are retained under `tests/upstream-presets`; `tests/historical-face.js` is the unchanged Apache-2.0 JS/Piu renderer from that PR head, used only to demonstrate the compatibility difference and preserve preset appearance.
