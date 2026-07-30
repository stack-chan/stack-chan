/* global SharedArrayBuffer, trace */

import AudioDuplex from 'embedded:io/audio/duplex'
import config from 'mc/config'
import Timer from 'timer'

const readAmplifierVolumeRegister = native('xs_audio_duplex_test_read_amp_volume_register')

const SAMPLE_RATE = 16000
const OUTPUT_VOLUME = 1
const PROBE_TABLE_SAMPLES = 16384
const DIAGNOSTIC_CHUNK_SAMPLES = 128
const REFERENCE_DELAY_SAMPLES = 1584
const captureConfig = config.aecWaveform ?? {}

function integerSetting(name, fallback, minimum, maximum) {
  const value = captureConfig[name] ?? fallback
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw new RangeError(`config.aecWaveform.${name} must be an integer from ${minimum} through ${maximum}`)
  return value
}

const CAPTURE_PROFILE = String(captureConfig.profile ?? 'quiet')
const HARDWARE_ATTENUATION_DB = integerSetting('hardwareAttenuationDb', 60, 0, 96)
const SAFE_HARDWARE_ATTENUATION_DB = integerSetting('safeHardwareAttenuationDb', 96, 90, 96)
const PROBE_PEAK = integerSetting('probePeak', 12000, 1, 16000)
const CAPTURE_SAMPLES = integerSetting('captureSamples', 16384, 1, 160000)
const START_DELAY_MS = integerSetting('startDelayMs', 3000, 0, 60000)
const WARMUP_MS = integerSetting('warmupMs', 3500, 0, 60000)
const CAPTURE_MS = integerSetting('captureMs', 1200, 1, 60000)

if (CAPTURE_MS * SAMPLE_RATE < CAPTURE_SAMPLES * 1000)
  throw new RangeError('config.aecWaveform.captureMs is too short for captureSamples')

function amplifierVolumeByte(attenuationDb) {
  const coarseSteps = Math.min(15, Math.floor(attenuationDb / 6))
  const fineSteps = Math.round((attenuationDb - coarseSteps * 6) * 2)
  return (coarseSteps << 4) | fineSteps
}

function amplifierVolumeRegister(attenuationDb) {
  return (amplifierVolumeByte(attenuationDb) << 8) | 0x64
}

function setHardwareAttenuation(attenuationDb) {
  if (!globalThis.amp) throw new Error('CoreS3 hardware amplifier is unavailable')
  globalThis.amp.volume = 256 - amplifierVolumeByte(attenuationDb)
}

function verifyHardwareAttenuation(attenuationDb) {
  const expected = amplifierVolumeRegister(attenuationDb)
  const actual = readAmplifierVolumeRegister()
  if (actual !== expected)
    throw new Error(
      `AW88298 attenuation readback mismatch: expected 0x${expected.toString(16)}, got 0x${actual.toString(16)}`,
    )
  return actual
}

function buildProbe() {
  const probe = new Int16Array(PROBE_TABLE_SAMPLES)
  let random = 0x6d2b79f5
  let lowPass = 0
  let baseline = 0
  let peak = 1

  for (let index = 0; index < probe.length; index += 1) {
    random ^= random << 13
    random ^= random >>> 17
    random ^= random << 5
    const white = random >> 16
    lowPass += (white - lowPass) >> 1
    baseline += (lowPass - baseline) >> 5
    const shaped = lowPass - baseline
    probe[index] = shaped
    const magnitude = Math.abs(shaped)
    if (peak < magnitude) peak = magnitude
  }

  const scale = PROBE_PEAK / peak
  for (let index = 0; index < probe.length; index += 1) probe[index] = Math.round(probe[index] * scale)
  return probe
}

const probe = buildProbe()
let probeOffset = 0
let inputCallbacks = 0
let running = false

const duplex = new AudioDuplex({
  sampleRate: SAMPLE_RATE,
  echoCancellation: {
    filterLength: 4,
    nlpLevel: 'normal',
    referenceDelaySamples: REFERENCE_DELAY_SAMPLES,
    diagnostics: {
      maxSamples: CAPTURE_SAMPLES,
    },
  },
  input: {
    channels: 1,
    onReadable(byteLength) {
      this.read(byteLength)
      inputCallbacks += 1
    },
  },
  output: {
    channels: 1,
    hardwareAttenuationDb: HARDWARE_ATTENUATION_DB,
    volume: OUTPUT_VOLUME,
    onWritable(byteLength) {
      const bytes = new Uint8Array(new SharedArrayBuffer(byteLength))
      const samples = new Int16Array(bytes.buffer)
      for (let index = 0; index < samples.length; index += 1) {
        samples[index] = probe[probeOffset]
        probeOffset += 1
        if (probeOffset === probe.length) probeOffset = 0
      }
      this.write(bytes)
    },
  },
})

function stopSafely() {
  duplex.output.volume = 0
  if (running) {
    duplex.output.stop({ flush: true })
    duplex.input.stop({ flush: true })
    running = false
  }
  setHardwareAttenuation(SAFE_HARDWARE_ATTENUATION_DB)
}

const armedRegister = verifyHardwareAttenuation(HARDWARE_ATTENUATION_DB)
trace(
  `AEC_WAVEFORM_ARMED ${JSON.stringify({
    profile: CAPTURE_PROFILE,
    hardwareAttenuationDb: HARDWARE_ATTENUATION_DB,
    amplifierRegister: `0x${armedRegister.toString(16)}`,
    digitalVolume: OUTPUT_VOLUME,
    probePeak: PROBE_PEAK,
    startDelayMs: START_DELAY_MS,
    warmupMs: WARMUP_MS,
    captureMs: CAPTURE_MS,
  })}\n`,
)

Timer.set(() => {
  duplex.input.start()
  duplex.output.start()
  running = true
  trace('AEC_WAVEFORM_WARMUP\n')

  Timer.set(() => {
    duplex.clearAecDiagnostics()
    trace('AEC_WAVEFORM_MEASURE\n')
  }, WARMUP_MS)

  Timer.set(() => {
    stopSafely()
    const safeRegister = verifyHardwareAttenuation(SAFE_HARDWARE_ATTENUATION_DB)
    const stats = duplex.stats
    let chunkIndex = 0
    let capturedSamples = 0

    trace(
      `AEC_WAVEFORM_BEGIN ${JSON.stringify({
        profile: CAPTURE_PROFILE,
        sampleRate: SAMPLE_RATE,
        captureSamples: CAPTURE_SAMPLES,
        referenceDelaySamples: REFERENCE_DELAY_SAMPLES,
        hardwareAttenuationDb: HARDWARE_ATTENUATION_DB,
        safeHardwareAttenuationDb: SAFE_HARDWARE_ATTENUATION_DB,
        probePeak: PROBE_PEAK,
        warmupMs: WARMUP_MS,
        captureMs: CAPTURE_MS,
        channels: ['raw-microphone-aec-off-equivalent', 'delayed-speaker-reference', 'aec-on'],
      })}\n`,
    )

    while (true) {
      const buffer = duplex.readAecDiagnostics(DIAGNOSTIC_CHUNK_SAMPLES)
      if (!buffer) break
      const samples = buffer.byteLength / (3 * Int16Array.BYTES_PER_ELEMENT)
      trace(`AEC_WAVEFORM_CHUNK ${chunkIndex} ${new Uint8Array(buffer).toBase64()}\n`)
      capturedSamples += samples
      chunkIndex += 1
    }

    duplex.close()
    if (!inputCallbacks || capturedSamples !== CAPTURE_SAMPLES)
      throw new Error(
        `AEC waveform capture incomplete: callbacks=${inputCallbacks}, captured=${capturedSamples}, expected=${CAPTURE_SAMPLES}`,
      )

    trace(
      `AEC_WAVEFORM_END ${JSON.stringify({
        capturedSamples,
        chunks: chunkIndex,
        safeAmplifierRegister: `0x${safeRegister.toString(16)}`,
        stats,
      })}\n`,
    )
  }, WARMUP_MS + CAPTURE_MS)
}, START_DELAY_MS)
