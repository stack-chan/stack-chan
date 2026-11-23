# Guruguru voice prototype

A Moddable-native behavior port inspired by [nananauno/M5GuruguruAvatar](https://github.com/nananauno/M5GuruguruAvatar) (MIT). No upstream character images or C++ code are copied. The Piu placeholder face shifts its head and eyes between nine directions, blinks, accepts neutral/happy/sad expressions, and colors idle/listen/think/speak differently. `avatar.js` is independent of Piu and voice transports; `view.js` owns touch and rendering. This avoids filesystem PNG loading and a separate native drawing task.

`mod.js` uses the existing `CascadedConversation.create` and `ConversationPipeline` public APIs. A holds microphone input, release submits the utterance, and B stops. Configuration is read from existing `option.config.ai` only. Output amplitude drives the mouth; text is not written to logs. This is the existing OpenAI cascaded route, **not a Muse connection**.

## Status

- Nine-direction mapping, blinking, expression, state and mouth model: Node behavior tests.
- Public pipeline events, physical button handlers, cleanup: mocked module integration test.
- MOD archive: compiled via repository `npm run mod:build` wrapper.
- `device/`: independent StopWatch Piu rendering harness. It cycles states and synthetic mouth levels, and allows touch. It does not connect a microphone, an LLM, or Muse. Its successful execution must not be reported as a voice conversation.
- Full StopWatch stack-chan host with this MOD and real voice exchange: not yet verified.
- Muse native transport/core and Conversation backend: see `host/modules/muse-gadget/VOICE.md`; live service and kasane channel v1.1 integration remain unverified.

## Muse boundary

The current upstream Muse SDK (`esp32/components/muse/muse_voice_call_core.c/.h`, `esp32/AGENTS.md`) uses HTTP-over-Noise, a separate voice session with app identity, 24 kHz PCM NDJSON, pairing credentials, and explicit `/voice/end-call`. Stack-chan's cascade owns STT, LLM, TTS and history locally. The opt-in Muse backend reuses the experimental Noise transport and the pinned upstream voice core, without replacing CascadedConversation. A raw HTTPS URL with a token is not an equivalent replacement. Do not silently replace the cascade or embed SDK credentials.

`hatch.voice.turn_settled` is not simply `turn.ended`: pending asynchronous handoffs can indicate an approval boundary, settlements can retire multiple turns, and an interrupted turn's delayed settlement must not retire the newer reply. A Muse backend must preserve those rules and drain/explicitly end on `session_control` stop. The avatar MOD still uses the cascade route; it does not select the Muse backend automatically.

## Checks

From `firmware`:

```
node --experimental-vm-modules --test mods/examples/guruguru_voice/*.test.mjs
npm run mod:build -- mods/examples/guruguru_voice/manifest.json --mode=release
node scripts/run-mcconfig.mjs -m -p esp32/m5stack_stopwatch -t build mods/examples/guruguru_voice/device/manifest.json
```

The device build requires the StopWatch-capable Moddable SDK. Preserve the device's partition table and NVS; flashing is coordinated with the parallel Alloy work.
