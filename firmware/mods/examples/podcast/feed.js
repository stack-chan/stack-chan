import MediaHttpStream, { mediaURL } from 'media-http'
import RSSParser from 'podcast-rss-parser'
import Timer from 'timer'

/** Cancellation rejects the pending promise; callers use a generation to ignore it. */
export function loadFeed(url) {
  let request,
    timer,
    settled = false,
    rejectPromise
  const parser = new RSSParser(mediaURL(url).href)
  const promise = new Promise((resolve, reject) => {
    rejectPromise = reject
    const finish = (error) => {
      if (settled) return
      settled = true
      if (timer !== undefined) Timer.clear(timer)
      request?.close()
      if (error) {
        reject(error)
        return
      }
      try {
        const result = parser.finish()
        result.episodes = result.episodes.flatMap((episode) => {
          try {
            return [{ ...episode, url: mediaURL(episode.url, request.url).href }]
          } catch {
            return []
          }
        })
        resolve(result)
      } catch (error) {
        reject(error)
      }
    }
    timer = Timer.set(() => finish(new Error('RSS request timed out')), 30_000)
    request = new MediaHttpStream({
      url,
      onReadable: () => {
        while (request.readable && !settled) {
          const bytes = new Uint8Array(Math.min(4096, request.readable))
          request.read(bytes)
          parser.push(bytes)
          if (parser.limited) finish()
        }
      },
      onDone: finish,
    })
  })
  return {
    promise,
    cancel() {
      if (settled) return
      settled = true
      if (timer !== undefined) Timer.clear(timer)
      request?.close()
      rejectPromise(new Error('RSS request cancelled'))
    },
  }
}
