import NativeReader from 'gemini-native-reader'
import { createNativeSpeechTransport } from 'gemini-native-transport'
import { createSlotWriter, createWorkerDiagnostics, pcmSlotBytes } from 'gemini-worker-bridge'
import { failureCode, synthesize } from 'gemini-worker-request'
import { findLF } from 'gemini-worker-scan'
import { createVoiceScope } from 'stackchan/voice/scope'
import { createResponseTransport } from 'stackchan-ai-http'
import Time from 'time'
import Timer from 'timer'

let slots, scope
const send = (message) => self.postMessage(message)
self.onmessage = (message) => {
  if (message.type === 'cancel') {
    slots?.cancel()
    scope?.abort()
  } else if (message.type === 'ack') {
    try {
      slots.ack(message.seq)
    } catch {
      slots.cancel()
      scope.abort()
    }
  } else if (message.type === 'start' && !scope) {
    scope = createVoiceScope()
    const now = message.reportTransport ? () => Time.ticks : undefined
    const diagnostics = createWorkerDiagnostics()
    const report = (value) => diagnostics.add(value)
    void (async () => {
      let result = 'done',
        code
      try {
        const bytesPerSlot = pcmSlotBytes(message.nativeTransport, message.sampleRate)
        slots = createSlotWriter(message.ring, send, now, bytesPerSlot)
        if (message.apiKey && !message.endpoint.startsWith('https://')) throw Error('Credentials require HTTPS')
        const request = message.nativeTransport
          ? createNativeSpeechTransport(message.endpoint, message.apiKey, message.transportTimeoutMs ?? 45000, {
              Reader: NativeReader,
              onDiagnostic: (values) => report({ type: 'transport', values }),
              now: () => Time.ticks,
              pause: (ms) => new Promise((resolve) => Timer.set(resolve, ms)),
            })
          : createResponseTransport(
              message.endpoint,
              '',
              message.transportTimeoutMs ?? 45000,
              16384,
              message.apiKey ? { 'x-goog-api-key': message.apiKey } : undefined,
              true,
              message.reportTransport ? (values) => report({ type: 'transport', values }) : undefined,
              true,
            )
        await synthesize(request, {
          ...message,
          pcmChunkBytes: bytesPerSlot,
          signal: scope.signal,
          findLF,
          now,
          onPcm: slots.writeImmediate,
          onFailure: (reason) => report({ type: 'diagnostic', reason }),
          onMetrics: (values) => {
            report({ type: 'metrics', values })
            if (now && values.stageMs) {
              const { waits, waitTotal, waitMax, postGapMax } = slots.metrics
              const m = values.framing
              report({
                type: 'transport',
                values: [6, m.calls, m.bytes, m.scans, m.scanMs, m.scanMax, m.copyMs, m.totalMs, m.maxMs, m.frames],
              })
              report({ type: 'transport', values: [5, ...values.stageMs, waits, waitTotal, waitMax, postGapMax] })
            }
          },
        })
        await slots.drain()
      } catch (error) {
        result = 'error'
        code = failureCode(error)
      } finally {
        slots?.cancel()
        scope.dispose()
      }
      send(diagnostics.finish(result, code))
    })()
  }
}
