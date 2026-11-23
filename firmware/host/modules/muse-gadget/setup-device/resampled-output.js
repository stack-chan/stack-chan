export function createResampledOutput({ openOutput, resample, minimumOutputBytes }) {
  return {
    minimumOutputBytes,
    openOutput(sampleRate, volume, limit, onLevel, startupBlocks = 1) {
      if (sampleRate !== 24000 && sampleRate !== 16000) throw new RangeError('unsupported StopWatch speech rate')
      if (startupBlocks !== 1 && startupBlocks !== 3) throw new RangeError('unsupported startup blocks')
      if (startupBlocks === 3 && limit < 4 * 4092) throw new RangeError('startup exceeds PCM budget')
      if (sampleRate === 16000) {
        if (startupBlocks === 1) return openOutput(sampleRate, volume, limit, onLevel)
        return openOutput(sampleRate, volume, limit, onLevel, startupBlocks)
      }
      const converted = new Uint8Array(4092),
        state = new Int32Array(3)
      const output = openOutput(16000, volume, limit, onLevel, startupBlocks)
      let frames = 0,
        busy = false,
        closed = false,
        draining
      return {
        get frames() {
          const submitted = output.submittedFrames
          return submitted === undefined ? frames : Math.min(frames, Math.floor((submitted * 3) / 2))
        },
        allowStreaming: output.allowStreaming && (() => output.allowStreaming()),
        setVolume: (gain) => output.setVolume(gain),
        async write(bytes, onAccepted) {
          if (closed) throw Object.assign(new Error('audio closed'), { code: 'cancelled' })
          if (
            busy ||
            draining ||
            bytes.byteLength & 1 ||
            bytes.byteLength > limit ||
            (startupBlocks === 3 && bytes.byteOffset & 1)
          )
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
              if (length) {
                const bytes = converted.subarray(0, length * 2)
                await output.write(bytes)
              }
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
                if (length) {
                  const bytes = converted.subarray(0, length * 2)
                  await output.write(bytes)
                }
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
