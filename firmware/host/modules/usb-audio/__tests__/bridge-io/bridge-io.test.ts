import startUsbAudioBridge, {
  type UsbAudioBridgeControl,
  type UsbAudioMicrophoneInputFactory,
  type UsbAudioSpeakerOutput,
  type UsbAudioSpeakerOutputFactory,
} from 'stackchan-usb-audio-core'
import {
  crc32,
  decodeStackChanFrame,
  encodeStackChanFrame,
  STACKCHAN_CAPABILITIES,
  STACKCHAN_MAX_PAYLOAD_BYTES,
  StackChanCapability,
  StackChanControl,
  StackChanErrorCode,
  StackChanFrameType,
  StackChanStatus,
} from 'stackchan-usb-protocol'
import { assert, equal } from 'testing/assert'
import FakeUSBSerial from 'testing/usb-serial'

const unusedMicrophoneFactory: UsbAudioMicrophoneInputFactory = () => {
  throw new Error('microphone should not be opened')
}
const unusedSpeakerFactory: UsbAudioSpeakerOutputFactory = () => {
  throw new Error('speaker should not be opened')
}

class FakeSpeakerOutput implements UsbAudioSpeakerOutput {
  volume = 1
  readonly bufferedBytes = 0
  readonly physicalWrittenBytes = 0
  readonly physicalWritableBytes = 0
  readonly physicalWritableCallbacks = 0
  readonly physicalMaxWritableGapMilliseconds = 0
  readonly physicalAudioActive = false
  readonly physicalAwaitingDrain = false

  start(): void {}
  poll(): void {}
  write(): void {}
  finish(): void {}
  stop(): void {}
  close(): void {}
}

function hello(capabilities = STACKCHAN_CAPABILITIES): Uint8Array {
  const payload = new Uint8Array(8)
  const view = new DataView(payload.buffer)
  view.setUint32(0, STACKCHAN_MAX_PAYLOAD_BYTES, true)
  view.setUint32(4, capabilities, true)
  return encodeStackChanFrame({
    type: StackChanFrameType.CONTROL,
    flags: StackChanControl.HELLO,
    sequence: 0,
    payload,
  })
}

function status(value: StackChanStatus): Uint8Array {
  return encodeStackChanFrame({
    type: StackChanFrameType.CONTROL,
    flags: StackChanControl.STATUS,
    sequence: 1,
    payload: Uint8Array.of(value),
  })
}

function speakerControl(control: StackChanControl, sequence: number): Uint8Array {
  return encodeStackChanFrame({
    type: StackChanFrameType.CONTROL,
    flags: control,
    streamId: 1,
    sequence,
    sampleRate: 24_000,
    payload: new Uint8Array(0),
  })
}

function speakerPcm(): Uint8Array {
  return encodeStackChanFrame({
    type: StackChanFrameType.SPEAKER_PCM,
    flags: 0,
    streamId: 1,
    sequence: 0,
    sampleRate: 24_000,
    payload: Uint8Array.of(0, 0),
  })
}

function concatenate(...parts: Uint8Array[]): Uint8Array {
  const combined = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    combined.set(part, offset)
    offset += part.byteLength
  }
  return combined
}

function startWithFakeSerial(
  options: { speakerVolume?: number; createSpeakerOutput?: UsbAudioSpeakerOutputFactory } = {},
): {
  bridge: UsbAudioBridgeControl
  serial: FakeUSBSerial
  transportStates: string[]
} {
  let serial: FakeUSBSerial | undefined
  const bridge = startUsbAudioBridge({
    speakerVolume: options.speakerVolume,
    createMicrophoneInput: unusedMicrophoneFactory,
    createSpeakerOutput: options.createSpeakerOutput ?? unusedSpeakerFactory,
    createUSBSerial(options) {
      serial = new FakeUSBSerial(options)
      return serial
    },
    checksum: crc32,
  })
  if (!serial) throw new Error('bridge should create USB serial')
  const transportStates: string[] = []
  bridge.setTransportStateHandler((state) => transportStates.push(state))
  return { bridge, serial, transportStates }
}

function testDynamicSpeakerVolume(): void {
  let output: FakeSpeakerOutput | undefined
  const { bridge, serial } = startWithFakeSerial({
    speakerVolume: 0.25,
    createSpeakerOutput: () => {
      output = new FakeSpeakerOutput()
      return output
    },
  })

  bridge.setSpeakerVolume(0.4)
  serial.enqueue(
    concatenate(
      hello(),
      speakerControl(StackChanControl.SPEAKER_START, 1),
      speakerPcm(),
      speakerControl(StackChanControl.SPEAKER_END, 2),
    ),
  )
  serial.notifyReadable()

  assert(output !== undefined, 'speaker end should start playback for buffered PCM')
  equal(output.volume, 0.4, 'playback should use the latest volume set before opening AudioOut')
  bridge.setSpeakerVolume(0.2)
  equal(output.volume, 0.2, 'active playback should receive runtime volume changes')
  bridge.close()
}

function testOutputFullRetry(): void {
  const { bridge, serial, transportStates } = startWithFakeSerial()
  serial.outputFull = true
  serial.enqueue(hello())
  serial.notifyReadable()

  equal(serial.writes.length, 0, 'output-full should retain the complete HELLO_ACK')
  assert(serial.writeAttempts > 0, 'HELLO_ACK should be attempted immediately')
  equal(transportStates[transportStates.length - 1], 'ready', 'HELLO should negotiate EVENT while ACK is queued')

  serial.notifyWritable()
  equal(serial.writes.length, 0, 'a failed writable retry should still retain the frame')

  serial.outputFull = false
  serial.notifyWritable()
  equal(serial.writes.length, 1, 'the retained frame should be written once')
  const response = decodeStackChanFrame(serial.writes[0])
  equal(response.type, StackChanFrameType.CONTROL, 'response should be a control frame')
  equal(response.flags, StackChanControl.HELLO_ACK, 'response should acknowledge HELLO')

  bridge.close()
  const attemptsAfterClose = serial.writeAttempts
  serial.notifyReadable()
  serial.notifyWritable()
  equal(serial.writeAttempts, attemptsAfterClose, 'stale callbacks should be ignored after close')
}

function testFatalSerialError(): void {
  const { bridge, serial, transportStates } = startWithFakeSerial()
  serial.notifyError()
  equal(serial.closed, true, 'fatal USB error should close the IO instance')
  equal(transportStates[transportStates.length - 1], 'disconnected', 'fatal USB error should disconnect the transport')

  const attemptsAfterError = serial.writeAttempts
  serial.notifyWritable()
  equal(serial.writeAttempts, attemptsAfterError, 'callbacks from a failed serial instance should be stale')
  bridge.close()
}

function testExtendedStatusWithoutPresentation(): void {
  const { bridge, serial } = startWithFakeSerial()
  const statuses: StackChanStatus[] = []
  bridge.setStatusHandler((next) => statuses.push(next))

  const peerCapabilities = STACKCHAN_CAPABILITIES & ~StackChanCapability.STATUS_EXTENDED
  serial.enqueue(concatenate(hello(peerCapabilities), status(StackChanStatus.LISTENING)))
  serial.notifyReadable()

  equal(statuses.length, 2, 'status handler should receive its initial value and the Dock update')
  equal(statuses[0], StackChanStatus.IDLE, 'status handler should receive the current value when attached')
  equal(
    statuses[1],
    StackChanStatus.LISTENING,
    'extended status should depend on the receiving Firmware capability, not the sender capability',
  )
  equal(serial.writes.length, 1, 'valid extended status should not produce an error response')
  bridge.close()
}

function testMediaAdmissionKeepsControlTransport(): void {
  let opened = 0,
    closed = 0
  const { bridge, serial } = startWithFakeSerial({
    createSpeakerOutput: () => {
      opened++
      return new (class extends FakeSpeakerOutput {
        close() {
          closed++
        }
      })()
    },
  })
  for (let cycle = 0; cycle < 100; cycle++) {
    bridge.setMediaEnabled(false)
    serial.enqueue(concatenate(hello(), speakerControl(StackChanControl.SPEAKER_START, 1)))
    serial.notifyReadable()
    equal(opened, cycle, 'inactive protocol cannot open audio')
    const last = decodeStackChanFrame(serial.writes[serial.writes.length - 1])
    equal(last.flags, StackChanControl.ERROR, 'inactive audio reports a protocol error')
    equal(last.payload?.[0], StackChanErrorCode.BUSY, 'inactive audio reports BUSY')
    equal(bridge.sendEvent('task snapshot'), 'queued', 'EVENT remains ready with media disabled')
    bridge.setMediaEnabled(true)
    serial.enqueue(
      concatenate(
        speakerControl(StackChanControl.SPEAKER_START, 2),
        speakerPcm(),
        speakerControl(StackChanControl.SPEAKER_END, 3),
      ),
    )
    serial.notifyReadable()
    equal(opened, cycle + 1, 'activation enables the next stream')
    bridge.setMediaEnabled(false)
    equal(closed, cycle + 1, 'deactivation closes the active stream')
    equal(bridge.sendEvent('stop request'), 'queued', 'media stop preserves control requests')
  }
  bridge.close()
}

trace('=== USB audio bridge IO test ===\n')
testOutputFullRetry()
testFatalSerialError()
testExtendedStatusWithoutPresentation()
testDynamicSpeakerVolume()
testMediaAdmissionKeepsControlTransport()
trace('ok\n')
