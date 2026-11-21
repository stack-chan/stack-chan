import { createGuruguruView } from 'guruguru-view'
import { Agent, OpenAIResponsesLLM, ToolSet } from 'stackchan/ai'
import { CascadedConversation, ConversationPipeline, PushToTalk, VoiceScope } from 'stackchan/voice'
import { OpenAISpeechTTS, WhisperSTT } from 'stackchan/voice/speech'

let close
export function onClose() {
  return close?.()
}

export function onContextCreated(robot, option) {
  const view = createGuruguruView()
  robot.ui.addEffect(view.content)
  const { token, model = 'gpt-4o-mini', voice = 'alloy' } = option.config.ai
  const scope = VoiceScope.create()
  const ptt = PushToTalk.create()
  let pipeline,
    opening,
    stopping,
    held = false,
    recording = false,
    closed = false
  let activeTurn
  const button = robot.input.button?.a
  const endButton = robot.input.button?.b
  const previous = button?.onEvent,
    previousEnd = endButton?.onEvent
  const state = (value) => {
    if (!closed) view.model.setState(value)
  }
  async function stop() {
    held = false
    recording = false
    ptt.release()
    if (stopping) return stopping
    stopping = (async () => {
      try {
        try {
          await opening
        } finally {
          await pipeline?.close({ mode: 'abort' })
        }
      } finally {
        pipeline = undefined
        opening = undefined
        stopping = undefined
        activeTurn = undefined
        state('idle')
      }
    })()
    return stopping
  }
  function start() {
    if (!token) throw new Error('Configure ai.token for cascaded voice; Muse is not connected')
    const conversation = CascadedConversation.create({
      stt: WhisperSTT.create({ apiKey: token, maxAudioBytes: 194560 }),
      agent: Agent.create({
        llm: OpenAIResponsesLLM.create({ apiKey: token, model }),
        tools: ToolSet.create([]),
        maxToolRounds: 1,
        instructions: 'Reply briefly in natural Japanese suitable for spoken audio. Do not use markdown or emoji.',
      }),
      tts: OpenAISpeechTTS.create({ apiKey: token }),
      turnDetector: ptt.detector,
      voice,
    })
    pipeline = ConversationPipeline.create({
      microphone: robot.audio.microphone,
      speaker: robot.audio.speaker,
      conversation,
      mediaBudget: { maxBufferedMs: 250, maxBufferedBytes: 24576 },
      onEvent(event) {
        if (closed) return
        if (event.type === 'input.transcript' && event.value.final) {
          robot.ui.showBalloon(event.value.text)
          state(event.value.text.trim() ? 'think' : 'idle')
        } else if (event.type === 'turn.started') {
          activeTurn = event.turnId
          state('think')
        } else if (event.type === 'output.level') {
          if (activeTurn && !held) {
            if (event.value > 0) state('speak')
            view.model.setLevel(event.value)
          }
        } else if (event.type === 'turn.ended' && activeTurn === event.turnId) {
          activeTurn = undefined
          state(held ? 'listen' : 'idle')
        } else if (event.type === 'error') {
          robot.ui.showBalloon(`Voice: ${event.code}`)
          if (event.fatal) void stop().catch(() => {})
          else state(held ? 'listen' : 'idle')
        }
      },
    })
    if (robot.audio.volume !== undefined) pipeline.setVolume(robot.audio.volume)
    opening = pipeline.start(scope)
    return opening
  }
  async function press(event) {
    if (closed || stopping) return
    held = event.pressed
    if (!held) {
      if (recording) {
        recording = false
        ptt.release()
        state('think')
      }
      return
    }
    try {
      await (opening ?? start())
    } catch (error) {
      await stop().catch(() => {})
      throw error
    }
    if (held && !closed && !stopping) {
      recording = true
      state('listen')
      ptt.press()
    }
  }
  const report = (error) => {
    if (!closed) {
      state('idle')
      robot.ui.showBalloon(String(error))
    }
  }
  if (button)
    button.onEvent = (event) => {
      void press(event).catch(report)
    }
  if (endButton)
    endButton.onEvent = (event) => {
      if (event.pressed) void stop().catch(report)
    }
  close = async () => {
    if (closed) return
    closed = true
    if (button) button.onEvent = previous
    if (endButton) endButton.onEvent = previousEnd
    scope.abort()
    try {
      await stop()
    } finally {
      view.close()
      robot.ui.removeEffect(view.content)
    }
  }
}
