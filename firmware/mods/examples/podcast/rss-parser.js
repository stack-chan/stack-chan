import XML from 'xml'

export function durationSeconds(value) {
  if (typeof value !== 'string' || !/^\d+(?::[0-5]\d){0,2}(?:\.\d+)?$/.test(value.trim())) return
  const seconds = value
    .trim()
    .split(':')
    .reduce((total, part) => total * 60 + Number(part), 0)
  return seconds > 0 && Number.isFinite(seconds) ? seconds : undefined
}

const MAX_BYTES = 256 * 1024
const MAX_FIELD = 8192
const MAX_EPISODES = 20
const child = (node, name) => node?.elements?.find((element) => element.name === name)
const attribute = (node, name) => node?.attributes?.find((entry) => entry.name === name)?.value
function text(node) {
  const value = node?.text ?? ''
  if (value.length > MAX_FIELD) throw new Error('RSS field exceeds limit')
  return value.trim()
}
function artwork(node) {
  return (
    attribute(child(node, 'itunes:image'), 'href') ||
    attribute(child(node, 'media:thumbnail'), 'url') ||
    attribute(
      node?.elements?.find((entry) => entry.name === 'media:content' && attribute(entry, 'type')?.startsWith('image/')),
      'url',
    ) ||
    text(child(child(node, 'image'), 'url')) ||
    undefined
  )
}

/** Bounded input for the SDK's native XML parser. XML is parsed once after reception. */
export default class RSSParser {
  static MAX_BYTES = MAX_BYTES
  #feedURL
  #buffer = new Uint8Array(16384)
  #length = 0
  constructor(feedURL) {
    this.#feedURL = feedURL
  }
  push(bytes) {
    const length = this.#length + bytes.byteLength
    if (length > MAX_BYTES) throw new Error('RSS exceeds 256 KiB limit')
    if (length > this.#buffer.length) {
      const next = new Uint8Array(Math.min(MAX_BYTES, Math.max(length, this.#buffer.length * 2)))
      next.set(this.#buffer.subarray(0, this.#length))
      this.#buffer = next
    }
    this.#buffer.set(bytes, this.#length)
    this.#length = length
  }
  finish() {
    let root
    try {
      // The SDK accepts byte views directly, avoiding another complete UTF-8 string copy.
      root = XML.parse(this.#buffer.subarray(0, this.#length))
    } finally {
      this.#buffer = undefined
    }
    if (root?.name !== 'rss' || attribute(root, 'version') !== '2.0') throw new Error('Expected RSS 2.0')
    const channels = root.elements?.filter((entry) => entry.name === 'channel') ?? []
    if (channels.length !== 1) throw new Error('Expected one RSS channel')
    const channel = channels[0],
      episodes = [],
      identities = new Set()
    let limited = false
    for (const item of channel.elements ?? []) {
      if (item.name !== 'item') continue
      const enclosure = child(item, 'enclosure')
      const url = attribute(enclosure, 'url'),
        type = attribute(enclosure, 'type')?.toLowerCase()
      if (
        !url ||
        !(type === 'audio/mpeg' || ((!type || type === 'application/octet-stream') && /\.mp3(?:[?#]|$)/i.test(url)))
      )
        continue
      const guid = text(child(item, 'guid')) || undefined
      const identity = guid ? `guid:${guid}` : `url:${url}`
      if (identities.has(identity)) continue
      if (episodes.length === MAX_EPISODES) {
        limited = true
        break
      }
      identities.add(identity)
      episodes.push({
        feedURL: this.#feedURL,
        identity,
        guid,
        url,
        title: text(child(item, 'title')) || '(untitled)',
        duration: durationSeconds(text(child(item, 'itunes:duration'))),
        artwork: artwork(item),
      })
    }
    return { title: text(child(channel, 'title')), artwork: artwork(channel), episodes, limited }
  }
}
