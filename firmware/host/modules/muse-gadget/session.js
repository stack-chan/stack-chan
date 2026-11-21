// Socket/native dependencies are injected so lifecycle tests need no credentials.
// These tests cannot establish server interoperability.
export class MuseSession {
  constructor(options, dependencies) {
    this.options = options
    this.dependencies = dependencies
    this.generation = 0
    this.state = 'stopped'
    this.timers = []
  }

  connect() {
    this.close()
    const { host, vmId, token, nodeId } = this.options
    if (
      typeof host !== 'string' ||
      !/^[a-zA-Z0-9.-]{1,253}$/.test(host) ||
      typeof vmId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(vmId) ||
      typeof token !== 'string' ||
      !/^[\x21-\x7e]{1,2048}$/.test(token) ||
      typeof nodeId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(nodeId)
    ) {
      throw new Error('Muse host, vmId, token and stable nodeId are required')
    }
    const generation = this.generation
    this.control = new Uint8Array(4096)
    this.controlSize = 0
    this.line = new Uint8Array(8192)
    this.lineSize = 0
    this.seen = []
    this.chatStream = undefined
    this.nextStream = 5
    this.sequence = 0
    this.changeState('connecting')
    if (generation !== this.generation) return
    try {
      this.transport = this.dependencies.open(this.options, (type, data) => {
        if (generation !== this.generation) return
        try {
          this.event(type, data)
        } catch {
          this.fail()
        }
      })
      this.timeout = this.timer(() => this.fail(), 15000)
    } catch {
      this.fail()
    }
  }

  changeState(state) {
    this.state = state
    this.dependencies.onState?.(state)
  }

  timer(callback, milliseconds) {
    const generation = this.generation
    const handle = this.dependencies.setTimer(() => {
      this.timers = this.timers.filter((entry) => entry !== handle)
      if (generation === this.generation) {
        try {
          callback()
        } catch {
          this.fail()
        }
      }
    }, milliseconds)
    this.timers.push(handle)
    return handle
  }

  fail() {
    this.close()
    this.changeState('failed') // No raw SDK/server error or credential is logged.
  }

  close() {
    this.generation++
    const transport = this.transport
    this.transport = undefined
    for (const timer of this.timers) this.dependencies.clearTimer(timer)
    this.timers = []
    this.control = undefined
    this.line = undefined
    this.seen = undefined
    this.chatStream = undefined
    this.state = 'stopped'
    transport?.close()
  }

  event(type, data) {
    if (type === 3) throw new Error('transport failed')
    if (type === 1) {
      if (this.state !== 'connecting') throw new Error('unexpected transport open')
      this.transport.start()
      this.changeState('noise-handshake')
      return
    }
    if (type !== 2) throw new Error('unexpected event')
    if (this.state === 'noise-handshake') {
      this.transport.handshake(data)
      this.transport.request(1, 0, new ArrayBuffer(0))
      this.changeState('registering')
      if (this.state !== 'registering') return
      this.sendControl({
        type: 'req',
        id: 'stackchan-register',
        method: 'link.register',
        params: {
          node_id: this.options.nodeId,
          display_name: 'Stack-chan',
          platform: 'esp32',
          version: 'experimental-1',
          device_family: 'link',
          model_id: 'stack-chan',
          is_wakeup_supported: false,
          commands_v2: {
            'stackchan.smile': {
              description: 'Set the face to HAPPY; no movement or audio',
              required: {},
              optional: {},
            },
          },
        },
      })
      return
    }
    const frame = this.transport.receive(data)
    if (!frame) return
    if (frame.kind === 4 || (frame.kind === 2 && (frame.status < 200 || frame.status >= 300))) {
      throw new Error('stream rejected')
    }
    if (frame.stream === 1) {
      if (frame.end) throw new Error('control ended')
      this.feedControl(frame.body)
    } else if (frame.stream === 3) {
      if (frame.end) throw new Error('subscription ended')
      this.feedText(frame.body)
    } else if (frame.stream === this.chatStream && frame.end) {
      this.chatStream = undefined
    }
  }

  sendControl(value) {
    const body = this.dependencies.encode(JSON.stringify(value))
    if (body.byteLength > 4092) throw new Error('control message too large')
    const data = new Uint8Array(body.byteLength + 4)
    new DataView(data.buffer).setUint32(0, body.byteLength, true)
    data.set(new Uint8Array(body), 4)
    this.transport.chunk(data.buffer)
  }

  feedControl(buffer) {
    const input = new Uint8Array(buffer)
    // Parse incrementally; the concatenation is bounded even with coalesced messages.
    for (const byte of input) {
      if (this.controlSize >= 4096) throw new Error('control buffer exceeded')
      this.control[this.controlSize++] = byte
      if (this.controlSize < 4) continue
      const size = new DataView(this.control.buffer).getUint32(0, true)
      if (size === 0 || size > 4092) throw new Error('control size invalid')
      if (this.controlSize !== size + 4) continue
      const message = JSON.parse(this.dependencies.decode(this.control.slice(4, size + 4).buffer))
      this.controlSize = 0
      const generation = this.generation
      this.controlMessage(message)
      if (generation !== this.generation) return
    }
  }

  controlMessage(message) {
    if (message.type === 'event' && ['link.unpaired', 'node.unpaired'].includes(message.event)) {
      throw new Error('pairing revoked')
    }
    if (this.state === 'registering' && message.id === 'stackchan-register') {
      if (message.type !== 'res' || message.error || message.result?.status !== 'registered') {
        throw new Error('registration rejected')
      }
      this.transport.request(3, 2, this.dependencies.encode('{}'))
      this.changeState('subscribing')
      return
    }
    if (message.method !== 'link.invoke' || this.state !== 'ready') return
    if (typeof message.id !== 'string' || message.id.length > 128 || this.seen.includes(message.id)) return
    this.seen.push(message.id)
    if (this.seen.length > 32) this.seen.shift()
    const allowed =
      message.command === 'stackchan.smile' &&
      (message.params === undefined ||
        (message.params !== null &&
          typeof message.params === 'object' &&
          !Array.isArray(message.params) &&
          Object.keys(message.params).length === 0))
    if (allowed) {
      const generation = this.generation
      this.dependencies.onSmile?.()
      if (generation !== this.generation) return
    }
    this.sendControl({
      method: 'link.result',
      id: message.id,
      ok: allowed,
      ...(allowed ? { payload: { emotion: 'HAPPY' } } : { error: 'unsupported command or parameters' }),
    })
  }

  feedText(buffer) {
    for (const byte of new Uint8Array(buffer)) {
      if (this.lineSize >= 8192) throw new Error('subscription line too large')
      if (byte !== 10) {
        this.line[this.lineSize++] = byte
        continue
      }
      if (!this.lineSize) continue
      const message = JSON.parse(this.dependencies.decode(this.line.slice(0, this.lineSize).buffer))
      this.lineSize = 0
      if (this.state === 'subscribing') {
        if (message.error || (message.type !== 'res' && !message.result)) throw new Error('subscription rejected')
        this.dependencies.clearTimer(this.timeout)
        this.timers = this.timers.filter((entry) => entry !== this.timeout)
        this.changeState('ready')
        if (this.state !== 'ready') return
        this.heartbeat()
      }
      if (this.state !== 'ready') return
      if (message.type !== 'event') continue
      if (Number.isSafeInteger(message.seq) && message.seq > 0) {
        if (message.seq <= this.sequence) continue
        this.sequence = message.seq
      }
      if (message.event === 'delta.text_append' && typeof message.payload?.text === 'string') {
        const generation = this.generation
        this.dependencies.onText?.(message.payload.text)
        if (generation !== this.generation) return
      }
    }
  }

  heartbeat() {
    this.timer(() => {
      if (this.state !== 'ready') return
      this.sendControl({ method: 'link.heartbeat' })
      this.heartbeat()
    }, 30000)
  }

  sendText(text) {
    if (this.state !== 'ready' || this.chatStream !== undefined) throw new Error('Muse is not ready for text')
    if (typeof text !== 'string' || !text.length) throw new Error('text is required')
    const body = this.dependencies.encode(JSON.stringify({ message: text, output_modality: 'text' }))
    if (body.byteLength > 4096 || this.nextStream > 0x7ffffffd) throw new Error('text limit exceeded')
    this.chatStream = this.nextStream
    this.nextStream += 2
    try {
      this.transport.request(this.chatStream, 1, body)
    } catch {
      this.fail()
    }
  }
}
