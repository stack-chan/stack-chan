import startUsbAudioBridge, {
  type UsbAudioBridgeControl,
  type UsbAudioMicrophoneInputFactory,
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
  StackChanFrameType,
  StackChanStatus,
} from 'stackchan-usb-protocol'
import { type USBSerialIO, type USBSerialOptions, USBSerialOutputFullError } from 'stackchan-usb-serial-types'
import { assert, equal } from 'testing/assert'

class FakeUSBSerial implements USBSerialIO {
  connected = true
  format: 'buffer' = 'buffer'
  readonly writes: Uint8Array[] = []
  writeAttempts = 0
  outputFull = false
  closed = false
  #options: USBSerialOptions
  #incoming = new Uint8Array(0)

  constructor(options: USBSerialOptions) {
    this.#options = options
  }

  enqueue(bytes: Uint8Array): void {
    const combined = new Uint8Array(this.#incoming.byteLength + bytes.byteLength)
    combined.set(this.#incoming)
    combined.set(bytes, this.#incoming.byteLength)
    this.#incoming = combined
  }

  notifyReadable(): void {
    this.#options.onReadable?.call(this, this.#incoming.byteLength)
  }

  notifyWritable(): void {
    this.#options.onWritable?.call(this)
  }

  notifyError(): void {
    this.#options.onError?.call(this)
  }

  read(): ArrayBuffer | undefined
  read(maximumBytes: number): ArrayBuffer | undefined
  read(target: Uint8Array): number | undefined
  read(target?: number | Uint8Array): ArrayBuffer | number | undefined {
    if (this.closed) throw new Error('closed')
    if (this.#incoming.byteLength === 0) return
    const maximum =
      target instanceof Uint8Array ? target.byteLength : typeof target === 'number' ? target : this.#incoming.byteLength
    const count = Math.min(maximum, this.#incoming.byteLength)
    const bytes = this.#incoming.slice(0, count)
    this.#incoming = this.#incoming.slice(count)
    if (target instanceof Uint8Array) {
      target.set(bytes)
      return count
    }
    return bytes.buffer
  }

  write(source: Uint8Array): void {
    if (this.closed) throw new Error('closed')
    this.writeAttempts += 1
    if (this.outputFull) throw new USBSerialOutputFullError()
    this.writes.push(source.slice())
  }

  close(): void {
    this.closed = true
  }
}

const unusedMicrophoneFactory: UsbAudioMicrophoneInputFactory = () => {
  throw new Error('microphone should not be opened')
}
const unusedSpeakerFactory: UsbAudioSpeakerOutputFactory = () => {
  throw new Error('speaker should not be opened')
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

function concatenate(...parts: Uint8Array[]): Uint8Array {
  const combined = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    combined.set(part, offset)
    offset += part.byteLength
  }
  return combined
}

function startWithFakeSerial(): {
  bridge: UsbAudioBridgeControl
  serial: FakeUSBSerial
  transportStates: string[]
} {
  let serial: FakeUSBSerial | undefined
  const bridge = startUsbAudioBridge({
    createMicrophoneInput: unusedMicrophoneFactory,
    createSpeakerOutput: unusedSpeakerFactory,
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

trace('=== USB audio bridge IO test ===\n')
testOutputFullRetry()
testFatalSerialError()
testExtendedStatusWithoutPresentation()
trace('ok\n')
