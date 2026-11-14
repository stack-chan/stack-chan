# Real-provider audio path check

This MOD exercises the public conversation API with real providers. Nothing connects on boot. Open the drawer and select `Start test`; select `Stop test` when finished. The default deadline is 90 seconds, capped at 300 seconds. A deadline limits session duration, not provider billing. Do not leave a test unattended.

## Configure and build

Copy `manifest.local.example.json` to `manifest.local.json`, which is ignored by Git. Fill in only the credentials needed for the selected route. Use model IDs available to your account. Never commit or share the local manifest, generated MOD archive, firmware dump or serial logs from other modules; compiled configuration contains credentials.

From `firmware/`:

```sh
npm run mod:build -- mods/examples/voice_path_check/manifest.local.json
```

This builds without flashing. When the target device and its current workload are confirmed, install with the repository's `npm run mod` command and the selected device port. Do not assume COM6 or overwrite another running experiment. Use a host containing the new voice API, native WebRTC for the WebRTC rows, and the relevant SDK worker for WebSocket rows. No host source changes are included in this example.

## Route matrix

| Route/config | What runs | Required configuration |
| --- | --- | --- |
| `cascade`, default LLM kind | 16 kHz microphone → Whisper → Responses Agent → OpenAI Speech → 24 kHz speaker | `speech.apiKey`, `llm.apiKey`, `llm.model` |
| `cascade`, `llm.kind: "chat"` | Same PCM path, Chat Completions-compatible LLM | Above plus `llm.endpoint` |
| `webrtc`, `delegation: "none"` | Native OpenAI Live WebRTC without delegation | `live.apiKey`, `live.model` |
| `webrtc`, `delegation: "hosted"` | Native WebRTC with hosted delegation | Above plus `llm.model` for delegate model; no client LLM key needed |
| `webrtc`, `delegation: "client"` | Native WebRTC with a local Agent calling a real Responses LLM | Above plus `llm.apiKey`, `llm.model` |
| `websocket` | SDK ChatConversation worker | `chat.type`, `chat.apiKey`, provider-specific `modelID` / `voiceID` / `providerID` as needed |
| `xiaozhi` | XiaoZhi v1 WebSocket server's STT/LLM/TTS | `xiaozhi.endpoint`, `deviceId`, `clientId`, optional `accessToken`; server must have real LLM configured |

WebSocket worker types exposed by the host are `openAIRealtime`, `googleGeminiLive`, `deepgramAgent`, `elevenLabsAgent` and `humeAIEVI`. Availability depends on the installed SDK and provider account. An exposed configuration option is not evidence that a provider/device combination has passed a real call.

Custom Hub signaling is tested through the separately maintained stack-chan-ai MOD, not by copying Hub authentication into this generic example. This MOD does not read saved host TTS settings: cascade constructs its own TTS and the other paths use their provider audio.

## Manual checks

1. Select one route, start, and wait for `ready`. For cascade select `Record / Send`, speak briefly, then select it again to send. Other routes use provider turn detection and do not use that button.
2. Say a short arbitrary phrase, hear an appropriate response, then ask what you just said. Repeat for three turns. For delegated WebRTC, use a question requiring the delegate and verify server-side evidence separately; successful audio alone does not establish delegation execution.
3. Stop while the provider is answering. Confirm sound stops, close completes, and starting again succeeds. Repeat stop during connection. Check that the microphone/speaker can be acquired again.
4. Leave a session until the test deadline and confirm it closes. If the screen reports remote state unknown, verify the provider session; do not record a clean pass.
5. For cascade compare responses with saved host TTS set to another provider, without changing its credentials. Explicit TTS construction should be unaffected.

Record host commit, MOD commit, board/port, route/provider/model, number of turns, observed audio, stop/restart outcome and remote finalization. Never record API keys or private conversation contents.

## Verification status

The included Node tests exercise route composition and lifecycle without network calls:

```sh
node --test mods/examples/voice_path_check/__tests__/check.test.mjs
```

These tests do not prove hardware audio, provider compatibility, latency, AEC, interruption semantics or billing finalization. This new MOD has not yet been run against a real provider or flashed to hardware. Existing stack-chan-ai hardware results must not be counted as validation of every row above.

