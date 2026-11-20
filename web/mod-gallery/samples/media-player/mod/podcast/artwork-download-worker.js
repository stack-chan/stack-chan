import { downloadArtwork, prepareWorker } from 'jpeg-scaled-decoder'
import { mediaRedirectURL } from 'media-http'

prepareWorker()

self.onmessage = ({ url, data, state }) => {
  const started = Date.now()
  try {
    for (let redirects = 0; redirects <= 5; redirects++) {
      const result = downloadArtwork(url, data, state)
      if (!result.redirect) {
        self.postMessage({ download: { ...result, downloadMs: Date.now() - started } })
        return
      }
      if (redirects === 5) throw new Error('Too many artwork redirects')
      url = mediaRedirectURL(result.redirect, url).href
    }
  } catch (error) {
    Atomics.store(new Int32Array(state), 3, 1)
    self.postMessage({ error: String(error) })
  }
}
