import { formatVoiceExampleError, runTextConversation } from 'minimal-voice-workflow'
import { defineMod, type StackchanAppBehaviorOption } from 'mod-kit'
import { ensure, isErr } from 'stackchan-result'
import { Agent, OpenAIResponsesLLM, ToolSet } from 'stackchan/ai'
import { CascadedConversation, ConversationPipeline, PushToTalk } from 'stackchan/voice'
import { OpenAISpeechTTS, WhisperSTT } from 'stackchan/voice/speech'

type VoiceAiConfig = Readonly<{
  token?: string
  model?: string
}>

function readAiConfig(option: StackchanAppBehaviorOption): VoiceAiConfig {
  const ai = option.config.ai
  const token = typeof ai?.token === 'string' && ai.token.length > 0 ? ai.token : undefined
  const model = typeof ai?.model === 'string' && ai.model.length > 0 ? ai.model : undefined
  return { token, model }
}

export const { onContextCreated, onClose } = defineMod({
  setup(context, option, scope) {
    const { token, model = 'gpt-4o-mini' } = readAiConfig(option)

    const validMicrophone = ensure(
      context.audio.microphone,
      () => new Error('This host does not provide conversation audio'),
    )
    if (isErr(validMicrophone)) throw validMicrophone.error
    const validSpeaker = ensure(context.audio.speaker, () => new Error('This host does not provide conversation audio'))
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
