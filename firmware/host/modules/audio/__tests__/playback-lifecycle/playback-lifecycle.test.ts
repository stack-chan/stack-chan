import Debug from 'debug'
import AudioOut from 'pins/audioout'
import { createRecordingWave } from 'recording-wave'
import Speaker from 'speaker'
import { assert, equal } from 'testing/assert'
import Timer from 'timer'
import { TTS as ClipPlayer } from 'tts-local'
import { beginTTSPlayback, runTTSPlayback } from 'tts-playback-lifecycle'
import { PlaybackProvider, playbackReleaseFailure } from 'tts-playback-session'

const current = () => AudioOut.instances[AudioOut.instances.length - 1]
const observe = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error) => error,
  )

async function run() {
  const owner = new PlaybackProvider()
  for (let cycle = 0; cycle < 100; cycle++) {
    const order: string[] = []
    owner.onPlayed = (power) => {
      order.push(`power:${power}`)
    }
    owner.onDone = () => {
      order.push('done')
    }
    const lifecycle = beginTTSPlayback(owner, (error) => {
      equal(error, undefined)
      order.push('callback')
    })
    if (!lifecycle) throw new Error('playback did not start')
    const audio = lifecycle.openAudio({ streams: 1 }, 0.5)
    lifecycle.attach({
      close() {
        order.push('streamer')
      },
    })
    lifecycle.onReady(true)
    lifecycle.onPlayed(new ArrayBuffer(3))
    await new Promise<void>((resolve) =>
      Timer.set(() => {
        audio.deliver(lifecycle.onDone)
        resolve()
      }, 1),
    )
    await lifecycle.released
    equal(owner.streaming, false, 'completion releases provider')
    equal(audio.closes, 1, 'completion closes one output')
    equal(audio.closesInCallback, 0, 'audio callback returns before output close')
    equal(audio.started, 1, 'ready starts the output')
    equal(
      JSON.stringify(order),
      JSON.stringify(['power:3', 'streamer', 'done', 'callback']),
      'cleanup precedes presentation and completion',
    )

    const reason = new Error('app closed')
    let result: unknown
    const cancelled = beginTTSPlayback(owner, (error) => {
      result = error
    })
    if (!cancelled) throw new Error('cancel trial did not start')
    cancelled.openAudio({ streams: 1 }, 0.5)
    let closes = 0
    cancelled.attach({
      close() {
        closes++
        cancelled.onDone()
      },
    })
    await cancelled.cancel(reason)
    cancelled.onDone()
    cancelled.onError(new Error('late error'))
    cancelled.onPower(999)
    equal(result, reason, 'cancelled result is delivered once')
    equal(closes, 1, 'reentrant close does not release twice')
    equal(current().closes, 1, 'cancel closes the output')
    equal(owner.streaming, false, 'cancel allows the next operation')
  }

  AudioOut.constructorFailure = true
  let failure: unknown
  runTTSPlayback(
    owner,
    (error) => {
      failure = error
    },
    (lifecycle) => {
      lifecycle.openAudio({ streams: 1 }, 0.5)
    },
  )
  await owner.cancelPlayback?.()
  assert(failure instanceof Error, 'constructor failure completes with an error')
  equal(owner.streaming, false)
  AudioOut.constructorFailure = false

  AudioOut.volumeFailure = true
  runTTSPlayback(
    owner,
    (error) => {
      failure = error
    },
    (lifecycle) => {
      lifecycle.openAudio({ streams: 1 }, 0.5)
    },
  )
  await owner.cancelPlayback?.()
  equal(current().closes, 1, 'initial volume failure rolls back acquired output')
  AudioOut.volumeFailure = false

  for (const phase of ['start', 'stop'] as const) {
    const lifecycle = beginTTSPlayback(owner)
    if (!lifecycle) throw new Error('ready trial did not start')
    const audio = lifecycle.openAudio({ streams: 1 }, 0.5)
    audio.startFailure = phase === 'start'
    audio.stopFailure = phase === 'stop'
    lifecycle.onReady(phase === 'start')
    await lifecycle.released
    equal(audio.closes, 1, 'ready callback failure releases the output')
  }

  const brokenOwner = new PlaybackProvider()
  const broken = beginTTSPlayback(brokenOwner)
  if (!broken) throw new Error('failure trial did not start')
  const audio = broken.openAudio({ streams: 1 }, 0.5)
  audio.closeFailure = true
  let streamerClosed = false
  broken.attach({
    close() {
      streamerClosed = true
      throw new Error('streamer close failed')
    },
  })
  broken.onDone()
  equal((await observe(broken.released))?.code, 'IO', 'cleanup errors reject release')
  assert(streamerClosed, 'streamer cleanup was attempted')
  equal(audio.closes, 1, 'audio cleanup follows failed streamer cleanup')
  let rejected: unknown
  equal(
    beginTTSPlayback(brokenOwner, (error) => {
      rejected = error
    }),
    undefined,
  )
  equal(rejected, playbackReleaseFailure(brokenOwner), 'provider retains its physical failure')

  const speaker = new Speaker()
  const tone = speaker.tone(440, 10)
  current().deliver()
  await tone
  equal(current().closesInCallback, 0, 'Speaker follows the same native completion boundary')
  const active = observe(speaker.tone(440, 1000))
  await speaker.close()
  equal((await active)?.code, 'CLOSED', 'Speaker close waits and rejects the operation')
  equal((await observe(speaker.tone(440, 10)))?.code, 'CLOSED', 'closed Speaker cannot reacquire')

  const pcmSpeaker = new Speaker()
  for (let cycle = 0; cycle < 100; cycle++) {
    const wave = createRecordingWave({ sampleRate: 16000, channels: 1, bitsPerSample: 16 }, 10)
    wave.samples[0] = 23
    const playing = pcmSpeaker.play(wave.buffer, 0.25)
    const audio = current()
    await new Promise<void>((resolve) => Timer.set(() => resolve(), 1))
    Debug.gc()
    equal(audio.raw?.deref()?.byteLength, wave.samples.byteLength, 'PCM survives GC while C would own its pointer')
    equal(new Uint8Array(audio.raw?.deref() ?? new ArrayBuffer(0))[0], 23, 'only PCM reaches RawSamples')
    equal(audio.options.sampleRate, 16000)
    equal(audio.volumes.length, 1, 'initial volume is sent once')
    equal(audio.volumes[0], 64, 'per-operation volume is honored')
    audio.deliver()
    equal(await playing, true)
    equal(audio.closesInCallback, 0)
    equal(audio.closes, 1)
    const cancelled = observe(pcmSpeaker.play(wave.buffer))
    await pcmSpeaker.cancelPlayback?.()
    equal((await cancelled)?.code, 'CANCELLED', 'PCM cancellation rejects instead of returning false')
  }
  const count = AudioOut.instances.length
  equal((await observe(pcmSpeaker.play(new ArrayBuffer(44))))?.code, 'INVALID_ARGUMENT')
  equal((await observe(pcmSpeaker.tone(NaN, 10)))?.code, 'INVALID_ARGUMENT')
  equal((await observe(pcmSpeaker.tone(440, 10, NaN)))?.code, 'INVALID_ARGUMENT')
  equal(AudioOut.instances.length, count, 'invalid requests never acquire output')
  await pcmSpeaker.close()

  const faultedSpeaker = new Speaker()
  const wave = createRecordingWave({ sampleRate: 16000, channels: 1, bitsPerSample: 16 }, 10)
  const faultedPlay = observe(faultedSpeaker.play(wave.buffer))
  const faultedAudio = current()
  faultedAudio.closeFailure = true
  faultedAudio.deliver()
  equal((await faultedPlay)?.code, 'IO')
  await new Promise<void>((resolve) => Timer.set(() => resolve(), 1))
  Debug.gc()
  equal(faultedAudio.raw?.deref()?.byteLength, wave.samples.byteLength, 'unconfirmed native close keeps PCM pinned')
  const beforeRetry = AudioOut.instances.length
  equal((await observe(faultedSpeaker.play(wave.buffer)))?.code, 'IO')
  equal(AudioOut.instances.length, beforeRetry, 'a release failure prevents reacquisition')

  for (const rate of [11025, 44100]) {
    const player = new ClipPlayer({})
    const completed = new Promise<void>((resolve, reject) =>
      player.stream(`clip-${rate}`, undefined, (error) => (error ? reject(error) : resolve())),
    )
    const output = current()
    equal(output.sampleRate, rate, 'clip playback follows the resource header without app configuration')
    equal(output.started, 1, 'resource streamer started')
    output.deliver(() => output.callbacks[0]?.(0))
    await completed
    equal(output.closes, 1, 'clip completion releases the output')
    await player.close()
  }
  const invalidClip = new ClipPlayer({})
  const outputs = AudioOut.instances.length
  const invalid = await observe(
    new Promise<void>((resolve, reject) =>
      invalidClip.stream('clip-invalid', undefined, (error) => (error ? reject(error) : resolve())),
    ),
  )
  equal(invalid?.code, 'IO', 'malformed resources have an observable failure')
  equal(AudioOut.instances.length, outputs, 'malformed resources do not acquire the output')
  await invalidClip.close()

  await owner.close()
  trace('ok\n')
}
Promise.resolve()
  .then(run)
  .catch((error) => trace(`FAIL ${error?.stack ?? error}\n`))
