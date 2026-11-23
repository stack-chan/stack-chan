import { VoiceScope } from 'stackchan/voice'
import { mono, readSource } from 'stackchan/voice/media'

let stop

export async function onContextCreated(robot) {
  const { microphone, speaker } = robot.audio
  if (!microphone) return
  const scope = VoiceScope.create()
  const lease = microphone.runtime.acquire(
    microphone,
    speaker,
    {
      input: [mono(16000)],
      output: [mono(24000)],
      duplex: 'half',
    },
    { signal: scope.signal, budget: { maxBufferedMs: 100, maxBufferedBytes: 8192 } },
  )
  let reader
  stop = async () => {
    scope.abort()
    reader?.close()
    await (await lease.catch(() => undefined))?.close()
  }
  const audio = await lease
  if (scope.signal.aborted) return
  try {
    reader = readSource(audio.input, (bytes) => {
      let total = 0
      for (let i = 0; i < bytes.length; i += 2) {
        const sample = ((bytes[i] | (bytes[i + 1] << 8)) << 16) >> 16
        total += Math.abs(sample)
      }
      if (bytes.length) robot.face.setMouthOpen(Math.min(1, total / (bytes.length / 2) / 150))
    })
  } catch (error) {
    await stop()
    throw error
  }
}

export function onClose() {
  return stop?.()
}
