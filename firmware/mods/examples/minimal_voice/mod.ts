import { runTextConversation } from 'minimal-voice-workflow'
import { Agent, OpenAIResponsesLLM, ToolSet } from 'stackchan/ai'
import type { Microphone, Speaker } from 'stackchan/voice'
import { CascadedConversation, ConversationPipeline, PushToTalk } from 'stackchan/voice'
import { OpenAISpeechTTS, WhisperSTT } from 'stackchan/voice/speech'

let pipeline: ReturnType<typeof ConversationPipeline.create> | undefined

export function onContextCreated(
  robot: { audio: { microphone?: Microphone; speaker?: Speaker } },
  option: { config: { ai: { token: string; model?: string } } },
) {
  const { microphone, speaker } = robot.audio
  const { token, model = 'gpt-4o-mini' } = option.config.ai
  if (!microphone || !speaker) throw new Error('This host does not provide conversation audio')
  if (!token) throw new Error('Configure ai.token before starting this example')

  const conversation = CascadedConversation.create({
    stt: WhisperSTT.create({ apiKey: token }),
    agent: Agent.create({
      llm: OpenAIResponsesLLM.create({ apiKey: token, model }),
      tools: ToolSet.create([]),
      instructions: 'Reply in one short sentence.',
      maxToolRounds: 1,
    }),
    tts: OpenAISpeechTTS.create({ apiKey: token }),
    turnDetector: PushToTalk.create().detector,
    voice: 'alloy',
  })
  pipeline = ConversationPipeline.create({ microphone, speaker, conversation, microphoneMuted: true })
  void runTextConversation(pipeline, ['Hello.', 'What did I just say?']).catch((error: unknown) => {
    trace(`minimal_voice: ${error instanceof Error ? error.message : String(error)}\n`)
  })
}

export function onClose() {
  return pipeline?.close()
}
