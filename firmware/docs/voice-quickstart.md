# Build a voice conversation

Start with [minimal_voice](../mods/examples/minimal_voice/README.md). It imports the public API, constructs a conversation, sends two requests in order, waits for both spoken responses, and releases audio. It uses no UI, camera, or registered tools. Building and offline testing do not call a provider; intentionally running the MOD does.

## Construct the conversation

`Conversation` selects the conversation strategy. A cascaded conversation connects STT, an Agent, TTS, and a TurnDetector. `ConversationSession` is the running backend and is for adapter authors. Applications create a `ConversationPipeline`; it owns the backend session and the microphone/speaker lease.

```ts
import { Agent, OpenAIResponsesLLM, ToolSet } from 'stackchan/ai'
import { CascadedConversation, ConversationPipeline, PushToTalk } from 'stackchan/voice'
import { OpenAISpeechTTS, WhisperSTT } from 'stackchan/voice/speech'

const ptt = PushToTalk.create()
const conversation = CascadedConversation.create({
  stt: WhisperSTT.create({ apiKey }),
  agent: Agent.create({
    llm: OpenAIResponsesLLM.create({ apiKey, model }),
    tools: ToolSet.create([]),
    instructions: 'Reply in one short sentence.',
    maxToolRounds: 1,
  }),
  tts: OpenAISpeechTTS.create({ apiKey }),
  turnDetector: ptt.detector,
  voice: 'alloy',
})
const pipeline = ConversationPipeline.create({
  microphone: robot.audio.microphone,
  speaker: robot.audio.speaker,
  conversation,
  microphoneMuted: true,
})
```

Check that the host supplies both audio handles before construction. They must belong to the same runtime. Construction does not acquire them; `start()` does. The pipeline has a default PCM budget of 250 ms and 24,000 bytes. Supply `mediaBudget` only when the selected backend and device need a different bound. A budget limits buffering; it is not a promise about network latency or the whole application's memory usage.

The complete sample reads `apiKey` and `model` from the host's `ai.token` and `ai.model` settings. It checks for a missing key instead of embedding credentials. Use a model supported by the provider account.

## Wait for the response, then stop

```ts
try {
  pipeline.setVolume(0.2)
  await pipeline.start()
  const turn = await pipeline.submit({
    type: 'message',
    role: 'user',
    content: [{ type: 'input_text', text: 'Hello.' }],
  })
  if (turn.completion !== 'playback') throw new Error('This backend cannot track a submitted response')
  const result = await turn.done
  if (result.status !== 'completed') throw new Error(`Turn ended: ${result.status}`)
  await pipeline.close({ mode: 'drain', timeoutMs: 5000 })
} finally {
  await pipeline.close()
}
```

`submit()` resolves on acceptance. For a tracked submission, `id` matches the turn events and `done` resolves after the response's local playback has completed, been interrupted, or failed. A failed or interrupted turn is a result, not a rejected `done` promise. Submitting another request before `done` can fail with `device_busy`. The sample checks the result before sending its second request.

Some providers cannot correlate a submitted message with a response. They return `{ completion: 'unavailable' }` and have no `done` promise. Do not treat `await submit()` or a local playback event as proof that that request has completed. Check `pipeline.capabilities.submitCompletion` before choosing a workflow that needs sequential replies.

`close()` defaults to abort: it cancels work and stops playback. `close({ mode: 'drain' })` waits for the backend's supported drain condition before releasing resources. In the cascaded backend this includes the active response and its playback. ChatAudioIO and native Live can drain locally accepted audio but cannot promise completion of a remotely pending reply. A drain timeout returns `reason: 'drain-timeout'` and falls back to cancellation. Set `timeoutMs` explicitly when the deadline matters; it bounds draining, not arbitrary native cleanup. `remoteFinalization` reports whether remote shutdown was confirmed.

Close is idempotent; the first call chooses its mode. A pipeline is single-use even if startup failed. To restart, construct a new pipeline after the old one's close has completed. If session or lease cleanup rejects, the runtime may retain the reservation to prevent callbacks from reaching a new owner's audio device. Propagate that failure; do not retry acquisition as if release had succeeded.

## Microphone, interruption, and capability checks

`setMicrophoneMuted(true)` disables microphone input. It can be called before `start()`, and repeated requests are idempotent. Mute requests are serialized. `setVolume()` controls speaker gain from 0 to 1 and can also be called before startup. Neither setting can be changed after close begins.

`interrupt()` cancels the current output. Inspect its returned `history`; when it is `restart-required`, the pipeline closes itself and a new instance is required. This applies to ChatAudioIO and native Live. Cascaded conversations are normally reusable, but a cancellation that cannot confirm a tool has stopped can also require a restart. The capability describes the normal strategy; the interruption result describes the actual outcome.

| Strategy | Text submission | Images | Request completion | Turn owner | After interruption |
| --- | --- | --- | --- | --- | --- |
| Cascaded | `user`, `system`, `developer` | Only when `agent.capabilities.image` is true | Response and playback | Client TurnDetector | Usually reusable; inspect result |
| ChatAudioIO | `user` text where worker supports it | Unsupported | Unavailable | Provider | New pipeline |
| XiaoZhi | Unsupported | Unsupported | Unavailable | Provider | New pipeline |
| Native Live | Unsupported through `submit` | Unsupported through `submit` | Unavailable | Provider | New pipeline |

Always inspect the selected instance's `textInput`, `imageInput`, `inputRoles`, `submitCompletion`, `turnControl`, and `interruptionReuse`. The common message shape can express more than a particular backend accepts. Unsupported content or roles reject with `unsupported_capability` before submission. A cascaded conversation derives `imageInput` from `agent.capabilities.image`. `Agent.create()` propagates its LLM image capability. Custom agents default to text-only; opt in with `capabilities: { image: true }` only when their `run` implementation accepts images. Unsupported submitted images and initial history images reject before they enter conversation history, so a rejected image does not affect later text turns.

## Add microphone input

Keep the `ptt` object from construction. Replace the automated request workflow with:

```ts
await pipeline.start()
await pipeline.setMicrophoneMuted(false)
// Connect these two operations to your own input control:
ptt.press()
ptt.release()
// On application exit:
await pipeline.close()
```

The press and release calls must surround the time the user actually speaks; calling them back-to-back does not record a useful utterance. The example deliberately leaves UI and physical button binding to the application. Do not attach a client TurnDetector to a provider-controlled Live session as a second turn owner.

Pressing again while the previous utterance is still being transcribed cancels that recognition and starts a new recording. The previous transcript is not queued for a later answer. The cascaded backend closes the previous STT before opening its replacement, keeps at most one STT resource active, and ignores late results from the cancelled utterance. A final transcript received during `finish()` is committed only after that finish succeeds.

## Add one tool or a camera

To add a tool, replace the empty ToolSet in construction:

```ts
tools: ToolSet.create([{
  definition: {
    type: 'function', name: 'current_mode', description: 'Read the current application mode.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  execute() { return { mode: 'conversation' } },
}]),
```

Tool handlers run only when the Agent executes a completed model function call. Do not execute irreversible actions from partial ASR text or `output.text` deltas. Apply application authorization inside the handler when needed.

See [tool execution and MCP adapters](ai-tools.md) for custom schema validators, cancellation of pending tool waits, remote side-effect limits, and bounded result serialization.

For camera questions, add the separate Vision facade with the same LLM:

```ts
import { adaptRobotCamera, Vision } from 'stackchan/ai'
import { VoiceScope } from 'stackchan/voice'

const vision = Vision.create({ camera: adaptRobotCamera(robot.camera), llm })
const scope = VoiceScope.create()
try {
  const observation = await vision.observe({ question: 'What is in front of me?' }, scope)
  trace(`${observation.text}\n`)
} finally {
  scope.abort()
  scope.dispose()
}
```

Check camera availability and `llm.capabilities.image` first. This extension needs a named `llm` variable from the construction step. A `Scope` carries cancellation, not device ownership; abort it when its task is no longer wanted and dispose its parent subscription after completion.

## Provider authors and future extensions

Use [the PCM/STT/TTS adapter guide](stackchan-voice-adapters.md) for Source/Sink construction, buffer ownership, backpressure, `flush`, `endInput`, and audio supply completion. `SpeechPlayback` is a synthesis-through-playback facade for `robot.audio.say()`, while the conversation TTS contract produces an audio Source. A finished Source still needs its playback receipt before sound is considered played.

For existing applications, follow [the API migration guide](voice-api-migration.md) for companion constructors, named exports, MOD rebuilding, and restoring a replaced speech provider.

See [conversation boundaries](../../docs/architecture/voice-conversation-boundaries.md) for realtime models, ASR semantics, wake-word handoff, and the current exclusivity limit.
