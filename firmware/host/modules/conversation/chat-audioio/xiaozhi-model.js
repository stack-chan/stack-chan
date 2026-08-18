/*
 * Copyright (c) 2026 Shinya Ishikawa
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

import OpusDecoder from 'stackchanOpusDecoder'
import OpusEncoder from 'stackchanOpusEncoder'
import ServerChatWebSocketWorker from 'stackchanServerChatWebSocketWorker'
import Timer from 'timer'
import {
  parseJsonRpcMessage,
  parseXiaozhiV1ClientEvent,
  parseXiaozhiV1ServerEvent,
  sanitizeXiaozhiV1HelloExtension,
} from 'xiaozhi-contract'

const INPUT_SAMPLE_RATE = 16000
const INPUT_FRAME_DURATION = 60
const OPUS_MAX_PACKET_BYTES = 1275
const MCP_PROTOCOL_VERSION = '2024-11-05'
const headerIdentity = /^[\x21-\x7e]{1,200}$/
const bearerTokenValue = /^[\x21-\x7e]{1,4096}$/
const binary = Object.freeze({ binary: true })

export default class XiaozhiModel extends ServerChatWebSocketWorker {
  constructor(options) {
    super(options)
    this.configurationError = ''
    this.decoder = undefined
    this.decoderPCM = undefined
    this.decoderPacket = undefined
    this.silence = undefined
    this.outputSampleRate = 0
    this.encoder = undefined
    this.encoderPCM = undefined
    this.encoderPacket = undefined
    this.encoderTimer = undefined
    this.encoderFill = 0
    this.sessionID = ''
    this.uploading = false
    this.listeningMode = 'auto'
    this.features = {}
    this.helloExtension = {}
    this.functions = []
    this.functionByName = Object.create(null)
    this.pendingMcpCalls = Object.create(null)
    this.mcpServerInfo = { name: 'stack-chan', version: 'unknown' }
    this.resetDecodeStats()
    this.resetEncodeStats()
  }

  configure(message) {
    this.closeCodecs()
    this.configurationError = ''
    try {
      const configuration = normalizeConfiguration(message)
      const endpoint = parseWebSocketEndpoint(configuration.endpoint)
      const apiKey = String(configuration.authentication?.bearerToken ?? '')
      const deviceID = String(configuration.identity?.deviceId ?? '')
      const clientID = String(configuration.identity?.clientId ?? '')
      if (!deviceID || !clientID) throw new Error('XiaoZhi connection requires deviceId and clientId')
      if (!headerIdentity.test(deviceID) || !headerIdentity.test(clientID)) {
        throw new Error('XiaoZhi device identity contains invalid header characters')
      }
      if (apiKey && !bearerTokenValue.test(apiKey)) {
        throw new Error('XiaoZhi Bearer token contains invalid header characters')
      }
      if (!endpoint.secure && hasEmbeddedCredentials(endpoint.path)) {
        throw new Error('ChatService credentials must not be embedded in a ws:// endpoint')
      }
      if (!endpoint.secure && apiKey && !isTrustedLocalHost(endpoint.host)) {
        throw new Error('ChatService Bearer authentication over ws:// is restricted to trusted local networks')
      }

      this.secure = endpoint.secure
      this.host = endpoint.host
      this.port = endpoint.port
      this.path = endpoint.path
      this.headers = [
        ['Protocol-Version', '1'],
        ['Device-Id', deviceID],
        ['Client-Id', clientID],
      ]
      if (apiKey) this.headers.unshift(['Authorization', `Bearer ${apiKey}`])

      this.helloExtension = sanitizeXiaozhiV1HelloExtension(configuration.helloExtension)
      this.listeningMode = normalizeListeningMode(configuration.listeningMode)
      this.functions = Array.isArray(message.functions) ? message.functions : []
      this.functionByName = Object.create(null)
      for (const tool of this.functions) {
        if (tool && typeof tool.name === 'string' && tool.name) this.functionByName[tool.name] = tool
      }
      this.features = {
        mcp: configuration.features?.mcp === true || this.functions.length > 0,
        aec: configuration.features?.aec === true,
      }
      // Dynamic glyph rendering is not yet connected to the UI. Never advertise it.
      this.mcpServerInfo = {
        name: String(configuration.mcp?.serverInfo?.name ?? 'stack-chan'),
        version: String(configuration.mcp?.serverInfo?.version ?? 'unknown'),
      }
    } catch (error) {
      this.closeCodecs()
      this.configurationError = String(error?.message ?? error)
    }
  }

  connect(message) {
    if (this.configurationError) {
      this.postMessage({ id: 'failed', string: this.configurationError })
      return
    }
    super.connect(message)
  }

  disconnect() {
    this.uploading = false
    this.encoder?.clear()
    this.encoderFill = 0
    super.disconnect()
  }

  close() {
    try {
      super.close()
    } finally {
      // Native codec resources must be released even if transport cleanup fails.
      this.closeCodecs()
    }
  }

  closeCodecs() {
    if (this.encoderTimer !== undefined) Timer.clear(this.encoderTimer)
    this.decoder?.close()
    this.encoder?.close()
    this.decoder = undefined
    this.decoderPCM = undefined
    this.decoderPacket = undefined
    this.encoder = undefined
    this.encoderPCM = undefined
    this.encoderPacket = undefined
    this.encoderTimer = undefined
    this.encoderFill = 0
    this.silence = undefined
    this.outputSampleRate = 0
    this.sessionID = ''
    this.uploading = false
    this.pendingMcpCalls = Object.create(null)
  }

  onOpen() {
    const features = {}
    if (this.features.mcp) features.mcp = true
    if (this.features.aec) features.aec = true
    this.sendProtocolEvent({
      type: 'hello',
      version: 1,
      transport: 'websocket',
      ...this.helloExtension,
      ...(Object.keys(features).length ? { features } : {}),
      audio_params: {
        format: 'opus',
        sample_rate: INPUT_SAMPLE_RATE,
        channels: 1,
        frame_duration: INPUT_FRAME_DURATION,
      },
    })
  }

  onJSON(json) {
    try {
      const parsed = parseXiaozhiV1ServerEvent(json)
      if (!parsed.known) {
        this.postPresentation({ id: 'receiveUnknownEvent', event: parsed.event })
        return
      }
      const event = parsed.event
      if (
        event.type !== 'hello' &&
        this.sessionID &&
        event.session_id !== undefined &&
        event.session_id !== this.sessionID
      ) {
        this.postProtocolWarning('ignored XiaoZhi event with a mismatched session_id', event)
        return
      }
      const handler = this[event.type]
      if (typeof handler !== 'function') {
        this.postProtocolWarning(`unimplemented XiaoZhi event: ${event.type}`, event)
        return
      }
      handler.call(this, event)
    } catch (error) {
      const message = String(error?.message ?? error)
      if (json?.type === 'hello') {
        this.fail(`invalid XiaoZhi server hello: ${message}`)
        return
      }
      this.postProtocolWarning(message, isRecord(json) ? json : undefined)
    }
  }

  hello(message) {
    const params = message.audio_params ?? {
      format: 'opus',
      sample_rate: 24000,
      channels: 1,
      frame_duration: 60,
    }
    const sampleRate = params.sample_rate
    const frameDuration = params.frame_duration

    try {
      if (this.encoderTimer !== undefined) {
        Timer.clear(this.encoderTimer)
        this.encoderTimer = undefined
      }
      this.decoder?.close()
      this.decoder = new OpusDecoder(sampleRate, frameDuration)
      this.decoderPCM = new SharedArrayBuffer(this.decoder.outputBytes)
      this.encoder?.close()
      this.encoder = new OpusEncoder()
      this.encoderPCM = new SharedArrayBuffer(this.encoder.inputBytes)
      this.encoderPacket = new SharedArrayBuffer(this.encoder.outputBytes)
      this.encoderTimer = Timer.repeat(() => this.flushEncodedAudio(), 10)
      this.silence = new ArrayBuffer(this.decoder.outputBytes)
      this.outputSampleRate = sampleRate
      this.sessionID = message.session_id ?? ''
      this.decoderPacket = undefined
      this.pendingMcpCalls = Object.create(null)
      this.encoderFill = 0
      this.resetEncodeStats()
      this.resetDecodeStats()
      this.uploading = true
      this.postMessage({
        id: 'configureAudio',
        inputSampleRate: INPUT_SAMPLE_RATE,
        outputSampleRate: sampleRate,
      })
      trace(
        `[opus] decoder heap internal=${this.decoder.internalHeapBytes ?? 0}B psram=${this.decoder.psramHeapBytes ?? 0}B\n`,
      )
      trace(
        `[opus] encoder heap internal=${this.encoder.internalHeapBytes ?? 0}B psram=${this.encoder.psramHeapBytes ?? 0}B\n`,
      )
      this.post('connected')
      this.startListening({ mode: this.listeningMode })
    } catch (error) {
      this.fail(String(error?.message ?? error))
    }
  }

  startListening(message = {}) {
    if (!this.encoder) {
      this.postProtocolWarning('cannot start listening before XiaoZhi hello')
      return
    }
    const mode = normalizeListeningMode(message.mode ?? this.listeningMode)
    this.listeningMode = mode
    this.encoder.clear()
    this.encoderFill = 0
    this.uploading = true
    this.sendProtocolEvent(this.withSession({ type: 'listen', state: 'start', mode }))
  }

  stopListening() {
    this.uploading = false
    this.encoder?.clear()
    this.encoderFill = 0
    this.sendProtocolEvent(this.withSession({ type: 'listen', state: 'stop' }))
  }

  detectWakeWord(message = {}) {
    this.sendProtocolEvent(
      this.withSession({
        type: 'listen',
        state: 'detect',
        ...(typeof message.text === 'string' && message.text ? { text: message.text } : {}),
      }),
    )
  }

  abort(message = {}) {
    this.uploading = false
    this.encoder?.clear()
    this.encoderFill = 0
    this.decoderPacket = undefined
    this.sendProtocolEvent(
      this.withSession({
        type: 'abort',
        ...(typeof message.reason === 'string' && message.reason ? { reason: message.reason } : {}),
      }),
    )
  }

  listened() {
    this.startListening({ mode: this.listeningMode })
  }

  sendAudio(message) {
    try {
      if (!this.uploading || !this.encoder) return
      const source = new Int16Array(this.inputBuffer, message.offset, message.size >> 1)
      const frame = new Int16Array(this.encoderPCM)
      let offset = 0
      while (offset < source.length) {
        frame[this.encoderFill++] = source[offset]
        offset += 1
        if (this.encoderFill !== frame.length) continue
        this.encoder.enqueue(this.encoderPCM)
        this.encoderFill = 0
      }
    } catch (error) {
      this.fail(String(error?.message ?? error))
    } finally {
      this.postMessage({ id: 'audioConsumed' })
    }
  }

  flushEncodedAudio() {
    if (!this.encoder) return
    try {
      const packetBytes = this.encoder.read(this.encoderPacket)
      if (!packetBytes || !this.uploading) return
      const packet = new Uint8Array(packetBytes)
      packet.set(new Uint8Array(this.encoderPacket, 0, packetBytes))
      this.write(packet, binary)
      this.encodePackets += 1
      this.encodePCMBytes += this.encoder.inputBytes
      this.encodeCompressedBytes += packetBytes
      this.encodeUs += this.encoder.encodeUs
      if (this.encodeMaxUs < this.encoder.encodeUs) this.encodeMaxUs = this.encoder.encodeUs
    } catch (error) {
      this.fail(String(error?.message ?? error))
    }
  }

  read(data, options) {
    if (!options.binary) return super.read(data, options)
    if (!this.decoder) {
      this.fail('received Opus audio before XiaoZhi hello')
      return
    }
    // Protocol v1 devices do not play downlink audio while their microphone turn is active.
    if (this.uploading) return

    let packet = new Uint8Array(data)
    if (this.decoderPacket || options.more) {
      const previous = this.decoderPacket
      const length = (previous?.byteLength ?? 0) + packet.byteLength
      if (length > OPUS_MAX_PACKET_BYTES) {
        this.fail('Opus packet exceeds 1275 bytes')
        return
      }
      const joined = new Uint8Array(length)
      if (previous) joined.set(previous)
      joined.set(packet, previous?.byteLength ?? 0)
      if (options.more) {
        this.decoderPacket = joined
        return
      }
      this.decoderPacket = undefined
      packet = joined
    }

    try {
      const pcmBytes = this.decoder.decode(packet, this.decoderPCM)
      this.parser.copy(new Uint8Array(this.decoderPCM, 0, pcmBytes))
      this.decodePackets += 1
      this.decodeCompressedBytes += packet.byteLength
      this.decodePCMBytes += pcmBytes
      this.decodeUs += this.decoder.decodeUs
      if (this.decodeMaxUs < this.decoder.decodeUs) this.decodeMaxUs = this.decoder.decodeUs
    } catch (error) {
      this.fail(String(error?.message ?? error))
    }
  }

  resetDecodeStats() {
    this.decodePackets = 0
    this.decodeCompressedBytes = 0
    this.decodePCMBytes = 0
    this.decodeUs = 0
    this.decodeMaxUs = 0
  }

  resetEncodeStats() {
    this.encodePackets = 0
    this.encodePCMBytes = 0
    this.encodeCompressedBytes = 0
    this.encodeUs = 0
    this.encodeMaxUs = 0
  }

  stt(message) {
    if (message.glyph_push) {
      this.postPresentation({
        id: 'receiveGlyphPush',
        source: 'stt',
        text: message.text,
        payload: message.glyph_push,
      })
    }
    this.postPresentation({ id: 'receiveInputText', text: message.text })
  }

  llm(message) {
    if (message.emotion || message.text) {
      this.postPresentation({
        id: 'receiveEmotion',
        emotion: message.emotion ?? '',
        text: message.text,
      })
    }
  }

  tts(message) {
    switch (message.state) {
      case 'start':
        if (this.encodePackets) {
          const average = Math.round(this.encodeUs / this.encodePackets)
          const load = (100 * this.encodeUs) / (this.encodePackets * INPUT_FRAME_DURATION * 1000)
          trace(
            `[opus] packets=${this.encodePackets} pcm=${this.encodePCMBytes}B compressed=${this.encodeCompressedBytes}B encode_avg=${average}us encode_max=${this.encodeMaxUs}us load=${load.toFixed(2)}%\n`,
          )
        }
        this.uploading = false
        this.encoder?.clear()
        this.encoderFill = 0
        this.resetEncodeStats()
        this.decoderPacket = undefined
        this.resetDecodeStats()
        this.postPresentation({ id: 'receiveOutputText', text: '', more: true })
        this.post('listen')
        break
      case 'sentence_start':
        if (message.glyph_push) {
          this.postPresentation({
            id: 'receiveGlyphPush',
            source: 'tts',
            text: message.text,
            payload: message.glyph_push,
          })
        }
        this.postPresentation({ id: 'receiveOutputText', text: message.text, more: true })
        break
      case 'stop':
        if (!this.decoder) {
          this.fail('received XiaoZhi tts stop before hello')
          break
        }
        if (this.decodePackets) {
          const average = Math.round(this.decodeUs / this.decodePackets)
          const durationUs = (this.decoder.outputBytes * 1000000) / (2 * this.outputSampleRate)
          const load = (100 * this.decodeUs) / (this.decodePackets * durationUs)
          trace(
            `[opus] packets=${this.decodePackets} compressed=${this.decodeCompressedBytes}B pcm=${this.decodePCMBytes}B decode_avg=${average}us decode_max=${this.decodeMaxUs}us load=${load.toFixed(2)}%\n`,
          )
        }
        this.parser.copy(this.silence)
        this.parser.done()
        this.postPresentation({ id: 'receiveOutputText', text: '' })
        this.post('speak')
        break
    }
  }

  mcp(message) {
    let payload
    try {
      payload = parseJsonRpcMessage(message.payload)
    } catch (error) {
      this.postProtocolWarning(String(error?.message ?? error), message)
      return
    }

    if (typeof payload.method !== 'string') {
      this.postPresentation({ id: 'receiveMcpResponse', payload })
      return
    }

    if (payload.id === undefined) {
      this.postPresentation({ id: 'receiveMcpNotification', payload })
      return
    }

    switch (payload.method) {
      case 'initialize':
        this.sendMcpResult(payload.id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: this.mcpServerInfo,
        })
        break
      case 'tools/list':
        this.sendMcpResult(payload.id, {
          tools: this.functions.map((tool) => ({
            name: tool.name,
            ...(tool.description ? { description: tool.description } : {}),
            inputSchema: tool.parameters ?? { type: 'object', properties: {} },
          })),
          nextCursor: '',
        })
        break
      case 'tools/call':
        this.handleMcpToolCall(payload)
        break
      default:
        this.sendMcpError(payload.id, -32601, `Unknown MCP method: ${payload.method}`)
        break
    }
  }

  handleMcpToolCall(payload) {
    const params = payload.params
    if (!isRecord(params) || typeof params.name !== 'string') {
      this.sendMcpError(payload.id, -32602, 'tools/call requires params.name')
      return
    }
    const tool = this.functionByName[params.name]
    if (!tool) {
      this.sendMcpError(payload.id, -32601, `Unknown tool: ${params.name}`)
      return
    }
    const args = params.arguments ?? {}
    if (!isRecord(args)) {
      this.sendMcpError(payload.id, -32602, 'tools/call params.arguments must be an object')
      return
    }
    const call = `mcp:${typeof payload.id}:${String(payload.id)}`
    this.pendingMcpCalls[call] = { id: payload.id, name: params.name }
    this.postMessage({
      id: 'receiveFunctionCall',
      call,
      name: params.name,
      parameters: args,
    })
  }

  sendFunctionResult(message) {
    const pending = this.pendingMcpCalls[message.call]
    if (!pending) {
      this.postProtocolWarning(`unknown MCP tool call result: ${String(message.call)}`)
      return
    }
    delete this.pendingMcpCalls[message.call]
    this.sendMcpResult(pending.id, normalizeToolResult(message.result))
  }

  sendMcpMessage(message) {
    try {
      const payload = parseJsonRpcMessage(message.payload)
      this.sendProtocolEvent(this.withSession({ type: 'mcp', payload }))
    } catch (error) {
      this.postProtocolWarning(String(error?.message ?? error))
    }
  }

  sendMcpResult(id, result) {
    this.sendProtocolEvent(
      this.withSession({
        type: 'mcp',
        payload: { jsonrpc: '2.0', id, result },
      }),
    )
  }

  sendMcpError(id, code, message, data) {
    this.sendProtocolEvent(
      this.withSession({
        type: 'mcp',
        payload: {
          jsonrpc: '2.0',
          id,
          error: { code, message, ...(data === undefined ? {} : { data }) },
        },
      }),
    )
  }

  system(message) {
    this.postPresentation({
      id: 'receiveSystemCommand',
      command: message.command,
      event: message,
    })
  }

  alert(message) {
    // Alert is a normal UI event. WebSocket close/error remains the fatal signal.
    this.postPresentation({
      id: 'receiveAlert',
      status: message.status,
      message: message.message,
      emotion: message.emotion,
    })
  }

  custom(message) {
    this.postPresentation({
      id: 'receiveCustomEvent',
      payload: message.payload,
      event: message,
    })
  }

  sendText() {
    this.postProtocolWarning('XiaoZhi v1 does not define text input')
  }

  withSession(event) {
    return this.sessionID ? { session_id: this.sessionID, ...event } : event
  }

  sendProtocolEvent(event) {
    try {
      parseXiaozhiV1ClientEvent(event)
      this.sendJSON(event)
    } catch (error) {
      this.postProtocolWarning(String(error?.message ?? error), event)
    }
  }

  postProtocolWarning(string, event) {
    this.postPresentation({ id: 'protocolWarning', string, event })
  }

  postPresentation(message) {
    try {
      this.postMessage(message)
    } catch (error) {
      trace(`[xiaozhi-v1] presentation update dropped: ${error}\n`)
    }
  }

  fail(message) {
    this.postMessage({ id: 'failed', string: message })
    this.close()
  }
}

function normalizeConfiguration(message) {
  const configuration = message.configuration
  if (configuration?.protocol !== 'xiaozhi-v1') {
    throw new Error('XiaoZhi v1 requires structured connection configuration')
  }
  return configuration
}

function normalizeListeningMode(value) {
  return value === 'manual' || value === 'realtime' ? value : 'auto'
}

function normalizeToolResult(result) {
  if (isRecord(result) && Array.isArray(result.content)) return result
  let text
  if (typeof result === 'string') text = result
  else {
    try {
      text = JSON.stringify(result)
    } catch {
      text = String(result)
    }
  }
  if (text === undefined) text = 'null'
  return {
    content: [{ type: 'text', text }],
    isError: false,
  }
}

function hasEmbeddedCredentials(path) {
  return /(?:[?&](?:access[_-]?token|api[_-]?key|authorization|credential|key|secret|token)=)|(?:\/(?:auth|credential|key|secret|token)(?:\/|$))/i.test(
    path,
  )
}

function isTrustedLocalHost(host) {
  const normalized = host.toLowerCase()
  if (normalized === 'localhost') return true
  const parts = normalized.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false
  const octets = parts.map((part) => Number(part))
  if (octets.some((octet) => octet > 255)) return false
  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  )
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function parseWebSocketEndpoint(value) {
  const endpoint = String(value ?? '').trim()
  const match = /^(wss?):\/\/([^@/:?#]+)(?::(\d+))?(\/[^#]*)?$/.exec(endpoint)
  if (!match) throw new Error('ChatService endpoint must use ws:// or wss://')
  const secure = match[1] === 'wss'
  const port = match[3] ? Number.parseInt(match[3], 10) : secure ? 443 : 80
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('ChatService endpoint port is invalid')
  }
  return { secure, host: match[2], port, path: match[4] ?? '/' }
}
