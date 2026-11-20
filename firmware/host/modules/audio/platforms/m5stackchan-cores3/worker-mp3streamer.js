import MediaHttpStream from 'media-http'
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
  #request
  #networkOptions
  #networkGeneration = 0
  #networkReconnectTimer
  #networkBackoffIndex = 0
  #reconnect = true
  #input = SharedByteRing.allocate(COMPRESSED_RING_BYTES)
  #output = SharedByteRing.allocate(PCM_RING_BYTES)
  #receivedBytes = 0
  #finite = false
  #networkPumpTimer
  #seek
  #source

  constructor(options) {
    if (options.onPlayed) this.#callbacks.onPlayed = options.onPlayed
    if (options.onReady) this.#callbacks.onReady = options.onReady
    if (options.onError) this.#callbacks.onError = options.onError
    if (options.onDone) this.#callbacks.onDone = options.onDone
    for (const name of ['onMetadata', 'onCheckpoint', 'onOutputStart', 'onSource'])
      this.#callbacks[name] = options[name]
    this.#seek = options.seek ?? { offset: 0, seconds: 0, target: 0 }
    this.#source = options.source
    this.#finite = options.mode === 'finite'
    this.#reconnect = !this.#finite && (options.reconnect ?? true)

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
      mode: options.mode,
      seekSeconds: this.#seek.target,
      queueLength: WORKER_AUDIO_QUEUE_LENGTH,
      sampleRate: options.audio.sampleRate ?? 44100,
      outputSampleRate: this.#audio.sampleRate,
      completion: this.#completion,
      input: this.#input.buffers,
      output: this.#output.buffers,
    })
    this.#networkOptions = {
      protocol: options.protocol ?? (options.port === 443 ? 'https' : 'http'),
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
    try {
      this.#worker?.postMessage({ id: 'close' })
    } catch {
      this.#worker?.terminate()
      this.#worker = undefined
    }
    this.#audio = this.#input = this.#output = this.#networkOptions = undefined
  }

  #openNetwork() {
    if (this.#closed) return
    const options = this.#networkOptions
    if (!options) return
    this.#networkReconnectTimer = undefined
    const generation = ++this.#networkGeneration
    try {
      const port = options.port ? `:${options.port}` : ''
      this.#request = new MediaHttpStream({
        // Resolve redirects again: signed CDN URLs may expire while playback is paused.
        url: `${options.protocol}://${options.host}${port}${options.path}`,
        rangeStart: this.#seek.offset,
        ifRange: this.#source?.validator,
        onHeaders: (_headers, url, info) => {
          this.#networkBackoffIndex = 0
          if (info.start && this.#source?.totalBytes !== undefined && info.totalBytes !== this.#source.totalBytes)
            throw new Error('Media changed while seeking')
          const source = { url, totalBytes: info.totalBytes, validator: info.validator }
          this.#callbacks.onSource?.(source, this.#seek.offset > 0 && info.start === 0)
          if (this.#finite)
            this.#worker.postMessage({
              id: 'source',
              offset: info.start,
              seconds: info.start ? this.#seek.seconds : 0,
              totalBytes: info.totalBytes,
            })
        },
        onReadable: () => this.#drainNetwork(),
        onDone: (error) => {
          if (this.#closed || generation !== this.#networkGeneration) return
          if (!error && this.#finite) {
            this.#closeNetwork()
            this.#worker.postMessage({ id: 'end' })
          } else this.#handleNetworkFailure(error ? String(error) : 'connection closed')
        },
      })
      // Metadata consumption may produce no PCM. Pump backpressure independently
      // of output notifications so a tag larger than the input ring cannot deadlock.
      this.#networkPumpTimer = Timer.repeat(() => this.#drainNetwork(), 25)
    } catch (error) {
      if (generation !== this.#networkGeneration || this.#closed) return
      this.#handleNetworkFailure(String(error))
    }
  }

  #drainNetwork() {
    const request = this.#request
    const input = this.#input
    if (!request || !input) return
    try {
      while (request.readable && input.writableBytes) {
        const target = input.writableView(request.readable)
        if (!target.byteLength) break
        request.read(target)
        input.advanceWrite(target.byteLength)
        this.#receivedBytes += target.byteLength
      }
    } catch (error) {
      this.#handleNetworkFailure(String(error))
    }
  }

  #handleNetworkFailure(reason) {
    if (this.#reconnect) {
      this.#scheduleNetworkReconnect(reason)
      return
    }
    this.#closeNetwork()
    this.#callbacks.onError?.call(this, reason)
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
    if (this.#networkPumpTimer !== undefined) Timer.clear(this.#networkPumpTimer)
    this.#networkPumpTimer = undefined
    const http = this.#request
    this.#request = undefined
    try {
      http?.close()
    } catch {}
  }

  #onMessage(message) {
    if (message.id === 'closed') {
      this.#worker = undefined
      return
    }
    if (this.#closed) return
    switch (message.id) {
      case 'metadata':
        this.#callbacks.onMetadata?.(message.value)
        break
      case 'checkpoint':
        this.#callbacks.onCheckpoint?.(message.value)
        break
      case 'position':
        this.#callbacks.onOutputStart?.(message.seconds)
        break
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
