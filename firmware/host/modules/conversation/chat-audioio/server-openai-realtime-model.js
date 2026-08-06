/*
 * Copyright (c) 2026 Shinya Ishikawa
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

import { Encode } from 'ChatAudioIO/Codecs'
import ServerChatWebSocketWorker from 'stackchanServerChatWebSocketWorker'

const audioPrefix = Object.freeze(
  new Uint8Array(ArrayBuffer.fromString('{"type":"input_audio_buffer.append","audio":"')),
  true,
)
const audioSuffix = Object.freeze(new Uint8Array(ArrayBuffer.fromString('"}')), true)
const eventHandlers = Object.freeze({
  'conversation.item.input_audio_transcription.completed': true,
  error: true,
  'input_audio_buffer.committed': true,
  'input_audio_buffer.speech_started': true,
  'input_audio_buffer.speech_stopped': true,
  'response.created': true,
  'response.done': true,
  'response.output_audio.done': true,
  'response.output_audio_transcript.delta': true,
  'response.output_audio_transcript.done': true,
  'response.output_item.done': true,
  'session.created': true,
  'session.updated': true,
})

export default class ServerOpenAIRealtimeModel extends ServerChatWebSocketWorker {
  constructor(options) {
    super(options)
    this.audioPrefix = audioPrefix
    this.audioSuffix = audioSuffix
    this.configurationError = ''
    this.eventHandlers = eventHandlers
  }

  configure(message) {
    this.configurationError = ''
    try {
      const endpoint = parseWebSocketEndpoint(message.providerID)
      const apiKey = String(message.apiKey ?? '')
      const tools = (message.functions ?? []).map((tool) => ({
        ...tool,
        type: 'function',
        parameters: {
          ...(tool.parameters ?? { type: 'object', properties: {} }),
          additionalProperties: false,
        },
      }))
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
      this.headers = apiKey ? [['Authorization', `Bearer ${apiKey}`]] : []
      this.session = {
        type: 'realtime',
        audio: {
          input: {
            format: { type: 'audio/pcma' },
            transcription: { model: 'gpt-live-transcribe', languages: ['ja'] },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 700,
              create_response: true,
              interrupt_response: false,
            },
          },
          output: {
            format: { type: 'audio/pcm', rate: 24000 },
            voice: message.voiceID ?? 'marin',
          },
        },
        instructions: message.instructions ?? '',
        tools,
        tool_choice: 'auto',
      }
    } catch (error) {
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

  generateId(prefix, length = 21) {
    const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    const value = Array(length - prefix.length)
      .fill(0)
      .map(() => chars[Math.floor(Math.random() * chars.length)])
      .join('')
    return `${prefix}${value}`
  }

  isBase64(result, _current, name) {
    return result?.type === 'response.output_audio.delta' && name === 'delta'
  }

  postPresentation(message) {
    try {
      this.postMessage(message)
    } catch (error) {
      trace(`[stackchan-ai] presentation update dropped: ${error}\n`)
    }
  }

  sendAudio(message) {
    const buffer = new Uint8Array(this.inputBuffer, message.offset, message.size)
    Encode.toAlaw(buffer, buffer)
    message.size >>= 1
    super.sendAudio(message)
  }

  sendFunctionResult(message) {
    this.sendJSON({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: message.call,
        output: JSON.stringify(message.result),
      },
      event_id: this.generateId('event_'),
    })
    this.sendJSON({ type: 'response.create' })
  }

  sendText(message) {
    this.sendJSON({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: message.text }],
      },
      event_id: this.generateId('event_'),
    })
    this.sendJSON({ type: 'response.create' })
  }

  onJSON(json) {
    if (json.response?.status === 'failed') {
      this.postMessage({
        id: 'failed',
        string: json.response.status_details?.error?.message ?? `${json.type} failed`,
      })
      this.close()
      return
    }
    return super.onJSON(json)
  }

  'conversation.item.input_audio_transcription.completed'(message) {
    this.postPresentation({ id: 'receiveInputText', text: message.transcript })
  }

  'response.output_audio_transcript.delta'(message) {
    this.postPresentation({
      id: 'receiveOutputText',
      text: message.delta,
      more: true,
    })
  }

  'response.output_audio_transcript.done'() {
    this.postPresentation({ id: 'receiveOutputText', text: '' })
  }

  'response.created'() {
    this.postPresentation({ id: 'receiveInputText', text: '', more: true })
    this.postPresentation({ id: 'receiveOutputText', text: '', more: true })
    this.post('listen')
  }

  'response.done'() {
    this.parser.copy(this.silence)
    this.parser.done()
    this.post('speak')
  }

  'response.output_item.done'(message) {
    const item = message.item
    if (item.type !== 'function_call') return
    this.postMessage({
      id: 'receiveFunctionCall',
      call: item.call_id,
      name: item.name,
      parameters: JSON.parse(item.arguments),
    })
  }

  'session.created'() {
    this.sendJSON({
      type: 'session.update',
      session: this.session,
      event_id: this.generateId('event_'),
    })
  }

  'session.updated'() {
    this.post('connected')
  }

  error(message) {
    this.postMessage({
      id: 'failed',
      string: message.error?.message ?? 'Realtime API error',
    })
    this.close()
  }

  'input_audio_buffer.committed'() {}
  'input_audio_buffer.speech_started'() {}
  'input_audio_buffer.speech_stopped'() {}
  'response.output_audio.done'() {}
}

function hasEmbeddedCredentials(path) {
  return /(?:[?&](?:access[_-]?token|api[_-]?key|authorization|credential|key|secret|token)=)|(?:\/(?:auth|credential|key|secret|token)(?:\/|$))/i.test(
    path,
  )
}

function isTrustedLocalHost(host) {
  const normalized = host.toLowerCase()
  if (normalized === 'localhost' || normalized.endsWith('.local')) return true
  const parts = normalized.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false
  const octets = parts.map((part) => Number(part))
  if (octets.some((octet) => octet > 255)) {
    return false
  }
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
  if (!match) {
    throw new Error('ChatService endpoint must use ws:// or wss://')
  }
  const secure = match[1] === 'wss'
  const port = match[3] ? Number.parseInt(match[3], 10) : secure ? 443 : 80
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('ChatService endpoint port is invalid')
  }
  return {
    secure,
    host: match[2],
    port,
    path: match[4] ?? '/',
  }
}
