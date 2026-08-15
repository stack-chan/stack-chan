/*
 * Copyright (c) 2026 Shinya Ishikawa
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

import OpusDecoder from 'stackchanOpusDecoder'
import OpusEncoder from 'stackchanOpusEncoder'
import ServerChatWebSocketWorker from 'stackchanServerChatWebSocketWorker'

const INPUT_SAMPLE_RATE = 16000
const INPUT_FRAME_DURATION = 60
const OPUS_MAX_PACKET_BYTES = 1275
const binary = Object.freeze({ binary: true })
const eventHandlers = Object.freeze({ alert: true, hello: true, stt: true, tts: true })

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
    this.encoderFill = 0
    this.eventHandlers = eventHandlers
    this.sessionID = ''
    this.uploading = false
    this.resetDecodeStats()
    this.resetEncodeStats()
  }

  configure(message) {
    this.closeCodecs()
    this.configurationError = ''
    try {
      const endpoint = parseWebSocketEndpoint(message.providerID)
      const apiKey = String(message.apiKey ?? '')
      const deviceID = queryParameter(endpoint.path, 'device_id')
      const clientID = queryParameter(endpoint.path, 'client_id')
      if (!deviceID || !clientID) throw new Error('XiaoZhi endpoint requires device_id and client_id')
      if (deviceID.length > 200 || clientID.length > 200) throw new Error('XiaoZhi device identity is too long')
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
      this.agentID = String(message.modelID ?? '')
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

  close() {
    this.closeCodecs()
    super.close()
  }

  closeCodecs() {
    this.decoder?.close()
    this.encoder?.close()
    this.decoder = undefined
    this.decoderPCM = undefined
    this.decoderPacket = undefined
    this.encoder = undefined
    this.encoderPCM = undefined
    this.encoderPacket = undefined
    this.encoderFill = 0
    this.sessionID = ''
    this.uploading = false
  }

  onOpen() {
    this.sendJSON({
      type: 'hello',
      version: 1,
      transport: 'websocket',
      ...(this.agentID ? { agent_id: this.agentID } : {}),
      audio_params: {
        format: 'opus',
        sample_rate: INPUT_SAMPLE_RATE,
        channels: 1,
        frame_duration: INPUT_FRAME_DURATION,
      },
    })
  }

  hello(message) {
    const params = message.audio_params ?? {
      format: 'opus',
      sample_rate: 24000,
      channels: 1,
      frame_duration: 60,
    }
    const sampleRate = params?.sample_rate
    const frameDuration = params?.frame_duration
    if (
      (message.version !== undefined && message.version !== 1) ||
      message.transport !== 'websocket' ||
      (message.session_id !== undefined &&
        (typeof message.session_id !== 'string' || message.session_id.length > 200)) ||
      params?.format !== 'opus' ||
      params?.channels !== 1 ||
      ![8000, 12000, 16000, 24000, 48000].includes(sampleRate) ||
      ![10, 20, 40, 60].includes(frameDuration)
    ) {
      this.fail('invalid XiaoZhi server hello')
      return
    }

    try {
      this.decoder?.close()
      this.decoder = new OpusDecoder(sampleRate, frameDuration)
      this.decoderPCM = new SharedArrayBuffer(this.decoder.outputBytes)
      this.encoder?.close()
      this.encoder = new OpusEncoder()
      this.encoderPCM = new SharedArrayBuffer(this.encoder.inputBytes)
      this.encoderPacket = new SharedArrayBuffer(this.encoder.outputBytes)
      this.silence = new ArrayBuffer(this.decoder.outputBytes)
      this.outputSampleRate = sampleRate
      this.sessionID = message.session_id ?? ''
      this.encoderFill = 0
      this.resetEncodeStats()
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
      this.startListening()
    } catch (error) {
      this.fail(String(error?.message ?? error))
    }
  }

  startListening() {
    this.sendJSON({
      ...(this.sessionID ? { session_id: this.sessionID } : {}),
      type: 'listen',
      state: 'start',
      mode: 'auto',
    })
  }

  listened() {
    this.encoderFill = 0
    this.uploading = true
    this.startListening()
  }

  sendAudio(message) {
    if (!this.uploading || !this.encoder) return
    const source = new Uint8Array(this.inputBuffer, message.offset, message.size)
    const frame = new Uint8Array(this.encoderPCM)
    let offset = 0
    try {
      while (offset < source.byteLength) {
        const size = Math.min(frame.byteLength - this.encoderFill, source.byteLength - offset)
        frame.set(source.subarray(offset, offset + size), this.encoderFill)
        this.encoderFill += size
        offset += size
        if (this.encoderFill !== frame.byteLength) continue

        const packetBytes = this.encoder.encode(this.encoderPCM, this.encoderPacket)
        const packet = new Uint8Array(packetBytes)
        packet.set(new Uint8Array(this.encoderPacket, 0, packetBytes))
        this.write(packet, binary)
        this.encodePackets += 1
        this.encodePCMBytes += frame.byteLength
        this.encodeCompressedBytes += packetBytes
        this.encodeUs += this.encoder.encodeUs
        if (this.encodeMaxUs < this.encoder.encodeUs) this.encodeMaxUs = this.encoder.encodeUs
        this.encoderFill = 0
      }
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
    if (typeof message.text === 'string') this.postPresentation({ id: 'receiveInputText', text: message.text })
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
        this.encoderFill = 0
        this.resetEncodeStats()
        this.decoderPacket = undefined
        this.resetDecodeStats()
        this.postPresentation({ id: 'receiveOutputText', text: '', more: true })
        this.post('listen')
        break
      case 'sentence_start':
        if (typeof message.text === 'string') {
          this.postPresentation({ id: 'receiveOutputText', text: message.text, more: true })
        }
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

  alert(message) {
    this.fail(message.message ?? message.text ?? 'XiaoZhi server error')
  }

  sendText() {
    this.fail('XiaoZhi v1 does not support text input')
  }

  postPresentation(message) {
    try {
      this.postMessage(message)
    } catch (error) {
      trace(`[stackchan-ai] presentation update dropped: ${error}\n`)
    }
  }

  fail(message) {
    this.postMessage({ id: 'failed', string: message })
    this.close()
  }
}

function queryParameter(path, name) {
  const match = new RegExp(`[?&]${name}=([^&#]*)`).exec(path)
  if (!match) return ''
  try {
    return decodeURIComponent(match[1].replace(/\+/g, ' '))
  } catch {
    throw new Error(`XiaoZhi ${name} is not valid URL encoding`)
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

export function parseWebSocketEndpoint(value) {
  const endpoint = String(value ?? '').trim()
  const match = /^(wss?):\/\/([^/:?#]+)(?::(\d+))?(\/[^#]*)?$/.exec(endpoint)
  if (!match) throw new Error('ChatService endpoint must use ws:// or wss://')
  const secure = match[1] === 'wss'
  const port = match[3] ? Number.parseInt(match[3], 10) : secure ? 443 : 80
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('ChatService endpoint port is invalid')
  }
  return { secure, host: match[2], port, path: match[4] ?? '/' }
}
