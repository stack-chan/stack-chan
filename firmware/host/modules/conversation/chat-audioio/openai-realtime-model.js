/*
 * Copyright (c) 2026 Shinya Ishikawa
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

import OpenAIRealtimeModelBase from 'openAIRealtimeModel'
import config from 'mc/config'
import Timer from 'timer'

const INPUT_ACK_BARRIER_INDEX = 1
const INPUT_RING_HEAD_BARRIER_INDEX = 1
const INPUT_RING_TAIL_BARRIER_INDEX = 2
const INPUT_GATE_BARRIER_INDEX = 3
const INPUT_GATE_CLOSED = 0
const INPUT_GATE_OPEN = 1
const INPUT_GATE_CLOSING = 2
const INPUT_RING_SIZE = 128 * 1024
const INPUT_PUMP_INTERVAL_MS = 64
const INPUT_CHUNK_DURATION_MS = 128
const INPUT_PRE_ROLL_DURATION_MS = 300
const PCM_BYTES_PER_SAMPLE = 2
const INPUT_PROBE_DEFAULT_VAD_SILENCE_MS = 1500

/*
 * Barrier index 1 is the acknowledgement sequence for message transport, but
 * the ring head for shared-ring transport. The shared-ring pump never sends a
 * sequence, so the two layouts must not be mixed.
 */

function inputChunkBytes(sampleRate) {
  return Math.round((sampleRate * INPUT_CHUNK_DURATION_MS) / 1000) * PCM_BYTES_PER_SAMPLE
}

function inputPreRollBytes(sampleRate) {
  return Math.round((sampleRate * INPUT_PRE_ROLL_DURATION_MS) / 1000) * PCM_BYTES_PER_SAMPLE
}

const TRACED_EVENTS = Object.freeze([
  'session.created',
  'session.updated',
  'error',
  'input_audio_buffer.speech_started',
  'input_audio_buffer.speech_stopped',
  'input_audio_buffer.committed',
  'response.created',
  'response.done',
  'response.cancelled',
  'response.output_audio.done',
])

export default class OpenAIRealtimeModel extends OpenAIRealtimeModelBase {
  constructor(options) {
    super(options)
    this.traceEvents = config.chat?.traceEvents === true
    this.connectStartedAt = 0
    this.tracedAudioDelta = false
    this.inputSampleRate = options.inputSampleRate ?? 24000
    this.inputChunkBytes = inputChunkBytes(this.inputSampleRate)
    this.inputPreRollBytes = inputPreRollBytes(this.inputSampleRate)
    this.inputPumpTimer = undefined
    this.inputPumpRuns = 0
    this.inputPumpSends = 0
    this.inputPumpBytes = 0
    this.inputPumpMaxAvailable = 0
    this.inputPumpDiscardedBytes = 0
    this.inputPumpMaximumSendBytes = 0
    this.inputPumpSendTotalMs = 0
    this.inputPumpSendMaximumMs = 0
    this.inputPumpSummaryTraced = false
    this.resetOutputTransportStats()
    this.postMessage({
      id: 'configureInputTransport',
      mode: 'shared-ring',
      ringSize: INPUT_RING_SIZE,
      chunkBytes: this.inputChunkBytes,
      gated: true,
      preRollBytes: this.inputPreRollBytes,
    })
  }

  configure(message) {
    const result = super.configure(message)
    this.session.audio.input.transcription = { model: 'gpt-transcribe', languages: ['ja'] }
    const probe = config.chat?.inputProbe
    if (probe?.enabled === true) {
      const configured = probe.vadSilenceDurationMs
      const silenceDurationMs =
        Number.isInteger(configured) && configured >= 500 && configured <= 5000
          ? configured
          : INPUT_PROBE_DEFAULT_VAD_SILENCE_MS
      this.session.audio.input.turn_detection.silence_duration_ms = silenceDurationMs
    }
    return result
  }

  connect(message) {
    this.connectStartedAt = Date.now()
    this.tracedAudioDelta = false
    this.inputBarrier = message.barrier
    this.inputPumpRuns = 0
    this.inputPumpSends = 0
    this.inputPumpBytes = 0
    this.inputPumpMaxAvailable = 0
    this.inputPumpDiscardedBytes = 0
    this.inputPumpMaximumSendBytes = 0
    this.inputPumpSendTotalMs = 0
    this.inputPumpSendMaximumMs = 0
    this.inputPumpSummaryTraced = false
    this.resetOutputTransportStats()
    this.traceEvent('connect')
    const result = super.connect(message)
    this.stopInputPump()
    this.inputPumpTimer = Timer.repeat(() => this.pumpInputAudio(), INPUT_PUMP_INTERVAL_MS)
    return result
  }

  disconnect() {
    this.traceInputPumpSummary('disconnect')
    this.stopInputPump()
    return super.disconnect()
  }

  close() {
    this.traceInputPumpSummary('close')
    this.stopInputPump()
    this.inputBarrier = undefined
    return super.close()
  }

  sendAudio(message) {
    try {
      return super.sendAudio(message)
    } finally {
      if (message.sequence !== undefined && this.inputBarrier?.length > INPUT_ACK_BARRIER_INDEX) {
        Atomics.store(this.inputBarrier, INPUT_ACK_BARRIER_INDEX, message.sequence)
      }
    }
  }

  pumpInputAudio() {
    const barrier = this.inputBarrier
    this.inputPumpRuns += 1
    if (this.traceEvents && this.inputPumpRuns === 1) {
      trace(
        `[OpenAIRealtime] input pump started barrierLength=${barrier?.length ?? 0} chunkBytes=${this.inputChunkBytes}\n`,
      )
    }
    if (!barrier || barrier.length <= INPUT_GATE_BARRIER_INDEX) return

    const mask = INPUT_RING_SIZE - 1
    const head = Atomics.load(barrier, INPUT_RING_HEAD_BARRIER_INDEX)
    let tail = Atomics.load(barrier, INPUT_RING_TAIL_BARRIER_INDEX)
    const available = (head - tail) & mask
    if (this.inputPumpMaxAvailable < available) this.inputPumpMaxAvailable = available
    const gate = Atomics.load(barrier, INPUT_GATE_BARRIER_INDEX)
    if (gate === INPUT_GATE_CLOSED) {
      this.inputPumpDiscardedBytes += available
      Atomics.store(barrier, INPUT_RING_TAIL_BARRIER_INDEX, head)
      return
    }
    if (gate === INPUT_GATE_OPEN && available < this.inputChunkBytes) return
    if (gate === INPUT_GATE_CLOSING && !available) {
      Atomics.compareExchange(barrier, INPUT_GATE_BARRIER_INDEX, INPUT_GATE_CLOSING, INPUT_GATE_CLOSED)
      return
    }

    const size = Math.min(available, this.inputChunkBytes, INPUT_RING_SIZE - tail)
    const sendStartedAt = Date.now()
    this.sendAudio({ offset: tail, size })
    const sendElapsedMs = Date.now() - sendStartedAt
    this.inputPumpSendTotalMs += sendElapsedMs
    if (this.inputPumpSendMaximumMs < sendElapsedMs) this.inputPumpSendMaximumMs = sendElapsedMs
    tail = (tail + size) & mask
    Atomics.store(barrier, INPUT_RING_TAIL_BARRIER_INDEX, tail)
    if (gate === INPUT_GATE_CLOSING && tail === head) {
      Atomics.compareExchange(barrier, INPUT_GATE_BARRIER_INDEX, INPUT_GATE_CLOSING, INPUT_GATE_CLOSED)
    }
    this.inputPumpSends += 1
    this.inputPumpBytes += size
    if (this.inputPumpMaximumSendBytes < size) this.inputPumpMaximumSendBytes = size
    if (this.traceEvents && (this.inputPumpSends === 1 || (this.inputPumpSends & (this.inputPumpSends - 1)) === 0)) {
      trace(`[OpenAIRealtime] input pump send count=${this.inputPumpSends} head=${head} tail=${tail} size=${size}\n`)
    }
  }

  stopInputPump() {
    if (this.inputPumpTimer === undefined) return
    Timer.clear(this.inputPumpTimer)
    this.inputPumpTimer = undefined
  }

  traceInputPumpSummary(reason) {
    if (!this.traceEvents || this.inputPumpSummaryTraced || !this.inputPumpRuns) return
    this.inputPumpSummaryTraced = true
    const maxLagMs = Math.round((this.inputPumpMaxAvailable * 1000) / (this.inputSampleRate * PCM_BYTES_PER_SAMPLE))
    trace(
      `[OpenAIRealtime] input pump summary reason=${reason} runs=${this.inputPumpRuns} sends=${
        this.inputPumpSends
      } bytes=${this.inputPumpBytes} discardedBytes=${this.inputPumpDiscardedBytes} maxAvailable=${
        this.inputPumpMaxAvailable
      } maxLagMs=${maxLagMs} maxSendBytes=${this.inputPumpMaximumSendBytes} sendTotalMs=${
        this.inputPumpSendTotalMs
      } sendMaxMs=${this.inputPumpSendMaximumMs}\n`,
    )
  }

  onOpen() {
    this.traceEvent('websocket.open')
    return super.onOpen()
  }

  onBase64(offset, size) {
    const now = Date.now()
    if (!this.outputAudioChunks) {
      this.outputAudioFirstAt = now
    } else {
      const gap = now - this.outputAudioLastAt
      if (this.outputAudioMaximumGapMs < gap) this.outputAudioMaximumGapMs = gap
    }
    this.outputAudioLastAt = now
    this.outputAudioChunks += 1
    this.outputAudioBytes += size
    return super.onBase64(offset, size)
  }

  onJSON(json) {
    const type = json?.type ?? 'unknown'
    if (type === 'response.created') {
      this.resetOutputTransportStats()
      this.outputResponseCreatedAt = Date.now()
    } else if (type === 'response.output_audio.done') {
      this.traceOutputTransportSummary()
    }
    if (TRACED_EVENTS.includes(type)) {
      let detail = ''
      if (type === 'error') detail = ` code=${json?.error?.code ?? 'unknown'}`
      else if (type === 'input_audio_buffer.speech_started')
        detail = ` audioStartMs=${json?.audio_start_ms ?? 'unknown'}`
      else if (type === 'input_audio_buffer.speech_stopped') detail = ` audioEndMs=${json?.audio_end_ms ?? 'unknown'}`
      else if (type === 'response.done') detail = ` status=${json?.response?.status ?? 'unknown'}`
      this.traceEvent(type, detail)
    } else if (type === 'response.output_audio.delta' && !this.tracedAudioDelta) {
      this.tracedAudioDelta = true
      this.traceEvent(type, ' first=true')
    }
    return super.onJSON(json)
  }

  resetOutputTransportStats() {
    this.outputResponseCreatedAt = 0
    this.outputAudioFirstAt = 0
    this.outputAudioLastAt = 0
    this.outputAudioChunks = 0
    this.outputAudioBytes = 0
    this.outputAudioMaximumGapMs = 0
  }

  traceOutputTransportSummary() {
    if (!this.traceEvents) return
    const audioMs = Math.round((this.outputAudioBytes * 1000) / (24000 * PCM_BYTES_PER_SAMPLE))
    const firstDelayMs =
      this.outputAudioFirstAt && this.outputResponseCreatedAt
        ? this.outputAudioFirstAt - this.outputResponseCreatedAt
        : 0
    const deliveryMs =
      this.outputAudioFirstAt && this.outputAudioLastAt ? this.outputAudioLastAt - this.outputAudioFirstAt : 0
    trace(
      `[OpenAIRealtime] output transport summary chunks=${this.outputAudioChunks} bytes=${
        this.outputAudioBytes
      } audioMs=${audioMs} firstDelayMs=${firstDelayMs} deliveryMs=${deliveryMs} maxGapMs=${
        this.outputAudioMaximumGapMs
      }\n`,
    )
  }

  traceEvent(event, detail = '') {
    if (!this.traceEvents) return
    const elapsed = this.connectStartedAt ? Date.now() - this.connectStartedAt : 0
    trace(`[OpenAIRealtime] event=${event} elapsedMs=${elapsed}${detail}\n`)
  }
}
