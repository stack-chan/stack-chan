import MediaHttpStream, { mediaURL } from 'media-http'
import RSSParser from 'podcast-rss-parser'
import Timer from 'timer'

/** Cancellation rejects the pending promise; callers use a generation to ignore it. */
export function loadFeed(url) {
  let request,
    timer,
    pumpTimer,
    settled = false,
    rejectPromise
  const parser = new RSSParser(mediaURL(url).href)
  const promise = new Promise((resolve, reject) => {
    rejectPromise = reject
    const finish = (error) => {
      if (settled) return
      settled = true
      if (timer !== undefined) Timer.clear(timer)
      if (pumpTimer !== undefined) Timer.clear(pumpTimer)
      request?.close()
      if (error) {
        reject(error)
        return
      }
      try {
        const result = parser.finish()
        const artworkURL = (value) => {
          try {
            return value ? mediaURL(value, request.url).href : undefined
          } catch {
            return undefined
          }
        }
        result.artwork = artworkURL(result.artwork)
        result.episodes = result.episodes.flatMap((episode) => {
          try {
            return [{ ...episode, artwork: artworkURL(episode.artwork), url: mediaURL(episode.url, request.url).href }]
          } catch {
            return []
          }
        })
        resolve(result)
      } catch (error) {
        reject(error)
      }
    }
    // Bound receive work per turn. Parsing is delegated to native XML at EOF.
    const schedule = () => {
      if (settled || pumpTimer !== undefined || !request.readable) return
      pumpTimer = Timer.set(() => {
        pumpTimer = undefined
        if (settled) return
        try {
          const bytes = new Uint8Array(Math.min(4096, request.readable))
          request.read(bytes)
          parser.push(bytes)
          schedule()
        } catch (error) {
          finish(error)
        }
      }, 1)
    }
    timer = Timer.set(() => finish(new Error('RSS request timed out')), 30_000)
    request = new MediaHttpStream({
      url,
      onHeaders: (_headers, _url, info) => {
        if (info.totalBytes > RSSParser.MAX_BYTES) throw new Error('RSS exceeds 256 KiB limit')
      },
      onReadable: schedule,
      onDone: finish,
    })
  })
  return {
    promise,
    cancel() {
      if (settled) return
      settled = true
      if (timer !== undefined) Timer.clear(timer)
      if (pumpTimer !== undefined) Timer.clear(pumpTimer)
      request?.close()
      rejectPromise(new Error('RSS request cancelled'))
    },
  }
}
