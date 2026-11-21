import type { AudioRuntime, DuplexLease, Microphone, Speaker } from 'stackchan/voice/contracts'
import { requireActive, voiceError } from 'stackchan/voice/scope'
import type { LeaseFactory, RuntimeOptions } from './runtime-types.js'

export type { LeaseFactory, LeaseOptions, RuntimeOptions } from './runtime-types.js'

export function bindAudioRuntime(options: RuntimeOptions, openPCM: LeaseFactory) {
  let reserved = false
  const runtime: AudioRuntime = {
    async acquire(microphone, speaker, requirements, { budget, signal, onLevel: requestedLevel }) {
      const onLevel = options.emitLevels === false ? undefined : requestedLevel
      requireActive(signal)
      if (microphone !== mic || speaker !== spk) throw voiceError('unsupported_capability', 'unpaired audio ports')
      if (reserved) throw voiceError('device_busy')
      const open = requirements.nativeBackend ? options.openNativeLease : openPCM
      if (!open) throw voiceError('unsupported_capability', 'native audio backend unavailable')
      let release: () => void
      try {
        release = options.acquireExclusive()
      } catch {
        throw voiceError('device_busy')
      }
      reserved = true
      let observing = true
      let inputEnabled = true
      const last = { input: -Infinity, output: -Infinity }
      const values = { input: -1, output: -1 }
      const observe: typeof onLevel =
        onLevel &&
        ((level) => {
          if (!observing || signal.aborted) return
          const value = level.direction === 'input' && !inputEnabled ? 0 : Math.min(1, Math.max(0, level.value))
          const now = Date.now()
          if (
            !Number.isFinite(value) ||
            (value === 0 && values[level.direction] === 0) ||
            (value !== 0 && now - last[level.direction] < 50)
          )
            return
          values[level.direction] = value
          last[level.direction] = now
          try {
            onLevel({ direction: level.direction, value })
          } catch {
            /* UI must not interrupt audio. */
          }
        })
      let lease: DuplexLease
      try {
        lease = await open({ requirements, budget, signal, microphone, speaker, onLevel: observe })
      } catch (error) {
        observing = false
        release()
        reserved = false
        throw error
      }
      let closing: Promise<void> | undefined
      function close() {
        if (!closing)
          closing = Promise.resolve().then(async () => {
            observing = false
            for (const direction of ['input', 'output'] as const) {
              try {
                onLevel?.({ direction, value: 0 })
              } catch {}
            }
            await lease.close()
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
      return {
        input: lease.input,
        output: lease.output,
        media: lease.media,
        async setInputEnabled(enable) {
          inputEnabled = enable
          if (!enable) observe?.({ direction: 'input', value: 0 })
          await lease.setInputEnabled(enable)
        },
        setVolume: (value) => lease.setVolume(value),
        close,
      }
    },
  }
  const mic: Microphone = { id: 'builtin-microphone', runtime }
  const spk: Speaker = { id: 'builtin-speaker', runtime }
  return Object.assign(runtime, { microphone: mic, speaker: spk })
}
