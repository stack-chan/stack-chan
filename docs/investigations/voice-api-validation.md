# Voice API validation

This record covers the public API revision of PR #776 from `deed4fd77d0979580f4b0387965ddcd7af7a938b`. Its original merge-base was `2c80a00161eae3fe3467e29059bf37355c790f33`. A separate worktree preserved the existing checkout and its untracked files. Develop `3a436a50e22863adf35f69a275f8d3ab05a81b1a` was subsequently integrated in `fa1a2d1c` after CI exposed its newly added network regression fixture importing the removed dialogue API. The fixture is migrated to the current stateless Responses contract while preserving SDK fetch failure/recovery checks.

Initial runtime changes are in `2c7375c5`; the typed example and declaration manifest are in `6a6da5d5`. Further review and CI integration fixes follow `1cd30081` as separate commits.

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

### Follow-up review and integration

Checking unresolved PR comments identified further issues outside the initial API review. Each was addressed rather than treating the earlier review as final approval:

- Pending transcription no longer blocks the next press. A new press cancels the old utterance; late old results cannot submit or stop its replacement. Two regression tests fail against `1cd30081` and pass after the fix. Failed STT cleanup retains the resource and makes session close fail.
- Tool waits settle on cancellation, but unfinished effects are explicitly `cancelled_unconfirmed`. The same ToolSet rejects further execution until actual settlement, and cascaded interruption requires restart. This also fixes a fresh reviewer's executable finding that a simple abort race hid pending effects from the conversation.
- MCP schemas outside the built-in subset accept explicit per-tool validators. Missing validators produce a named error. Tool JSON serialization checks its output, traversal, and nesting budgets before building an oversized string. See [tool contracts](../../firmware/docs/ai-tools.md).
- Live keeps separate in-flight IDs and bounded completed-ID history. More than 256 sequential delegations work; capacity rejection, failure, and timeout send bounded failure results. Uncooperative timed-out work keeps its slot until actual settlement.
- Failed MOD close clears its operation references while leaving runtime resource quarantine intact. An XS/Piu regression verifies failure reporting, safe retry rejection, and suppression of stale callbacks.
- Public PCM consumers retain their method receiver, and end callbacks may reenter close without recursively receiving the same end event. Both defects were independently reproduced with production code by a new reviewer.
- Stateless Responses requests no longer force the optional reasoning include. The current [OpenAI reasoning guide](https://developers.openai.com/api/docs/guides/reasoning) documents encrypted reasoning output by default with `store: false`; opaque returned items are still preserved and replayed. No live API request was used to validate this change.

At `1cd30081`, all six release targets and the web bundle passed [Bundle CI](https://github.com/stack-chan/stack-chan/actions/runs/43474551552). [Build CI](https://github.com/stack-chan/stack-chan/actions/runs/43474551725) passed static, Node, browser, smoke, and one XS shard; the other shard failed only the newly introduced old-dialogue fixture described above. These are intermediate results, not validation of later fixes.

At `b6fa0515`, [Bundle CI](https://github.com/stack-chan/stack-chan/actions/runs/43477778619) again passed all six release targets and web artifacts with SDK 10.1.1. The migrated network fixture passed. [Build CI](https://github.com/stack-chan/stack-chan/actions/runs/43477778204) exposed a PTT regression-test synchronization error: its 1 ms timer ran before the retry's asynchronous error presentation. The test now awaits the next presentation event with a deadline and still asserts the exact error, a fresh start, no recording, and ignored stale callbacks. Production behavior is unchanged by this test correction.

After runtime freeze, the new Astra reviewer reran four independent production-code regressions and 18 current-source session tests, with no remaining concrete P2-or-higher finding in the reviewed API scope. This reviewer discovered the cancellation and both PCM issues independently, but encountered earlier review summaries in this checked-in document; it was therefore an independent review, not a strictly blind review. The separate first-use exercises below were conducted without those summaries.

## First-use exercises

Separate Luna and Sol agents received public documentation/contracts and concrete implementation tasks, without prior design discussion or review reports.

| Exercise | Execution | Classification |
| --- | --- | --- |
| Luna: muted startup, volume, two sequential responses, interruption, cleanup, unsupported completion | Type-check against the real public types; executable fake-pipeline ordering/interruption/unsupported-backend checks passed | Initial failures were isolated TypeScript/Node configuration mistakes, not API misuse |
| Sol: custom PCM STT and TTS, provisional/final snapshots, two flushes, input end, borrowed buffers | Type-check plus four executable public-adapter tests passed | Initial failures were Windows/Linux dependency selection and test-hook configuration mistakes |

Constructing the repository's minimal example also exposed a public barrel type/value collision, which was fixed with an explicit type export. Its real Moddable build exposed missing host API type resolution. A type-only manifest now re-exports the actual implementation declarations while preserving SDK type mappings. The resulting MOD contains only `check`, `mod`, and `minimal-voice-workflow`, not copies of host modules. Passing the model exercises does not establish hardware or provider correctness.

## Commands and scope

The environment used Node 24, TypeScript 7.0.2, Moddable SDK 10.1.0 at `2d54ac4308501a03f45d4fcfe33beee45ee44ac4`, and ESP-IDF 6.1 for initial builds. Develop integration uses SDK 10.1.1 at `61c84af99c4f6b4ee191862fa1d07cb284caaf50` in an isolated checkout. Tests never intentionally contacted a live provider or accessed a device.

- Unit tests: 693 passed after follow-up fixes and dependency refresh (676 in the initial run). Parallel execution on WSL over NTFS intermittently failed while separate test processes replaced shared alias packages. `test:unit` now uses `node --test --test-concurrency=1` with the same file list, so the normal command preserves the passing execution order.
- Minimal example: `npm run test:voice-example`, three tests passed, including public import/construction type-checking.
- RFID regressions: `npm run test:rfid`, 11 passed.
- Architecture: `npm run check:architecture`, 78 passed.
- Static checks: `biome ci . --error-on-warnings` passed; informational legacy-style suggestions remain.
- XS: the AI PTT, dialogue-chatgpt, and dialogue-smoke manifests passed using the SDK above. The ambient SDK 10.0.2 failed a missing HTTPS manifest preflight and was not used as passing evidence.
- Manifest preflight: all six supported targets passed.
- After SDK integration: six-target preflight and the typed `minimal_voice` MOD build passed with SDK 10.1.1. The first preflight invocation omitted the ESP-IDF environment and was rerun after sourcing it; no missing-header failure is counted as passing evidence.
- Initial release builds: CoreS3 host, `ai_stackchan`, and `minimal_voice` passed. The host binary is 8,127,232 bytes with SHA-256 `128f6ccddb87d06a5ea3e0af444df7310bec8eb3df850f93eec05a1b549d28cf`; the minimal MOD archive is 3,087 bytes. These hashes precede follow-up runtime fixes. Build artifacts were not flashed.

Hardware flashing, device restart, microphone recording, actual sound, long-running device reuse, and paid API calls were not performed. Fake-device ownership tests do not establish DMA timing, physical silence, memory fragmentation, sound quality, or remote-service reliability. Wake-word detection, simultaneous microphone sharing, and wake-to-conversation handoff remain future design boundaries described in [the architecture note](../architecture/voice-conversation-boundaries.md).
