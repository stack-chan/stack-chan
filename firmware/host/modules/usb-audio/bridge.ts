import AudioIn from 'embedded:io/audio/in'
import { encodeSpeakerDiagnostics, StackChanDiagnosticEvent, StackChanDiagnosticFlag } from 'stackchan-usb-diagnostics'
import {
  encodeStackChanFrame,
  STACKCHAN_CAPABILITIES,
  STACKCHAN_MAX_PAYLOAD_BYTES,
  StackChanCapability,
  StackChanControl,
  StackChanErrorCode,
  type StackChanFrame,
  StackChanFrameParser,
  StackChanFrameType,
  StackChanStatus,
} from 'stackchan-usb-protocol'
import { closeUsbSerial, crc32UsbSerial, openUsbSerial, readUsbSerial, writeUsbSerial } from 'stackchan-usb-serial'
import { SpeakerPlaybackBuffer } from 'stackchan-usb-speaker-buffer'
import { SpeakerSessionGuard, SpeakerSessionResult } from 'stackchan-usb-speaker-session'
import { StreamTxQueue } from 'stackchan-usb-stream-tx-queue'
import TextDecoder from 'text/decoder'
import Time from 'time'
import Timer from 'timer'

const MICROPHONE_SAMPLE_RATE = 16000
const BITS_PER_SAMPLE = 16
const CHANNELS = 1
const PCM_FRAME_MILLISECONDS = 20
const MICROPHONE_FRAME_BYTES = (MICROPHONE_SAMPLE_RATE * 2 * PCM_FRAME_MILLISECONDS) / 1000
const SPEAKER_BUFFER_MILLISECONDS = 1000
const SPEAKER_PREBUFFER_MILLISECONDS = 500
// Drain half of the native 32 KiB RX ring at once and retain enough room for
// another complete credited PCM burst, including frame headers.
// The RX ring is configured in usb-serial.c and cannot share this XS constant;
// the device burst diagnostic is the cross-language invariant check.
const USB_RX_READ_BYTES = 16 * 1024
const SPEAKER_CREDIT_WINDOW_BYTES = 8 * 1024
const MAX_USB_RX_READS_PER_POLL = 4
const MAX_CAPTION_BYTES = 1024
const MAX_QUEUED_CAPTIONS = 16
const POLL_MILLISECONDS = 2
const MAX_TX_QUEUE_BYTES = 16 * 1024
const DIAGNOSTIC_INTERVAL_MILLISECONDS = 100

type AudioInput = InstanceType<typeof AudioIn>

export type UsbAudioSpeakerOutputOptions = {
  streamId: number
  sampleRate: number
  channels: number
  bitsPerSample: number
  onWritable(this: UsbAudioSpeakerOutput, size: number): void
  onDrained(this: UsbAudioSpeakerOutput): void
  onError(this: UsbAudioSpeakerOutput): void
}

export type UsbAudioSpeakerOutput = {
  volume: number
  readonly bufferedBytes: number
  readonly physicalWrittenBytes: number
  readonly physicalWritableBytes: number
  readonly physicalWritableCallbacks: number
  readonly physicalMaxWritableGapMilliseconds: number
  readonly physicalAudioActive: boolean
  readonly physicalAwaitingDrain: boolean
  start(): void
  poll(): void
  write(payload: Uint8Array): void
  finish(): void
  stop(): void
  close(): void
}

export type UsbAudioSpeakerOutputFactory = (options: UsbAudioSpeakerOutputOptions) => UsbAudioSpeakerOutput

export type UsbAudioPresentation = {
  onStatusChanged(status: StackChanStatus): void
  onPlaybackStarted(): void
  onPlaybackPower(power: number): void
  onPlaybackText(text: string): void
  onPlaybackStopped(): void
}

export type UsbAudioBridgeControl = {
  setPresentation(presentation?: UsbAudioPresentation): void
  close(): void
}

export type UsbAudioBridgeOptions = {
  speakerVolume?: number
  diagnostics?: boolean
  createSpeakerOutput?: UsbAudioSpeakerOutputFactory
}

class UsbAudioBridge implements UsbAudioBridgeControl {
  readonly #speakerVolume: number
  readonly #diagnosticsEnabled: boolean
  readonly #createSpeakerOutput: UsbAudioSpeakerOutputFactory
  #parser = new StackChanFrameParser(crc32UsbSerial)
  #textDecoder = new TextDecoder('utf-8', { fatal: true })
  #readBuffer = new Uint8Array(USB_RX_READ_BYTES)
  #timer: ReturnType<typeof Timer.repeat> | undefined
  #txQueue = new StreamTxQueue(MAX_TX_QUEUE_BYTES)
  #controlSequence = 0
  #diagnosticSequence = 0
  #microphoneSequence = 0
  #microphoneStreamId = 0
  #speakerExpectedSequence = 0
  #speakerSession = new SpeakerSessionGuard()
  #microphone: AudioInput | undefined
  #microphonePending = new Uint8Array(0)
  #speaker: UsbAudioSpeakerOutput | undefined
  #speakerRate = 0
  #speakerCapacity = 0
  #speakerCreditOutstanding = 0
  #speakerBuffer = new SpeakerPlaybackBuffer()
  #speakerEnded = false
  #speakerAwaitingDrain = false
  #presentation: UsbAudioPresentation | undefined
  #presentationActive = false
  #presentationPower = 0
  #presentationText = ''
  #presentationStatus = StackChanStatus.IDLE
  #speakerDiagnosticLastSnapshotTicks = 0
  #speakerDiagnosticLastReceiveTicks = 0
  #speakerReceivedBytes = 0
  #speakerWrittenBytes = 0
  #speakerReceivedFrames = 0
  #speakerStarvationEvents = 0
  #speakerMaxReceiveGapMilliseconds = 0
  #speakerStarving = false

  constructor(options: UsbAudioBridgeOptions = {}) {
    const speakerVolume = options.speakerVolume ?? 1
    if (!Number.isFinite(speakerVolume) || speakerVolume < 0 || speakerVolume > 1) {
      throw new RangeError('speaker volume must be between 0 and 1')
    }
    this.#speakerVolume = speakerVolume
    this.#diagnosticsEnabled = options.diagnostics === true
    if (!options.createSpeakerOutput) throw new TypeError('speaker output factory is required')
    this.#createSpeakerOutput = options.createSpeakerOutput
  }

  start(): void {
    if (this.#timer) return
    openUsbSerial()
    this.#timer = Timer.repeat(() => this.#poll(), POLL_MILLISECONDS)
  }

  setPresentation(presentation?: UsbAudioPresentation): void {
    if (this.#presentation === presentation) return
    if (this.#presentationActive) this.#notifyPresentation(this.#presentation, 'onPlaybackStopped')
    if (this.#presentationStatus !== StackChanStatus.IDLE) {
      this.#notifyPresentation(this.#presentation, 'onStatusChanged', StackChanStatus.IDLE)
    }
    this.#presentation = presentation
    if (!presentation) return
    this.#notifyPresentation(presentation, 'onStatusChanged', this.#presentationStatus)
    if (this.#presentationActive) {
      this.#notifyPresentation(presentation, 'onPlaybackStarted')
      if (this.#presentationText) this.#notifyPresentation(presentation, 'onPlaybackText', this.#presentationText)
      this.#notifyPresentation(presentation, 'onPlaybackPower', this.#presentationPower)
    }
  }

  close(): void {
    if (this.#timer) Timer.clear(this.#timer)
    this.#timer = undefined
    this.#stopMicrophone(false)
    this.#stopSpeaker(false)
    this.#setPresentationStatus(StackChanStatus.IDLE)
    this.#txQueue.clear()
    this.#parser.reset()
    closeUsbSerial()
  }

  #poll(): void {
    try {
      this.#pumpTx()
      for (let reads = 0; reads < MAX_USB_RX_READS_PER_POLL; reads += 1) {
        const count = readUsbSerial(this.#readBuffer)
        if (count <= 0) break
        for (const frame of this.#parser.push(this.#readBuffer.slice(0, count))) this.#handleFrame(frame)
        this.#pumpTx()
      }
      this.#pumpTx()
      this.#maybeStartSpeaker()
      this.#speaker?.poll()
      this.#refreshSpeakerCredit()
      this.#maybeSendSpeakerDiagnosticSnapshot()
    } catch (error) {
      trace(`[usb-audio] ${error instanceof Error ? error.message : String(error)}\n`)
      this.#stopMicrophone(false)
      this.#stopSpeaker(false)
      this.#parser.reset()
    }
  }

  #pumpTx(): void {
    while (this.#txQueue.remainingBytes > 0) {
      const current = this.#txQueue.current()
      if (!current) return
      const written = writeUsbSerial(current)
      if (written <= 0) return
      this.#txQueue.advance(written)
    }
  }

  #send(frame: StackChanFrame): boolean {
    const encoded = encodeStackChanFrame(frame, crc32UsbSerial)
    return this.#txQueue.enqueue(
      encoded,
      frame.type,
      frame.type === StackChanFrameType.CONTROL ? (frame.flags ?? 0) : 0,
      frame.streamId ?? 0,
    )
  }

  #sendControl(control: StackChanControl, sampleRate = 0, payload?: Uint8Array, streamId = 0): boolean {
    return this.#send({
      type: StackChanFrameType.CONTROL,
      flags: control,
      streamId,
      sequence: this.#controlSequence++,
      sampleRate,
      payload,
    })
  }

  #sendError(code: StackChanErrorCode, streamId = 0): void {
    const payload = new Uint8Array(4)
    new DataView(payload.buffer).setUint32(0, code, true)
    this.#sendControl(StackChanControl.ERROR, 0, payload, streamId)
  }

  #handleFrame(frame: StackChanFrame): void {
    if (frame.type === StackChanFrameType.CONTROL) {
      this.#handleControl(frame)
      return
    }
    if (frame.type === StackChanFrameType.SPEAKER_PCM) this.#handleSpeakerPcm(frame)
  }

  #handleControl(frame: StackChanFrame): void {
    switch (frame.flags) {
      case StackChanControl.HELLO:
        this.#handleHello(frame)
        break
      case StackChanControl.MIC_START:
        this.#handleMicrophoneStart(frame)
        break
      case StackChanControl.MIC_STOP:
        this.#handleMicrophoneStop(frame)
        break
      case StackChanControl.SPEAKER_START:
        this.#startSpeaker(frame)
        break
      case StackChanControl.SPEAKER_END:
        this.#endSpeaker(frame)
        break
      case StackChanControl.SPEAKER_ABORT:
        this.#abortSpeaker(frame)
        break
      case StackChanControl.SPEAKER_TEXT:
        this.#handleSpeakerText(frame)
        break
      case StackChanControl.STATUS:
        this.#handleStatus(frame)
        break
      default:
        this.#sendError(StackChanErrorCode.INVALID_REQUEST, frame.streamId ?? 0)
    }
  }

  #handleHello(frame: StackChanFrame): void {
    if ((frame.streamId ?? 0) !== 0 || frame.payload?.byteLength !== 8) {
      this.#sendError(StackChanErrorCode.INVALID_REQUEST)
      return
    }
    const request = new DataView(frame.payload.buffer, frame.payload.byteOffset, frame.payload.byteLength)
    const peerMaxPayload = request.getUint32(0, true)
    const peerCapabilities = request.getUint32(4, true)
    if (peerMaxPayload < MICROPHONE_FRAME_BYTES || (peerCapabilities & StackChanCapability.STREAM_ID) === 0) {
      this.#sendError(StackChanErrorCode.INVALID_REQUEST)
      return
    }
    this.#stopMicrophone(false)
    this.#stopSpeaker(false)
    this.#setPresentationStatus(StackChanStatus.IDLE)
    const payload = new Uint8Array(8)
    const response = new DataView(payload.buffer)
    response.setUint32(0, Math.min(peerMaxPayload, STACKCHAN_MAX_PAYLOAD_BYTES), true)
    const capabilities = STACKCHAN_CAPABILITIES | (this.#diagnosticsEnabled ? StackChanCapability.DIAGNOSTICS : 0)
    response.setUint32(4, capabilities, true)
    this.#sendControl(StackChanControl.HELLO_ACK, 0, payload)
  }

  #handleMicrophoneStart(frame: StackChanFrame): void {
    const streamId = frame.streamId ?? 0
    const payloadBytes = frame.payload?.byteLength ?? 0
    if (streamId === 0 || frame.sampleRate !== MICROPHONE_SAMPLE_RATE || payloadBytes !== 0) {
      this.#sendError(StackChanErrorCode.INVALID_STREAM_DATA, streamId)
      return
    }
    if (this.#speakerSession.active) {
      this.#sendError(StackChanErrorCode.BUSY, streamId)
      return
    }
    if (this.#microphone) {
      if (streamId === this.#microphoneStreamId) {
        this.#sendControl(StackChanControl.MIC_STARTED, MICROPHONE_SAMPLE_RATE, undefined, streamId)
      } else {
        this.#sendError(StackChanErrorCode.BUSY, streamId)
      }
      return
    }
    this.#startMicrophone(streamId)
  }

  #handleMicrophoneStop(frame: StackChanFrame): void {
    const streamId = frame.streamId ?? 0
    if (streamId !== this.#microphoneStreamId) return
    if (frame.sampleRate !== MICROPHONE_SAMPLE_RATE || (frame.payload?.byteLength ?? 0) !== 0) {
      this.#sendError(StackChanErrorCode.INVALID_STREAM_DATA, streamId)
      return
    }
    this.#stopMicrophone(true)
  }

  #startMicrophone(streamId: number): void {
    this.#microphoneStreamId = streamId
    this.#microphoneSequence = 0
    this.#microphonePending = new Uint8Array(0)
    const bridge = this
    try {
      this.#microphone = new AudioIn({
        sampleRate: MICROPHONE_SAMPLE_RATE,
        channels: CHANNELS,
        bitsPerSample: BITS_PER_SAMPLE,
        onReadable(size: number) {
          const bytes = new Uint8Array(size)
          this.read(bytes)
          bridge.#acceptMicrophoneBytes(bytes)
        },
      })
      this.#microphone.start()
      this.#sendControl(StackChanControl.MIC_STARTED, MICROPHONE_SAMPLE_RATE, undefined, streamId)
    } catch {
      this.#sendError(StackChanErrorCode.AUDIO_OUTPUT, streamId)
      this.#stopMicrophone(false)
    }
  }

  #handleStatus(frame: StackChanFrame): void {
    const payload = frame.payload ?? new Uint8Array(0)
    const status = payload[0]
    if (
      (frame.sampleRate ?? 0) !== 0 ||
      (frame.streamId ?? 0) !== 0 ||
      payload.byteLength !== 1 ||
      status < StackChanStatus.IDLE ||
      status > StackChanStatus.SPEAKING
    ) {
      this.#sendError(StackChanErrorCode.INVALID_REQUEST, frame.streamId ?? 0)
      return
    }
    this.#setPresentationStatus(status as StackChanStatus)
  }

  #acceptMicrophoneBytes(bytes: Uint8Array): void {
    const combined = new Uint8Array(this.#microphonePending.byteLength + bytes.byteLength)
    combined.set(this.#microphonePending)
    combined.set(bytes, this.#microphonePending.byteLength)
    let offset = 0
    while (combined.byteLength - offset >= MICROPHONE_FRAME_BYTES) {
      const sent = this.#send({
        type: StackChanFrameType.MICROPHONE_PCM,
        streamId: this.#microphoneStreamId,
        sequence: this.#microphoneSequence++,
        sampleRate: MICROPHONE_SAMPLE_RATE,
        payload: combined.slice(offset, offset + MICROPHONE_FRAME_BYTES),
      })
      if (!sent) {
        this.#sendError(StackChanErrorCode.TRANSPORT_OVERFLOW, this.#microphoneStreamId)
        this.#stopMicrophone(false)
        return
      }
      offset += MICROPHONE_FRAME_BYTES
    }
    this.#microphonePending = combined.slice(offset)
  }

  #stopMicrophone(notify: boolean): void {
    const streamId = this.#microphoneStreamId
    this.#microphone?.close()
    this.#microphone = undefined
    this.#microphonePending = new Uint8Array(0)
    this.#microphoneStreamId = 0
    if (notify && streamId) this.#sendControl(StackChanControl.MIC_STOPPED, MICROPHONE_SAMPLE_RATE, undefined, streamId)
  }

  #startSpeaker(frame: StackChanFrame): void {
    const streamId = frame.streamId ?? 0
    const sampleRate = frame.sampleRate ?? 0
    if (this.#microphone) {
      this.#sendError(StackChanErrorCode.BUSY, streamId)
      return
    }
    const result = this.#speakerSession.start(streamId, sampleRate, frame.payload?.byteLength ?? 0)
    if (result === SpeakerSessionResult.IDEMPOTENT) return
    if (result === SpeakerSessionResult.BUSY) {
      this.#sendError(StackChanErrorCode.BUSY, streamId)
      return
    }
    if (result !== SpeakerSessionResult.ACCEPTED) {
      this.#sendError(StackChanErrorCode.INVALID_STREAM_DATA, streamId)
      return
    }
    this.#speakerRate = sampleRate
    this.#speakerCapacity = (sampleRate * 2 * SPEAKER_BUFFER_MILLISECONDS) / 1000
    this.#speakerCreditOutstanding = 0
    this.#speakerExpectedSequence = 0
    this.#speakerEnded = false
    this.#speakerAwaitingDrain = false
    this.#resetSpeakerDiagnostics()
    this.#refreshSpeakerCredit()
    this.#sendSpeakerDiagnostics(StackChanDiagnosticEvent.SESSION_STARTED)
  }

  #endSpeaker(frame: StackChanFrame): void {
    const streamId = frame.streamId ?? 0
    const result = this.#speakerSession.end(streamId, frame.sampleRate ?? 0, frame.payload?.byteLength ?? 0)
    if (result === SpeakerSessionResult.STALE || result === SpeakerSessionResult.IDEMPOTENT) return
    if (result !== SpeakerSessionResult.ACCEPTED) {
      this.#sendError(StackChanErrorCode.INVALID_STREAM_DATA, streamId)
      return
    }
    this.#speakerEnded = true
    if (!this.#speaker && this.#speakerBuffer.pcmBytes === 0) this.#completeSpeaker()
    else {
      this.#maybeStartSpeaker()
      this.#speaker?.poll()
    }
  }

  #abortSpeaker(frame: StackChanFrame): void {
    const streamId = frame.streamId ?? 0
    const result = this.#speakerSession.abort(streamId, frame.sampleRate ?? 0, frame.payload?.byteLength ?? 0)
    if (result === SpeakerSessionResult.STALE) return
    if (result !== SpeakerSessionResult.ACCEPTED) {
      this.#sendError(StackChanErrorCode.INVALID_STREAM_DATA, streamId)
      return
    }
    this.#stopSpeaker(false)
  }

  #handleSpeakerPcm(frame: StackChanFrame): void {
    const payload = frame.payload ?? new Uint8Array(0)
    const streamId = frame.streamId ?? 0
    const validation = this.#speakerSession.validateData(streamId, frame.sampleRate ?? 0, payload.byteLength)
    if (validation === SpeakerSessionResult.STALE) return
    if (validation !== SpeakerSessionResult.ACCEPTED || payload.byteLength > this.#speakerCreditOutstanding) {
      this.#sendError(StackChanErrorCode.INVALID_STREAM_DATA, streamId)
      this.#stopSpeaker(false)
      return
    }
    if (frame.sequence !== this.#speakerExpectedSequence) {
      this.#sendError(StackChanErrorCode.SPEAKER_SEQUENCE_MISMATCH, streamId)
      this.#stopSpeaker(false)
      return
    }
    if (this.#speakerBuffer.pcmBytes + payload.byteLength > this.#speakerCapacity) {
      this.#sendError(StackChanErrorCode.SPEAKER_BUFFER_OVERFLOW, streamId)
      this.#stopSpeaker(false)
      return
    }
    this.#speakerExpectedSequence += 1
    this.#speakerCreditOutstanding -= payload.byteLength
    this.#recordSpeakerReceive(payload.byteLength)
    this.#speakerBuffer.enqueuePcm(payload)
    this.#maybeStartSpeaker()
    this.#speaker?.poll()
    this.#updateSpeakerStarvation()
    this.#refreshSpeakerCredit()
  }

  #handleSpeakerText(frame: StackChanFrame): void {
    const payload = frame.payload ?? new Uint8Array(0)
    const streamId = frame.streamId ?? 0
    const validation = this.#speakerSession.validateText(streamId, frame.sampleRate ?? 0, payload.byteLength)
    if (validation === SpeakerSessionResult.STALE) return
    if (validation !== SpeakerSessionResult.ACCEPTED || payload.byteLength > MAX_CAPTION_BYTES) {
      this.#sendError(StackChanErrorCode.INVALID_REQUEST, streamId)
      return
    }
    if (this.#speakerBuffer.captionCount >= MAX_QUEUED_CAPTIONS) {
      this.#sendError(StackChanErrorCode.CAPTION_QUEUE_OVERFLOW, streamId)
      return
    }
    try {
      const text = this.#textDecoder.decode(payload).trim()
      if (!text) {
        this.#sendError(StackChanErrorCode.INVALID_REQUEST, streamId)
        return
      }
      this.#speakerBuffer.enqueueCaption(text)
      this.#speaker?.poll()
    } catch {
      this.#sendError(StackChanErrorCode.INVALID_REQUEST, streamId)
    }
  }

  #maybeStartSpeaker(): void {
    if (this.#speaker || !this.#speakerRate) return
    const prebufferBytes = (this.#speakerRate * 2 * SPEAKER_PREBUFFER_MILLISECONDS) / 1000
    if (this.#speakerBuffer.pcmBytes < prebufferBytes && !this.#speakerEnded) return
    const bridge = this
    try {
      this.#speaker = this.#createSpeakerOutput({
        streamId: this.#speakerSession.streamId,
        sampleRate: this.#speakerRate,
        channels: CHANNELS,
        bitsPerSample: BITS_PER_SAMPLE,
        onWritable(size: number) {
          bridge.#handleSpeakerWritable(this, size)
        },
        onDrained() {
          bridge.#handleSpeakerDrained(this)
        },
        onError() {
          bridge.#handleSpeakerOutputError(this)
        },
      })
      this.#speaker.volume = this.#speakerVolume
      this.#startPresentation()
      this.#speaker.start()
      this.#sendSpeakerDiagnostics(StackChanDiagnosticEvent.AUDIO_STARTED)
    } catch {
      this.#sendError(StackChanErrorCode.AUDIO_OUTPUT, this.#speakerSession.streamId)
      this.#stopSpeaker(false)
    }
  }

  #handleSpeakerWritable(output: UsbAudioSpeakerOutput, writable: number): void {
    if (output !== this.#speaker || this.#speakerAwaitingDrain) return
    this.#speakerBuffer.setWritableBytes(writable)
    this.#drainSpeaker(output)
  }

  #handleSpeakerDrained(output: UsbAudioSpeakerOutput): void {
    if (output !== this.#speaker || !this.#speakerAwaitingDrain) return
    this.#completeSpeaker()
  }

  #handleSpeakerOutputError(output: UsbAudioSpeakerOutput): void {
    if (output !== this.#speaker) return
    this.#sendError(StackChanErrorCode.AUDIO_OUTPUT, this.#speakerSession.streamId)
    this.#stopSpeaker(false)
  }

  #drainSpeaker(output: UsbAudioSpeakerOutput): void {
    if (!output || this.#speakerAwaitingDrain) return
    const result = this.#speakerBuffer.drain(
      (payload) => output.write(payload),
      (text) => this.#showPresentationText(text),
    )
    if (result.consumedBytes > 0) {
      this.#speakerWrittenBytes += result.consumedBytes
      this.#updatePresentationPower(result.power)
    } else if (this.#speakerBuffer.pcmBytes === 0) {
      this.#updatePresentationPower(0)
    }
    if (this.#speakerEnded && this.#speakerBuffer.pcmBytes === 0) {
      this.#speakerAwaitingDrain = true
      output.finish()
    }
    this.#updateSpeakerStarvation()
    this.#refreshSpeakerCredit()
  }

  #refreshSpeakerCredit(): void {
    if (!this.#speakerRate || this.#speakerEnded) return
    const freeBytes = this.#speakerCapacity - this.#speakerBuffer.pcmBytes
    const targetOutstanding = Math.min(SPEAKER_CREDIT_WINDOW_BYTES, freeBytes)
    const credit = targetOutstanding - this.#speakerCreditOutstanding
    if (credit <= 0 || !this.#sendSpeakerCredit(credit)) return
    this.#speakerCreditOutstanding += credit
  }

  #sendSpeakerCredit(credit: number): boolean {
    const payload = new Uint8Array(4)
    new DataView(payload.buffer).setUint32(0, credit, true)
    return this.#sendControl(StackChanControl.SPEAKER_CREDIT, this.#speakerRate, payload, this.#speakerSession.streamId)
  }

  #completeSpeaker(): void {
    const completedStreamId = this.#speakerSession.streamId
    const speaker = this.#speaker
    speaker?.stop()
    speaker?.close()
    const completedRate = this.#speakerRate
    this.#sendSpeakerDiagnostics(StackChanDiagnosticEvent.COMPLETED)
    this.#speaker = undefined
    this.#speakerRate = 0
    this.#speakerCapacity = 0
    this.#speakerCreditOutstanding = 0
    this.#speakerBuffer.clear()
    this.#speakerEnded = false
    this.#speakerAwaitingDrain = false
    this.#stopPresentation()
    this.#txQueue.dropSpeakerFlowFrames(completedStreamId)
    this.#speakerSession.clear(completedStreamId)
    this.#sendControl(StackChanControl.SPEAKER_DONE, completedRate, undefined, completedStreamId)
  }

  #stopSpeaker(notify: boolean): void {
    const previousStreamId = this.#speakerSession.streamId
    const speaker = this.#speaker
    speaker?.stop()
    speaker?.close()
    const previousRate = this.#speakerRate
    if (previousRate) this.#sendSpeakerDiagnostics(StackChanDiagnosticEvent.ABORTED)
    this.#speaker = undefined
    this.#speakerRate = 0
    this.#speakerCapacity = 0
    this.#speakerCreditOutstanding = 0
    this.#speakerBuffer.clear()
    this.#speakerEnded = false
    this.#speakerAwaitingDrain = false
    this.#stopPresentation()
    this.#txQueue.dropSpeakerFlowFrames(previousStreamId)
    this.#speakerSession.reset()
    if (notify && previousStreamId) {
      this.#sendControl(StackChanControl.SPEAKER_DONE, previousRate, undefined, previousStreamId)
    }
  }

  #resetSpeakerDiagnostics(): void {
    const now = Time.ticks
    this.#speakerDiagnosticLastSnapshotTicks = now
    this.#speakerDiagnosticLastReceiveTicks = 0
    this.#speakerReceivedBytes = 0
    this.#speakerWrittenBytes = 0
    this.#speakerReceivedFrames = 0
    this.#speakerStarvationEvents = 0
    this.#speakerMaxReceiveGapMilliseconds = 0
    this.#speakerStarving = false
  }

  #recordSpeakerReceive(byteLength: number): void {
    const now = Time.ticks
    if (this.#speakerReceivedFrames > 0) {
      this.#speakerMaxReceiveGapMilliseconds = Math.max(
        this.#speakerMaxReceiveGapMilliseconds,
        (now - this.#speakerDiagnosticLastReceiveTicks) >>> 0,
      )
    }
    this.#speakerDiagnosticLastReceiveTicks = now
    this.#speakerReceivedBytes += byteLength
    this.#speakerReceivedFrames += 1
  }

  #updateSpeakerStarvation(): void {
    const bufferedBytes = this.#speakerBuffer.pcmBytes + (this.#speaker?.bufferedBytes ?? 0)
    const starving =
      this.#speaker !== undefined && !this.#speakerEnded && !this.#speakerAwaitingDrain && bufferedBytes === 0
    if (starving && !this.#speakerStarving) this.#speakerStarvationEvents += 1
    this.#speakerStarving = starving
  }

  #maybeSendSpeakerDiagnosticSnapshot(): void {
    if (!this.#diagnosticsEnabled || !this.#speakerRate) return
    const now = Time.ticks
    if ((now - this.#speakerDiagnosticLastSnapshotTicks) >>> 0 < DIAGNOSTIC_INTERVAL_MILLISECONDS) return
    this.#speakerDiagnosticLastSnapshotTicks = now
    this.#sendSpeakerDiagnostics(StackChanDiagnosticEvent.SNAPSHOT)
  }

  #sendSpeakerDiagnostics(event: StackChanDiagnosticEvent): void {
    if (!this.#diagnosticsEnabled || !this.#speakerRate) return
    const speaker = this.#speaker
    const queuedBytes = this.#speakerBuffer.pcmBytes + (speaker?.bufferedBytes ?? 0)
    let flags = 0
    if (speaker?.physicalAudioActive || speaker) flags |= StackChanDiagnosticFlag.AUDIO_ACTIVE
    if (this.#speakerEnded) flags |= StackChanDiagnosticFlag.SPEAKER_ENDED
    if (this.#speakerAwaitingDrain || speaker?.physicalAwaitingDrain) {
      flags |= StackChanDiagnosticFlag.AWAITING_DRAIN
    }
    if (queuedBytes === 0) flags |= StackChanDiagnosticFlag.BUFFER_EMPTY
    if (this.#speakerStarving) flags |= StackChanDiagnosticFlag.STARVING
    this.#send({
      type: StackChanFrameType.DIAGNOSTICS,
      streamId: this.#speakerSession.streamId,
      sequence: this.#diagnosticSequence++,
      sampleRate: this.#speakerRate,
      payload: encodeSpeakerDiagnostics({
        event,
        flags,
        ticks: Time.ticks,
        sampleRate: this.#speakerRate,
        queuedBytes,
        writableBytes: speaker?.physicalWritableBytes ?? 0,
        receivedBytes: this.#speakerReceivedBytes,
        writtenBytes: speaker?.physicalWrittenBytes ?? this.#speakerWrittenBytes,
        receivedFrames: this.#speakerReceivedFrames,
        writableCallbacks: speaker?.physicalWritableCallbacks ?? 0,
        starvationEvents: this.#speakerStarvationEvents,
        maxReceiveGapMilliseconds: this.#speakerMaxReceiveGapMilliseconds,
        maxWritableGapMilliseconds: speaker?.physicalMaxWritableGapMilliseconds ?? 0,
        txQueueBytes: this.#txQueue.remainingBytes,
      }),
    })
  }

  #setPresentationStatus(status: StackChanStatus): void {
    if (this.#presentationStatus === status) return
    this.#presentationStatus = status
    this.#notifyPresentation(this.#presentation, 'onStatusChanged', status)
  }

  #startPresentation(): void {
    if (this.#presentationActive) return
    this.#presentationActive = true
    this.#presentationPower = 0
    this.#presentationText = ''
    this.#notifyPresentation(this.#presentation, 'onPlaybackStarted')
  }

  #showPresentationText(text: string): void {
    this.#presentationText = text
    this.#notifyPresentation(this.#presentation, 'onPlaybackText', text)
  }

  #updatePresentationPower(power: number): void {
    this.#presentationPower = power
    this.#notifyPresentation(this.#presentation, 'onPlaybackPower', power)
  }

  #stopPresentation(): void {
    if (!this.#presentationActive) {
      this.#presentationPower = 0
      this.#presentationText = ''
      return
    }
    this.#presentationActive = false
    this.#presentationPower = 0
    this.#presentationText = ''
    this.#notifyPresentation(this.#presentation, 'onPlaybackStopped')
  }

  #notifyPresentation(
    presentation: UsbAudioPresentation | undefined,
    method: keyof UsbAudioPresentation,
    value?: number | string,
  ): void {
    if (!presentation) return
    try {
      if (value === undefined) (presentation[method] as () => void)()
      else if (typeof value === 'number') (presentation[method] as (next: number) => void)(value)
      else (presentation[method] as (next: string) => void)(value)
    } catch (error) {
      trace(`[usb-audio] presentation ${method} failed: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  }
}

let bridge: UsbAudioBridge | undefined

export function startUsbAudioBridge(options: UsbAudioBridgeOptions = {}): UsbAudioBridgeControl {
  if (!bridge) {
    bridge = new UsbAudioBridge(options)
    bridge.start()
  }
  return bridge
}

export function stopUsbAudioBridge(): void {
  bridge?.close()
  bridge = undefined
}

export default startUsbAudioBridge
