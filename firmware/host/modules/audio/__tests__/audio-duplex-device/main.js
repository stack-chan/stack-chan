/* global trace */

import { runAecSelfTest } from 'embedded:io/audio/aec'
import AudioDuplex from 'embedded:io/audio/duplex'
import Timer from 'timer'

const readAmplifierVolumeRegister = native('xs_audio_duplex_test_read_amp_volume_register')

const aecSelfTest = runAecSelfTest()
if (
  aecSelfTest.frameSamples <= 0 ||
  aecSelfTest.processedFrames <= 0 ||
  aecSelfTest.referenceEnergy <= 0 ||
  aecSelfTest.microphoneEnergy <= 0 ||
  aecSelfTest.outputEnergy >= aecSelfTest.microphoneEnergy ||
  aecSelfTest.suppressionDb < 30 ||
  aecSelfTest.doubleTalkFrames <= 0 ||
  aecSelfTest.nearEndEnergy <= 0 ||
  aecSelfTest.doubleTalkOutputEnergy <= 0 ||
  aecSelfTest.nearEndDelaySamples < 0 ||
  aecSelfTest.nearEndDelaySamples > aecSelfTest.frameSamples * 2 ||
  aecSelfTest.nearEndCorrelation < 0.8 ||
  aecSelfTest.nearEndGainDb < -9 ||
  aecSelfTest.nearEndGainDb > 1 ||
  aecSelfTest.nearEndErrorDb > -2
)
  throw new Error(`AEC synthetic echo test failed: ${JSON.stringify(aecSelfTest)}`)
trace(`AEC synthetic echo PASS: ${JSON.stringify(aecSelfTest)}\n`)

const SAMPLE_RATE = 16000
const TONE_HZ = 440
const AMPLITUDE = 1200
const OUTPUT_VOLUME = 0
const HARDWARE_ATTENUATION_DB = 96
const TONE_TABLE = new Int16Array(400)
for (let index = 0; index < TONE_TABLE.length; index += 1)
  TONE_TABLE[index] = Math.round(Math.sin((2 * Math.PI * TONE_HZ * index) / SAMPLE_RATE) * AMPLITUDE)
let toneOffset = 0
let inputCallbacks = 0

const duplex = new AudioDuplex({
  sampleRate: SAMPLE_RATE,
  echoCancellation: {
    filterLength: 4,
    nlpLevel: 'normal',
    referenceDelaySamples: 0,
    diagnostics: {
      maxSamples: 2048,
    },
  },
  input: {
    channels: 1,
    onReadable(byteLength) {
      const samples = new Int16Array(this.read(byteLength))
      inputCallbacks += 1
      if (inputCallbacks % 25 === 0) {
        let peak = 0
        for (const sample of samples) {
          const magnitude = Math.abs(sample)
          if (peak < magnitude) peak = magnitude
        }
        trace(`duplex input peak=${peak} buffered output=${duplex.output.bufferedBytes}\n`)
      }
    },
  },
  output: {
    channels: 1,
    hardwareAttenuationDb: HARDWARE_ATTENUATION_DB,
    // First prove the duplex transport and lifecycle without driving an
    // attached speaker. Raise this only for an intentional audible test.
    volume: OUTPUT_VOLUME,
    onWritable(byteLength) {
      const bytes = new Uint8Array(new SharedArrayBuffer(byteLength))
      const samples = new Int16Array(bytes.buffer)
      for (let index = 0; index < samples.length; index += 1) {
        samples[index] = TONE_TABLE[toneOffset]
        toneOffset += 1
        if (toneOffset === TONE_TABLE.length) toneOffset = 0
      }
      this.write(bytes)
    },
  },
})

const amplifierVolumeRegister = readAmplifierVolumeRegister()
if (amplifierVolumeRegister !== 0xfc64)
  throw new Error(
    `AW88298 attenuation readback mismatch: expected 0xfc64, got 0x${amplifierVolumeRegister.toString(16)}`,
  )
trace(
  `AW88298 attenuation verified at -${HARDWARE_ATTENUATION_DB} dB (register 0x${amplifierVolumeRegister.toString(16)}); digital output remains zero\n`,
)

duplex.input.start()
duplex.output.start()
trace('AudioDuplex input and output started\n')

Timer.set(() => {
  const stats = duplex.stats
  const diagnostics = new Int16Array(duplex.readAecDiagnostics())
  duplex.close()
  let rawEnergy = 0
  let cleanEnergy = 0
  for (let index = 0; index < diagnostics.length; index += 3) {
    const raw = diagnostics[index]
    const reference = diagnostics[index + 1]
    const clean = diagnostics[index + 2]
    if (reference !== 0) throw new Error(`AEC reference was not post-volume silence at diagnostic sample ${index / 3}`)
    rawEnergy += raw * raw
    cleanEnergy += clean * clean
  }
  if (
    !inputCallbacks ||
    !stats.capturedFrames ||
    !stats.renderedFrames ||
    !stats.aec.enabled ||
    !stats.aec.processedFrames ||
    !stats.aec.exactReferenceFrames ||
    diagnostics.length !== 2048 * 3 ||
    rawEnergy <= 0 ||
    cleanEnergy <= 0 ||
    stats.inputOverruns !== 0 ||
    stats.aec.microphoneOverruns !== 0 ||
    stats.aec.referenceOverruns !== 0
  )
    throw new Error(`AudioDuplex did not transport audio: ${JSON.stringify(stats)}`)
  trace(`AudioDuplex smoke PASS: ${JSON.stringify(stats)}\n`)
}, 10000)
