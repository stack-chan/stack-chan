import { MuseChatTurn } from './chat-turn.js'

function error(code = 'provider_failed') {
  return Object.assign(new Error('Muse chat operation failed'), { code })
}

export class MuseChatSession {
  constructor(options, dependencies) {
    if (
      typeof options.nodeId !== 'string' ||
      typeof options.sessionId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(options.nodeId) ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(options.sessionId)
    )
      throw error('unsupported_capability')
    this.options = { ...options }
    this.dependencies = dependencies
    this.state = 'closed'
    this.generation = 0
    this.timers = []
    this.retired = []
  }

  timer(callback, milliseconds) {
    const generation = this.generation
    const timer = this.dependencies.setTimer(() => {
      this.timers = this.timers.filter((value) => value !== timer)
      if (generation !== this.generation) return
      try {
        callback()
      } catch (cause) {
        this.fail(cause?.code)
      }
    }, milliseconds)
    this.timers.push(timer)
    return timer
  }

  clear(timer) {
    this.dependencies.clearTimer(timer)
    this.timers = this.timers.filter((value) => value !== timer)
  }

  connect() {
    if (this.poisoned) return Promise.reject(error('cancelled_unconfirmed'))
    if (this.state !== 'closed') return Promise.reject(error('device_busy'))
    this.state = 'connecting'
    this.nextStream = 3
    this.generation++
    const generation = this.generation
    return new Promise((resolve, reject) => {
      this.opening = { resolve, reject }
      this.connectionTimer = this.timer(() => this.fail('deadline_exceeded'), 20000)
      try {
        this.transport = this.dependencies.open(this.options, (type, data) => {
          if (generation !== this.generation) return
          try {
            this.event(type, data)
          } catch (cause) {
            this.fail(cause?.code)
          }
        })
      } catch {
        this.fail()
      }
    })
  }

  allocate() {
    if (this.nextStream > 0x7ffffffd) throw error('resource_exhausted')
    const stream = this.nextStream
    this.nextStream += 2
    return stream
  }

  event(type, data) {
    if (type === 3) { this.dependencies.onDiagnostic?.('note_transport_closed'); const reason = new Uint8Array(data ?? new ArrayBuffer(0)); if (reason.length === 1 && reason[0] <= 23) this.dependencies.onDiagnostic?.(`note_transport_reason_${reason[0]}`); throw error() }
    if (type === 1) {
      if (this.state !== 'connecting') throw error()
      this.transport.start()
      this.state = 'handshake'
      return
    }
    if (type !== 2) throw error()
    if (this.state === 'handshake') {
      this.transport.handshake(data)
      this.clear(this.connectionTimer)
      this.state = 'ready'
      const opening = this.opening
      this.opening = undefined
      opening.resolve()
      return
    }
    const frame = this.transport.receive(data)
    if (!frame) return
    if (frame.kind === 2 && Number.isInteger(frame.status)) this.dependencies.onDiagnostic?.(`note_http_${frame.status}`)
    if (frame.kind === 4) {
      this.dependencies.onDiagnostic?.('note_reset_received')
      if (
        frame.stream === this.tts?.stream ||
        frame.stream === this.pending?.subscription ||
        frame.stream === this.pending?.request
      )
        throw error()
      return
    }
    if (this.tts && frame.stream === this.tts.stream) {
      this.feedTts(frame)
      return
    }
    const pending = this.pending
    if (!pending) return
    if (frame.stream === pending.subscription) {
      if (frame.kind === 2) {
        if (frame.status === 404 && !pending.sent) {
          pending.fresh = true
          pending.subscription = undefined
          this.post()
          return
        }
        if (frame.status < 200 || frame.status >= 300) throw error()
        if (!pending.sent) this.post()
      }
      this.feedLines(frame.body)
      if (frame.end) { this.dependencies.onDiagnostic?.('note_subscription_end'); throw error() }
    } else if (frame.stream === pending.request) {
      if (frame.kind === 2 && (frame.status < 200 || frame.status >= 300)) throw error()
      for (const byte of new Uint8Array(frame.body ?? new ArrayBuffer(0))) {
        if (pending.ack.length >= 8192) throw error('resource_exhausted')
        pending.ack.push(byte)
      }
      if (frame.end) {
        const acknowledgement = JSON.parse(this.dependencies.decode(Uint8Array.from(pending.ack).buffer))
        if (acknowledgement.error || acknowledgement.ok === false) throw error()
        this.dependencies.onDiagnostic?.('note_ack_received')
        pending.turn.acknowledge(acknowledgement, this.dependencies.now())
        pending.request = undefined
        if (pending.fresh) this.subscribe()
      }
    }
  }

  subscribe() {
    this.pending.line = new Uint8Array(262144)
    this.pending.lineLength = 0
    this.pending.subscription = this.allocate()
    this.transport.request(
      this.pending.subscription,
      2,
      this.dependencies.encode(JSON.stringify({ session_id: this.options.sessionId })),
    )
  }

  post() {
    const pending = this.pending
    this.dependencies.onDiagnostic?.('note_post_begin')
    pending.sent = true
    pending.request = this.allocate()
    if (pending.body instanceof ArrayBuffer) {
      this.transport.request(pending.request, 1, pending.body)
      return
    }
    const iterator = pending.body[Symbol.iterator]()
    let sent = 0
    let encodingMs = 0, sendingMs = 0, chunks = 0
    this.transport.request(pending.request, 3, new ArrayBuffer(0))
    const pump = () => {
      if (this.pending !== pending) return
      const beforeEncoding = this.dependencies.now()
      const next = iterator.next()
      if (next.done) {
        if (sent !== pending.body.byteLength) throw error('resource_exhausted')
        this.transport.bodyChunk(pending.uploadStream, new ArrayBuffer(0), true)
        this.dependencies.onDiagnostic?.('note_upload_complete')
        this.dependencies.onUploadMetrics?.({ encodingMs, sendingMs, chunks, bytes: sent })
        pending.body = undefined
        return
      }
      const bytes = this.dependencies.encode(next.value)
      encodingMs += this.dependencies.now() - beforeEncoding
      sent += bytes.byteLength
      if (!bytes.byteLength || bytes.byteLength > 4096 || sent > pending.body.byteLength)
        throw error('resource_exhausted')
      const beforeSend = this.dependencies.now()
      this.transport.bodyChunk(pending.uploadStream, bytes, false)
      sendingMs += this.dependencies.now() - beforeSend
      chunks++
      this.timer(pump, 0)
    }
    pending.uploadStream = pending.request
    this.timer(pump, 0)
  }

  feedLines(body) {
    const pending = this.pending
    for (const byte of new Uint8Array(body ?? new ArrayBuffer(0))) {
      if (byte !== 10) {
        if (pending.lineLength >= pending.line.length) throw error('resource_exhausted')
        pending.line[pending.lineLength++] = byte
      } else if (pending.lineLength) {
        pending.turn.feed(
          JSON.parse(this.dependencies.decode(pending.line.slice(0, pending.lineLength).buffer)),
          this.dependencies.now(),
        )
        pending.line.fill(0, 0, pending.lineLength)
        pending.lineLength = 0
      }
    }
  }

  send({ message, items, outputModality = 'text' }, { signal } = {}) {
    if (typeof message !== 'string' || (!message.length && !items) || !['text', 'voice'].includes(outputModality))
      return Promise.reject(error('unsupported_capability'))
    const body = this.dependencies.encode(
      JSON.stringify({
        message,
        ...(items ? { items } : {}),
        session_id: this.options.sessionId,
        output_modality: outputModality,
        device_id: this.options.nodeId,
        device: 'mcu-wearable',
      }),
    )
    if (body.byteLength > 4096) return Promise.reject(error('resource_exhausted'))
    return this.sendBody(body, { signal })
  }

  sendBody(body, { signal } = {}) {
    if (this.state !== 'ready' || this.pending || this.tts) return Promise.reject(error('device_busy'))
    if (signal?.aborted) return Promise.reject(error('cancelled'))
    if (
      !body ||
      !Number.isSafeInteger(body.byteLength) ||
      body.byteLength < 1 ||
      body.byteLength > 700000 ||
      (!(body instanceof ArrayBuffer) && typeof body[Symbol.iterator] !== 'function')
    )
      return Promise.reject(error('resource_exhausted'))
    if (body instanceof ArrayBuffer && body.byteLength > 4096) return Promise.reject(error('resource_exhausted'))
    return new Promise((resolve, reject) => {
      const abort = () => this.fail('cancelled_unconfirmed')
      const turn = new MuseChatTurn(this.options.sessionId, this.retired)
      this.pending = { body, resolve, reject, signal, abort, turn, ack: [], line: [] }
      signal?.addEventListener('abort', abort)
      const started = this.dependencies.now()
      const check = () => {
        const pending = this.pending
        if (!pending) return
        const now = this.dependencies.now()
        if (pending.turn.complete(now)) {
          this.transport.resetStream(pending.subscription)
          signal?.removeEventListener('abort', abort)
          this.pending = undefined
          this.retired.push(...turn.observed, ...turn.userIds)
          if (this.retired.length > 2048) {
            reject(error('resource_exhausted'))
            this.close()
            return
          }
          resolve(turn.result())
        } else if (now - started >= (this.options.turnTimeoutMs ?? 120000)) this.fail('deadline_exceeded')
        else this.timer(check, 200)
      }
      try {
        this.subscribe()
        this.timer(check, 200)
      } catch {
        this.fail()
      }
    })
  }

  fail(code = 'provider_failed') {
    this.close(
      ['cancelled', 'cancelled_unconfirmed', 'deadline_exceeded', 'resource_exhausted'].includes(code)
        ? code
        : 'provider_failed',
    )
  }

  readTts(messageId, { signal, maxBytes = 1048576 } = {}) {
    if (this.state !== 'ready' || this.pending || this.tts) return Promise.reject(error('device_busy'))
    if (signal?.aborted) return Promise.reject(error('cancelled'))
    if (
      typeof messageId !== 'string' ||
      !messageId.length ||
      messageId.length > 128 ||
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 1 ||
      maxBytes > 1048576
    )
      return Promise.reject(error('resource_exhausted'))
    return new Promise((resolve, reject) => {
      const abort = () => this.fail('cancelled')
      const timer = this.timer(() => this.fail('deadline_exceeded'), 30000)
      this.tts = {
        messageId,
        signal,
        abort,
        timer,
        resolve,
        reject,
        maxBytes,
        chunks: [],
        size: 0,
        stream: this.allocate(),
      }
      signal?.addEventListener('abort', abort)
      try {
        this.transport.ttsRequest(this.tts.stream, messageId, false)
      } catch {
        this.fail()
      }
    })
  }

  feedTts(frame) {
    const tts = this.tts
    if (frame.kind === 2) {
      if (frame.status === 404 && !tts.legacy) {
        tts.legacy = true
        tts.stream = this.allocate()
        this.transport.ttsRequest(tts.stream, tts.messageId, true)
        return
      }
      if (frame.status < 200 || frame.status >= 300) throw error()
      tts.accepted = true
    }
    const body = new Uint8Array(frame.body ?? new ArrayBuffer(0))
    if (body.length) {
      if (!tts.accepted) throw error()
      tts.size += body.length
      if (tts.size > tts.maxBytes || tts.chunks.length >= 2048) throw error('resource_exhausted')
      tts.chunks.push(body.slice())
    }
    if (frame.end) {
      if (!tts.accepted || !tts.size) throw error()
      const result = new Uint8Array(tts.size)
      let offset = 0
      for (const chunk of tts.chunks) {
        result.set(chunk, offset)
        offset += chunk.length
      }
      this.clear(tts.timer)
      tts.signal?.removeEventListener('abort', tts.abort)
      this.tts = undefined
      tts.resolve(result)
    }
  }

  close(code = 'cancelled_unconfirmed') {
    this.generation++
    this.state = 'closed'
    const transport = this.transport
    this.transport = undefined
    for (const timer of this.timers) this.dependencies.clearTimer(timer)
    this.timers = []
    this.opening?.reject(error(code))
    this.opening = undefined
    const pending = this.pending
    this.pending = undefined
    if (pending?.sent) this.poisoned = true
    pending?.signal?.removeEventListener('abort', pending.abort)
    pending?.reject(error(code))
    const tts = this.tts
    this.tts = undefined
    tts?.signal?.removeEventListener('abort', tts.abort)
    tts?.reject(error(code))
    transport?.close()
  }
}

