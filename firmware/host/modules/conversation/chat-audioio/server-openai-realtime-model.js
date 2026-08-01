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
const INPUT_SAMPLE_RATE = 8000
const VAD_CALIBRATION_SAMPLES = INPUT_SAMPLE_RATE / 2
const VAD_MIN_START_LEVEL = 400
const VAD_MIN_CONTINUE_LEVEL = 220
const VAD_PREFIX_SAMPLES = (INPUT_SAMPLE_RATE * 300) / 1000
const VAD_START_SAMPLES = (INPUT_SAMPLE_RATE * 160) / 1000
const VAD_SILENCE_SAMPLES = (INPUT_SAMPLE_RATE * 700) / 1000

export default class ServerOpenAIRealtimeModel extends ServerChatWebSocketWorker {
  constructor(options) {
    super(options)
    this.audioPrefix = audioPrefix
    this.audioSuffix = audioSuffix
    this.configurationError = ''
    this.turnActive = false
    this.turnCommitted = false
    this.silenceSamples = 0
    this.voicedSamples = 0
    this.noiseLevel = 0
    this.calibrationSamples = VAD_CALIBRATION_SAMPLES
    this.prefixAudio = new Uint8Array(VAD_PREFIX_SAMPLES)
    this.prefixLength = 0
    this.prefixWrite = 0
  }

  configure(message) {
    try {
      const endpoint = parseWebSocketEndpoint(message.providerID)
      this.secure = endpoint.secure
      this.host = endpoint.host
      this.port = endpoint.port
      this.path = endpoint.path
      this.headers = [['Authorization', `Bearer ${message.apiKey ?? ''}`]]
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

  appendPrefixAudio(audio) {
    const capacity = this.prefixAudio.length
    if (audio.length >= capacity) {
      this.prefixAudio.set(audio.subarray(audio.length - capacity))
      this.prefixLength = capacity
      this.prefixWrite = 0
      return
    }
    const firstLength = Math.min(audio.length, capacity - this.prefixWrite)
    this.prefixAudio.set(audio.subarray(0, firstLength), this.prefixWrite)
    if (firstLength < audio.length) this.prefixAudio.set(audio.subarray(firstLength), 0)
    this.prefixWrite = (this.prefixWrite + audio.length) % capacity
    this.prefixLength = Math.min(capacity, this.prefixLength + audio.length)
  }

  takePrefixedAudio(audio) {
    if (!this.prefixLength) return audio
    const result = new Uint8Array(this.prefixLength + audio.length)
    const capacity = this.prefixAudio.length
    const start = (this.prefixWrite - this.prefixLength + capacity) % capacity
    const firstLength = Math.min(this.prefixLength, capacity - start)
    result.set(this.prefixAudio.subarray(start, start + firstLength))
    if (firstLength < this.prefixLength)
      result.set(this.prefixAudio.subarray(0, this.prefixLength - firstLength), firstLength)
    result.set(audio, this.prefixLength)
    this.resetPrefixAudio()
    return result
  }

  resetPrefixAudio() {
    this.prefixLength = 0
    this.prefixWrite = 0
  }

  sendAudio(message) {
    if (this.turnCommitted) return
    const buffer = new Uint8Array(this.inputBuffer, message.offset, message.size)
    const samples = new Int16Array(this.inputBuffer, message.offset, message.size >> 1)
    let total = 0
    for (let index = 0; index < samples.length; index += 1) {
      total += Math.abs(samples[index])
    }
    const level = samples.length > 0 ? total / samples.length : 0
    if (this.noiseLevel === 0) this.noiseLevel = level
    if (this.calibrationSamples > 0) {
      this.noiseLevel = this.noiseLevel * 0.9 + level * 0.1
      this.calibrationSamples -= samples.length
      return
    }
    const threshold = this.turnActive
      ? Math.max(VAD_MIN_CONTINUE_LEVEL, this.noiseLevel * 1.6)
      : Math.max(VAD_MIN_START_LEVEL, this.noiseLevel * 2.4)
    const voiced = samples.length > 0 && level >= threshold
    Encode.toAlaw(buffer, buffer)
    message.size = samples.length
    const encoded = new Uint8Array(this.inputBuffer, message.offset, message.size)
    if (!this.turnActive) {
      this.appendPrefixAudio(encoded)
      if (!voiced) {
        this.voicedSamples = 0
        this.noiseLevel = this.noiseLevel * 0.98 + level * 0.02
        return
      }
      this.voicedSamples += samples.length
      if (this.voicedSamples < VAD_START_SAMPLES) return
      this.turnActive = true
      this.voicedSamples = 0
      super.sendAudioBuffer(this.takePrefixedAudio(new Uint8Array(0)))
    } else {
      super.sendAudio(message)
    }
    if (voiced) this.silenceSamples = 0
    else this.silenceSamples += samples.length
    if (this.silenceSamples < VAD_SILENCE_SAMPLES) return
    this.turnActive = false
    this.turnCommitted = true
    this.silenceSamples = 0
    this.voicedSamples = 0
    this.resetPrefixAudio()
    this.sendJSON({ type: 'input_audio_buffer.commit' })
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
    this.turnCommitted = true
    this.postPresentation({ id: 'receiveInputText', text: '', more: true })
    this.postPresentation({ id: 'receiveOutputText', text: '', more: true })
    this.post('listen')
  }

  'response.done'() {
    this.turnActive = false
    this.turnCommitted = false
    this.silenceSamples = 0
    this.voicedSamples = 0
    this.resetPrefixAudio()
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
    this.turnActive = false
    this.turnCommitted = false
    this.silenceSamples = 0
    this.voicedSamples = 0
    this.calibrationSamples = VAD_CALIBRATION_SAMPLES
    this.resetPrefixAudio()
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
