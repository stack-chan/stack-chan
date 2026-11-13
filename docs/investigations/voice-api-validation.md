# Voice API validation

This record covers the public API revision of PR #776 from `deed4fd77d0979580f4b0387965ddcd7af7a938b`. The PR merge-base is `2c80a00161eae3fe3467e29059bf37355c790f33`. A separate worktree preserved the existing checkout and its untracked files. The latest observed develop was `3a436a50e22863adf35f69a275f8d3ab05a81b1a`; this API revision does not merge unrelated develop changes.

Runtime changes are in `2c7375c5`; the typed example and declaration manifest are in `6a6da5d5`. Subsequent documentation commits do not change runtime behavior.

## Contract and executable evidence

| Contract | Implementation | Evidence |
| --- | --- | --- |
| Acceptance differs from response playback | `ConversationSubmission`, cascaded turn receipt | Delayed playback prevents completion and next submission; terminal failure/interruption resolves a result |
| Unsupported input never enters history | Agent image capability and cascaded guards | Text-only and undeclared agents reject images; the following text turn succeeds; initial image history is rejected |
| Mute can precede startup | Pipeline desired input state and serialized input operations | Pre-start mute, duplicate mute, ordered toggles, startup/close races |
| Abort can stop pending startup | Pipeline cancellation before startup wait | Pending STT open and initial microphone configuration both cancel and release once |
| Failed cleanup does not free a live port | Pipeline/runtime lease quarantine | Session-close failure preserves the reservation and repeated failure |
| Text input has reusable and terminal boundaries | TTS `flush`, `endInput`, `close` | Two flushes, bounded text, ordered tail, concurrent close, idle abort and no late request |
| Borrowed PCM remains owned until all readers settle | Public PCM source/sink helpers | Sync and async sibling failures cannot release another reader's borrowed buffer early |
| Provider construction is consistent | Companion `X.create()` exports | XS constructor/Agent/tool/Vision tests and existing MOD migration |
| The smallest example waits before stopping | `minimal_voice` | Real public imports type-check; three workflow tests verify sequencing and failure cleanup |

## Independent review

Two separate Astra reviewers examined the implementation. The final reviewer did not receive the earlier review findings or discussion. Confirmed issues were reproduced with the production pipeline/Agent/cascaded/PCM code and fake devices/providers:

1. Closing after a mute command could wait for STT startup before delivering the cancellation needed to finish that startup. Close now initiates session cancellation before waiting for the input gate.
2. Closing during initial microphone configuration could mistake an assigned session for completed startup. An explicit startup-completed state now controls cancellation.
3. A failed PCM subscriber could settle the shared producer promise before another subscriber released its buffer. The producer now waits for every reader before returning the first failure.
4. Cascaded conversations advertised image support even for text-only agents, and failed image requests entered history. Capability propagation and pre-history validation now prevent this.

The final reviewer independently rechecked the fixes, including history-budget failure and a throwing fatal-event observer. No unresolved concrete P2-or-higher finding remained in the reviewed scope. This is bounded review evidence, not a claim that the implementation has no defects.

## First-use exercises

Separate Luna and Sol agents received public documentation/contracts and concrete implementation tasks, without prior design discussion or review reports.

| Exercise | Execution | Classification |
| --- | --- | --- |
| Luna: muted startup, volume, two sequential responses, interruption, cleanup, unsupported completion | Type-check against the real public types; executable fake-pipeline ordering/interruption/unsupported-backend checks passed | Initial failures were isolated TypeScript/Node configuration mistakes, not API misuse |
| Sol: custom PCM STT and TTS, provisional/final snapshots, two flushes, input end, borrowed buffers | Type-check plus four executable public-adapter tests passed | Initial failures were Windows/Linux dependency selection and test-hook configuration mistakes |

Constructing the repository's minimal example also exposed a public barrel type/value collision, which was fixed with an explicit type export. Its real Moddable build exposed missing host API type resolution. A type-only manifest now re-exports the actual implementation declarations while preserving SDK type mappings. The resulting MOD contains only `check`, `mod`, and `minimal-voice-workflow`, not copies of host modules. Passing the model exercises does not establish hardware or provider correctness.

## Commands and scope

The environment used Node 24, TypeScript 7.0.2, Moddable SDK 10.1.0 at `2d54ac4308501a03f45d4fcfe33beee45ee44ac4`, and ESP-IDF 6.1. Tests never intentionally contacted a live provider or accessed a device.

- Unit tests: 676 passed. Parallel execution on WSL over NTFS intermittently failed while separate test processes replaced shared alias packages. `test:unit` now uses `node --test --test-concurrency=1` with the same file list, so the normal command preserves the passing execution order.
- Minimal example: `npm run test:voice-example`, three tests passed, including public import/construction type-checking.
- RFID regressions: `npm run test:rfid`, 11 passed.
- Architecture: `npm run check:architecture`, 78 passed.
- Static checks: `biome ci . --error-on-warnings` passed; informational legacy-style suggestions remain.
- XS: the AI PTT, dialogue-chatgpt, and dialogue-smoke manifests passed using the SDK above. The ambient SDK 10.0.2 failed a missing HTTPS manifest preflight and was not used as passing evidence.
- Manifest preflight: all six supported targets passed.
- Release builds: CoreS3 host, `ai_stackchan`, and `minimal_voice` passed. The host binary is 8,127,232 bytes with SHA-256 `128f6ccddb87d06a5ea3e0af444df7310bec8eb3df850f93eec05a1b549d28cf`; the minimal MOD archive is 3,087 bytes. Build artifacts were not flashed.

Hardware flashing, device restart, microphone recording, actual sound, long-running device reuse, and paid API calls were not performed. Fake-device ownership tests do not establish DMA timing, physical silence, memory fragmentation, sound quality, or remote-service reliability. Wake-word detection, simultaneous microphone sharing, and wake-to-conversation handoff remain future design boundaries described in [the architecture note](../architecture/voice-conversation-boundaries.md).
