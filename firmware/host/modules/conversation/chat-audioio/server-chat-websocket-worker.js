/*
 * Copyright (c) 2026 Shinya Ishikawa
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

import ChatWorker from 'ChatWorker'
import JSONBase64Parser from 'JSONBase64Parser'
import TextEncoder from 'text/encoder'

const text = Object.freeze({ binary: false })
const MAX_QUEUED_BYTES = 64 * 1024

export default class ServerChatWebSocketWorker extends ChatWorker {
  #buffers = []
  #queuedBytes = 0
  #socketIO = null
  #state = 0
  #writable = 0
  #encoder = new TextEncoder()

  constructor(options) {
    super(options)
    this.ws = null
    this.secure = true
    this.host = ''
    this.path = '/'
    this.port = 443
    this.headers = []
    this.outputMinimum = (options.outputSampleRate ?? 24000) >> 1
    this.silence = new ArrayBuffer(this.outputMinimum)
  }

  close() {
    const ws = this.ws
    this.ws = null
    this.#buffers = []
    this.#queuedBytes = 0
    this.#socketIO = null
    this.#state = 0
    this.#writable = 0
    try {
      ws?.close()
    } catch {
      // The transport may already be closed.
    }
  }

  connect(message) {
    super.connect(message)
    this.parser = new JSONBase64Parser(this, this.outputBuffer, 2, this.outputMinimum)
    this.parser.barrier = message.barrier
    const network = this.secure ? device.network.wss : device.network.ws
    const WebSocketClient = network.io ?? device.network.ws.io
    this.#socketIO = WebSocketClient
    this.ws = new WebSocketClient({
      ...network,
      host: this.host,
      path: this.path,
      port: this.port,
      headers: this.headers,
      onClose: () => {},
      onControl: (opcode, data) => {
        switch (opcode) {
          case WebSocketClient.close: {
            const bytes = new Uint8Array(data)
            const code = bytes.length >= 2 ? (bytes[0] << 8) | bytes[1] : 1006
            const reason = bytes.length > 2 ? String.fromArrayBuffer(bytes.buffer.slice(2)) : 'connection closed'
            if (code !== 1000) this.postMessage({ id: 'failed', string: reason })
            else this.postMessage({ id: 'disconnected' })
            this.close()
            break
          }
          case WebSocketClient.ping:
          case WebSocketClient.pong:
            break
        }
      },
      onError: (error) => {
        const detail = error?.message ?? error
        this.postMessage({ id: 'failed', string: detail ? `network error: ${detail}` : 'network error' })
        this.close()
      },
      onReadable: (count, options) => {
        const buffer = this.ws.read(count)
        this.#open()
        if (this.#state === 1) this.read(buffer, options)
      },
      onWritable: (count) => {
        if (!count) return
        this.#writable = count
        this.#open()
        this.flushWrites()
      },
    })
  }

  disconnect() {
    const WebSocketClient = this.#socketIO
    if (!this.ws || !WebSocketClient) return
    const code = 1000
    this.write(Uint8Array.of(code >> 8, code & 0xff), {
      opcode: WebSocketClient.close,
    })
    this.#state = 2
  }

  isBase64() {
    return false
  }

  onBase64(offset, size) {
    this.postMessage({ id: 'receiveAudio', offset, size })
  }

  onJSON(json) {
    const type = json.type
    const handlers = this.eventHandlers
    if (typeof type === 'string' && handlers?.[type] === true && typeof this[type] === 'function') {
      this[type](json)
    }
  }

  onOpen() {}

  #open() {
    if (this.#state !== 0) return
    this.#state = 1
    this.onOpen()
  }

  read(data, options) {
    this.parser.read(data)
    if (options.more) return
    this.onJSON(this.parser.result)
    this.parser.reset()
  }

  sendAudio(message) {
    const samples = new Uint8Array(this.inputBuffer, message.offset, message.size)
    this.sendAudioBuffer(samples)
  }

  sendAudioBuffer(samples) {
    const string = samples.toBase64()
    const data = new Uint8Array(this.audioPrefix.length + string.length + this.audioSuffix.length)
    data.set(this.audioPrefix)
    this.#encoder.encodeInto(string, data.subarray(this.audioPrefix.length))
    data.set(this.audioSuffix, this.audioPrefix.length + string.length)
    this.write(data, text)
  }

  sendJSON(json) {
    this.write(ArrayBuffer.fromString(JSON.stringify(json)), text)
  }

  write(data, options) {
    if (!this.ws) return
    if (this.#buffers.length) {
      this.enqueue(data, options)
      return
    }
    const writable = this.#writable
    if (data.byteLength <= writable) {
      this.#writable = this.ws.write(data, options)
      return
    }
    if (writable > 0) {
      this.#writable = this.ws.write(data.slice(0, writable), {
        ...options,
        more: true,
      })
      this.enqueue(data.slice(writable), options)
      return
    }
    this.enqueue(data, options)
  }

  enqueue(data, options) {
    if (this.#queuedBytes + data.byteLength > MAX_QUEUED_BYTES) {
      this.postMessage({ id: 'failed', string: 'websocket backpressure' })
      this.close()
      return
    }
    this.#buffers.push({ data, options })
    this.#queuedBytes += data.byteLength
  }

  flushWrites() {
    while (this.#buffers.length && this.ws) {
      const buffer = this.#buffers[0]
      const data = buffer.data
      const writable = this.#writable
      if (data.byteLength <= writable) {
        this.#writable = this.ws.write(data, buffer.options)
        this.#queuedBytes -= data.byteLength
        this.#buffers.shift()
        continue
      }
      if (writable > 0) {
        this.#writable = this.ws.write(data.slice(0, writable), {
          ...buffer.options,
          more: true,
        })
        buffer.data = data.slice(writable)
        this.#queuedBytes -= writable
      }
      break
    }
  }
}
