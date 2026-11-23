# StopWatch interactive setup target

Build with `node scripts/build-muse-native-device.mjs --setup`. No flashing or pairing follows the build. This standalone Piu screen integrates an opaque account owner, Wi-Fi/time preparation, native admission and the shared voice pipeline.

Boot checks only NVS key presence/type/length and reads chip MAC for community device identity. Any account record or legacy Muse/homehub credential blocks re-pairing; unknown storage errors fail closed. Presence checks read no credential contents. A supported stored account can then be restored into native memory; credential contents never enter JavaScript. NVS is never initialized or erased here.

A distinct **Start pairing** touch creates the radio and advertises when ready. The phone handshake exposes a separate **Confirm pairing** action. Community pairing has no manufacturer attestation and does not defend against active MITM.

Provision receipt claims only an opaque native owner. **Save on device** and **Connect to Muse** use separate captured-revision approval gates. No automatic save/connect, credential display, or secret logging occurs. The save description explains that storage protection depends on existing device settings.

An SDK token must first be provisioned using the separate approved USB workflow; without it, Start pairing is disabled. A restored account offers Connect without re-pairing or rewriting storage. Connect prepares Wi-Fi and time and opens the ordinary Muse chat transport. Realtime voice admission is not used.

Hold Talk or physical A to record up to 15 seconds. Release completes OpenAI Whisper transcription, sends the resulting text through `createMuseChatAgent` inside `CascadedConversation`, and synthesizes the final Muse reply using OpenAI Speech. Muse retains its own history, tools and personality. No VoiceMemo or audio is sent to Muse. OpenAI receives the recorded audio for transcription and the reply text for synthesis. OpenAI Speech produces 24 kHz PCM; the setup target resamples it to the StopWatch's fixed 16 kHz output. The native playback ring and bounded DMA staging are unchanged.

New presses are rejected while transcription, Muse or playback is pending. Physical B or Disconnect aborts locally without submitting an unfinished recording and releases audio/transport while retaining saved credentials. Cancelling a submitted Muse request does not prove that remote work stopped. Interrupted or failed Muse turns require reconnecting; local transcript truncation cannot repair Muse's remote history. ADC capture may continue with samples discarded while muted. Generated Kasane artwork and mouth states are unchanged.

## OpenAI key

The owner supplies the common OpenAI key used by Guruguru and Codezine. This target reads the existing Guruguru preference location: domain `ai`, key `token`, via `Preference.get('ai', 'token')`. Both STT and TTS use that value. It does not read a PC `.env` file and does not create, copy, migrate, display or log keys. Without a nonempty stored token, connection stops with `OpenAI API key needed. Pairing is saved.` Muse pairing and the SDK token are separate credentials.

Provision `ai.token` privately using the [owner-only USB input workflow](../openai-provision/README.md), restore this setup application, then reconnect. Do not put the key in a tracked manifest, chat, terminal command history or diagnostic log. This standalone pairing screen does not offer a key-entry form. The shared key's billing and limits apply to both applications.

## Verification

Run the offline adapter tests with Node 24 from `firmware/`:

```
node --test host/modules/muse-gadget/__tests__/cascaded-conversation.test.mjs host/modules/muse-gadget/__tests__/resampled-output.test.mjs
```

Build with the command at the top of this document. It builds only, without flashing or paid API calls. After the owner provisions the key and approves device verification, check first/last syllable capture, the 15-second limit, one spoken reply per turn, cancel during recording/Muse/playback, reconnect, TLS, peak memory and playback gaps. Prior VoiceMemo transport checks in `../NOTE.md` do not validate this cascaded path.

Controller/Piu entry tests inject mocks. Native metadata ASan/UBSan tests enforce length-only reads and cover stored/corrupt/error states. They do not exercise radio or persistent writes.
