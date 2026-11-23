const pageBytes = 16 * 1024
const writeBytes = 4092
// One assistant message can span several Gemini responses. A single response can yield up to 2 MiB of resampled PCM.
const maxPcmBytes = 4 * 1024 * 1024

function cancelled() {
  return Object.assign(new Error('audio closed'), { code: 'cancelled' })
}

export function createBufferedPlayback({ allocatePage, openOutput, volume }) {
  const pages = []
  let length = 0
  let submittedFrames = 0
  let closed = false
  let output, draining

  function releasePages() {
    for (const page of pages) page.close()
    pages.length = 0
  }

  function close() {
    if (closed) return
    closed = true
    try {
      output?.close()
    } finally {
      releasePages()
    }
  }

  async function play() {
    let scratch
    try {
      if (closed) throw cancelled()
      if (!length) throw new Error('empty playback buffer')
      scratch = new Uint8Array(writeBytes)
      const opened = openOutput(volume)
      if (closed) {
        opened.close()
        throw cancelled()
      }
      output = opened
      for (let offset = 0; offset < length; ) {
        if (closed) throw cancelled()
        const index = Math.floor(offset / pageBytes)
        const pageOffset = offset % pageBytes
        const size = Math.min(writeBytes, pageBytes - pageOffset, length - offset)
        pages[index].get(scratch, 0, pageOffset, size)
        await output.write(scratch.subarray(0, size))
        if (closed) throw cancelled()
        submittedFrames += size / 2
        offset += size
      }
      if (closed) throw cancelled()
      await output.drain()
      if (closed) throw cancelled()
    } finally {
      scratch?.fill(0)
      releasePages()
    }
  }

  return {
    get submittedFrames() {
      return submittedFrames
    },
    setVolume(gain) {
      if (closed) throw cancelled()
      volume = Math.max(0, Math.min(1, gain))
      output?.setVolume(volume)
    },
    write(bytes) {
      if (closed || draining) throw cancelled()
      try {
        if (bytes.byteLength > maxPcmBytes - length) throw new Error('PCM buffer limit exceeded')
        for (let offset = 0; offset < bytes.byteLength; ) {
          const index = Math.floor(length / pageBytes)
          const pageOffset = length % pageBytes
          const size = Math.min(bytes.byteLength - offset, pageBytes - pageOffset)
          pages[index] ??= allocatePage()
          pages[index].put(bytes, offset, pageOffset, size)
          length += size
          offset += size
        }
      } catch (error) {
        close()
        throw Object.assign(error, { code: 'resource_exhausted' })
      }
    },
    drain() {
      draining ??= Promise.resolve().then(play)
      return draining
    },
    close,
  }
}
