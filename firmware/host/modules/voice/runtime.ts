import type {
  AudioRuntime,
  Microphone,
  PcmFormat,
  PlaybackLease,
  PlaybackOptions,
  Scope,
  Speaker,
} from 'stackchan/voice/contracts'
import { requireActive, voiceError } from 'stackchan/voice/scope'
import type { LeaseFactory, RuntimeOptions } from './runtime-types.js'

export type { LeaseFactory, LeaseOptions, RuntimeOptions } from './runtime-types.js'

export type PlaybackFactory = (formats: readonly PcmFormat[], options: PlaybackOptions) => PlaybackLease

export function bindAudioRuntime(options: RuntimeOptions, openPCM: LeaseFactory, openPlayback?: PlaybackFactory) {
  let reserved: { interrupt?: () => Promise<void> } | undefined
  let interrupting = false
  async function reserve<T extends PlaybackLease>(
    signal: Scope['signal'],
    open: () => T | Promise<T>,
    interrupt?: () => Promise<void>,
  ) {
    requireActive(signal)
    if (interrupting) throw voiceError('device_busy')
    const owner = reserved
    if (owner) {
      if (interrupt || !owner.interrupt) throw voiceError('device_busy')
      interrupting = true
      try {
        await owner.interrupt()
      } finally {
        interrupting = false
      }
      requireActive(signal)
      if (reserved) throw voiceError('device_busy')
    }
    reserved = { interrupt }
    let release: (() => void) | undefined
    let lease: T
    try {
      try {
        const claim = options.acquireExclusive(!!interrupt)
        release = typeof claim === 'function' ? claim : await claim
      } catch (error) {
        if (error instanceof Error && error.message === 'audio busy') throw voiceError('device_busy')
        throw error
      }
      requireActive(signal)
      lease = await open()
    } catch (error) {
      release?.()
      reserved = undefined
      throw error
    }
    let closing: Promise<void> | undefined
    function close() {
      if (!closing)
        closing = Promise.resolve().then(async () => {
          await lease.close()
          release?.()
          reserved = undefined
        })
      return closing
    }
    try {
      requireActive(signal)
      if (options.volume !== undefined) lease.setVolume(options.volume)
    } catch (error) {
      await close()
      throw error
    }
    return { lease, close }
  }
  const runtime: AudioRuntime = {
    async acquire(microphone, speaker, requirements, { budget, signal }) {
      requireActive(signal)
      if (microphone !== mic || speaker !== spk) throw voiceError('unsupported_capability', 'unpaired audio ports')
      const open = requirements.nativeBackend ? options.openNativeLease : openPCM
      if (!open) throw voiceError('unsupported_capability', 'native audio backend unavailable')
      const { lease, close } = await reserve(signal, () => open({ requirements, budget, signal, microphone, speaker }))
      return {
        input: lease.input,
        output: lease.output,
        media: lease.media,
        setInputEnabled: (enable) => lease.setInputEnabled(enable),
        setVolume: (value) => lease.setVolume(value),
        close,
      }
    },
    async acquirePlayback(speaker, formats, options) {
      requireActive(options.signal)
      if (speaker !== spk || !openPlayback) throw voiceError('unsupported_capability', 'unavailable speaker')
      const { lease, close } = await reserve(options.signal, () => openPlayback(formats, options), options.interrupt)
      const stop = () => {
        void close().catch(() => {})
      }
      options.signal.addEventListener('abort', stop)
      if (options.signal.aborted) {
        await close()
        requireActive(options.signal)
      }
      return {
        output: lease.output,
        media: lease.media,
        setVolume: (value) => lease.setVolume(value),
        close() {
          options.signal.removeEventListener('abort', stop)
          return close()
        },
      }
    },
  }
  const mic: Microphone = { id: 'builtin-microphone', runtime }
  const spk: Speaker = { id: 'builtin-speaker', runtime }
  return Object.assign(runtime, { microphone: mic, speaker: spk })
}
