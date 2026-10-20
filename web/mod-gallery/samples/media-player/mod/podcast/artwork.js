import Bitmap from 'commodetto/Bitmap'
import { memoryUsage } from 'jpeg-scaled-decoder'
import { mediaURL } from 'media-http'
import { ART_SIZE, RING_BYTES } from 'podcast-artwork-ring'
import Timer from 'timer'
import Worker from 'worker'

let active
let idle = Promise.resolve()
/** Only the final 8 KiB thumbnail survives completion. Neither Worker retains the full JPEG. */
export function loadArtwork(url, WorkerType = Worker) {
  active?.cancel()
  let downloadWorker,
    decodeWorker,
    deadline,
    finish,
    decoding = false,
    downloading = false,
    settled = false,
    download,
    decode,
    data,
    state,
    flags,
    pixels,
    releaseCleanup
  const started = Date.now()
  const memoryBefore = memoryUsage()
  const previous = idle
  const cleanup = new Promise((resolve) => {
    releaseCleanup = resolve
  })
  idle = previous.then(() => cleanup)
  const finishCleanup = () => {
    if (!downloading && !decoding) releaseCleanup()
  }
  const promise = new Promise((resolve, reject) => {
    finish = (error) => {
      if (settled) return
      if (!error && (!download || !decode)) return
      let bitmap
      if (!error) {
        try {
          bitmap = new Bitmap(ART_SIZE, ART_SIZE, decode.pixelFormat, pixels, 0)
        } catch (cause) {
          error = cause
        }
      }
      settled = true
      if (deadline !== undefined) Timer.clear(deadline)
      if (error && flags) Atomics.store(flags, 3, 1)
      if (!downloading) {
        downloadWorker?.terminate()
        downloadWorker = undefined
      }
      // Never delete a task while it is in native code: its input/output callbacks observe cancellation,
      // free the workspace, and post a reply. That reply is the safe point for terminate().
      if (!decoding) {
        decodeWorker?.terminate()
        decodeWorker = undefined
      }
      finishCleanup()
      if (error) {
        trace(
          `[podcast artwork] ${JSON.stringify({ error: String(error), received: flags ? Atomics.load(flags, 0) >>> 0 : 0, consumed: flags ? Atomics.load(flags, 1) >>> 0 : 0, totalMs: Date.now() - started, memoryAfter: memoryUsage() })}\n`,
        )
        reject(error)
      } else {
        trace(
          `[podcast artwork] ${JSON.stringify({ ...download, ...decode, totalMs: Date.now() - started, memoryBefore, memoryAfter: memoryUsage() })}\n`,
        )
        resolve(bitmap)
      }
    }
    deadline = Timer.set(() => finish(new Error('Artwork timed out')), 60000)
    // Serialize teardown/start: rapid episode changes must not accumulate native TLS tasks.
    previous.then(() => {
      if (settled) return
      try {
        const resolvedURL = mediaURL(url).href
        data = new SharedArrayBuffer(RING_BYTES)
        state = new SharedArrayBuffer(16)
        flags = new Int32Array(state)
        pixels = new SharedArrayBuffer(ART_SIZE * ART_SIZE * 2)
        downloadWorker = new WorkerType('podcast-artwork-download-worker', {
          static: 256 * 1024,
          chunk: { initial: 16 * 1024, incremental: 4 * 1024 },
          heap: { initial: 1024, incremental: 128 },
          stack: 1024,
          nativeStack: 16 * 1024,
          core: 1,
          priority: 1,
        })
        decodeWorker = new WorkerType('podcast-artwork-decode-worker', {
          static: 256 * 1024,
          chunk: { initial: 16 * 1024, incremental: 4 * 1024 },
          heap: { initial: 1024, incremental: 128 },
          stack: 512,
          nativeStack: 8 * 1024,
          core: 1,
          priority: 1,
        })
        downloadWorker.onmessage = (message) => {
          downloading = false
          downloadWorker?.terminate()
          downloadWorker = undefined
          if (settled) {
            finishCleanup()
            return
          }
          if (message.error) finish(new Error(message.error))
          else {
            download = message.download
            finish()
          }
        }
        decodeWorker.onmessage = (message) => {
          decoding = false
          decodeWorker?.terminate()
          decodeWorker = undefined
          if (settled) {
            finishCleanup()
            return
          }
          if (message.error) finish(new Error(message.error))
          else {
            decode = message.decode
            finish()
          }
        }
        decodeWorker.postMessage({ data, state, pixels })
        decoding = true
        downloadWorker.postMessage({ url: resolvedURL, data, state })
        downloading = true
      } catch (error) {
        finish(error)
      }
    })
  })
  const handle = { promise, cancel: () => finish(new Error('Artwork cancelled')) }
  active = handle
  const clearActive = () => {
    if (active === handle) active = undefined
  }
  promise.then(clearActive, clearActive)
  return handle
}
