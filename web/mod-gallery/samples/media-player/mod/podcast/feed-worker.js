import { loadFeed } from 'podcast-feed-core'

self.onmessage = async ({ url }) => {
  try {
    const result = await loadFeed(url).promise
    self.postMessage({ result })
  } catch (error) {
    self.postMessage({ error: String(error) })
  }
}
