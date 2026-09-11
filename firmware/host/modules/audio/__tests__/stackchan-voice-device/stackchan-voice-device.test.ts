import AudioOut from 'embedded:io/audio/out'
import { resetState, state } from 'stackchan-voice-test-state'
import { assert, equal } from 'testing/assert'
import { TTS } from 'tts-stackchan-voice'

async function run() {
  resetState()

  const playedPowers: number[] = []
  let callbackCalls = 0
  let callbackError: unknown
  let doneCalls = 0
  const tts = new TTS({
    onDone: () => {
      doneCalls += 1
    },
    onPlayed: (power) => playedPowers.push(power),
    speed: 130,
    voice: 'cute',
    volume: 0.25,
  })

  await new Promise<void>((resolve) =>
    tts.stream('デバイス再生', 0.75, (error) => {
      callbackCalls += 1
      callbackError = error
      resolve()
    }),
  )

  equal(state.constructors.length, 1, 'device TTS should construct one stackchan-voice renderer')
  equal(state.constructors[0].preset, 1, 'device TTS should select the cute voice preset')
  equal(state.constructors[0].resourceName, 'stackchan-ja.aqd', 'device TTS should load its dictionary')
  equal(state.says.length, 1, 'device TTS should synthesize one utterance')
  equal(state.says[0].text, 'デバイス再生', 'device TTS should forward the utterance')
  equal(state.says[0].speed, 130, 'device TTS should forward the configured speed')
  equal(state.audio.sampleRate, 24000, 'device playback should use the synthesized sample rate')
  equal(state.audio.bitsPerSample, 16, 'device playback should use 16-bit PCM')
  equal(state.audio.channels, 1, 'device playback should be mono')
  equal(state.audio.volume, 0.75, 'stream volume should override the constructor volume')
  equal(state.audio.started, 1, 'device playback should start AudioOut')
  equal(state.audio.writes.length, 2, 'device playback should write PCM followed by its drain buffer')
  assert(
    state.audio.writes[0].some((byte) => byte !== 0),
    'device playback should write synthesized PCM',
  )
  assert(
    state.audio.writes[1].every((byte) => byte === 0),
    'device playback should zero-fill its drain buffer',
  )
  assert(
    state.audio.writesAreUint8Arrays.every(Boolean),
    'device playback should pass ArrayBuffer views accepted by AudioOut.write',
  )
  assert(
    playedPowers.some((power) => power > 0),
    'device playback should report synthesized power',
  )
  equal(state.audio.stopped, 1, 'completed device playback should stop AudioOut')
  equal(state.audio.closed, 1, 'completed device playback should close AudioOut')
  equal(doneCalls, 1, 'completed device playback should notify onDone once')
  equal(callbackCalls, 1, 'completed device playback should invoke its callback once')
  equal(callbackError, undefined, 'completed device playback should not report an error')
  equal(tts.streaming, false, 'completed device playback should clear streaming state')

  let singingCallbackCalls = 0
  let singingCallbackError: unknown
  await new Promise<void>((resolve) =>
    tts.streamKoe('#C4,500ki#D4,500ra', undefined, (error) => {
      singingCallbackCalls += 1
      singingCallbackError = error
      resolve()
    }),
  )

  equal(state.koes.length, 1, 'device TTS should synthesize one singing utterance')
  equal(state.koes[0].koe, '#C4,500ki#D4,500ra', 'device TTS should forward raw koe notation')
  equal(state.koes[0].speed, 130, 'device TTS should use the configured speed for singing consonants')
  equal(state.audio.started, 2, 'device singing should use the same AudioOut playback path')
  assert(
    state.audio.writes.slice(2).some((write) => write.some((byte) => byte !== 0)),
    'device singing should write synthesized PCM',
  )
  equal(singingCallbackCalls, 1, 'completed device singing should invoke its callback once')
  equal(singingCallbackError, undefined, 'completed device singing should not report an error')
  equal(tts.streaming, false, 'completed device singing should clear streaming state')

  for (const output of AudioOut.instances) equal(output.closesInCallback, 0, 'native callback returns before release')

  // A delayed callback from a previous output must never write to its successor.
  const previousOutput = AudioOut.instances[0]
  AudioOut.autoDeliver = false
  const pending = new Promise<unknown>((resolve) => tts.stream('次の再生', undefined, resolve))
  const output = AudioOut.instances[AudioOut.instances.length - 1]
  const writes = state.audio.writes.length
  previousOutput.deliver()
  equal(state.audio.writes.length, writes, 'old output cannot drive the current renderer')
  await tts.cancelPlayback?.()
  assert((await pending) instanceof Error, 'cancellation settles pending playback')
  equal(output.closes, 1, 'cancel releases the current output once')
  output.deliver()
  equal(state.audio.writes.length, writes, 'closed output cannot write PCM')
  AudioOut.autoDeliver = true
  await tts.close()

  for (const phase of ['volume', 'start', 'stop', 'close'] as const) {
    const provider = new TTS()
    AudioOut.failure = phase
    const error = await new Promise<unknown>((resolve) => provider.stream('失敗の試験', undefined, resolve))
    assert(error instanceof Error, `${phase} failure is reported to the operation`)
    const failedOutput = AudioOut.instances[AudioOut.instances.length - 1]
    equal(failedOutput.closes, 1, `${phase} failure still attempts output close`)
    equal(failedOutput.closesInCallback, 0, 'release runs outside the native callback')
    AudioOut.failure = undefined
    if (phase === 'stop' || phase === 'close') {
      const retry = await new Promise<unknown>((resolve) => provider.stream('再取得不可', undefined, resolve))
      equal(retry, error, 'physical release failure blocks another output acquisition')
      try {
        await provider.close()
      } catch (caught) {
        equal(caught, error)
      }
    } else await provider.close()
  }

  trace('ok\n')
}
Promise.resolve()
  .then(run)
  .catch((error) => trace(`FAIL ${error?.stack ?? error}\n`))
