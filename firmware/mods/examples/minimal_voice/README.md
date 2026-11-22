# Minimal voice conversation

This MOD sends two text requests, waits for each spoken response, then releases its microphone and speaker lease. It has no UI, camera, or registered tools. Its microphone stays muted; the first exercise isolates request acceptance from response and playback completion.

Read [the quickstart](../../../docs/voice-quickstart.md) before enabling the MOD. Running the MOD uses the configured OpenAI API key and makes network requests. Merely type-checking or building it does not send requests. The offline workflow tests inject a fake pipeline and never load a provider.

`mod.ts` contains the imports and construction. `workflow.ts` contains the sequential requests and cleanup. `onClose()` cancels an active run when the host unloads the MOD. Repeated close calls share one shutdown; the first call chooses its mode.

From `firmware/`, with the repository's configured Moddable SDK and an already-built matching host:

```sh
npm run mod:build -- mods/examples/minimal_voice/manifest.json
```

`mod:build` builds the MOD archive without flashing a device. Before intentionally loading and running the MOD, configure the host's `ai.token` and optional `ai.model`. The example reports missing configuration through its startup error. See the quickstart for microphone, tool, and camera extensions.

TypeScript MODs using `stackchan/ai`, `stackchan/voice`, or `stackchan/voice/speech` include `firmware/typings/voice-api/manifest.json` alongside the SDK's `manifest_mod.json`, using the relative path from their own manifest. This example shows that include. The declarations re-export the host's actual source types, so changes to the host API are checked during the MOD build. The type manifest adds no runtime modules and preserves the SDK's generated TypeScript module mappings. The matching host supplies the runtime implementations.

Run the offline workflow checks from `firmware/`:

```sh
npx tsc -p mods/examples/minimal_voice/tsconfig.test.json
node --test dist/minimal-voice-tests/mods/examples/minimal_voice/workflow.test.js
```

These checks exercise sequential completion and cleanup with a fake pipeline. They do not verify network providers, audio drivers, or sound on a device. The MOD build separately checks provider construction and its imports against the host.
