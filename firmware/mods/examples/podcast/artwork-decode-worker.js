import decodeScaledJPEG, { prepareWorker } from 'jpeg-scaled-decoder'

prepareWorker()

self.onmessage = ({ data, state, pixels }) => {
  try {
    self.postMessage({ decode: decodeScaledJPEG(data, state, pixels) })
  } catch (error) {
    self.postMessage({ error: String(error) })
  }
}
