import Resource from 'Resource'
import type { Synthesis, TTS } from 'stackchan/voice/contracts'
import { createPcmSource } from 'stackchan/voice/media'
import { deferred, requireActive, voiceError } from 'stackchan/voice/scope'
import { openStreamingSynthesis } from 'stackchan/voice/synthesis'
import StackchanVoice from 'stackchanvoice'
import Timer from 'timer'

export type StackchanVoiceTTS = TTS & { openKoe: TTS['open'] }

export function createStackchanVoiceTTS(
  options: { speed?: number; voice?: 'normal' | 'cute' } = {},
): StackchanVoiceTTS {
  const speed = options.speed ?? 100
  if (!Number.isInteger(speed) || speed < 1 || speed > 65535) throw new RangeError('invalid synthesis speed')
  let engine: StackchanVoice | undefined
  let busy = false
  let reserved = false

  async function openSegment(
    { signal, format, voice }: Parameters<TTS['open']>[0],
    koe: boolean,
  ): Promise<Omit<Synthesis, 'flush'>> {
    requireActive(signal)
    if (format.encoding !== 'pcm_s16le' || format.sampleRate !== 24000 || format.channels !== 1)
      throw voiceError('unsupported_capability', 'StackchanVoice renders 24 kHz mono PCM')
    const preset = !voice || voice === 'default' ? (options.voice ?? 'normal') : voice
    if (preset !== 'cute' && preset !== 'normal')
      throw voiceError('unsupported_capability', 'unknown StackchanVoice preset')
    if (busy) throw voiceError('device_busy', 'StackchanVoice is already synthesizing')
    const source = createPcmSource(format)
    let text = '',
      frames = 0,
      ended = false,
      complete = false
    let result: ReturnType<typeof deferred<void>> | undefined
    let failure: unknown
    let timer: ReturnType<typeof Timer.set> | undefined
    let block: { buffer: ArrayBuffer; bytes: Uint8Array } | undefined
    const abort = () => end(signal.reason ?? voiceError('cancelled'))
    function end(error?: unknown) {
      if (ended) return
      ended = true
      busy = false
      failure = error
      complete = !error
      block = undefined
      if (timer !== undefined) Timer.clear(timer)
      signal.removeEventListener('abort', abort)
      source.end(error)
      if (error) result?.reject(error)
      else result?.resolve()
    }
    async function render() {
      timer = undefined
      let started = Date.now()
      let blocks = 0
      try {
        while (!ended && block && engine) {
          const bytes = block.bytes
          const samples = engine.read24(block.buffer)
          if (!Number.isInteger(samples) || samples < 0 || samples > bytes.length / 2)
            throw voiceError('provider_failed', 'invalid StackchanVoice PCM length')
          if (!samples) return end()
          frames += samples
          const last = samples * 2 < bytes.length
          const pending = source.offer(last ? bytes.subarray(0, samples * 2) : bytes)
          blocks++
          if (pending) {
            const waiting = Date.now()
            await pending
            if (ended) return
            if (Date.now() - waiting >= 8) started = Date.now()
          }
          if (ended) return
          if (last) return end()
          if (blocks >= 4 || Date.now() - started >= 8) {
            timer = Timer.set(render, 0)
            return
          }
        }
      } catch (error) {
        end(error)
      }
    }
    busy = true
    signal.addEventListener('abort', abort)
    return {
      output: source.output,
      async write(part) {
        if (ended || result) throw failure ?? voiceError('cancelled', 'synthesis input closed')
        if (text.length + part.length > 2047)
          throw voiceError('resource_exhausted', 'StackchanVoice utterance too long')
        if (part.includes('\0')) throw new TypeError('utterance contains NUL')
        text += part
      },
      finish() {
        if (result) return result.promise
        if (ended) return Promise.reject(failure)
        result = deferred<void>()
        try {
          if (!text) end()
          else {
            if (koe && ArrayBuffer.fromString(text).byteLength > 2047)
              throw voiceError('resource_exhausted', 'StackchanVoice Koe exceeds 2047 bytes')
            const selected = preset === 'cute' ? StackchanVoice.Cute : StackchanVoice.Normal
            if (engine) engine.setVoice(selected)
            else engine = new StackchanVoice(selected, new Resource('stackchan-ja.aqd'))
            if (koe) engine.koe(text, speed)
            else engine.say(text, speed)
            const bytes = new Uint8Array(2048)
            block = { bytes, buffer: bytes.buffer }
            render()
          }
        } catch (error) {
          end(error)
        }
        return result.promise
      },
      textAt(position) {
        if (
          complete &&
          frames > 0 &&
          position.basis !== 'unknown' &&
          position.sampleRate > 0 &&
          position.renderedFrames / position.sampleRate >= frames / format.sampleRate
        )
          return { basis: 'completed-segment', text }
        return { basis: 'unknown', text: '' }
      },
      async close() {
        end(voiceError('cancelled'))
      },
    }
  }
  function open(args: Parameters<TTS['open']>[0], koe: boolean): Promise<Synthesis> {
    if (reserved) return Promise.reject(voiceError('device_busy', 'StackchanVoice is already synthesizing'))
    reserved = true
    return openStreamingSynthesis(
      args,
      (options) => openSegment(options, koe),
      2047,
      () => {
        reserved = false
      },
    )
  }
  return { open: (options) => open(options, false), openKoe: (options) => open(options, true) }
}
