/* global SharedArrayBuffer, trace */

import AudioDuplex from 'embedded:io/audio/duplex'
import { amplifierVolumeByte, amplifierVolumeRegister, buildProbe } from 'audio-duplex-test-helpers'
import Timer from 'timer'

const readAmplifierVolumeRegister = native('xs_audio_duplex_test_read_amp_volume_register')
const analyzeDiagnostics = native('xs_audio_duplex_test_analyze_diagnostics')

const SAMPLE_RATE = 16000
const HARDWARE_ATTENUATION_DB = 60
const SAFE_HARDWARE_ATTENUATION_DB = 96
const OUTPUT_VOLUME = 1
const PROBE_PEAK = 12000
const PROBE_TABLE_SAMPLES = 16384
const DIAGNOSTIC_SAMPLES = 4096
const MAXIMUM_DELAY_SAMPLES = 2048
const REFERENCE_DELAY_SAMPLES = 1584
const START_DELAY_MS = 2000
const WARMUP_MS = 3500
const MEASUREMENT_MS = 4000

function setHardwareAttenuation(attenuationDb) {
  if (!globalThis.amp) throw new Error('CoreS3 hardware amplifier is unavailable')
  globalThis.amp.volume = 256 - amplifierVolumeByte(attenuationDb)
}

const probe = buildProbe(PROBE_TABLE_SAMPLES, PROBE_PEAK)
let probeOffset = 0
let inputCallbacks = 0

const duplex = new AudioDuplex({
  sampleRate: SAMPLE_RATE,
  echoCancellation: {
    filterLength: 4,
    nlpLevel: 'normal',
    referenceDelaySamples: REFERENCE_DELAY_SAMPLES,
    diagnostics: {
      maxSamples: DIAGNOSTIC_SAMPLES,
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

const expectedAmplifierRegister = amplifierVolumeRegister(HARDWARE_ATTENUATION_DB)
const actualAmplifierRegister = readAmplifierVolumeRegister()
if (actualAmplifierRegister !== expectedAmplifierRegister) {
  setHardwareAttenuation(SAFE_HARDWARE_ATTENUATION_DB)
  duplex.close()
  throw new Error(
    `AW88298 attenuation readback mismatch: expected 0x${expectedAmplifierRegister.toString(16)}, got 0x${actualAmplifierRegister.toString(16)}`,
  )
}

trace(
  `Acoustic probe armed: AW88298 -${HARDWARE_ATTENUATION_DB} dB verified at 0x${actualAmplifierRegister.toString(16)}, reference delay ${REFERENCE_DELAY_SAMPLES} samples, probe peak ${PROBE_PEAK}/32767, output remains stopped for ${START_DELAY_MS} ms\n`,
)

Timer.set(() => {
  trace('Acoustic probe starting\n')
  duplex.input.start()
  duplex.output.start()

  Timer.set(() => {
    duplex.readAecDiagnostics()
    trace('AEC warm-up capture discarded; measurement capture started\n')
  }, WARMUP_MS)

  Timer.set(() => {
    duplex.output.volume = 0
    duplex.output.stop({ flush: true })
    duplex.input.stop({ flush: true })
    setHardwareAttenuation(SAFE_HARDWARE_ATTENUATION_DB)

    const stats = duplex.stats
    const diagnostics = duplex.readAecDiagnostics()
    const analysis = analyzeDiagnostics(diagnostics, MAXIMUM_DELAY_SAMPLES)
    duplex.close()

    if (
      !inputCallbacks ||
      stats.inputOverruns ||
      stats.aec.microphoneOverruns ||
      stats.aec.referenceOverruns ||
      analysis.sampleCount !== DIAGNOSTIC_SAMPLES ||
      analysis.referenceRms <= 0
    )
      throw new Error(
        `Acoustic probe transport failed: stats=${JSON.stringify(stats)} analysis=${JSON.stringify(analysis)}`,
      )

    trace(`Acoustic probe PASS: ${JSON.stringify({ stats, analysis })}\n`)
  }, WARMUP_MS + MEASUREMENT_MS)
}, START_DELAY_MS)
