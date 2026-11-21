export function createResampledOutput({ openOutput, resample, minimumOutputBytes }) {
  return {
    minimumOutputBytes,
    openOutput(sampleRate, volume, limit, onLevel) {
      if (sampleRate === 16000) return openOutput(sampleRate, volume, limit, onLevel)
      if (sampleRate !== 24000) throw new RangeError('unsupported StopWatch speech rate')
      const converted = new Uint8Array(4092),
        state = new Int32Array(3)
      const output = openOutput(16000, volume, limit, onLevel)
      let frames = 0,
        busy = false,
        closed = false,
        draining
      return {
        get frames() {
          return frames
        },
        setVolume: (gain) => output.setVolume(gain),
        async write(bytes, onAccepted) {
          if (closed) throw Object.assign(new Error('audio closed'), { code: 'cancelled' })
          if (busy || draining || bytes.byteLength & 1 || bytes.byteLength > limit)
            throw new RangeError('unaccepted StopWatch PCM')
          busy = true
          try {
            if (bytes.byteOffset & 1) bytes = bytes.slice()
            for (let at = 0; at < bytes.length; ) {
              const count = Math.min(4092, bytes.length - at)
              const length = resample(
                bytes.buffer,
                (bytes.byteOffset + at) / 2,
                count / 2,
                converted.buffer,
                24000,
                16000,
                state,
              )
              if (length) await output.write(converted.subarray(0, length * 2))
              if (closed) throw Object.assign(new Error('audio closed'), { code: 'cancelled' })
              frames += count / 2
              onAccepted?.(count)
              at += count
            }
          } finally {
            busy = false
          }
        },
        drain() {
          if (busy) return Promise.reject(new Error('write still pending'))
          if (!draining)
            draining = (async () => {
              if (state[2]) {
                const tail = new Int16Array([state[1]])
                const length = resample(tail.buffer, 0, 1, converted.buffer, 24000, 16000, state)
                if (length) await output.write(converted.subarray(0, length * 2))
              }
              await output.drain()
            })()
          return draining
        },
        close() {
          if (!closed) {
            closed = true
            output.close()
          }
        },
      }
    },
  }
}
