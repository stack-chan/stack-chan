/*
 * Copyright (c) 2026 Shinya Ishikawa
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

/* global SharedArrayBuffer */

import ChatAudioIOBase from 'ChatAudioIOBase'
import AudioDuplex from 'embedded:io/audio/duplex'
import {
  CircularByteHistory,
  copyCircularBytes,
  INPUT_GATE_CLOSED,
  INPUT_GATE_CLOSING,
  INPUT_GATE_OPEN,
  INPUT_GATE_SHOULD_CLOSE,
  INPUT_GATE_SHOULD_OPEN,
  InputActivityGate,
  maximumSourceSamplesForOutput,
  ringReadableBytes,
  SyntheticInputProbe,
} from 'duplex-chat-audio-buffer'
import config from 'mc/config'
import resamplePCM16Mono from 'pcm-resampler'
import Timer from 'timer'
import Worker from 'worker'

const PCM_BYTES_PER_SAMPLE = 2
const HARDWARE_SAMPLE_RATE = 16000
const HARDWARE_ATTENUATION_DB = 48
const SAFE_HARDWARE_ATTENUATION_DB = 96
const AEC_REFERENCE_DELAY_SAMPLES = 1584
const AEC_FILTER_LENGTH = 4
const AEC_NLP_LEVEL = 'normal'
const RESAMPLER_STATE_INTS = 3
const INPUT_BATCH_DURATION_MS = 128
const INPUT_ACK_BARRIER_INDEX = 1
const INPUT_RING_HEAD_BARRIER_INDEX = 1
const INPUT_RING_TAIL_BARRIER_INDEX = 2
const INPUT_GATE_BARRIER_INDEX = 3
const INPUT_TRANSPORT_MESSAGES = 'messages'
const INPUT_TRANSPORT_SHARED_RING = 'shared-ring'
// CoreS3 AEC residuals and normal room noise can remain in the low hundreds.
// Keep the default above that floor while retaining ample margin for speech.
const INPUT_GATE_DEFAULT_THRESHOLD = 400
const INPUT_GATE_ATTACK_MS = 192
const INPUT_GATE_HANGOVER_MS = 800
const INPUT_PROBE_CHUNK_SAMPLES = 512
const INPUT_PROBE_MIN_DURATION_MS = 200
const INPUT_PROBE_MAX_DURATION_MS = 5000
const INPUT_PROBE_MIN_LEVEL = 256
const INPUT_PROBE_MAX_LEVEL = 12000
const INPUT_PROBE_DEFAULT_VAD_SILENCE_MS = 1500
const INPUT_PROBE_MIN_VAD_SILENCE_MS = 500
const INPUT_PROBE_MAX_VAD_SILENCE_MS = 5000
const NETWORK_WORKER_CORE = 0
// Keep TLS/WebSocket processing above the priority-4 host XS task. Audio
// delivery must preempt optional UI rendering during network bursts.
const NETWORK_WORKER_PRIORITY = 5

function computeLevel(buffer) {
  return native('xs_computeLevel').call(this, buffer)
}

function amplifierVolumeByte(attenuationDb) {
  const coarseSteps = Math.min(15, Math.floor(attenuationDb / 6))
  const fineSteps = Math.round((attenuationDb - coarseSteps * 6) * 2)
  return (coarseSteps << 4) | fineSteps
}

function setHardwareAttenuation(attenuationDb) {
  if (globalThis.amp) globalThis.amp.volume = 256 - amplifierVolumeByte(attenuationDb)
}

function inputBatchBytes(sampleRate) {
  return Math.max(
    PCM_BYTES_PER_SAMPLE,
    Math.round((sampleRate * INPUT_BATCH_DURATION_MS) / 1000) * PCM_BYTES_PER_SAMPLE,
  )
}

function inputGateThreshold() {
  const threshold = config.chat?.inputGateThreshold
  return Number.isInteger(threshold) && threshold > 0 ? threshold : INPUT_GATE_DEFAULT_THRESHOLD
}

function inputProbeSettings() {
  const probe = config.chat?.inputProbe
  if (probe?.enabled !== true) return null

  const startDelayMs = probe.startDelayMs ?? 250
  const durationMs = probe.durationMs ?? 1500
  const level = probe.level ?? 4000
  const vadSilenceDurationMs = probe.vadSilenceDurationMs ?? INPUT_PROBE_DEFAULT_VAD_SILENCE_MS
  if (!Number.isInteger(startDelayMs) || startDelayMs < 0 || startDelayMs > 10000)
    throw new RangeError('config.chat.inputProbe.startDelayMs must be from 0 through 10000')
  if (
    !Number.isInteger(durationMs) ||
    durationMs < INPUT_PROBE_MIN_DURATION_MS ||
    durationMs > INPUT_PROBE_MAX_DURATION_MS
  )
    throw new RangeError(
      `config.chat.inputProbe.durationMs must be from ${INPUT_PROBE_MIN_DURATION_MS} through ${INPUT_PROBE_MAX_DURATION_MS}`,
    )
  if (!Number.isInteger(level) || level < INPUT_PROBE_MIN_LEVEL || level > INPUT_PROBE_MAX_LEVEL)
    throw new RangeError(
      `config.chat.inputProbe.level must be from ${INPUT_PROBE_MIN_LEVEL} through ${INPUT_PROBE_MAX_LEVEL}`,
    )
  if (
    !Number.isInteger(vadSilenceDurationMs) ||
    vadSilenceDurationMs < INPUT_PROBE_MIN_VAD_SILENCE_MS ||
    vadSilenceDurationMs > INPUT_PROBE_MAX_VAD_SILENCE_MS
  )
    throw new RangeError(
      `config.chat.inputProbe.vadSilenceDurationMs must be from ${INPUT_PROBE_MIN_VAD_SILENCE_MS} through ${INPUT_PROBE_MAX_VAD_SILENCE_MS}`,
    )
  return { startDelayMs, durationMs, level, vadSilenceDurationMs }
}

export default class DuplexChatAudioIO extends ChatAudioIOBase {
  createWorker(specifier, instructions, functions, voiceID, providerID, modelID, apiKey) {
    this.inputResamplerState = new Int32Array(new ArrayBuffer(RESAMPLER_STATE_INTS * Int32Array.BYTES_PER_ELEMENT))
    this.outputResamplerState = new Int32Array(new ArrayBuffer(RESAMPLER_STATE_INTS * Int32Array.BYTES_PER_ELEMENT))
    this.inputResampleSource = null
    this.inputResampleTarget = null
    this.outputResampleSource = null
    this.outputResampleTarget = null
    this.inputBatchOffset = 0
    this.inputBatchSize = 0
    this.inputBatchTargetBytes = inputBatchBytes(this.inputSampleRate)
    this.inputPostPending = false
    this.inputPostSequence = 0
    this.inputPostFailures = 0
    this.inputBackpressureDrops = 0
    this.inputTransport = INPUT_TRANSPORT_MESSAGES
    this.inputRingSize = 0
    this.inputGateEnabled = false
    this.inputGate = null
    this.inputPreRoll = null
    this.inputProbeSettings = inputProbeSettings()
    this.inputProbeTimer = undefined
    this.inputProbe = null
    this.inputProbeBuffer = null
    this.inputProbeSilenceSamples = 0
    this.inputProbeSignalSamples = 0
    this.inputProbeQueuedSilenceSamples = 0
    this.inputProbeCompleted = false
    this.barrier = new Int32Array(new SharedArrayBuffer(4 * Int32Array.BYTES_PER_ELEMENT))

    this.worker = new Worker(specifier, {
      static: 512 * 1024,
      chunk: {
        initial: 64 * 1024,
        incremental: 8 * 1024,
      },
      heap: {
        initial: 1024,
        incremental: 256,
      },
      stack: 1024,
      nativeStack: 8192,
      // Keep TLS/WebSocket work off the Core 1 real-time audio path.
      core: NETWORK_WORKER_CORE,
      priority: NETWORK_WORKER_PRIORITY,
    })
    this.worker.onmessage = (message) => {
      this[message.id](message)
    }
    this.worker.postMessage({
      id: 'configure',
      instructions,
      functions,
      voiceID,
      providerID,
      modelID,
      apiKey,
    })
  }

  connect() {
    this.error = ''
    this.inputBatchSize = 0
    this.inputBatchOffset = 0
    this.inputPostPending = false
    this.inputPostSequence = 0
    this.inputPostFailures = 0
    this.inputBackpressureDrops = 0
    Atomics.store(this.barrier, INPUT_ACK_BARRIER_INDEX, 0)
    Atomics.store(this.barrier, INPUT_RING_TAIL_BARRIER_INDEX, 0)
    Atomics.store(this.barrier, INPUT_GATE_BARRIER_INDEX, INPUT_GATE_CLOSED)
    this.inputGate?.reset()
    this.inputPreRoll?.clear()
    this.closeAudio()
    super.connect()
  }

  connected() {
    this.ensureInput()
    super.connected()
    this.startInputProbe()
  }

  disconnect() {
    if (config.chat?.traceEvents === true) trace('[DuplexChatAudioIO] disconnect begin\n')
    this.closeAudio()
    if (config.chat?.traceEvents === true) trace('[DuplexChatAudioIO] disconnect audio closed\n')
    super.disconnect()
    if (config.chat?.traceEvents === true) trace('[DuplexChatAudioIO] disconnect request posted\n')
  }

  configureAudio(message) {
    const inputSampleRate = message.inputSampleRate ?? 24000
    const outputSampleRate = message.outputSampleRate ?? 24000

    if (
      !Number.isInteger(inputSampleRate) ||
      inputSampleRate < 8000 ||
      inputSampleRate > 48000 ||
      !Number.isInteger(outputSampleRate) ||
      outputSampleRate < 8000 ||
      outputSampleRate > 48000
    ) {
      this.error = `unsupported chat audio sample rates (${inputSampleRate}, ${outputSampleRate})`
      this.state = ChatAudioIOBase.FAILED
      this.worker?.terminate()
      this.worker = null
      this.onStateChanged(this.state)
      return
    }

    const changed = this.inputSampleRate !== inputSampleRate || this.outputSampleRate !== outputSampleRate
    this.inputSampleRate = inputSampleRate
    this.outputSampleRate = outputSampleRate

    if (changed) {
      this.inputResamplerState.fill(0)
      this.outputResamplerState.fill(0)
      this.inputBatchSize = 0
      this.inputBatchOffset = 0
      this.inputPostPending = false
      this.inputPostSequence = 0
      Atomics.store(this.barrier, INPUT_ACK_BARRIER_INDEX, 0)
      this.inputBatchTargetBytes = inputBatchBytes(inputSampleRate)
      this.ready = false
      this.inputReadyAt = Date.now() + 500
    }
  }

  configureInputTransport(message) {
    const ringSize = message.ringSize
    const chunkBytes = message.chunkBytes
    const preRollBytes = message.preRollBytes
    if (
      message.mode !== INPUT_TRANSPORT_SHARED_RING ||
      !Number.isInteger(ringSize) ||
      ringSize < 4096 ||
      ringSize > this.inputBufferSize ||
      (ringSize & (ringSize - 1)) !== 0 ||
      !Number.isInteger(chunkBytes) ||
      chunkBytes < PCM_BYTES_PER_SAMPLE ||
      chunkBytes > ringSize / 2 ||
      chunkBytes % PCM_BYTES_PER_SAMPLE !== 0 ||
      message.gated !== true ||
      !Number.isInteger(preRollBytes) ||
      preRollBytes < chunkBytes ||
      preRollBytes > ringSize / 2 ||
      preRollBytes % PCM_BYTES_PER_SAMPLE !== 0
    ) {
      this.error = 'unsupported chat input transport'
      this.state = ChatAudioIOBase.FAILED
      this.worker?.terminate()
      this.worker = null
      this.onStateChanged(this.state)
      return
    }

    this.inputTransport = INPUT_TRANSPORT_SHARED_RING
    this.inputRingSize = ringSize
    this.inputBatchTargetBytes = chunkBytes
    this.inputGateEnabled = true
    this.inputGate = new InputActivityGate(
      inputGateThreshold(),
      Math.round((HARDWARE_SAMPLE_RATE * INPUT_GATE_ATTACK_MS) / 1000),
      Math.round((HARDWARE_SAMPLE_RATE * INPUT_GATE_HANGOVER_MS) / 1000),
    )
    const sourcePreRollBytes =
      Math.round((preRollBytes * HARDWARE_SAMPLE_RATE) / this.inputSampleRate / PCM_BYTES_PER_SAMPLE) *
      PCM_BYTES_PER_SAMPLE
    this.inputPreRoll = new CircularByteHistory(sourcePreRollBytes)
    this.inputBufferOffset = 0
    Atomics.store(this.barrier, INPUT_RING_HEAD_BARRIER_INDEX, 0)
    Atomics.store(this.barrier, INPUT_RING_TAIL_BARRIER_INDEX, 0)
    Atomics.store(this.barrier, INPUT_GATE_BARRIER_INDEX, INPUT_GATE_CLOSED)
    if (config.chat?.traceEvents === true) {
      trace(
        `[DuplexChatAudioIO] input gate configured threshold=${this.inputGate.threshold} attackMs=${INPUT_GATE_ATTACK_MS} hangoverMs=${INPUT_GATE_HANGOVER_MS} preRollBytes=${preRollBytes} sourcePreRollBytes=${sourcePreRollBytes} aecFilterLength=${AEC_FILTER_LENGTH}\n`,
      )
    }
  }

  ensureDuplex() {
    if (this.duplex) return

    this.ready = false
    this.inputReadyAt = Date.now() + 500

    this.duplex = new AudioDuplex({
      sampleRate: HARDWARE_SAMPLE_RATE,
      bitsPerSample: 16,
      echoCancellation: {
        filterLength: AEC_FILTER_LENGTH,
        nlpLevel: AEC_NLP_LEVEL,
        referenceDelaySamples: AEC_REFERENCE_DELAY_SAMPLES,
      },
      input: {
        channels: 1,
        onReadable: (size) => this.onAudioReadable(size),
      },
      output: {
        channels: 1,
        hardwareAttenuationDb: HARDWARE_ATTENUATION_DB,
        volume: this.volume,
        onWritable: (size) => this.onAudioWritable(size),
      },
    })
    this.input = this.duplex.input
    this.output = this.duplex.output
  }

  ensureInput() {
    this.ensureDuplex()
    this.input.start()
  }

  ensureOutput() {
    this.ensureDuplex()
    this.output.start()
    this.output.volume = this.volume
  }

  startInputProbe() {
    const settings = this.inputProbeSettings
    if (!settings || this.inputProbeTimer !== undefined || this.inputProbe) return

    this.inputProbe = new SyntheticInputProbe(HARDWARE_SAMPLE_RATE, settings.durationMs, settings.level)
    this.inputProbeBuffer = new SharedArrayBuffer(INPUT_PROBE_CHUNK_SAMPLES * PCM_BYTES_PER_SAMPLE)
    this.inputProbeSilenceSamples = Math.round(
      (HARDWARE_SAMPLE_RATE *
        (INPUT_GATE_HANGOVER_MS + settings.vadSilenceDurationMs + INPUT_PROBE_CHUNK_SAMPLES / 16)) /
        1000,
    )
    this.inputProbeSignalSamples = 0
    this.inputProbeQueuedSilenceSamples = 0
    this.inputProbeCompleted = false
    trace(
      `[DuplexChatAudioIO] input probe armed startDelayMs=${settings.startDelayMs} durationMs=${settings.durationMs} level=${settings.level} physicalMicrophoneIgnored=true\n`,
    )
    this.scheduleInputProbe(settings.startDelayMs)
  }

  scheduleInputProbe(delayMs) {
    this.inputProbeTimer = Timer.set(() => {
      this.inputProbeTimer = undefined
      this.pumpInputProbe()
    }, delayMs)
  }

  pumpInputProbe() {
    if (!this.inputProbe || !this.inputProbeBuffer || !this.microphone || !this.input) return

    const samples = new Int16Array(this.inputProbeBuffer)
    let count = this.inputProbe.fill(samples)
    if (count) {
      this.inputProbeSignalSamples += count
    } else if (this.inputProbeSilenceSamples > 0) {
      count = Math.min(samples.length, this.inputProbeSilenceSamples)
      samples.fill(0, 0, count)
      this.inputProbeSilenceSamples -= count
      this.inputProbeQueuedSilenceSamples += count
    }

    if (count) {
      this.processInputAudio(new Uint8Array(this.inputProbeBuffer, 0, count * PCM_BYTES_PER_SAMPLE), count)
      this.scheduleInputProbe(Math.round((count * 1000) / HARDWARE_SAMPLE_RATE))
      return
    }

    this.inputProbeCompleted = true
    trace(
      `[DuplexChatAudioIO] input probe complete signalSamples=${this.inputProbeSignalSamples} silenceSamples=${this.inputProbeQueuedSilenceSamples}\n`,
    )
    this.inputProbe = null
    this.inputProbeBuffer = null
  }

  stopInputProbe() {
    if (this.inputProbeTimer !== undefined) {
      Timer.clear(this.inputProbeTimer)
      this.inputProbeTimer = undefined
    }
    this.inputProbe = null
    this.inputProbeBuffer = null
    this.inputProbeSilenceSamples = 0
  }

  ensureInputResampleSourceBuffer(sourceBytes) {
    if (!this.inputResampleSource || this.inputResampleSource.byteLength < sourceBytes)
      this.inputResampleSource = new SharedArrayBuffer(sourceBytes)
  }

  ensureInputResampleTargetBuffer(targetBytes) {
    if (!this.inputResampleTarget || this.inputResampleTarget.byteLength < targetBytes)
      this.inputResampleTarget = new SharedArrayBuffer(targetBytes)
  }

  ensureOutputResampleBuffers(sourceBytes, targetBytes) {
    if (!this.outputResampleSource || this.outputResampleSource.byteLength < sourceBytes)
      this.outputResampleSource = new SharedArrayBuffer(sourceBytes)
    if (!this.outputResampleTarget || this.outputResampleTarget.byteLength < targetBytes)
      this.outputResampleTarget = new SharedArrayBuffer(targetBytes)
  }

  resampleAndQueueInput(inputBuffer, inputOffsetSamples, sourceSamples) {
    if (!sourceSamples) return
    const targetCapacitySamples = Math.ceil((sourceSamples * this.inputSampleRate) / HARDWARE_SAMPLE_RATE) + 1
    const targetCapacityBytes = targetCapacitySamples * PCM_BYTES_PER_SAMPLE
    this.ensureInputResampleTargetBuffer(targetCapacityBytes)
    const targetSamples = resamplePCM16Mono(
      inputBuffer,
      inputOffsetSamples,
      sourceSamples,
      this.inputResampleTarget,
      HARDWARE_SAMPLE_RATE,
      this.inputSampleRate,
      this.inputResamplerState,
    )
    const targetBytes = targetSamples * PCM_BYTES_PER_SAMPLE
    if (targetBytes) this.queueInputAudio(new Uint8Array(this.inputResampleTarget, 0, targetBytes), targetBytes)
  }

  drainInputPreRoll() {
    this.inputPreRoll?.drain((buffer, byteOffset, byteLength) => {
      this.resampleAndQueueInput(buffer, byteOffset / PCM_BYTES_PER_SAMPLE, byteLength / PCM_BYTES_PER_SAMPLE)
    })
  }

  flushInputBatch() {
    const size = this.inputBatchSize
    if (!size || this.inputPostPending) return false

    const offset = this.inputBatchOffset
    const sequence = (this.inputPostSequence + 1) | 0
    try {
      this.worker?.postMessage({
        id: 'sendAudio',
        offset,
        size,
        sequence,
      })
    } catch (error) {
      this.inputPostFailures += 1
      if (this.inputPostFailures === 1 || (this.inputPostFailures & (this.inputPostFailures - 1)) === 0) {
        trace(
          `[DuplexChatAudioIO] input post deferred count=${this.inputPostFailures} reason=${String(
            error?.message ?? error,
          )}\n`,
        )
      }
      return false
    }

    this.inputPostSequence = sequence
    this.inputPostPending = true
    this.inputBatchSize = 0
    this.inputBatchOffset = offset === 0 ? this.inputBatchTargetBytes : 0
    this.inputBufferOffset = this.inputBatchOffset
    return true
  }

  refreshInputPostAcknowledgement() {
    if (this.inputPostPending && Atomics.load(this.barrier, INPUT_ACK_BARRIER_INDEX) === this.inputPostSequence) {
      this.inputPostPending = false
    }
  }

  recordInputBackpressureDrop(bytes) {
    this.inputBackpressureDrops += 1
    if (this.inputBackpressureDrops === 1 || (this.inputBackpressureDrops & (this.inputBackpressureDrops - 1)) === 0) {
      trace(`[DuplexChatAudioIO] input backpressure drop count=${this.inputBackpressureDrops} bytes=${bytes}\n`)
    }
  }

  queueSharedInputAudio(source, targetBytes) {
    if (this.inputGateEnabled && Atomics.load(this.barrier, INPUT_GATE_BARRIER_INDEX) === INPUT_GATE_CLOSING) return

    const ringSize = this.inputRingSize
    const mask = ringSize - 1
    const head = Atomics.load(this.barrier, INPUT_RING_HEAD_BARRIER_INDEX)
    const tail = Atomics.load(this.barrier, INPUT_RING_TAIL_BARRIER_INDEX)
    const free = (tail - (head + 1)) & mask
    if (targetBytes > free) {
      this.recordInputBackpressureDrop(targetBytes)
      return
    }

    const first = Math.min(targetBytes, ringSize - head)
    new Uint8Array(this.inputBuffer, head, first).set(source.subarray(0, first))
    const remaining = targetBytes - first
    if (remaining) new Uint8Array(this.inputBuffer, 0, remaining).set(source.subarray(first))

    const nextHead = (head + targetBytes) & mask
    this.inputBufferOffset = nextHead
    Atomics.store(this.barrier, INPUT_RING_HEAD_BARRIER_INDEX, nextHead)
  }

  openInputGate(level) {
    Atomics.store(this.barrier, INPUT_GATE_BARRIER_INDEX, INPUT_GATE_OPEN)
    if (config.chat?.traceEvents === true)
      trace(`[DuplexChatAudioIO] input gate open level=${level} threshold=${this.inputGate.threshold}\n`)
  }

  beginInputGateClose(level) {
    Atomics.store(this.barrier, INPUT_GATE_BARRIER_INDEX, INPUT_GATE_CLOSING)
    if (config.chat?.traceEvents === true) trace(`[DuplexChatAudioIO] input gate closing level=${level}\n`)
  }

  queueInputAudio(source, targetBytes) {
    if (this.state < ChatAudioIOBase.CONNECTED) {
      this.inputBatchSize = 0
      return
    }

    if (this.inputTransport === INPUT_TRANSPORT_SHARED_RING) {
      this.queueSharedInputAudio(source, targetBytes)
      return
    }

    this.refreshInputPostAcknowledgement()
    if (this.inputBatchSize === this.inputBatchTargetBytes) this.flushInputBatch()

    let sourceOffset = 0
    while (sourceOffset < targetBytes) {
      if (this.inputBatchSize === this.inputBatchTargetBytes) {
        this.recordInputBackpressureDrop(targetBytes - sourceOffset)
        return
      }

      const available = this.inputBatchTargetBytes - this.inputBatchSize
      const count = Math.min(available, targetBytes - sourceOffset)
      const targetOffset = this.inputBatchOffset + this.inputBatchSize
      const samples = new Uint8Array(this.inputBuffer, targetOffset, count)
      samples.set(source.subarray(sourceOffset, sourceOffset + count))
      this.inputBatchSize += count
      this.inputBufferOffset = this.inputBatchOffset + this.inputBatchSize
      sourceOffset += count

      if (this.inputBatchSize === this.inputBatchTargetBytes) this.flushInputBatch()
    }
  }

  onAudioReadable(size) {
    if (!size || !this.input) return

    size -= size % PCM_BYTES_PER_SAMPLE
    const sourceSamples = size / PCM_BYTES_PER_SAMPLE
    this.ensureInputResampleSourceBuffer(size)
    const source = new Uint8Array(this.inputResampleSource, 0, size)
    this.input.read(source)

    if (!this.ready) {
      if (Date.now() < this.inputReadyAt) {
        return
      }
      this.ready = true
      if (this.state !== ChatAudioIOBase.DISCONNECTED) this.onStateChanged(this.state)
    }

    if (!this.microphone || this.inputProbeSettings) return

    this.processInputAudio(source, sourceSamples)
  }

  processInputAudio(source, sourceSamples) {
    const level = computeLevel(source)
    if (this.level !== level) {
      this.level = level
      this.onInputLevelChanged(level)
    }

    if (!this.inputGateEnabled || !this.inputGate || !this.inputPreRoll) {
      this.resampleAndQueueInput(source, 0, sourceSamples)
      return
    }

    const gateState = Atomics.load(this.barrier, INPUT_GATE_BARRIER_INDEX)
    const gateAction = this.inputGate.update(level, sourceSamples, gateState)
    if (gateAction === INPUT_GATE_SHOULD_OPEN) {
      this.openInputGate(level)
      this.inputResamplerState.fill(0)
      this.drainInputPreRoll()
      this.resampleAndQueueInput(source, 0, sourceSamples)
      return
    }

    if (gateState === INPUT_GATE_OPEN) {
      this.resampleAndQueueInput(source, 0, sourceSamples)
      if (gateAction === INPUT_GATE_SHOULD_CLOSE) this.beginInputGateClose(level)
      return
    }

    this.inputPreRoll.append(source)
  }

  onAudioWritable(size) {
    if (!size || !this.output) return

    size -= size % PCM_BYTES_PER_SAMPLE
    const writableSamples = size / PCM_BYTES_PER_SAMPLE
    const maximumSourceSamples = maximumSourceSamplesForOutput(
      writableSamples,
      this.outputSampleRate,
      HARDWARE_SAMPLE_RATE,
    )
    const availableBytes = ringReadableBytes(this.outputBufferHead, this.outputBufferTail, this.outputBufferSize)
    const sourceSamples = Math.min(Math.floor(availableBytes / PCM_BYTES_PER_SAMPLE), maximumSourceSamples)
    const sourceBytes = sourceSamples * PCM_BYTES_PER_SAMPLE
    let level = 0

    if (sourceBytes) {
      this.ensureOutputResampleBuffers(sourceBytes, size)
      const nextTail = copyCircularBytes(
        new Uint8Array(this.outputBuffer),
        this.outputBufferTail,
        new Uint8Array(this.outputResampleSource, 0, sourceBytes),
        sourceBytes,
      )
      const outputSamples = resamplePCM16Mono(
        this.outputResampleSource,
        0,
        sourceSamples,
        this.outputResampleTarget,
        this.outputSampleRate,
        HARDWARE_SAMPLE_RATE,
        this.outputResamplerState,
      )
      const outputBytes = outputSamples * PCM_BYTES_PER_SAMPLE

      this.outputBufferTail = nextTail
      Atomics.store(this.barrier, 0, nextTail)
      Atomics.notify(this.barrier, 0)

      if (outputBytes) {
        const samples = new Uint8Array(this.outputResampleTarget, 0, outputBytes)
        if (this.onOutputLevelChanged) level = computeLevel(samples)
        this.output.write(samples)
      }
    }

    const sourceDrained = ringReadableBytes(this.outputBufferHead, this.outputBufferTail, this.outputBufferSize) === 0
    if (sourceDrained && this.state === ChatAudioIOBase.WAITING && this.output.bufferedBytes === 0) {
      this.worker?.postMessage({ id: 'listened' })
      this.state = ChatAudioIOBase.SPEAKING
      this.output.stop({ flush: true })
      this.onStateChanged(this.state)
    }

    if (this.level !== level) {
      this.level = level
      this.onOutputLevelChanged?.(level)
    }
  }

  disconnected() {
    this.error = ''
    this.state = ChatAudioIOBase.DISCONNECTED
    this.closeAudio()
    this.onStateChanged(this.state)
  }

  failed(message) {
    this.error = message.string
    this.state = ChatAudioIOBase.FAILED
    this.closeAudio()
    this.onStateChanged(this.state)
  }

  closeAudio() {
    if (this.duplex && !this.duplex.closed) {
      this.traceAudioSummary(this.duplex.stats)
      this.duplex.output.volume = 0
    }
    if (config.chat?.traceEvents === true && this.duplex) trace('[DuplexChatAudioIO] native close begin\n')
    this.duplex?.close()
    if (config.chat?.traceEvents === true && this.duplex) trace('[DuplexChatAudioIO] native close end\n')
    this.stopInputProbe()
    setHardwareAttenuation(SAFE_HARDWARE_ATTENUATION_DB)
    this.duplex = null
    this.input = null
    this.output = null
    this.ready = false
    this.inputResampleSource = null
    this.inputResampleTarget = null
    this.outputResampleSource = null
    this.outputResampleTarget = null
    this.inputBatchSize = 0
    this.inputBatchOffset = 0
    this.inputPostPending = false
    this.inputResamplerState?.fill(0)
    this.outputResamplerState?.fill(0)
    this.inputGate?.reset()
    this.inputPreRoll?.clear()
    Atomics.store(this.barrier, INPUT_GATE_BARRIER_INDEX, INPUT_GATE_CLOSED)
  }

  traceAudioSummary(stats) {
    if (config.chat?.traceEvents !== true || !stats) return
    const aec = stats.aec ?? {}
    trace(
      `[DuplexChatAudioIO] audio summary captured=${stats.capturedFrames ?? 0} rendered=${
        stats.renderedFrames ?? 0
      } inputOverruns=${stats.inputOverruns ?? 0} outputUnderruns=${stats.outputUnderruns ?? 0} aecFrames=${
        aec.processedFrames ?? 0
      } micOverruns=${aec.microphoneOverruns ?? 0} refOverruns=${aec.referenceOverruns ?? 0} syncResets=${
        aec.syncResets ?? 0
      } micRms=${Math.round(aec.microphoneRms ?? 0)} refRms=${Math.round(
        aec.referenceRms ?? 0,
      )} outRms=${Math.round(aec.outputRms ?? 0)} erleDb=${
        Math.round((aec.erleDb ?? 0) * 10) / 10
      } aecAverageUs=${Math.round(aec.averageProcessUs ?? 0)} aecMaximumUs=${
        aec.maximumProcessUs ?? 0
      } aecCycleAverageUs=${Math.round(aec.averageCycleUs ?? 0)} aecCycleMaximumUs=${
        aec.maximumCycleUs ?? 0
      } aecMemory=${aec.internalMemory ? 'internal' : 'spiram'} internalFreeBytes=${
        aec.internalFreeBytes ?? 0
      } xsCore=${aec.xsCore ?? -1} realtimeCore=${aec.realtimeCore ?? -1}\n`,
    )
    if (this.inputBackpressureDrops || this.inputPostFailures) {
      trace(
        `[DuplexChatAudioIO] input summary drops=${this.inputBackpressureDrops} postFailures=${this.inputPostFailures}\n`,
      )
    }
    if (this.inputGateEnabled && this.inputGate) {
      trace(
        `[DuplexChatAudioIO] input gate summary opens=${this.inputGate.opens} closes=${
          this.inputGate.closes
        } rejectedAttacks=${this.inputGate.rejectedAttacks} maxLevel=${
          this.inputGate.maxLevel
        } state=${Atomics.load(this.barrier, INPUT_GATE_BARRIER_INDEX)}\n`,
      )
    }
    if (this.inputProbeSettings) {
      trace(
        `[DuplexChatAudioIO] input probe summary signalSamples=${this.inputProbeSignalSamples} silenceSamples=${this.inputProbeQueuedSilenceSamples} completed=${this.inputProbeCompleted}\n`,
      )
    }
  }

  close() {
    this.worker?.terminate()
    this.worker = null
    this.closeAudio()
  }
}
