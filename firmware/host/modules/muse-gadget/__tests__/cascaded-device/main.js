import { internalFree, internalMinimum, psramFree } from 'offline-heap'
import { createMuseCascadedConversation } from 'muse-cascaded-conversation'
import { createMuseChatAgent } from 'muse-chat-agent'
import { createGuruguruView } from 'guruguru-view'
import { createCascadedConversation, createPushToTalk } from 'stackchan/voice/cascaded'
import { createAudioRuntime } from 'stackchan/voice/device'
import { createConversationPipeline } from 'stackchan/voice/pipeline'
import { createPcmSource } from 'stackchan/voice/media'
import { createVoiceScope } from 'stackchan/voice/scope'
import { Application, Label, Skin, Style } from 'piu/MC'
import Timer from 'timer'

const marker = (value) => trace(`MUSE_OFFLINE ${value}\n`)
const view = createGuruguruView()
const caption = new Label(null, {
  left: 100,
  right: 100,
  top: 52,
  height: 56,
  style: new Style({ font: 'k8x12-24', color: 'white' }),
  string: 'Offline test',
})
new Application(null, { skin: new Skin({ fill: 'black' }), displayListLength: 4096, contents: [view.content, caption] })
const scope = createVoiceScope()
let pipeline
async function run() {
  marker('start')
  marker('internal_before_' + internalFree())
  marker('psram_before_' + psramFree())
  const pause = () => new Promise((resolve) => Timer.set(resolve, 150))
  for (const expression of ['neutral', 'happy', 'sad', 'neutral']) {
    view.model.setExpression(expression)
    for (let direction = 0; direction < 9; direction++) {
      view.model.trackFace((((direction % 3) + 0.5) * 466) / 3, ((Math.floor(direction / 3) + 0.5) * 466) / 3, 466, 466)
      view.model.eyeOpen = false
      view.model.invalidate()
      await pause()
      view.model.eyeOpen = true
      view.model.setState('speak')
      view.model.mouthOpen = true
      view.model.invalidate()
      await pause()
      view.model.setState('idle')
    }
    marker('expression_' + expression)
    marker('internal_free_' + internalFree())
    marker('internal_min_' + internalMinimum())
    marker('psram_free_' + psramFree())
  }
  view.model.trackFace(233, 233, 466, 466)
  const audio = createAudioRuntime({ volume: 0.08, emitLevels: false, acquireExclusive: () => () => {} })
  const conversation = createMuseCascadedConversation({
    createConversation: createCascadedConversation,
    createPushToTalk,
    createAgent: createMuseChatAgent,
    async openChat() {
      return {
        async send() {
          marker('agent_done')
          return { status: 'completed', messages: [{ id: 'fixture', text: 'これは音声再生の確認です。' }] }
        },
        close() {},
      }
    },
    stt: {
      async open() {
        throw new Error('offline microphone disabled')
      },
    },
    tts: {
      async open({ format }) {
        const source = createPcmSource(format)
        return {
          output: source.output,
          async write() {},
          async endInput() {
            marker('pcm_start')
            const pcm = new Uint8Array(new SharedArrayBuffer(2000))
            for (let i = 0; i < 12; i++) await source.push(pcm)
            source.end()
          },
          async close() {
            source.end()
          },
        }
      },
    },
    voice: 'alloy',
    onPlaybackState(value) {
      marker(value ? 'playback_start' : 'playback_stop')
      view.model.setState(value ? 'speak' : 'idle')
    },
  })
  pipeline = createConversationPipeline({
    conversation,
    microphone: audio.microphone,
    speaker: audio.speaker,
    microphoneMuted: true,
    mediaBudget: { maxBufferedMs: 500, maxBufferedBytes: 24576 },
    onEvent(event) {
      if (event.type === 'output.text') {
        marker('caption')
        caption.string = event.delta
      } else if (event.type === 'error') marker(`conversation_error_${event.code}`)
      else if (event.type === 'turn.ended') marker(`turn_${event.status}`)
    },
  })
  await pipeline.start(scope)
  for (let i = 0; i < 3; i++) {
    const accepted = await pipeline.submit(
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'fixture' }] },
      scope,
    )
    const result = await accepted.done
    if (result.status !== 'completed') throw new Error('offline turn failed')
  }
  await pipeline.close({ mode: 'drain' })
  marker('pass')
}
Timer.set(() => {
  void run().catch(async (error) => {
    marker('fail')
    marker(error?.constructor?.name ?? 'unknown')
    await pipeline?.close({ mode: 'abort' })
  })
}, 1500)
