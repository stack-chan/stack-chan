import AudioOutput from 'embedded:io/audio/out'
import type { AudioStreamAccess } from 'audio-ports'
import Modules from 'modules'
import { StackchanError } from 'stackchan/errors'
import startBridge, { type UsbAudioBridgeControl } from 'stackchan-usb-audio'
import {
  decodeStackChanFrame,
  encodeStackChanFrame,
  STACKCHAN_CAPABILITIES,
  STACKCHAN_MAX_PAYLOAD_BYTES,
  StackChanControl,
  StackChanFrameType,
} from 'stackchan-usb-protocol'
import Serial from 'stackchan-usb-serial'
import { assert, equal } from 'testing/assert'
import WorkerFake from 'worker'

const AudioFake = AudioOutput as unknown as typeof import('./audio-fake').default
type Bridge = UsbAudioBridgeControl & { activateAudio(audio: AudioStreamAccess): () => void }
try {
  const bridge = startBridge() as Bridge
  const worker = WorkerFake.current
  let occupied = false,
    releases = 0,
    failure: unknown
  const access: AudioStreamAccess = {
    reserveStream(input, output) {
      assert(input && output, 'USB owns both audio directions')
      if (failure) throw failure
      if (occupied) throw new StackchanError('BUSY', 'audio is in use')
      occupied = true
      return () => {
        occupied = false
        releases++
      }
    },
    failStream(error) {
      failure = error
    },
  }
  let events = 0
  bridge.setEventHandler(() => events++)
  worker.emit({ id: 'event', event: 'task snapshot' })
  equal(events, 1, 'control events remain available before activation')
  const open = (generation: number, id = 'audio-open') =>
    worker.emit({
      id,
      generation,
      streamId: 7,
      sampleRate: 16000,
      channels: 1,
      bitsPerSample: 16,
    })
  open(0)
  equal(AudioFake.instances.length, 0, 'inactive bridge cannot open a device')
  for (let cycle = 0; cycle < 100; cycle++) {
    const release = bridge.activateAudio(access)
    const generation = worker.generation
    equal(occupied, true, 'audio admission held throughout activation')
    let busy = false
    try {
      bridge.activateAudio(access)
    } catch (error) {
      busy = error.code === 'BUSY'
    }
    assert(busy, 'second activation rejected')
    open(generation, cycle % 2 ? 'microphone-open' : 'audio-open')
    equal(AudioFake.instances.length, cycle + 1, 'one device opened')
    const device = AudioFake.instances[AudioFake.instances.length - 1]
    open(generation - 1)
    equal(AudioFake.instances.length, cycle + 1, 'old open ignored')
    worker.emit({ id: cycle % 2 ? 'microphone-close' : 'audio-close', generation: generation - 1, streamId: 7 })
    equal(device.closed, false, 'old close cannot stop a new stream with the same ID')
    release()
    release()
    equal(device.closed, true, 'native device closed before reservation release')
    equal(occupied, false, 'audio available after close')
    equal(releases, cycle + 1, 'reservation released once')
    open(generation)
    equal(AudioFake.instances.length, cycle + 1, 'late open cannot reopen an inactive bridge')
  }
  const release = bridge.activateAudio(access)
  open(worker.generation)
  worker.emit({ id: 'audio-start', generation: worker.generation, streamId: 7 })
  worker.emit({ id: 'audio-end', generation: worker.generation, streamId: 7 })
  AudioFake.failClose = true
  const finalOutput = AudioFake.instances[AudioFake.instances.length - 1]
  const writable = finalOutput.options.onWritable
  if (!writable) throw new Error('Output callback was not installed')
  for (let i = 0; i < 10; i++) writable.call(finalOutput, 2048)
  assert(
    worker.messages.some((message) => message.id === 'audio-failed'),
    'drain release failure reaches the worker',
  )
  assert(
    !worker.messages.some((message) => message.id === 'audio-drained'),
    'unconfirmed release cannot report playback completion',
  )
  let rejected = false
  try {
    release()
  } catch {
    rejected = true
  }
  assert(rejected && failure, 'native close failure is surfaced and latches the shared audio owner')
  let reopenFailed = false
  try {
    bridge.activateAudio(access)
  } catch {
    reopenFailed = true
  }
  assert(reopenFailed, 'unconfirmed release prevents another activation')
  AudioFake.failClose = false
  try {
    bridge.close()
  } catch {}
  const count = AudioFake.instances.length
  open(worker.generation)
  worker.emit({ id: 'event', event: 'late' })
  equal(AudioFake.instances.length, count, 'host close blocks late physical requests')
  equal(events, 1, 'host close blocks late control callbacks')
  // Execute the real worker routing and protocol in XS with queued messages,
  // independently of the main-thread admission assertions above.
  const messages: Record<string, unknown>[] = []
  let workerClosed = false
  const workerSelf = {
    onmessage: undefined as ((message: Record<string, unknown>) => void) | undefined,
    postMessage(message: Record<string, unknown>) {
      messages.push(message)
    },
    close() {
      workerClosed = true
    },
  }
  ;(globalThis as { self?: unknown }).self = workerSelf
  Modules.importNow('stackchan-usb-audio-worker')
  const send = workerSelf.onmessage
  if (!send) throw new Error('Worker receiver was not installed')
  send(worker.messages[0])
  const serial = Serial.current
  const payload = new Uint8Array(8)
  new DataView(payload.buffer).setUint32(0, STACKCHAN_MAX_PAYLOAD_BYTES, true)
  new DataView(payload.buffer).setUint32(4, STACKCHAN_CAPABILITIES, true)
  serial.enqueue(
    encodeStackChanFrame({ type: StackChanFrameType.CONTROL, flags: StackChanControl.HELLO, sequence: 0, payload }),
  )
  serial.notifyReadable()
  const microphoneStart = (streamId: number) => {
    serial.enqueue(
      encodeStackChanFrame({
        type: StackChanFrameType.CONTROL,
        flags: StackChanControl.MIC_START,
        sequence: 1,
        streamId,
        sampleRate: 16000,
      }),
    )
    serial.notifyReadable()
  }
  microphoneStart(1)
  equal(messages.filter((message) => message.id === 'microphone-open').length, 0, 'worker starts with media disabled')
  send({ id: 'media-state', generation: 1, enabled: true })
  microphoneStart(1)
  const opened = messages.filter((message) => message.id === 'microphone-open').at(-1)
  if (!opened) throw new Error('Worker did not request an input')
  equal(opened.generation, 1, 'worker stamps the activation generation on requests')
  const writes = serial.writes.length
  send({ id: 'microphone-started', streamId: 1, generation: 0 })
  equal(serial.writes.length, writes, 'worker ignores native ACK from an old generation')
  send({ id: 'microphone-started', streamId: 1, generation: 1 })
  equal(
    decodeStackChanFrame(serial.writes[serial.writes.length - 1]).flags,
    StackChanControl.MIC_STARTED,
    'matching ACK reaches the protocol',
  )
  send({ id: 'media-state', generation: 2, enabled: false })
  equal(
    messages.filter((message) => message.id === 'microphone-close').at(-1)?.generation,
    1,
    'old input closes with its original generation',
  )
  send({ id: 'send-event', requestId: 42, event: 'stop request' })
  equal(
    messages.filter((message) => message.requestId === 42).at(-1)?.result,
    'queued',
    'control transport survives deactivation',
  )
  send({ id: 'media-state', generation: 3, enabled: true })
  microphoneStart(2)
  equal(
    messages.filter((message) => message.id === 'microphone-open').at(-1)?.generation,
    3,
    'replacement input uses the new generation',
  )
  send({ id: 'close' })
  equal(workerClosed, true, 'worker closes its protocol and transport')
  trace('USB worker ownership: 100 activation replacements and release failure passed\n')
  trace('ok\n')
} catch (error) {
  trace(`USB worker lifecycle failed: ${String(error)}\n`)
  throw error
}
