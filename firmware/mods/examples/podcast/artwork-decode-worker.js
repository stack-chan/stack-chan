import decodeThumbnail, { prepareWorker } from 'podcast-jpeg-thumbnail'

prepareWorker()

self.onmessage = ({ data, state, pixels }) => {
  try {
    self.postMessage({ decode: decodeThumbnail(data, state, pixels) })
  } catch (error) {
    self.postMessage({ error: String(error) })
  }
}
