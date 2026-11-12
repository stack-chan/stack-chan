import NativeSanoTTS from 'sanotts-native'
import type { Synthesis, TTS } from 'stackchan/voice/contracts'
import { createPcmSource } from 'stackchan/voice/media'
import { toKana } from 'stackchan/voice/sanotts-reading'
import { deferred, requireActive, voiceError } from 'stackchan/voice/scope'
import Timer from 'timer'

export function createSanoTTS(options: { toKana?: (text: string) => string } = {}): TTS & { openKana: TTS['open'] } {
  const readText = options.toKana ?? toKana
  async function open({ signal, format, voice }: Parameters<TTS['open']>[0], kana: boolean): Promise<Synthesis> {
    requireActive(signal)
    if (format.channels !== 1 || format.sampleRate !== 24000 || format.encoding !== 'pcm_s16le')
      throw voiceError('unsupported_capability', 'sanoTTS requires mono 24 kHz PCM')
    if (voice && voice !== 'default') throw voiceError('unsupported_capability', 'sanoTTS provides the default voice')
    const source = createPcmSource(format)
    let text = '',
      ended = false
    let error: unknown
    let native: NativeSanoTTS | undefined
    let completion: ReturnType<typeof deferred<void>> | undefined
    let timer: ReturnType<typeof Timer.set> | undefined
    let released: ReturnType<typeof deferred<void>> | undefined
    const abort = () => end(signal.reason ?? voiceError('cancelled'))
    function end(reason?: unknown) {
      if (ended) return
      ended = true
      error = reason
      signal.removeEventListener('abort', abort)
      if (timer !== undefined) Timer.clear(timer)
      const renderer = native
      native = undefined
      released = deferred<void>()
      function release() {
        try {
          if (renderer && !renderer.done) {
            Timer.set(release, 5)
            return
          }
          renderer?.close()
        } catch (failure) {
          error ??= failure
        }
        try {
          source.end(error)
        } finally {
          if (error) completion?.reject(error)
          else completion?.resolve()
          released?.resolve()
        }
      }
      renderer?.stop()
      release()
    }
    function start() {
      const input = kana ? text : readText(text)
      if (ended) throw error ?? voiceError('cancelled')
      if (typeof input !== 'string') throw new TypeError('reading must return a string')
      if (input.includes('\0')) throw new TypeError('reading contains NUL')
      native = new NativeSanoTTS()
      native.start(input)
      const bytes = new Uint8Array(2048)
      let primed = false
      async function pump() {
        timer = undefined
        try {
          if (!native || ended) return
          if (!primed && native.available < 12288 && !native.done) {
            timer = Timer.set(pump, 10)
            return
          }
          primed = true
          for (let index = 0; index < 4 && native && !ended; index++) {
            const samples = native.read(bytes.buffer)
            if (samples === -1) return end()
            if (!samples) break
            if (!Number.isInteger(samples) || samples < 0 || samples * 2 > bytes.length)
              throw voiceError('provider_failed', 'invalid sanoTTS PCM length')
            const pending = source.offer(samples * 2 === bytes.length ? bytes : bytes.subarray(0, samples * 2))
            if (pending) await pending
          }
          if (!ended) timer = Timer.set(pump, native?.available ? 0 : 5)
        } catch (e) {
          end(e)
        }
      }
      void pump()
    }
    signal.addEventListener('abort', abort)
    return {
      output: source.output,
      async write(part) {
        if (ended || completion) throw error ?? voiceError('cancelled')
        if (text.length + part.length > 512) throw voiceError('resource_exhausted', 'utterance exceeds 512 characters')
        if (part.includes('\0')) throw new TypeError('utterance contains NUL')
        text += part
      },
      finish() {
        if (completion) return completion.promise
        if (ended) return Promise.reject(error)
        completion = deferred<void>()
        try {
          if (text) start()
          else end()
        } catch (e) {
          end(e)
        }
        return completion.promise
      },
      async close() {
        end(voiceError('cancelled'))
        await released?.promise
      },
    }
  }
  return { open: (options) => open(options, false), openKana: (options) => open(options, true) }
}
