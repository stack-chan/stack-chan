import Transport from 'realtimeConversation/transport'
import OpusDecoder from 'stackchanOpusDecoder'
import OpusEncoder from 'stackchanOpusEncoder'
import MP3Decoder from 'esp32-mp3-decoder'
import AudioOut from 'pins/audioout'
import { assert, equal } from 'testing/assert'
import Time from 'time'
import Timer from 'timer'

function bounded(promise, label, timeout = 5000) {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = Timer.set(() => {
      settled = true
      reject(new Error(`${label} timed out`))
    }, timeout)
    promise.then(
      (value) => {
        if (settled) return
        settled = true
        Timer.clear(timer)
        resolve(value)
      },
      (error) => {
        if (settled) return
        settled = true
        Timer.clear(timer)
        reject(error)
      },
    )
  })
}

function wait(milliseconds) {
  return new Promise((resolve) => Timer.set(resolve, milliseconds))
}

async function captureProgress(transport, getError, previous, label) {
  let poll
  try {
    return await bounded(
      new Promise((resolve, reject) => {
        poll = Timer.repeat(() => {
          try {
            const error = getError()
            if (error) throw error
            const stats = transport.stats
            if (stats.encodedFrames > previous.encodedFrames && stats.capturedSamples > previous.capturedSamples)
              resolve(stats)
          } catch (error) {
            reject(error)
          }
        }, 25)
      }),
      label,
    )
  } finally {
    if (poll !== undefined) Timer.clear(poll)
  }
}

async function captureCycle(cycle) {
  let transport, heartbeat, error, finalStats
  let ticks = 0,
    maximumGapMs = 0,
    previousTick = Time.ticks,
    released = false
  const started = Time.ticks
  try {
    trace(`capture-cycle ${cycle} starting\n`)
    globalThis.amp.sampleRate = 48000
    heartbeat = Timer.repeat(() => {
      maximumGapMs = Math.max(maximumGapMs, Time.delta(previousTick, Time.ticks))
      previousTick = Time.ticks
      ticks++
    }, 25)
    transport = new Transport((event) => {
      if (event.type === 'error') error = new Error(`capture ${event.stage ?? 'native'}: ${event.code}`)
      else if (event.type === 'disconnected') error = new Error('capture disconnected')
    })
    transport.setVolume(0)
    transport.setMuted(true)
    // This opens the native duplex bus and encoder without a peer, SDP or network.
    transport.start({ captureOnly: true })
    const muted = await captureProgress(
      transport,
      () => error,
      { encodedFrames: 0, capturedSamples: 0 },
      'muted capture',
    )
    const mutedTicks = ticks
    transport.setMuted(false)
    const unmuted = await captureProgress(transport, () => error, muted, 'unmuted capture')
    transport.setMuted(true)
    finalStats = await captureProgress(transport, () => error, unmuted, 'remuted capture')
    assert(ticks > mutedTicks, 'JS timers advance while native capture continues')
    assert(!error, 'native capture completed without an error event')
  } finally {
    try {
      if (transport) {
        await bounded(transport.close(), 'native capture close')
        released = true
        finalStats = transport.stats
      } else released = true
    } finally {
      if (heartbeat !== undefined) Timer.clear(heartbeat)
      // Never reconfigure the codec while a timed-out native close may own I2S.
      if (released) globalThis.amp.sampleRate = 24000
    }
  }
  assert(!error, error?.message ?? 'native capture and close completed without errors')
  trace(
    `capture-cycle ${JSON.stringify({ cycle, elapsedMs: Time.delta(started, Time.ticks), ticks, maximumGapMs, ...finalStats })}\n`,
  )
  // Timer and freeInternalHeap figures are observations, not UI-latency or
  // largest-contiguous-block acceptance. No peer/TLS/provider path was exercised.
}

async function silentPlaybackCycle(cycle) {
  const output = new AudioOut({ sampleRate: 24000, numChannels: 1, bitsPerSample: 16, streams: 1 })
  try {
    output.start()
    // No samples are enqueued. Opening the real driver must reacquire the bus
    // released by the previous native session without audible playback.
    await bounded(wait(100), 'silent AudioOut interval', 1000)
  } finally {
    try {
      output.stop()
    } finally {
      output.close()
    }
  }
  trace(`silent-audioout-cycle ${cycle} released\n`)
}

function exerciseCodecs() {
  const codecs = []
  try {
    codecs.push(new MP3Decoder())
    codecs.push(new OpusDecoder(16000, 60))
    const encoder = new OpusEncoder()
    codecs.push(encoder)
    equal(encoder.capturedPcmBytes, 0, 'new encoder has no captured PCM')
    equal(encoder.droppedPcmBytes, 0, 'new encoder has no dropped PCM')
  } finally {
    for (const codec of codecs.reverse()) codec.close()
  }
}

async function run() {
  // Construct the actual optimized codecs with no setup/realtime-performance
  // module and no earlier transport. This used to dereference unset allocators.
  exerciseCodecs()
  trace('codecs-before-transport passed\n')
  const transport = new Transport(() => {})
  await bounded(transport.close(), 'unstarted transport close')
  exerciseCodecs()
  trace('codecs-after-unstarted-transport passed\n')
  assert(globalThis.amp, 'CoreS3 amplifier is initialized')
  for (let cycle = 1; cycle <= 2; cycle++) {
    await captureCycle(cycle)
    await silentPlaybackCycle(cycle)
  }
  exerciseCodecs()
  trace('@@STACKCHAN_TEST:PASS@@\n')
}

export default run
