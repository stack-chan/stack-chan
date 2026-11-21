import { createSpeechEvents } from 'gemini-worker-events'

const knownCodes = new Set([
  'provider_failed',
  'unsupported_capability',
  'resource_exhausted',
  'cancelled',
  'deadline_exceeded',
])
export const failureCode = (error) => (knownCodes.has(error?.code) ? error.code : 'provider_failed')

export async function synthesize(request, job) {
  const { text, voice, instructions, model, signal, onPcm, onMetrics, maxEventBytes } = job
  const speech = createSpeechEvents({
    maxEventBytes,
    onPcm,
    now: job.now,
    findLF: job.findLF,
    sampleRate: job.sampleRate,
    pcmChunkBytes: job.pcmChunkBytes,
  })
  const content = { type: 'text', text, annotations: [{ type: 'speech_metadata', style: instructions }] }
  const bytes = new Uint8Array(
    ArrayBuffer.fromString(
      JSON.stringify({
        model,
        input: [{ type: 'user_input', content: [content] }],
        generation_config: { speech_config: [{ voice: voice || 'Leda' }] },
        response_format: job.sampleRate === 16000 ? { type: 'audio', mime_type: 'audio/l16', sample_rate: 16000 } : { type: 'audio' },
        stream: true,
        store: false,
      }),
    ),
  )
  if (bytes.length > 32768)
    throw Object.assign(new RangeError('Speech request too large'), { code: 'resource_exhausted' })
  try {
    await request(
      {
        length: bytes.length,
        *read() {
          yield bytes
        },
      },
      speech.feed,
      { signal },
      speech.isComplete,
    )
    await speech.finish()
  } catch (error) {
    const message = error?.message
    const reason =
      message === 'Responses connection closed early'
        ? 9
        : message?.startsWith?.('Responses connection failed')
          ? 11
          : message?.startsWith?.('Responses HTTP ')
            ? 12
            : 0
    try {
      job.onFailure?.(reason)
    } catch {}
    throw error
  } finally {
    try {
      onMetrics?.(speech.metrics)
    } catch {}
  }
}
