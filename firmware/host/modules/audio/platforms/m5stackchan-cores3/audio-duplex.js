/*
 * Copyright (c) 2026 Shinya Ishikawa
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

import 'embedded:io/audio/aec'

const CORE_S3_AEC_REFERENCE_DELAY_SAMPLES = 1584

class NativeAudioDuplex extends Native('xs_audio_duplex_destructor') {
  constructor(options) {
    super()
    native('xs_audio_duplex_constructor').call(this, options)
  }

  close() {
    native('xs_audio_duplex_close').call(this)
  }

  startInput() {
    native('xs_audio_duplex_start_input').call(this)
  }

  stopInput(flush) {
    native('xs_audio_duplex_stop_input').call(this, flush)
  }

  read() {
    return native('xs_audio_duplex_read').call(this)
  }

  readInto(value) {
    return native('xs_audio_duplex_read').call(this, value)
  }

  startOutput() {
    native('xs_audio_duplex_start_output').call(this)
  }

  stopOutput(flush) {
    native('xs_audio_duplex_stop_output').call(this, flush)
  }

  write(buffer) {
    native('xs_audio_duplex_write').call(this, buffer)
  }

  get volume() {
    return native('xs_audio_duplex_get_volume').call(this)
  }

  set volume(value) {
    native('xs_audio_duplex_set_volume').call(this, value)
  }

  get capturedFrames() {
    return native('xs_audio_duplex_get_captured_frames').call(this)
  }

  get renderedFrames() {
    return native('xs_audio_duplex_get_rendered_frames').call(this)
  }

  get inputOverruns() {
    return native('xs_audio_duplex_get_input_overruns').call(this)
  }

  get outputUnderruns() {
    return native('xs_audio_duplex_get_output_underruns').call(this)
  }

  get outputBufferedBytes() {
    return native('xs_audio_duplex_get_output_buffered_bytes').call(this)
  }

  get aecStats() {
    return native('xs_audio_duplex_get_aec_stats').call(this)
  }

  readAecDiagnostics(maxSamples) {
    if (maxSamples === undefined) return native('xs_audio_duplex_read_aec_diagnostics').call(this)
    return native('xs_audio_duplex_read_aec_diagnostics').call(this, maxSamples)
  }

  clearAecDiagnostics() {
    native('xs_audio_duplex_clear_aec_diagnostics').call(this)
  }
}

class AudioDuplexInput {
  #owner
  #closed = false
  #started = false

  constructor(owner, target) {
    this.#owner = owner
    if (target !== undefined) this.target = target
  }

  #assertOpen() {
    if (this.#closed || this.#owner.closed) throw new Error('audio input is closed')
  }

  start() {
    this.#assertOpen()
    if (this.#started) return
    this.#owner._startInput()
    this.#started = true
  }

  stop(options) {
    if (this.#closed || !this.#started) {
      if (options?.flush) this.#owner._flushInput()
      return
    }
    this.#owner._stopInput(Boolean(options?.flush))
    this.#started = false
  }

  close() {
    if (this.#closed) return
    this.#owner._stopInput(true)
    this.#started = false
    this.#closed = true
    this.#owner._closeInputEndpoint()
  }

  read(value) {
    this.#assertOpen()
    if (value === undefined) return this.#owner._readInput()
    return this.#owner._readInput(value)
  }

  get audioType() {
    return 'LPCM'
  }

  get bitsPerSample() {
    return this.#owner.bitsPerSample
  }

  get channels() {
    return this.#owner.inputChannels
  }

  get sampleRate() {
    return this.#owner.sampleRate
  }

  get format() {
    return 'buffer'
  }

  set format(value) {
    if (value !== 'buffer') throw new RangeError('unsupported audio format')
  }

  _closeFromOwner() {
    this.#started = false
    this.#closed = true
  }

  static {
    AudioDuplexInput.prototype[Symbol.dispose] = AudioDuplexInput.prototype.close
  }
}

class AudioDuplexOutput {
  #owner
  #closed = false
  #started = false

  constructor(owner, target) {
    this.#owner = owner
    if (target !== undefined) this.target = target
  }

  #assertOpen() {
    if (this.#closed || this.#owner.closed) throw new Error('audio output is closed')
  }

  start() {
    this.#assertOpen()
    if (this.#started) return
    this.#owner._startOutput()
    this.#started = true
  }

  stop(options) {
    if (this.#closed || !this.#started) {
      if (options?.flush) this.#owner._flushOutput()
      return
    }
    this.#owner._stopOutput(Boolean(options?.flush))
    this.#started = false
  }

  close() {
    if (this.#closed) return
    this.#owner._stopOutput(true)
    this.#started = false
    this.#closed = true
    this.#owner._closeOutputEndpoint()
  }

  write(buffer) {
    this.#assertOpen()
    this.#owner._writeOutput(buffer)
  }

  get audioType() {
    return 'LPCM'
  }

  get bitsPerSample() {
    return this.#owner.bitsPerSample
  }

  get channels() {
    return this.#owner.outputChannels
  }

  get sampleRate() {
    return this.#owner.sampleRate
  }

  get hardwareAttenuationDb() {
    return this.#owner.hardwareAttenuationDb
  }

  get format() {
    return 'buffer'
  }

  set format(value) {
    if (value !== 'buffer') throw new RangeError('unsupported audio format')
  }

  get bufferedBytes() {
    this.#assertOpen()
    return this.#owner._getOutputBufferedBytes()
  }

  get volume() {
    this.#assertOpen()
    return this.#owner._getVolume()
  }

  set volume(value) {
    this.#assertOpen()
    this.#owner._setVolume(value)
  }

  _closeFromOwner() {
    this.#started = false
    this.#closed = true
  }

  static {
    AudioDuplexOutput.prototype[Symbol.dispose] = AudioDuplexOutput.prototype.close
  }
}

export default class AudioDuplex {
  #native
  #inputClosed = false
  #outputClosed = false
  #closed = false
  #finalStats = null

  constructor(options) {
    if (!options || typeof options !== 'object') throw new TypeError('options are required')

    const sampleRate = options.sampleRate
    const bitsPerSample = options.bitsPerSample ?? 16
    const inputChannels = options.input?.channels ?? 1
    const outputChannels = options.output?.channels ?? 1
    const echoCancellationOption = options.echoCancellation ?? false

    if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 48000)
      throw new RangeError('sampleRate must be an integer from 8000 through 48000')
    if (bitsPerSample !== 16) throw new RangeError('CoreS3 AudioDuplex supports 16-bit LPCM only')
    if (inputChannels !== 1 && inputChannels !== 2) throw new RangeError('input.channels must be 1 or 2')
    if (outputChannels !== 1 && outputChannels !== 2) throw new RangeError('output.channels must be 1 or 2')
    if (
      typeof echoCancellationOption !== 'boolean' &&
      (typeof echoCancellationOption !== 'object' || echoCancellationOption === null)
    )
      throw new TypeError('echoCancellation must be a boolean or an options object')

    const echoCancellation = echoCancellationOption !== false
    const aecOptions =
      typeof echoCancellationOption === 'object' && echoCancellationOption !== null ? echoCancellationOption : {}
    const aecFilterLength = aecOptions.filterLength ?? 4
    const aecNlpLevelName = aecOptions.nlpLevel ?? 'normal'
    const aecNlpLevels = Object.freeze({
      normal: 0,
      aggressive: 1,
      'very-aggressive': 2,
    })
    const aecNlpLevel = aecNlpLevels[aecNlpLevelName]
    const aecReferenceDelaySamples = aecOptions.referenceDelaySamples ?? CORE_S3_AEC_REFERENCE_DELAY_SAMPLES
    const aecDiagnosticSamples = aecOptions.diagnostics?.maxSamples ?? 0

    if (echoCancellation && sampleRate !== 16000) throw new RangeError('echoCancellation requires sampleRate 16000')
    if (echoCancellation && (inputChannels !== 1 || outputChannels !== 1))
      throw new RangeError('echoCancellation requires mono input and output')
    if (!Number.isInteger(aecFilterLength) || aecFilterLength < 1 || aecFilterLength > 8)
      throw new RangeError('echoCancellation.filterLength must be an integer from 1 through 8')
    if (aecNlpLevel === undefined)
      throw new RangeError('echoCancellation.nlpLevel must be normal, aggressive, or very-aggressive')
    if (!Number.isInteger(aecReferenceDelaySamples) || aecReferenceDelaySamples < 0 || aecReferenceDelaySamples > 4096)
      throw new RangeError('echoCancellation.referenceDelaySamples must be an integer from 0 through 4096')
    if (!Number.isInteger(aecDiagnosticSamples) || aecDiagnosticSamples < 0 || aecDiagnosticSamples > 160000)
      throw new RangeError('echoCancellation.diagnostics.maxSamples must be an integer from 0 through 160000')
    if (!echoCancellation && aecDiagnosticSamples)
      throw new RangeError('echo cancellation must be enabled to capture AEC diagnostics')

    this.sampleRate = sampleRate
    this.bitsPerSample = bitsPerSample
    this.inputChannels = inputChannels
    this.outputChannels = outputChannels

    const inputOptions = options.input ?? {}
    const outputOptions = options.output ?? {}
    const onReadable = inputOptions.onReadable
    const onWritable = outputOptions.onWritable
    const initialVolume = outputOptions.volume ?? 1
    const requestedHardwareAttenuationDb = outputOptions.hardwareAttenuationDb
    if (typeof initialVolume !== 'number' || !Number.isFinite(initialVolume))
      throw new TypeError('output.volume must be a finite number')
    if (
      requestedHardwareAttenuationDb !== undefined &&
      (typeof requestedHardwareAttenuationDb !== 'number' || !Number.isFinite(requestedHardwareAttenuationDb))
    )
      throw new TypeError('output.hardwareAttenuationDb must be a finite number')
    if (
      requestedHardwareAttenuationDb !== undefined &&
      (requestedHardwareAttenuationDb < 0 || requestedHardwareAttenuationDb > 96)
    )
      throw new RangeError('output.hardwareAttenuationDb must be from 0 through 96')

    this.hardwareAttenuationDb =
      requestedHardwareAttenuationDb === undefined ? undefined : Math.round(requestedHardwareAttenuationDb * 2) / 2

    if (globalThis.amp) {
      globalThis.amp.sampleRate = sampleRate
      if (this.hardwareAttenuationDb !== undefined) {
        const coarseSteps = Math.min(15, Math.floor(this.hardwareAttenuationDb / 6))
        const fineSteps = Math.round((this.hardwareAttenuationDb - coarseSteps * 6) * 2)
        const volumeRegister = (coarseSteps << 4) | fineSteps
        globalThis.amp.volume = 256 - volumeRegister
      }
    } else if (this.hardwareAttenuationDb !== undefined) {
      throw new Error('CoreS3 hardware amplifier is unavailable')
    }

    const input = new AudioDuplexInput(this, inputOptions.target)
    const output = new AudioDuplexOutput(this, outputOptions.target)
    this.input = input
    this.output = output

    this.#native = new NativeAudioDuplex({
      sampleRate,
      inputChannels,
      outputChannels,
      echoCancellation,
      aecFilterLength,
      aecNlpLevel,
      aecReferenceDelaySamples,
      aecDiagnosticSamples,
      onReadable:
        typeof onReadable === 'function'
          ? (byteLength, sampleCount) => onReadable.call(input, byteLength, sampleCount)
          : undefined,
      onWritable:
        typeof onWritable === 'function'
          ? (byteLength, sampleCount) => onWritable.call(output, byteLength, sampleCount)
          : undefined,
    })

    output.volume = initialVolume
  }

  get closed() {
    return this.#closed
  }

  get stats() {
    if (this.#closed) return this.#finalStats

    return Object.freeze({
      capturedFrames: this.#native.capturedFrames,
      renderedFrames: this.#native.renderedFrames,
      inputOverruns: this.#native.inputOverruns,
      outputUnderruns: this.#native.outputUnderruns,
      aec: Object.freeze(this.#native.aecStats),
    })
  }

  readAecDiagnostics(maxSamples) {
    if (this.#closed) throw new Error('audio duplex is closed')
    if (maxSamples !== undefined && (!Number.isInteger(maxSamples) || maxSamples <= 0))
      throw new RangeError('AEC diagnostic read size must be a positive integer')
    return this.#native.readAecDiagnostics(maxSamples)
  }

  clearAecDiagnostics() {
    if (this.#closed) throw new Error('audio duplex is closed')
    this.#native.clearAecDiagnostics()
  }

  _startInput() {
    if (this.#closed) throw new Error('audio duplex is closed')
    this.#native.startInput()
  }

  _stopInput(flush) {
    if (!this.#closed) this.#native.stopInput(flush)
  }

  _flushInput() {
    if (!this.#closed) this.#native.stopInput(true)
  }

  _readInput(value) {
    if (value === undefined) return this.#native.read()
    return this.#native.readInto(value)
  }

  _startOutput() {
    if (this.#closed) throw new Error('audio duplex is closed')
    this.#native.startOutput()
  }

  _stopOutput(flush) {
    if (!this.#closed) this.#native.stopOutput(flush)
  }

  _flushOutput() {
    if (!this.#closed) this.#native.stopOutput(true)
  }

  _writeOutput(buffer) {
    this.#native.write(buffer)
  }

  _getOutputBufferedBytes() {
    return this.#native.outputBufferedBytes
  }

  _getVolume() {
    return this.#native.volume
  }

  _setVolume(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('volume must be a finite number')
    this.#native.volume = Math.min(1, Math.max(0, value))
  }

  _closeInputEndpoint() {
    this.#inputClosed = true
    if (this.#outputClosed) this.close()
  }

  _closeOutputEndpoint() {
    this.#outputClosed = true
    if (this.#inputClosed) this.close()
  }

  close() {
    if (this.#closed) return
    this.#finalStats = this.stats
    this.#closed = true
    this.#native.close()
    this.input._closeFromOwner()
    this.output._closeFromOwner()
    this.#inputClosed = true
    this.#outputClosed = true
  }

  static {
    AudioDuplex.prototype[Symbol.dispose] = AudioDuplex.prototype.close
  }
}

export function openAudioDuplex(options) {
  return new AudioDuplex(options)
}
