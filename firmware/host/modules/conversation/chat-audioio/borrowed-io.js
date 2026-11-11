import { readSource, writeSink } from 'stackchan/voice/media'

export function createBorrowedChatIO(io, options, states, level) {
  const { media } = options
  const nativeInput = options.specifier === 'xiaozhiV1'
  const budget = media.output.budget,
    inputRate = media.input.format.sampleRate,
    outputRate = media.output.format.sampleRate
  const slotBytes = 2048,
    slots = 4
  const nativeInputBytes = 9 * 1920 + 2
  const inputBytes = nativeInput ? nativeInputBytes + 2 : slotBytes * slots
  // Reserve room for the device pre-roll and one pending speaker block. The
  // decoder computes offsets with a bit mask, so its ring must be a power of two.
  const remaining = Math.min(
    budget.maxBufferedBytes - inputBytes - 16384,
    ((budget.maxBufferedMs - 200 - (inputBytes / (inputRate * 2)) * 1000) * (outputRate * 2)) / 1000,
  )
  const outputBytes = 2 ** Math.floor(Math.log2(Math.min(131072, remaining)))
  if (!(outputBytes > outputRate / 2)) throw new RangeError('Insufficient Chat worker PCM budget')

  const available = new Set(Array.from({ length: slots }, (_, i) => i))
  let generation = 0,
    serial = 0,
    active,
    pump,
    subscription,
    waiting = false,
    sealed = false,
    queued = 0
  const packets = []
  Object.assign(io, {
    nativeInputBytes,
    voiceClosed: false,
    error: '',
    state: states.DISCONNECTED,
    microphone: true,
    inputBuffer: new SharedArrayBuffer(nativeInput ? 2 : slotBytes * slots),
    outputBuffer: new SharedArrayBuffer(outputBytes),
    barrier: new Int32Array(new SharedArrayBuffer(8)),
    inputSampleRate: media.input.format.sampleRate,
    outputSampleRate: media.output.format.sampleRate,
    releaseInputSlot(slot) {
      if (Number.isInteger(slot) && slot >= 0 && slot < slots) available.add(slot)
    },
    ensureInput() {
      if (subscription || io.voiceClosed) return
      subscription = readSource(
        media.input,
        (bytes) => {
          if (!io.microphone || io.state !== states.SPEAKING || io.voiceClosed) return
          options.onInputLevelChanged?.(level(bytes))
          if (nativeInput) return io.writeNativeInput(bytes)
          if (bytes.length > slotBytes || !available.size) throw new Error('Chat input overrun')
          const slot = available.values().next().value
          available.delete(slot)
          new Uint8Array(io.inputBuffer, slot * slotBytes, bytes.length).set(bytes)
          io.worker.postMessage({ id: 'sendAudio', slot, offset: slot * slotBytes, size: bytes.length, channels: 1 })
        },
        (error) => io.failed({ string: String(error) }),
      )
    },
    configureAudio(message) {
      if (message.inputSampleRate !== io.inputSampleRate || message.outputSampleRate !== io.outputSampleRate)
        io.failed({ string: 'Worker changed to an unsupported audio format' })
    },
    connect() {
      io.worker.postMessage({
        id: 'connect',
        inputBuffer: io.inputBuffer,
        outputBuffer: io.outputBuffer,
        barrier: io.barrier,
      })
      state(states.CONNECTING)
    },
    connected() {
      state(states.CONNECTED)
      state(states.SPEAKING)
    },
    disconnected() {
      state(states.DISCONNECTED)
    },
    failed({ string }) {
      io.error = string
      state(states.FAILED)
    },
    disconnect() {
      state(states.DISCONNECTING)
      io.worker.postMessage({ id: 'disconnect' })
    },
    changeMicrophone(enabled) {
      io.microphone = enabled
    },
    listen() {
      if (io.voiceClosed || sealed || active) return
      const id = 'chat-output-' + ++serial
      active = { id, sink: media.output.begin(id, generation) }
      options.onOutputStarted?.(id)
      state(states.LISTENING)
      schedule()
    },
    receiveAudio({ offset, size }) {
      if (io.voiceClosed || sealed) return
      if (
        !Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(size) ||
        size <= 0 ||
        size % 2 ||
        offset < 0 ||
        offset >= io.outputBuffer.byteLength ||
        size > io.outputBuffer.byteLength ||
        queued + size > io.outputBuffer.byteLength ||
        packets.length >= 128
      )
        return io.failed({ string: 'Invalid audio range' })
      packets.push({ offset, size })
      queued += size
      schedule()
    },
    speak() {
      if (io.voiceClosed || sealed) return
      waiting = true
      state(states.WAITING)
      schedule()
    },
    async drain() {
      sealed = true
      if (active) {
        waiting = true
        schedule()
      }
      await pump
    },
    async fence() {
      sealed = true
      const old = active
      active = undefined
      waiting = false
      packets.length = 0
      queued = 0
      const receipts = await media.output.fence(++generation)
      if (old) await pump
      return receipts
    },
    close() {
      io.voiceClosed = true
      subscription?.close()
      subscription = undefined
      packets.length = 0
      // Release a decoder blocked in its shared-buffer barrier before joining the worker.
      Atomics.store(io.barrier, 1, 1)
      Atomics.notify(io.barrier, 0)
      io.worker?.terminate()
      io.worker = undefined
    },
    sendText(text) {
      io.worker.postMessage({ id: 'sendText', text })
    },
    sendFunctionResult(call, name, result) {
      io.worker.postMessage({ id: 'sendFunctionResult', call, name, result })
    },
    abort(reason) {
      io.worker.postMessage({ id: 'abort', reason })
    },
    receiveFunctionCall(m) {
      options.onFunctionCall?.(m.call, m.name, m.parameters)
    },
    receiveInputText(m) {
      options.onInputTranscript?.(m.text, m.more)
    },
    receiveOutputText(m) {
      options.onOutputTranscript?.(m.text, m.more, active?.id ?? 'chat-output-' + (serial + 1))
    },
    receiveEmotion(m) {
      options.onEmotionChanged?.(m.emotion ?? '', m.text)
    },
    receiveAlert(m) {
      options.onAlert?.({ status: m.status, message: m.message ?? '', emotion: m.emotion })
    },
    receiveSystemCommand(m) {
      options.onSystemCommand?.({ command: m.command ?? '', event: m.event ?? {} })
    },
    receiveCustomEvent(m) {
      options.onCustomEvent?.({ payload: m.payload, event: m.event ?? {} })
    },
    receiveUnknownEvent(m) {
      options.onUnknownEvent?.(m.event ?? {})
    },
    protocolWarning(m) {
      options.onProtocolWarning?.(m.string ?? 'protocol warning', m.event)
    },
    receiveMcpNotification(m) {
      options.onMcpNotification?.(m.payload ?? {})
    },
    receiveMcpResponse(m) {
      options.onMcpResponse?.(m.payload ?? {})
    },
    receiveGlyphPush(m) {
      options.onGlyphPush?.({ source: m.source, text: m.text, payload: m.payload ?? {} })
    },
  })
  function state(value) {
    if (io.voiceClosed) return
    io.state = value
    options.onStateChanged(value)
  }
  function schedule() {
    if (!active || pump || io.voiceClosed) return
    const item = active
    pump = Promise.resolve()
      .then(async () => {
        while (packets.length && active === item && !io.voiceClosed) {
          const packet = packets.shift()
          let offset = packet.offset,
            remaining = packet.size
          const accepted = (size) => {
            if (active !== item || io.voiceClosed) return
            if (options.onOutputLevelChanged) {
              const samples = new Uint8Array(io.outputBuffer, offset, size)
              options.onOutputLevelChanged(level(samples))
              if (active !== item || io.voiceClosed) return
            }
            offset = (offset + size) % io.outputBuffer.byteLength
            remaining -= size
            queued -= size
            Atomics.store(io.barrier, 0, offset)
            Atomics.notify(io.barrier, 0)
          }
          while (remaining && active === item && !io.voiceClosed) {
            const contiguous = Math.min(remaining, io.outputBuffer.byteLength - offset)
            const bytes = item.sink.writeBorrowed ? contiguous : Math.min(contiguous, 2048)
            const samples = new Uint8Array(io.outputBuffer, offset, bytes)
            if (item.sink.writeBorrowed) await item.sink.writeBorrowed(samples, accepted)
            else {
              await writeSink(item.sink, samples)
              accepted(bytes)
            }
          }
        }
        if (active === item && waiting && !io.voiceClosed) {
          const receipt = await media.output.finish(item.id)
          if (active !== item || io.voiceClosed) return
          options.onPlayback?.(receipt)
          active = undefined
          waiting = false
          if (receipt.state !== 'played') {
            io.failed({ string: `Chat playback ${receipt.state}` })
            return
          }
          io.worker.postMessage({ id: 'listened' })
          state(states.SPEAKING)
        }
      })
      .catch((error) => {
        if (!io.voiceClosed && active === item) io.failed({ string: String(error) })
      })
      .finally(() => {
        pump = undefined
        if (active && (packets.length || waiting) && io.state !== states.FAILED) schedule()
      })
  }
  return io
}
