import { createGuruguruView } from 'guruguru-view'
import Modules from 'modules'
import Preference from 'preference'
import { ConversationPipeline, VoiceScope } from 'stackchan/voice'

let dispose
export function onClose() {
  return dispose?.()
}

export function onContextCreated(robot) {
  const view = createGuruguruView()
  robot.ui.addEffect(view.content)
  const a = robot.input.button?.a,
    b = robot.input.button?.b
  const previousA = a?.onEvent,
    previousB = b?.onEvent
  let pipeline, scope, opening, stopping, closing
  let held = false,
    recording = false,
    closed = false
  const turns = new Set()
  const state = (value) => {
    if (!closed) view.model.setState(value)
  }
  const rest = () => state(held ? 'listen' : turns.size ? 'think' : 'idle')
  const report = (error) => {
    if (error?.code === 'muse_configuration') return
    if (!closed) {
      state('idle')
      robot.ui.showBalloon('Muse voice could not start or continue. Check host and Muse settings.')
    }
  }
  function stop(mode = 'drain') {
    held = false
    recording = false
    if (stopping) return stopping
    stopping = Promise.resolve()
      .then(async () => {
        try {
          await pipeline?.close({ mode, timeoutMs: 10000 })
        } finally {
          scope?.abort()
          scope = pipeline = opening = undefined
          turns.clear()
          state('idle')
        }
      })
      .finally(() => {
        stopping = undefined
      })
    return stopping
  }
  function start() {
    if (!Modules.has('muse-voice')) {
      robot.ui.showBalloon('This host does not include the opt-in Muse voice backend.')
      return Promise.reject(Object.assign(new Error('Muse host unavailable'), { code: 'muse_configuration' }))
    }
    const configuration = {}
    const missing = []
    for (const key of ['host', 'vmId', 'token', 'appId', 'nodeId']) {
      const value = Preference.get('muse', key)
      if (typeof value !== 'string' || !value.length) missing.push(key)
      else configuration[key] = value
    }
    if (missing.length) {
      robot.ui.showBalloon(`Configure Muse settings: ${missing.join(', ')}`)
      return Promise.reject(Object.assign(new Error('Muse settings missing'), { code: 'muse_configuration' }))
    }
    const { createMuseVoiceConversation } = Modules.importNow('muse-voice')
    scope = VoiceScope.create()
    pipeline = ConversationPipeline.create({
      microphone: robot.audio.microphone,
      speaker: robot.audio.speaker,
      conversation: createMuseVoiceConversation(configuration),
      microphoneMuted: true,
      mediaBudget: { maxBufferedMs: 500, maxBufferedBytes: 24576 },
      onEvent(event) {
        if (closed || stopping) return
        if (event.type === 'session.ended') {
          held = false
          recording = false
          scope?.abort()
          scope = pipeline = opening = undefined
          turns.clear()
          state('idle')
          return
        }
        if (event.type === 'input.transcript' && event.value.final) robot.ui.showBalloon(event.value.text)
        else if (event.type === 'turn.started') {
          turns.add(event.turnId)
          rest()
        } else if (event.type === 'turn.ended') {
          turns.delete(event.turnId)
          rest()
        } else if (event.type === 'output.level') {
          if (!held && event.value > 0) state('speak')
          view.model.setLevel(event.value)
          if (!event.value) rest()
        } else if (event.type === 'error') {
          robot.ui.showBalloon('Muse voice reported a connection or provider error.')
          if (event.fatal) void stop('abort').catch(report)
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
        await pipeline.setMicrophoneMuted(true)
        rest()
      }
      return
    }
    try {
      await (opening ?? start())
      if (!held || closed || stopping) return
      recording = true
      await pipeline.setMicrophoneMuted(false)
      if (!closed && !stopping) rest()
    } catch (error) {
      await stop('abort').catch(() => {})
      throw error
    }
  }
  const onA = (event) => {
    void press(event).catch(report)
  }
  const onB = (event) => {
    if (event.pressed) void stop().catch(report)
  }
  if (a) a.onEvent = onA
  if (b) b.onEvent = onB
  dispose = () => {
    if (closing) return closing
    closed = true
    if (a?.onEvent === onA) a.onEvent = previousA
    if (b?.onEvent === onB) b.onEvent = previousB
    closing = stop('abort').finally(() => {
      view.close()
      robot.ui.removeEffect(view.content)
    })
    return closing
  }
}
