import Timer from 'timer'
import { URL } from 'url'

const REDIRECTS = [301, 302, 303, 307, 308]

export function mediaURL(value, base) {
  const url = base ? new URL(value, base) : new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only HTTP and HTTPS are supported')
  if (url.username || url.password) throw new Error('URL credentials are not supported')
  url.hash = ''
  return url
}

/** A cancellable GET with bounded redirects and caller-controlled backpressure. */
export default class MediaHttpStream {
  #options
  #url
  #client
  #request
  #timer
  #idleTimer
  #generation = 0
  #closed = false
  #redirects = 0
  #received = 0
  #length
  #framed = false
  #accepted = false
  readable = 0

  constructor(options) {
    this.#options = options
    this.#url = mediaURL(options.url)
    this.#timer = Timer.set(() => {
      this.#timer = undefined
      this.#open()
    })
  }

  get url() {
    return this.#url.href
  }

  read(target) {
    if (this.#closed || target.byteLength > this.readable) throw new Error('Invalid media read')
    const request = this.#request
    request.read(target)
    this.readable -= target.byteLength
    this.#received += target.byteLength
    if (!this.readable) this.#armTimeout()
    return target.byteLength
  }

  close() {
    if (this.#closed) return
    this.#closed = true
    this.#disconnect()
    if (this.#timer !== undefined) Timer.clear(this.#timer)
    this.#timer = undefined
  }

  #armTimeout() {
    if (this.#idleTimer !== undefined) Timer.clear(this.#idleTimer)
    this.#idleTimer = undefined
    // Unread bytes belong to the consumer; a full audio ring is not a network stall.
    if (!this.#closed && !this.readable)
      this.#idleTimer = Timer.set(() => this.#finish(new Error('Media request timed out')), 10_000)
  }

  #disconnect() {
    this.#generation += 1
    if (this.#idleTimer !== undefined) Timer.clear(this.#idleTimer)
    this.#idleTimer = undefined
    const client = this.#client
    this.#request = this.#client = undefined
    this.readable = 0
    client?.close()
  }

  #finish(error) {
    if (this.#closed) return
    const callback = this.#options.onDone
    this.close()
    callback?.(error)
  }

  #open() {
    if (this.#closed) return
    const generation = ++this.#generation
    const current = () => !this.#closed && generation === this.#generation
    try {
      const url = this.#url
      const provider = device.network[url.protocol === 'https:' ? 'https' : 'http'].client
      this.#accepted = false
      this.#received = 0
      this.#length = undefined
      this.#framed = false
      this.#armTimeout()
      // SDK HTTPClient cannot cancel an outstanding DNS resolution. Suppress
      // its completion after stop/redirect so it cannot open an orphan socket.
      const dns = provider.dns && {
        ...provider.dns,
        io: class {
          constructor(options) {
            this.resolver = new provider.dns.io(options)
          }
          resolve(options) {
            this.resolver.resolve({
              ...options,
              onResolved: (...args) => {
                if (current()) options.onResolved?.(...args)
              },
              onError: (...args) => {
                if (current()) options.onError?.(...args)
              },
            })
          }
        },
      }
      this.#client = new provider.io({
        ...provider,
        ...(dns && { dns }),
        onError: (error) => {
          if (current()) this.#finish(error || new Error('Media connection failed'))
        },
        host: url.hostname,
        port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
      })
      this.#request = this.#client.request({
        path: `${url.pathname}${url.search}` || '/',
        headers: new Map([
          ['accept-encoding', 'identity'],
          ['connection', 'close'],
          ...(this.#options.rangeStart > 0
            ? [
                ['range', `bytes=${this.#options.rangeStart}-`],
                ...(this.#options.ifRange ? [['if-range', this.#options.ifRange]] : []),
              ]
            : []),
        ]),
        onHeaders: (status, headers) => {
          if (!current()) return
          try {
            if (REDIRECTS.includes(status)) {
              const location = headers.get('location')
              if (!location) throw new Error('Redirect has no Location')
              if (++this.#redirects > 5) throw new Error('Too many redirects')
              this.#url = mediaURL(location, this.#url.href)
              this.#disconnect()
              this.#timer = Timer.set(() => {
                this.#timer = undefined
                this.#open()
              })
              return
            }
            if (status !== 200 && !(status === 206 && this.#options.rangeStart > 0)) throw new Error(`HTTP ${status}`)
            const encoding = headers.get('content-encoding')
            if (encoding && encoding.toLowerCase() !== 'identity')
              throw new Error('Compressed HTTP responses are not supported')
            const length = headers.get('content-length')
            const chunked = headers.get('transfer-encoding')?.toLowerCase() === 'chunked'
            if (!chunked && length !== undefined && length !== null) {
              if (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))
                throw new Error('Invalid Content-Length')
              this.#length = Number(length)
            }
            let start = 0,
              totalBytes = this.#length
            if (status === 206) {
              const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(headers.get('content-range') ?? '')
              if (!range) throw new Error('Invalid Content-Range')
              const [, first, last, total] = range.map(Number)
              if (
                ![first, last, total].every(Number.isSafeInteger) ||
                first !== this.#options.rangeStart ||
                last < first ||
                last !== total - 1 ||
                (this.#length !== undefined && this.#length !== last - first + 1)
              )
                throw new Error('Unexpected Content-Range')
              start = first
              totalBytes = total
              this.#length = last - first + 1
            }
            const etag = headers.get('etag')
            const validator = etag && !etag.startsWith('W/') ? etag : headers.get('last-modified')
            this.#framed = chunked || this.#length !== undefined
            this.#accepted = true
            this.#options.onHeaders?.(headers, this.#url.href, { start, totalBytes, validator })
          } catch (error) {
            this.#finish(error)
          }
        },
        onReadable: (count) => {
          if (!current() || !this.#accepted) return
          this.readable = count
          this.#armTimeout()
          try {
            this.#options.onReadable?.(count)
          } catch (error) {
            this.#finish(error)
          }
        },
        onDone: (error) => {
          if (!current()) return
          if (
            !error &&
            (!this.#accepted || !this.#framed || (this.#length !== undefined && this.#received !== this.#length))
          )
            error = new Error('Incomplete media response')
          this.#finish(error || undefined)
        },
      })
    } catch (error) {
      if (current()) this.#finish(error)
    }
  }
}
