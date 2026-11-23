import { geminiEndpoint } from 'gemini-native-transport'
import { runWorkerJob } from 'gemini-worker-bridge'
import { synthesize } from 'gemini-worker-request'
import { createGeminiWorkerTTS } from 'gemini-worker-session'
import Timer from 'timer'
import Worker from 'worker'

const runtime = {
  spawn: () =>
    new Worker('gemini-worker-entry', {
      static: 512 * 1024,
      chunk: { initial: 96 * 1024, incremental: 16384 },
      heap: { initial: 2048, incremental: 256 },
      stack: 1024,
      nativeStack: 8192,
      priority: 3,
    }),
  schedule: (callback, ms) => Timer.set(callback, ms),
  clear: (handle) => Timer.clear(handle),
}

export function createGeminiSpeechTTS(options) {
  if (typeof options?.request === 'function')
    return createGeminiWorkerTTS(options, (job) => synthesize(options.request, job))
  if (typeof options?.endpoint !== 'string' || !/^https?:\/\//.test(options.endpoint))
    throw new TypeError('Speech endpoint or injected request required')
  if (options.nativeTransport && options.endpoint !== geminiEndpoint)
    throw new TypeError('Unsupported native speech endpoint')
  if (options.apiKey && !options.endpoint.startsWith('https://')) throw new TypeError('Credentials require HTTPS')
  return createGeminiWorkerTTS(options, (job) => runWorkerJob(job, options, runtime))
}

export const GeminiSpeechTTS = { create: createGeminiSpeechTTS }
