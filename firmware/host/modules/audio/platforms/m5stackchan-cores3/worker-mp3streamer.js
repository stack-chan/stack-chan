import Timer from 'timer'
import { SharedByteRing } from 'web-radio-byte-ring'
import Worker from 'worker'

const WORKER_AUDIO_QUEUE_LENGTH = 48
const COMPRESSED_RING_BYTES = 512 * 1024
const PCM_RING_BYTES = 64 * 1024
const NETWORK_RECONNECT_DELAYS_MS = [250, 500, 1000, 2000, 5000]

export default class {
  #audio
  #completion = new Int32Array(new SharedArrayBuffer(4))
  #worker
  #callbacks = {}
  #closed = false
  #http
  #request
  #networkOptions
  #networkGeneration = 0
  #networkReconnectTimer
  #networkBackoffIndex = 0
  #input = SharedByteRing.allocate(COMPRESSED_RING_BYTES)
  #output = SharedByteRing.allocate(PCM_RING_BYTES)
  #receivedBytes = 0
  #connectionReceivedBytes = 0

  constructor(options) {
    if (options.onPlayed) this.#callbacks.onPlayed = options.onPlayed
    if (options.onReady) this.#callbacks.onReady = options.onReady
    if (options.onError) this.#callbacks.onError = options.onError
    if (options.onDone) this.#callbacks.onDone = options.onDone

    this.#audio = options.audio.out
    this.#audio.attachSharedOutput(this.#output, this.#completion, () => {
      if (!this.#closed) this.#callbacks.onPlayed?.call(this)
    })

    this.#worker = new Worker('web-radio-stream-worker', {
      static: 512 * 1024,
      chunk: {
        initial: 96 * 1024,
        incremental: 16 * 1024,
      },
      heap: {
        initial: 2048,
        incremental: 256,
      },
      stack: 1024,
      // The measured high-water mark shows about 3.5 KiB maximum use while
      // decoding this stream. Keep nearly twice that amount as headroom and
      // return scarce internal RAM to the decoder's hot work buffers.
      nativeStack: 10 * 1024,
      core: 1,
      priority: 1,
    })
    this.#worker.onmessage = (message) => this.#onMessage(message)
    this.#worker.postMessage({
      id: 'start',
      queueLength: WORKER_AUDIO_QUEUE_LENGTH,
      sampleRate: options.audio.sampleRate ?? 44100,
      outputSampleRate: this.#audio.sampleRate,
      completion: this.#completion,
      input: this.#input.buffers,
      output: this.#output.buffers,
    })
    this.#networkOptions = {
      http: options.http,
      host: options.host,
      port: options.port,
      path: options.path,
      request: options.request,
    }
    this.#openNetwork()
  }

  close() {
    if (this.#closed) return
    this.#closed = true
    Atomics.store(this.#completion, 0, 0)
    this.#audio?.detachSharedOutput(this.#output)
    this.#closeNetwork()
    this.#worker?.postMessage({ id: 'close' })
    this.#worker?.terminate()
    this.#worker = this.#audio = this.#input = this.#output = this.#networkOptions = undefined
  }

  #openNetwork() {
    if (this.#closed) return
    const options = this.#networkOptions
    if (!options) return
    this.#networkReconnectTimer = undefined
    const generation = ++this.#networkGeneration
    const httpOptions = { ...options.http, host: options.host }
    if (options.port) httpOptions.port = options.port
    let http
    let request
    try {
      http = new options.http.io(httpOptions)
      this.#http = http
      this.#connectionReceivedBytes = 0
      request = http.request({
        ...options.request,
        path: options.path,
        onHeaders: (status, headers) => {
          if (!this.#isCurrentNetwork(generation, http, request)) return
          trace(
            `[web-radio-network] http status=${status} length=${headers.get('content-length') ?? 'none'} encoding=${headers.get('transfer-encoding') ?? 'none'} connection=${headers.get('connection') ?? 'none'}\n`,
          )
          if (Math.idiv(status, 100) === 2) {
            this.#networkBackoffIndex = 0
            return
          }
          this.#scheduleNetworkReconnect(`http status ${status}`)
        },
        onReadable: (count) => {
          if (!this.#isCurrentNetwork(generation, http, request)) return
          request.readable = count
          this.#drainNetwork()
        },
        onDone: (error) => {
          if (!this.#isCurrentNetwork(generation, http, request)) return
          trace(
            `[web-radio-network] http done error=${error ? String(error) : 'none'} connectionReceived=${this.#connectionReceivedBytes} totalReceived=${this.#receivedBytes} buffered=${this.#input.readableBytes}\n`,
          )
          this.#scheduleNetworkReconnect(error ? String(error) : 'connection closed')
        },
      })
      this.#request = request
    } catch (error) {
      if (generation !== this.#networkGeneration || this.#closed) return
      try {
        http?.close()
      } catch {}
      this.#http = this.#request = undefined
      this.#scheduleNetworkReconnect(String(error))
    }
  }

  #drainNetwork() {
    const request = this.#request
    const input = this.#input
    if (!request || !input) return
    while (request.readable && input.writableBytes) {
      const target = input.writableView(request.readable)
      if (!target.byteLength) break
      request.read(target)
      request.readable -= target.byteLength
      input.advanceWrite(target.byteLength)
      this.#receivedBytes += target.byteLength
      this.#connectionReceivedBytes += target.byteLength
    }
  }

  #isCurrentNetwork(generation, http, request) {
    return !this.#closed && generation === this.#networkGeneration && http === this.#http && request === this.#request
  }

  #scheduleNetworkReconnect(reason) {
    if (this.#closed || this.#networkReconnectTimer !== undefined) return
    const delay =
      NETWORK_RECONNECT_DELAYS_MS[Math.min(this.#networkBackoffIndex, NETWORK_RECONNECT_DELAYS_MS.length - 1)]
    this.#networkBackoffIndex += 1
    const buffered = this.#input?.readableBytes ?? 0
    this.#closeNetwork(false)
    trace(`[web-radio-network] reconnect reason=${reason} delay=${delay}ms buffered=${buffered}\n`)
    this.#networkReconnectTimer = Timer.set(() => this.#openNetwork(), delay)
  }

  #closeNetwork(clearReconnect = true) {
    this.#networkGeneration += 1
    if (clearReconnect && this.#networkReconnectTimer !== undefined) Timer.clear(this.#networkReconnectTimer)
    if (clearReconnect) this.#networkReconnectTimer = undefined
    const http = this.#http
    this.#request = this.#http = undefined
    try {
      http?.close()
    } catch {}
  }

  #onMessage(message) {
    if (this.#closed) return
    switch (message.id) {
      case 'output':
        this.#audio.pumpSharedOutput()
        this.#drainNetwork()
        break
      case 'ready':
        this.#callbacks.onReady?.call(this, message.value)
        break
      case 'error':
        this.#callbacks.onError?.call(this, message.reason)
        break
      case 'done':
        this.#callbacks.onDone?.call(this)
        break
    }
  }
}
