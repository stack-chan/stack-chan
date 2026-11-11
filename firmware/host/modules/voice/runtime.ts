import type {
  AudioRequirements,
  AudioRuntime,
  DuplexLease,
  MediaBudget,
  Microphone,
  Scope,
  Speaker,
} from 'stackchan/voice/contracts'
import { requireActive, voiceError } from 'stackchan/voice/scope'

export type LeaseOptions = Scope & {
  requirements: AudioRequirements
  budget: MediaBudget
  microphone: Microphone
  speaker: Speaker
}
export type LeaseFactory = (options: LeaseOptions) => Promise<DuplexLease> | DuplexLease
export type RuntimeOptions = {
  acquireExclusive: () => () => void
  openNativeLease?: LeaseFactory
  volume?: number
}

export function bindAudioRuntime(options: RuntimeOptions, openPCM: LeaseFactory) {
  let reserved = false
  const runtime: AudioRuntime = {
    async acquire(microphone, speaker, requirements, { budget, signal }) {
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
      let lease: DuplexLease
      try {
        lease = await open({ requirements, budget, signal, microphone, speaker })
      } catch (error) {
        release()
        reserved = false
        throw error
      }
      let closing: Promise<void> | undefined
      function close() {
        if (!closing)
          closing = Promise.resolve().then(async () => {
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
        setInputEnabled: (enable) => lease.setInputEnabled(enable),
        setVolume: (value) => lease.setVolume(value),
        close,
      }
    },
  }
  const mic: Microphone = { id: 'builtin-microphone', runtime }
  const spk: Speaker = { id: 'builtin-speaker', runtime }
  return Object.assign(runtime, { microphone: mic, speaker: spk })
}
