import assert from 'node:assert/strict'
import test from 'node:test'
import {
  encodeSpeakerDiagnostics,
  STACKCHAN_DIAGNOSTICS_PAYLOAD_BYTES,
  STACKCHAN_DIAGNOSTICS_VERSION,
  StackChanDiagnosticEvent,
  StackChanDiagnosticFlag,
} from './diagnostics.js'

test('speaker diagnostics use the documented fixed little-endian layout', () => {
  const payload = encodeSpeakerDiagnostics({
    event: StackChanDiagnosticEvent.SNAPSHOT,
    flags: StackChanDiagnosticFlag.AUDIO_ACTIVE | StackChanDiagnosticFlag.STARVING,
    ticks: 0x01020304,
    sampleRate: 24000,
    queuedBytes: 12000,
    writableBytes: 4092,
    receivedBytes: 96000,
    writtenBytes: 84000,
    receivedFrames: 100,
    writableCallbacks: 21,
    starvationEvents: 2,
    maxReceiveGapMilliseconds: 23,
    maxWritableGapMilliseconds: 88,
    txQueueBytes: 152,
  })

  assert.equal(payload.byteLength, STACKCHAN_DIAGNOSTICS_PAYLOAD_BYTES)
  const view = new DataView(payload.buffer)
  assert.equal(view.getUint8(0), STACKCHAN_DIAGNOSTICS_VERSION)
  assert.equal(view.getUint8(1), StackChanDiagnosticEvent.SNAPSHOT)
  assert.equal(view.getUint16(2, true), StackChanDiagnosticFlag.AUDIO_ACTIVE | StackChanDiagnosticFlag.STARVING)
  assert.equal(view.getUint32(4, true), 0x01020304)
  assert.equal(view.getUint32(8, true), 24000)
  assert.equal(view.getUint32(12, true), 12000)
  assert.equal(view.getUint32(16, true), 4092)
  assert.equal(view.getUint32(20, true), 96000)
  assert.equal(view.getUint32(24, true), 84000)
  assert.equal(view.getUint32(28, true), 100)
  assert.equal(view.getUint32(32, true), 21)
  assert.equal(view.getUint32(36, true), 2)
  assert.equal(view.getUint32(40, true), 23)
  assert.equal(view.getUint32(44, true), 88)
  assert.equal(view.getUint32(48, true), 152)
})
