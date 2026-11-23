import { formatVoiceExampleError, runTextConversation } from 'minimal-voice-workflow'
import { defineMod } from 'mod-kit'
import { ensure, isErr } from 'stackchan-result'
import { Agent, OpenAIResponsesLLM, ToolSet } from 'stackchan/ai'
import { CascadedConversation, ConversationPipeline, type Microphone, PushToTalk, type Speaker } from 'stackchan/voice'
import { OpenAISpeechTTS, WhisperSTT } from 'stackchan/voice/speech'

type VoiceAudioEndpoints = Readonly<{
  microphone?: Microphone
  speaker?: Speaker
}>

type VoiceAiConfig = Readonly<{
  token?: string
  model?: string
}>

function readAudioEndpoints(context: unknown): VoiceAudioEndpoints {
  if (!context || typeof context !== 'object' || !('audio' in context)) return {}
  const audio = (context as { readonly audio?: unknown }).audio
  if (!audio || typeof audio !== 'object') return {}
  return audio as VoiceAudioEndpoints
}

function readAiConfig(option: unknown): VoiceAiConfig {
  if (!option || typeof option !== 'object' || !('config' in option)) return {}
  const config = (option as { readonly config?: unknown }).config
  if (!config || typeof config !== 'object' || !('ai' in config)) return {}
  const ai = (config as { readonly ai?: unknown }).ai
  if (!ai || typeof ai !== 'object') return {}
  const record = ai as { readonly token?: unknown; readonly model?: unknown }
  return {
    token: typeof record.token === 'string' && record.token.length > 0 ? record.token : undefined,
    model: typeof record.model === 'string' && record.model.length > 0 ? record.model : undefined,
  }
}

export const { onContextCreated, onClose } = defineMod({
  setup(context, option, scope) {
    const { microphone, speaker } = readAudioEndpoints(context)
    const { token, model = 'gpt-4o-mini' } = readAiConfig(option)

    const validMicrophone = ensure(microphone, () => new Error('This host does not provide conversation audio'))
    if (isErr(validMicrophone)) throw validMicrophone.error
    const validSpeaker = ensure(speaker, () => new Error('This host does not provide conversation audio'))
    if (isErr(validSpeaker)) throw validSpeaker.error
    const validToken = ensure(token, () => new Error('Configure ai.token before starting this example'))
    if (isErr(validToken)) throw validToken.error

    const conversation = CascadedConversation.create({
      stt: WhisperSTT.create({ apiKey: validToken.value }),
      agent: Agent.create({
        llm: OpenAIResponsesLLM.create({ apiKey: validToken.value, model }),
        tools: ToolSet.create([]),
        instructions: 'Reply in one short sentence.',
        maxToolRounds: 1,
      }),
      tts: OpenAISpeechTTS.create({ apiKey: validToken.value }),
      turnDetector: PushToTalk.create().detector,
      voice: 'alloy',
    })

    const pipeline = ConversationPipeline.create({
      microphone: validMicrophone.value,
      speaker: validSpeaker.value,
      conversation,
      microphoneMuted: true,
    })

    scope.own(async () => {
      await pipeline.close()
    })

    void runTextConversation(pipeline, ['Hello.', 'What did I just say?']).then(
      (result) => {
        if (isErr(result)) {
          trace(`minimal_voice: ${formatVoiceExampleError(result.error)}\n`)
        }
      },
      (cause) => {
        trace(`minimal_voice: ${cause instanceof Error ? cause.message : String(cause)}\n`)
      },
    )
  },
})
