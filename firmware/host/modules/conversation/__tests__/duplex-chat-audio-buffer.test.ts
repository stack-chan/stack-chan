import assert from 'node:assert/strict'
import test from 'node:test'
import resamplePCM16Mono from '../../testing/fakes/pcm-resampler.js'
import {
  CircularByteHistory,
  copyCircularBytes,
  INPUT_GATE_CLOSED,
  INPUT_GATE_CLOSING,
  INPUT_GATE_NO_CHANGE,
  INPUT_GATE_OPEN,
  INPUT_GATE_SHOULD_CLOSE,
  INPUT_GATE_SHOULD_OPEN,
  InputActivityGate,
  maximumSourceSamplesForOutput,
  ringReadableBytes,
  SyntheticInputProbe,
} from '../chat-audioio/duplex-chat-audio-buffer.js'

test('ringReadableBytes handles contiguous and wrapped audio', () => {
  assert.equal(ringReadableBytes(10, 4, 16), 6)
  assert.equal(ringReadableBytes(3, 12, 16), 7)
  assert.equal(ringReadableBytes(16, 12, 16), 4)
  assert.equal(ringReadableBytes(8, 8, 16), 0)
})

test('maximumSourceSamplesForOutput bounds the two realtime resampling directions', () => {
  assert.equal(maximumSourceSamplesForOutput(512, 24_000, 16_000), 768)
  assert.equal(maximumSourceSamplesForOutput(512, 8_000, 16_000), 256)
  assert.equal(maximumSourceSamplesForOutput(512, 16_000, 16_000), 512)
})

test('copyCircularBytes copies through wraparound and returns the new tail', () => {
  const source = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7])
  const target = new Uint8Array(5)
  const tail = copyCircularBytes(source, 6, target, target.length)

  assert.deepEqual(Array.from(target), [6, 7, 0, 1, 2])
  assert.equal(tail, 3)
})

test('source bound never overflows a hardware output callback while streaming', () => {
  const outputCapacitySamples = 512

  for (const sourceSampleRate of [8_000, 16_000, 24_000, 48_000]) {
    const sourceSamples = maximumSourceSamplesForOutput(outputCapacitySamples, sourceSampleRate, 16_000)
    const input = new Int16Array(sourceSamples)
    const output = new Int16Array(outputCapacitySamples)
    const state = new Int32Array(3)

    for (let chunk = 0; chunk < 12; chunk += 1) {
      for (let index = 0; index < input.length; index += 1)
        input[index] = Math.round(Math.sin(((chunk * input.length + index) * Math.PI) / 31) * 20_000)

      const outputSamples = resamplePCM16Mono(
        input.buffer,
        0,
        input.length,
        output.buffer,
        sourceSampleRate,
        16_000,
        state,
      )
      assert.ok(outputSamples <= outputCapacitySamples, `${sourceSampleRate} Hz produced ${outputSamples} samples`)
    }
  }
})

test('input activity gate opens on speech and closes after its silence hangover', () => {
  const gate = new InputActivityGate(120, 320, 800)

  assert.equal(gate.update(40, 160, INPUT_GATE_CLOSED), INPUT_GATE_NO_CHANGE)
  assert.equal(gate.update(180, 160, INPUT_GATE_CLOSED), INPUT_GATE_NO_CHANGE)
  assert.equal(gate.update(180, 160, INPUT_GATE_CLOSED), INPUT_GATE_SHOULD_OPEN)
  assert.equal(gate.update(30, 400, INPUT_GATE_OPEN), INPUT_GATE_NO_CHANGE)
  assert.equal(gate.update(30, 399, INPUT_GATE_OPEN), INPUT_GATE_NO_CHANGE)
  assert.equal(gate.update(30, 1, INPUT_GATE_OPEN), INPUT_GATE_SHOULD_CLOSE)
  assert.equal(gate.opens, 1)
  assert.equal(gate.closes, 1)
  assert.equal(gate.maxLevel, 180)
})

test('input activity gate can reopen while the transport drains its hangover', () => {
  const gate = new InputActivityGate(120, 320, 800)

  assert.equal(gate.update(200, 320, INPUT_GATE_CLOSING), INPUT_GATE_SHOULD_OPEN)
  assert.equal(gate.update(20, 800, INPUT_GATE_OPEN), INPUT_GATE_SHOULD_CLOSE)
  gate.reset()
  assert.equal(gate.opens, 0)
  assert.equal(gate.closes, 0)
  assert.equal(gate.maxLevel, 0)
})

test('input activity gate rejects a short level transient', () => {
  const gate = new InputActivityGate(120, 320, 800)

  assert.equal(gate.update(500, 160, INPUT_GATE_CLOSED), INPUT_GATE_NO_CHANGE)
  assert.equal(gate.update(30, 160, INPUT_GATE_CLOSED), INPUT_GATE_NO_CHANGE)
  assert.equal(gate.opens, 0)
  assert.equal(gate.rejectedAttacks, 1)
})

test('circular byte history drains the newest bytes in chronological order', () => {
  const history = new CircularByteHistory(6)
  const chunks: number[] = []

  history.append(Uint8Array.from([1, 2, 3, 4]))
  history.append(Uint8Array.from([5, 6, 7, 8]))
  history.drain((buffer, byteOffset, byteLength) => {
    chunks.push(...new Uint8Array(buffer, byteOffset, byteLength))
  })

  assert.deepEqual(chunks, [3, 4, 5, 6, 7, 8])
  assert.equal(history.length, 0)

  history.append(Uint8Array.from([9, 10, 11, 12, 13, 14, 15]))
  const replaced: number[] = []
  history.drain((buffer, byteOffset, byteLength) => {
    replaced.push(...new Uint8Array(buffer, byteOffset, byteLength))
  })
  assert.deepEqual(replaced, [10, 11, 12, 13, 14, 15])
})

test('synthetic input probe is bounded, voiced, and chunk independent', () => {
  const probe = new SyntheticInputProbe(16_000, 250, 4_000)
  const samples: number[] = []
  for (const chunkSize of [127, 512, 31, 2048, 4096]) {
    if (probe.done) break
    const chunk = new Int16Array(chunkSize)
    const written = probe.fill(chunk)
    samples.push(...chunk.subarray(0, written))
  }

  while (!probe.done) {
    const chunk = new Int16Array(333)
    const written = probe.fill(chunk)
    samples.push(...chunk.subarray(0, written))
  }

  const peak = Math.max(...samples.map(Math.abs))
  const meanAbsolute = samples.reduce((sum, sample) => sum + Math.abs(sample), 0) / samples.length
  assert.equal(samples.length, 4_000)
  assert.ok(peak <= 4_000)
  assert.ok(peak >= 3_900)
  assert.ok(meanAbsolute > 1_000)
  assert.equal(probe.fill(new Int16Array(32)), 0)
})
