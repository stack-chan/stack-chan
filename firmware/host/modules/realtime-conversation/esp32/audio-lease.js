import Timer from 'timer'

class NativeAudio extends Native('xs_live_audio_lease_destructor') {
  constructor() {
    super()
    native('xs_live_audio_lease_open').call(this)
  }
  setInput(enabled) {
    native('xs_live_audio_lease_input').call(this, enabled)
  }
  setVolume(gain) {
    native('xs_live_audio_lease_volume').call(this, gain)
  }
  fence(discard) {
    native('xs_live_audio_lease_fence').call(this, discard)
  }
  quiet() {
    return native('xs_live_audio_lease_quiet').call(this)
  }
  close() {
    native('xs_live_audio_lease_close').call(this)
  }
}

const handles = new WeakMap()
const pcm = (sampleRate) => Object.freeze({ encoding: 'pcm_s16le', channels: 1, sampleRate })
export const liveAudioRequirements = Object.freeze({
  input: [pcm(16000)],
  output: [pcm(48000)],
  duplex: 'half',
  nativeBackend: 'gpt-live-webrtc',
})
export function borrowLiveAudio(input, output) {
  const entry = handles.get(input)
  if (!entry || entry.output !== output) throw new Error('Expected a CoreS3 WebRTC audio lease')
  return entry.native
}

export function openRealtimeAudioLease({ budget, signal }) {
  if (signal?.aborted) throw signal.reason ?? new Error('Audio acquisition cancelled')
  if (!(budget.maxBufferedBytes >= 131072 && budget.maxBufferedMs >= 1000))
    throw new RangeError('CoreS3 WebRTC requires a 128 KiB, 1000 ms media budget')
  const amp = globalThis.amp
  if (!amp) throw new Error('CoreS3 amplifier unavailable')
  let device
  try {
    amp.sampleRate = 48000
    device = new NativeAudio()
  } catch (error) {
    amp.sampleRate = 24000
    throw error
  }
  let closed = false,
    generation = 0,
    segment,
    settlement,
    fenced = false,
    discarded = false
  const input = Object.freeze({ format: liveAudioRequirements.input[0] })
  function settle(discard) {
    if (closed) return Promise.reject(new Error('Audio lease closed'))
    // RTP is continuous. Its packets carry no conversation output or generation ID.
    // The gate stays shut until the pipeline opens a fresh peer and lease.
    if (discard) discarded = true
    device.fence(discard)
    fenced = true
    if (!settlement)
      settlement = (async () => {
        const end = Date.now() + 1500
        while (!device.quiet()) {
          if (closed || Date.now() >= end) throw new Error('WebRTC playback did not quiesce')
          await new Promise((resolve) => Timer.set(resolve, 10))
        }
        if (!segment) return []
        return [{ ...segment, position: { basis: 'unknown' }, state: discarded ? 'interrupted' : 'played' }]
      })()
    return settlement
  }
  const output = {
    format: liveAudioRequirements.output[0],
    budget,
    begin(outputId, value) {
      if (fenced || closed || segment || value !== generation) throw new Error('Invalid WebRTC playback generation')
      segment = { outputId, generation }
      return this
    },
    async finish(outputId) {
      if (!segment || segment.outputId !== outputId) throw new Error('Unknown WebRTC output')
      return (await settle(false))[0]
    },
    fence(next) {
      if (next < generation) throw new Error('Stale WebRTC playback generation')
      generation = next
      return settle(true)
    },
  }
  handles.set(input, { native: device, output })
  return {
    input,
    output,
    media: {
      connect() {
        throw new Error('WebRTC PCM endpoints require the native peer')
      },
    },
    async setInputEnabled(enabled) {
      device.setInput(enabled)
    },
    setVolume(gain) {
      device.setVolume(gain)
    },
    async close() {
      if (closed) return
      device.close()
      amp.sampleRate = 24000
      closed = true
      handles.delete(input)
    },
  }
}
