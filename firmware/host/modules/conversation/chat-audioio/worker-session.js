export function startWorkerSession(self, Model, configuration) {
  const pending = []
  let requested = 0,
    written = 0,
    socket,
    parser,
    stopped = false
  function fail(message) {
    if (!stopped) self.postMessage({ id: 'failed', string: message })
    stopped = true
  }
  function release() {
    while (pending.length && pending[0].through <= written)
      self.postMessage({ id: 'audioConsumed', slot: pending.shift().slot })
  }
  class WorkerModel extends Model {
    get ws() {
      return socket
    }
    set ws(value) {
      socket = value && {
        read: (count) => value.read(count),
        close: () => value.close(),
        write(data, options) {
          const credit = value.write(data, options)
          written += data.byteLength
          release()
          return credit
        },
      }
    }
    write(data, options) {
      if (stopped) return
      if (requested - written + data.byteLength > 65536) return fail('Chat network queue exceeded 64 KiB')
      requested += data.byteLength
      super.write(data, options)
    }
    get parser() {
      return parser
    }
    set parser(value) {
      parser = value
      if (!value) return
      // The SDK parser uses a power-of-two PCM ring and its own blocking wait.
      // A second atomic word lets the owning VM release that wait on shutdown.
      Object.defineProperty(value, 'wait', {
        value: function (head, size, space) {
          if (space >= size) {
            fail('Chat packet exceeds PCM ring')
            throw new RangeError('Audio packet too large')
          }
          const deadline = Date.now() + 5000
          for (;;) {
            if (Atomics.load(this.barrier, 1)) throw new Error('Chat worker closing')
            const tail = Atomics.load(this.barrier, 0)
            if (((tail - (head + 1)) & (size - 1)) >= space) return
            if (Date.now() >= deadline) {
              fail('Chat playback deadline exceeded')
              throw new Error('Audio output stalled')
            }
            Atomics.wait(this.barrier, 0, tail, 100)
          }
        },
      })
    }
  }
  new WorkerModel({ inputSampleRate: configuration.inputRate, outputSampleRate: configuration.outputRate })
  const dispatch = self.onmessage
  self.onmessage = (message) => {
    if (stopped) return
    try {
      dispatch(message)
      // Deepgram can queue a view into the shared input buffer. Keep its slot
      // borrowed until the actual socket has accepted every byte for this packet.
      if (message.id === 'sendAudio') {
        pending.push({ through: requested, slot: message.slot })
        release()
      }
    } catch (error) {
      fail(String(error))
    }
  }
  self.onmessage(configuration)
}
