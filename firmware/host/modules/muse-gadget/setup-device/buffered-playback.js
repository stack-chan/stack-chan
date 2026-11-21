const pageBytes = 16 * 1024
const writeBytes = 4092
// One assistant message can span several Gemini responses. A single response can yield up to 2 MiB of resampled PCM.
const maxPcmBytes = 4 * 1024 * 1024

function cancelled() {
  return Object.assign(new Error('audio closed'), { code: 'cancelled' })
}

export function createBufferedPlayback({ allocatePage, openOutput, volume, streamingLeadBytes }) {
  const pages = []
  let length = 0
  let submittedFrames = 0
  let closed = false
  let sealed = false
  let streaming = streamingLeadBytes === undefined ? 'disabled' : 'waiting'
  let output, playback, resumePlayback, playbackError

  function releasePages() {
    for (const page of pages) page.close()
    pages.length = 0
  }

  function wakePlayback() {
    const resume = resumePlayback
    resumePlayback = undefined
    resume?.()
  }

  function close() {
    if (closed) return
    closed = true
    wakePlayback()
    try {
      output?.close()
    } finally {
      releasePages()
    }
  }

  async function play() {
    let scratch, deferredToDrain = false
    try {
      if (closed) throw cancelled()
      if (!length) throw new Error('empty playback buffer')
      scratch = new Uint8Array(writeBytes)
      let opened
      try {
        opened = openOutput(volume)
      } catch (error) {
        if (sealed || closed) throw error
        deferredToDrain = true
        streaming = 'disabled'
        playback = undefined
        return
      }
      if (closed) {
        opened.close()
        throw cancelled()
      }
      output = opened
      let offset = 0
      while (!closed) {
        if (offset === length) {
          if (sealed) break
          await new Promise((resolve) => {
            resumePlayback = resolve
          })
          continue
        }
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
    } catch (error) {
      playbackError = error
      throw error
    } finally {
      scratch?.fill(0)
      if (!deferredToDrain) releasePages()
    }
  }

  function startPlayback() {
    if (!playback) {
      playback = Promise.resolve().then(play)
      if (!sealed) playback.catch(() => {})
    }
    return playback
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
    allowStreaming() {
      if (streaming === 'waiting') streaming = 'enabled'
    },
    write(bytes) {
      if (closed || sealed) throw cancelled()
      if (playbackError) throw playbackError
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
      if (bytes.byteLength && streaming === 'enabled' && length >= streamingLeadBytes) startPlayback()
      wakePlayback()
    },
    drain() {
      sealed = true
      wakePlayback()
      return startPlayback()
    },
    close,
  }
}
