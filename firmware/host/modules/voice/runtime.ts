import type {
  AudioLevel,
  AudioRuntime,
  Microphone,
  PcmFormat,
  PlaybackLease,
  PlaybackOptions,
  Speaker,
} from 'stackchan/voice/contracts'
import { requireActive, voiceError } from 'stackchan/voice/scope'
import type { LeaseFactory, RuntimeOptions } from './runtime-types.js'

export type { LeaseFactory, LeaseOptions, RuntimeOptions } from './runtime-types.js'

type PlaybackFactory = (formats: readonly PcmFormat[], options: PlaybackOptions) => PlaybackLease

function levelReporter({ signal, onLevel }: PlaybackOptions, directions: readonly AudioLevel['direction'][]) {
  let observing = true
  let inputEnabled = true
  const last = { input: -Infinity, output: -Infinity }
  const values = { input: -1, output: -1 }
  function report(level: AudioLevel) {
    try {
      onLevel?.(level)
    } catch {}
  }
  function observe({ direction, value: raw }: AudioLevel) {
    if (!observing || signal.aborted) return
    const value = direction === 'input' && !inputEnabled ? 0 : Math.min(1, Math.max(0, raw))
    const now = Date.now()
    if (
      !Number.isFinite(value) ||
      (value === 0 && values[direction] === 0) ||
      (value !== 0 && now - last[direction] < 50)
    )
      return
    values[direction] = value
    last[direction] = now
    report({ direction, value })
  }
  return {
    observe: onLevel && observe,
    setInputEnabled(enable: boolean) {
      inputEnabled = enable
      if (!enable) observe({ direction: 'input', value: 0 })
    },
    stop(notify = true) {
      observing = false
      if (notify) for (const direction of directions) report({ direction, value: 0 })
    },
  }
}

export function bindAudioRuntime(options: RuntimeOptions, openPCM: LeaseFactory, openPlayback?: PlaybackFactory) {
  let reserved = false

  async function reserve<T extends PlaybackLease>(
    kind: 'conversation' | 'playback',
    setup: PlaybackOptions,
    directions: readonly AudioLevel['direction'][],
    open: (onLevel: PlaybackOptions['onLevel']) => T | Promise<T>,
  ) {
    const { signal } = setup
    requireActive(signal)
    if (reserved) throw voiceError('device_busy')
    let release: () => void
    try {
      release = options.acquireExclusive(kind)
    } catch {
      throw voiceError('device_busy')
    }
    reserved = true
    const levels = levelReporter(setup, directions)
    let lease: T
    try {
      lease = await open(levels.observe)
    } catch (error) {
      levels.stop(false)
      release()
      reserved = false
      throw error
    }
    let stopping: Promise<void> | undefined
    let closing: Promise<void> | undefined
    function stop() {
      stopping ??= Promise.resolve().then(async () => {
        levels.stop()
        await lease.close()
      })
      return stopping
    }
    function close() {
      closing ??= stop().then(() => {
        release()
        reserved = false
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
    return { lease, levels, stop, close }
  }

  const runtime: AudioRuntime = {
    async acquire(microphone, speaker, requirements, setup) {
      requireActive(setup.signal)
      if (microphone !== mic || speaker !== spk) throw voiceError('unsupported_capability', 'unpaired audio ports')
      const open = requirements.nativeBackend ? options.openNativeLease : openPCM
      if (!open) throw voiceError('unsupported_capability', 'native audio backend unavailable')
      const { lease, levels, close } = await reserve('conversation', setup, ['input', 'output'], (onLevel) =>
        open({ ...setup, requirements, microphone, speaker, onLevel }),
      )
      return {
        input: lease.input,
        output: lease.output,
        media: lease.media,
        async setInputEnabled(enable) {
          levels.setInputEnabled(enable)
          await lease.setInputEnabled(enable)
        },
        setVolume: (value) => lease.setVolume(value),
        close,
      }
    },
    async acquirePlayback(speaker, formats, setup) {
      const { signal } = setup
      requireActive(signal)
      if (speaker !== spk || !openPlayback) throw voiceError('unsupported_capability', 'unavailable speaker')
      const { lease, stop, close } = await reserve('playback', setup, ['output'], (onLevel) =>
        openPlayback(formats, { ...setup, onLevel }),
      )
      const abort = () => {
        void stop().catch(() => {})
      }
      signal.addEventListener('abort', abort)
      if (signal.aborted) {
        signal.removeEventListener('abort', abort)
        await close()
        requireActive(signal)
      }
      return {
        output: lease.output,
        media: lease.media,
        setVolume: (value) => lease.setVolume(value),
        close() {
          signal.removeEventListener('abort', abort)
          return close()
        },
      }
    },
  }
  const mic: Microphone = { id: 'builtin-microphone', runtime }
  const spk: Speaker = { id: 'builtin-speaker', runtime }
  return Object.assign(runtime, { microphone: mic, speaker: spk })
}
