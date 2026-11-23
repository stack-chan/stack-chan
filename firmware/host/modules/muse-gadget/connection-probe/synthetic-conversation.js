import { AccountSession } from 'muse-pairing-native'
import { createMuseAccountNoteConversation } from 'muse-account-note'
import { createDeviceAccountNetwork } from 'muse-setup/device-account-network'
import metadata from 'muse-setup-metadata'
import Resource from 'Resource'
import Timer from 'timer'
import Time from 'time'
import { createVoiceScope } from 'stackchan/voice/scope'
import { createPcmSource, createPcmSink, pcmMedia } from 'stackchan/voice/media'
import { openOutput } from 'stackchan/voice/cores3-pcm-output'

const format = { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 }
const budget = { maxBufferedBytes: 6400, maxBufferedMs: 200 }
const measurementStart = Time.ticks
const report = value => {
  if (/^[a-z_0-9]{1,60}$/.test(value)) trace(`MUSE_TIMING ${value} ${(Time.ticks - measurementStart) >>> 0}\n`)
  if (/^[a-z_0-9]{1,60}$/.test(value)) trace(`MUSE_CONNECT note_${value}\n`)
}

function silentSpeaker() {
  let driver, generation = 0, outputId
  const retire = () => {
    const owned = driver
    driver = undefined
    owned?.close()
  }
  return {
    budget,
    begin(id, epoch) {
      if (epoch !== generation || driver) throw Object.assign(new Error('output state'), { code: 'cancelled' })
      outputId = id
      driver = openOutput(16000, 0, 6400)
      report('synthetic_silent_output_open')
      const owned = driver
      return createPcmSink(format, bytes => owned.write(bytes))
    },
    async finish(id) {
      if (id !== outputId || !driver) throw Object.assign(new Error('output state'), { code: 'cancelled' })
      const owned = driver
      await owned.drain()
      if (driver !== owned) throw Object.assign(new Error('output changed'), { code: 'cancelled' })
      const receipt = { outputId: id, generation, state: 'played', position: { basis: 'estimate', renderedFrames: owned.frames, sampleRate: 16000 } }
      retire()
      report('synthetic_silent_output_drained')
      report(`synthetic_rendered_frames_${receipt.position.renderedFrames}`)
      return receipt
    },
    async fence(next) {
      if (next <= generation) throw Object.assign(new Error('stale generation'), { code: 'cancelled' })
      generation = next
      retire()
      return []
    },
    close: retire,
  }
}

Timer.set(async () => {
  let account, network, session, timeout, phase = 'network'
  const scope = createVoiceScope()
  const input = createPcmSource(format)
  const output = silentSpeaker()
  trace('MUSE_PROBE start\n')
  try {
    account = AccountSession.restore()
    network = createDeviceAccountNetwork(() => {}, () => {})
    await network.prepare(account, account.generation)
    await account.connectApproved(account.generation)
    const conversation = createMuseAccountNoteConversation(account, { nodeId: metadata().nodeId, onDiagnostic: report,
      onUploadMetrics({ encodingMs, sendingMs, chunks }) {
        report(`encode_ms_${encodingMs}`)
        report(`send_ms_${sendingMs}`)
        report(`chunks_${chunks}`)
      } })
    let resolveTurn, rejectTurn
    const turn = new Promise((resolve, reject) => { resolveTurn = resolve; rejectTurn = reject })
    void turn.catch(() => {})
    timeout = Timer.set(() => { scope.abort(); rejectTurn(Object.assign(new Error('timeout'), { code: 'deadline_exceeded' })) }, 180000)
    phase = 'open'
    session = await conversation.open({
      media: { input: input.output, output, media: pcmMedia },
      signal: scope.signal,
      history: [],
      onEvent(event) {
        if (event.type === 'output.text') report('synthetic_conversation_text')
        else if (event.type === 'output.playback') report(event.receipt.state === 'played' ? 'synthetic_conversation_played' : 'synthetic_conversation_not_played')
        else if (event.type === 'error') rejectTurn(Object.assign(new Error('conversation'), { code: event.code }))
        else if (event.type === 'turn.ended') event.status === 'completed' ? resolveTurn() : rejectTurn(new Error('turn failed'))
      },
    })
    phase = 'synthetic_input'
    const pcm = new Uint8Array(new Resource('synthetic-note.pcm'))
    await session.setInputEnabled(true)
    for (let offset = 0; offset < pcm.length; offset += 1280) await input.push(pcm.subarray(offset, offset + 1280))
    report('synthetic_release')
    await session.setInputEnabled(false)
    phase = 'reply_playback'
    await turn
    report('synthetic_conversation_pass')
  } catch(error) {
    report(`synthetic_conversation_failed_${phase}`)
    report(['cancelled','resource_exhausted','deadline_exceeded','provider_failed'].includes(error?.code) ? `error_${error.code}` : 'error_unknown')
  } finally {
    if (timeout !== undefined) Timer.clear(timeout)
    await session?.close({ mode: 'abort' }).catch(() => report('synthetic_conversation_close_failed'))
    scope.abort()
    input.end()
    output.close()
    await network?.close()
    account?.close()
    scope.dispose?.()
    trace('MUSE_PROBE closed\n')
  }
}, 1000)
