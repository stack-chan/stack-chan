// Copyright (c) 2026 Shinya Ishikawa
// SPDX-License-Identifier: Apache-2.0

import Broker from './broker.js'
import ToolRunner from './tools.js'

const ENDPOINT = 'https://api.openai.com/v1/live/sessions'
const DEFAULT_DELEGATION = {
  type: 'responses',
  responses: {
    model: 'gpt-5.6-terra',
    instructions:
      '日本語の音声会話を支援してください。現在の情報が必要ならWeb検索し、根拠のある簡潔な結果を返してください。',
    tools: [{ type: 'web_search' }],
    tool_choice: 'auto',
  },
}

export class ConversationError extends Error {
  constructor(message, code, stage, status) {
    super(message)
    this.code = code
    this.stage = stage
    if (status !== undefined) this.status = status
  }
  get name() {
    return 'ConversationError'
  }
}

function deferred() {
  let resolve, reject
  const promise = new Promise((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}

export default class Conversation {
  #platform
  #options
  #key
  #state = 'idle'
  #transport
  #connection
  #closing
  #finishing = false
  #signalPending = false
  #signaled = false
  #sessionId
  #ready = false
  #closeSent = false
  #timers = new Set()
  #connectTimer
  #mute
  #muted = false
  #volume = 0.5
  #eventID = 0
  #usage
  #result
  #stats
  #tools
  #broker
  #toolTimeout

  constructor(options, platform) {
    if (
      !options ||
      (!options.broker && !options.signaling && (typeof options.apiKey !== 'string' || !options.apiKey.trim()))
    )
      throw new TypeError('apiKey or broker is required')
    if ([options.broker, options.signaling, options.apiKey].filter((v) => v !== undefined).length !== 1)
      throw new TypeError('Choose apiKey, broker, or signaling')
    if (options.signaling) {
      const adapter = options.signaling
      if (typeof adapter.createSession !== 'function' || typeof adapter.hangup !== 'function')
        throw new TypeError('Invalid signaling adapter')
      this.#broker = {
        create: (sdp, canStart, starting) => adapter.createSession({ sdp, canStart, starting }),
        accept: (result) => adapter.acceptSession?.(result),
        hangup: (sessionId) => adapter.hangup({ sessionId }),
      }
    }
    if (options.broker) this.#broker = new Broker(options.broker, platform)
    for (const name of ['onStateChanged', 'onTranscript', 'onEvent', 'onError', 'onToolResult'])
      if (options[name] !== undefined && typeof options[name] !== 'function')
        throw new TypeError(`${name} must be a function`)
    this.#key = options.apiKey
    this.#options = {
      model: options.model ?? 'gpt-live-1',
      instructions:
        options.instructions ??
        '日本語で自然に簡潔に会話してください。調べ物や推論が必要な依頼はバックエンドに委譲してください。相手の発話を聞き、割り込みや言い直しに対応してください。',
      voice: options.voice ?? 'marin',
      delegation: JSON.parse(JSON.stringify(options.delegation ?? DEFAULT_DELEGATION)),
      onStateChanged: options.onStateChanged,
      onTranscript: options.onTranscript,
      onEvent: options.onEvent,
      onError: options.onError,
      onToolResult: options.onToolResult,
    }
    for (const name of ['model', 'instructions', 'voice'])
      if (typeof this.#options[name] !== 'string') throw new TypeError(`invalid ${name}`)
    this.#platform = platform
    this.#toolTimeout = options.toolTimeout
    if (options.tools !== undefined && !Array.isArray(options.tools)) throw new TypeError('Invalid tools')
    if (options.tools?.length) {
      if (this.#options.delegation.type !== 'responses') throw new TypeError('Tools require Responses delegation')
      this.#tools = new ToolRunner(options.tools, {
        platform,
        timeout: options.toolTimeout,
        send: (event) => this.#send(event),
        onError: (error) => this.#fail(error),
        onResult: (result) => this.#notify('onToolResult', result),
      })
      const backend = this.#options.delegation.responses
      const definitions = backend.tools ?? []
      const names = new Set(definitions.filter((tool) => tool.type === 'function').map((tool) => tool.name))
      for (const tool of this.#tools.definitions) {
        if (names.has(tool.name)) throw new TypeError('Duplicate tool definition')
        definitions.push(tool)
      }
      backend.tools = definitions
    }
  }

  // Broker configuration may arrive while the local SDP is being prepared.
  setTools(tools) {
    if (!this.#broker || this.#signaled || !['idle', 'connecting'].includes(this.#state))
      throw new Error('Configure broker tools before session creation')
    const runner = new ToolRunner(tools, {
      platform: this.#platform,
      timeout: this.#toolTimeout,
      send: (event) => this.#send(event),
      onError: (error) => this.#fail(error),
      onResult: (result) => this.#notify('onToolResult', result),
    })
    this.#tools?.close()
    this.#tools = runner
  }

  get state() {
    return this.#state
  }
  get sessionId() {
    return this.#sessionId
  }
  get muted() {
    return this.#muted
  }
  get volume() {
    return this.#volume
  }
  get usage() {
    return this.#usage && { ...this.#usage }
  }
  get stats() {
    return this.#transport?.stats ?? this.#stats
  }

  connect() {
    if (this.#state === 'connecting' || this.#state === 'connected') return this.#connection.promise
    if (this.#state !== 'idle')
      return Promise.reject(new ConversationError('Create a new conversation to reconnect', 'closed', 'connect'))
    this.#connection = deferred()
    const promise = this.#connection.promise
    this.#setState('connecting')
    if (this.#state !== 'connecting') return promise
    try {
      this.#transport = this.#platform.createTransport((event) => this.#receive(event))
      this.#transport.setVolume(this.#volume)
      this.#connectTimer = this.#after(60000, () =>
        this.#fail(new ConversationError('Session startup timed out', 'connect_timeout', 'connect')),
      )
      this.#transport.start()
    } catch (error) {
      this.#fail(error)
    }
    return promise
  }

  close() {
    if (this.#closing) return this.#closing.promise
    this.#closing = deferred()
    if (this.#result) {
      this.#closing.resolve(this.#result)
      return this.#closing.promise
    }
    this.#cancelTimer(this.#connectTimer)
    this.#tools?.close()
    this.#connection?.reject(new ConversationError('Connection cancelled', 'cancelled', 'connect'))
    this.#setState('closing')
    if (!this.#signaled) {
      void this.#finish({ finalized: true, reason: 'not_started' })
    } else {
      this.#after(15000, () => {
        const error = new ConversationError('No session.closed event received', 'close_timeout', 'close')
        this.#notify('onError', error)
        void this.#finish({ finalized: false, reason: 'close_timeout', usage: this.#usage })
      })
      if (this.#ready) this.#sendClose()
    }
    return this.#closing.promise
  }

  setVolume(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
      throw new RangeError('volume must be between 0 and 1')
    this.#transport?.setVolume(value)
    this.#volume = value
  }

  setMuted(value) {
    if (typeof value !== 'boolean') return Promise.reject(new TypeError('muted must be boolean'))
    if (this.#state !== 'connected')
      return Promise.reject(new ConversationError('Session is not connected', 'not_connected', 'mute'))
    if (this.#mute) return Promise.reject(new ConversationError('A mute command is pending', 'command_pending', 'mute'))
    if (value === this.#muted) return Promise.resolve()
    const pending = { ...deferred(), value, id: `mute_${++this.#eventID}` }
    this.#mute = pending
    try {
      // Keep local capture gated until the remote command is acknowledged.
      this.#transport.setMuted(true)
      this.#muted = true
      pending.timer = this.#after(5000, () =>
        this.#rejectMute(new ConversationError('Mute acknowledgment timed out', 'command_timeout', 'mute')),
      )
      this.#send({ type: value ? 'session.input_audio.mute' : 'session.input_audio.unmute', event_id: pending.id })
    } catch (error) {
      this.#rejectMute(error)
    }
    return pending.promise
  }

  async #signal(sdp) {
    if (this.#signaled || this.#signalPending || this.#state !== 'connecting') return
    if (typeof sdp !== 'string' || !sdp.startsWith('v=0') || sdp.length > 65536)
      return this.#fail(new ConversationError('Invalid local SDP', 'invalid_sdp', 'signaling'))
    this.#signalPending = true
    const key = this.#key
    try {
      const options = this.#options
      let response
      if (this.#broker) {
        response = await this.#broker.create(
          sdp,
          () => this.#state === 'connecting' && !this.#finishing && !this.#result,
          () => {
            this.#signaled = true
          },
        )
        if (!response) return
      } else {
        this.#signaled = true
        response = await this.#platform.fetch(ENDPOINT, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session: {
              model: options.model,
              instructions: options.instructions,
              audio: { output: { voice: options.voice } },
              delegation: options.delegation,
              store: false,
            },
            transport: { type: 'webrtc', sdp },
          }),
        })
      }
      const text = await response.text()
      if (response.status !== 201)
        throw new ConversationError(
          `Live session creation failed (HTTP ${response.status})`,
          'http_error',
          'signaling',
          response.status,
        )
      if (typeof text !== 'string' || text.length > 131072)
        throw new ConversationError('Session response exceeds limit', 'response_limit', 'signaling')
      let result
      try {
        result = JSON.parse(text)
      } catch {
        throw new ConversationError('Invalid session response JSON', 'invalid_json', 'signaling')
      }
      if (typeof result.session?.id !== 'string' || !result.session.id)
        throw new ConversationError('Missing session ID', 'invalid_session', 'signaling')
      this.#sessionId = result.session.id
      this.#broker?.accept(result)
      if (this.#finishing || this.#result) {
        await this.#hangup(result.session.id, key)
        return
      }
      if (
        result.transport?.type !== 'webrtc' ||
        typeof result.transport.sdp !== 'string' ||
        !result.transport.sdp.startsWith('v=0')
      )
        throw new ConversationError('Missing SDP answer', 'invalid_sdp', 'signaling')
      this.#transport.acceptAnswer(result.transport.sdp)
    } catch (error) {
      if (!this.#finishing && !this.#result) this.#fail(error)
    } finally {
      this.#signalPending = false
    }
  }

  #receive(event) {
    if (this.#finishing || this.#result) return
    try {
      if (event.type === 'offer') {
        void this.#signal(event.sdp)
        return
      }
      if (event.type === 'error')
        throw new ConversationError(`WebRTC failure (${event.code})`, 'transport_error', event.stage ?? 'transport')
      if (event.type === 'disconnected')
        throw new ConversationError('WebRTC disconnected before session.closed', 'connection_lost', 'transport')
      if (event.type !== 'message') return
      if (typeof event.data !== 'string' || event.data.length > 131072)
        throw new ConversationError('Invalid event size', 'event_limit', 'events')
      let message
      try {
        message = JSON.parse(event.data)
      } catch {
        throw new ConversationError('Invalid event JSON', 'invalid_json', 'events')
      }
      if (!message || typeof message.type !== 'string')
        throw new ConversationError('Invalid event', 'invalid_event', 'events')
      this.#tools?.receive(message)
      switch (message.type) {
        case 'session.started':
          if (message.session?.id !== this.#sessionId)
            throw new ConversationError('Session ID mismatch', 'session_mismatch', 'events')
          this.#ready = true
          this.#cancelTimer(this.#connectTimer)
          if (this.#state === 'closing') this.#sendClose()
          else {
            this.#setState('connected')
            this.#connection.resolve({ id: this.#sessionId })
          }
          break
        case 'session.input_transcript.delta':
        case 'session.output_transcript.delta':
          if (
            typeof message.delta !== 'string' ||
            !Number.isFinite(message.start_ms) ||
            !Number.isFinite(message.end_ms) ||
            message.end_ms < message.start_ms
          )
            throw new ConversationError('Invalid transcript fragment', 'invalid_transcript', 'events')
          this.#notify('onTranscript', {
            role: message.type === 'session.input_transcript.delta' ? 'user' : 'assistant',
            delta: message.delta,
            start_ms: message.start_ms,
            end_ms: message.end_ms,
          })
          break
        case 'session.usage.updated':
          if (Number.isFinite(message.usage?.seconds)) this.#usage = { ...message.usage }
          break
        case 'session.input_audio.muted':
        case 'session.input_audio.unmuted': {
          const pending = this.#mute
          if (
            pending &&
            message.client_event_id === pending.id &&
            (message.type === 'session.input_audio.muted') === pending.value
          ) {
            this.#cancelTimer(pending.timer)
            this.#muted = pending.value
            this.#transport.setMuted(pending.value)
            this.#mute = undefined
            pending.resolve()
          }
          break
        }
        case 'error': {
          const error = new ConversationError(
            message.error?.message ?? 'Live command rejected',
            message.error?.code ?? 'server_error',
            'events',
          )
          if (message.error?.client_event_id && this.#mute?.id === message.error.client_event_id)
            this.#rejectMute(error)
          else this.#notify('onError', error)
          break
        }
        case 'session.closed':
          if (Number.isFinite(message.usage?.seconds)) this.#usage = { ...message.usage }
          this.#notify('onEvent', message)
          void this.#finish({ finalized: true, reason: message.reason, usage: this.#usage })
          return
      }
      this.#notify('onEvent', message)
    } catch (error) {
      this.#fail(error)
    }
  }

  #send(message) {
    this.#transport.send(JSON.stringify(message))
  }
  #sendClose() {
    if (this.#closeSent) return
    this.#closeSent = true
    try {
      this.#send({ type: 'session.close' })
    } catch (error) {
      this.#fail(error)
    }
  }
  #rejectMute(error) {
    const pending = this.#mute
    if (!pending) return
    this.#mute = undefined
    this.#cancelTimer(pending.timer)
    pending.reject(error)
    this.#notify('onError', error)
  }
  #fail(error) {
    if (this.#finishing || this.#result) return
    if (!(error instanceof ConversationError))
      error = new ConversationError(error?.message ?? 'Conversation failed', 'operation_failed', 'transport')
    this.#connection?.reject(error)
    this.#notify('onError', error)
    void this.#finish({ finalized: false, reason: error.code, usage: this.#usage }, true)
  }
  async #hangup(id, key) {
    try {
      if (this.#broker) {
        await this.#broker.hangup(id)
        return
      }
      const response = await this.#platform.fetch(`${ENDPOINT}/${encodeURIComponent(id)}/hangup`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: '',
      })
      await response.text()
      if (!response.ok)
        this.#notify(
          'onError',
          new ConversationError('Session hangup was not confirmed', 'hangup_failed', 'close', response.status),
        )
    } catch {
      this.#notify('onError', new ConversationError('Session hangup was not confirmed', 'hangup_failed', 'close'))
    }
  }
  async #finish(result, failed = false) {
    if (this.#finishing || this.#result) return
    this.#finishing = true
    this.#tools?.close()
    for (const timer of this.#timers) this.#platform.clearTimeout(timer)
    this.#timers.clear()
    this.#rejectMute(new ConversationError('Session ended', 'closed', 'mute'))
    this.#connection?.reject(new ConversationError('Session ended before startup', 'closed', 'connect'))
    const transport = this.#transport
    this.#transport = undefined
    if ((!result.finalized || this.#broker) && this.#sessionId) void this.#hangup(this.#sessionId, this.#key)
    try {
      await transport?.close()
      this.#stats = transport?.stats
    } catch (error) {
      failed = true
      result = { ...result, finalized: false, reason: 'cleanup_error' }
      this.#notify('onError', error)
    }
    this.#key = undefined
    this.#result = result
    this.#setState(failed ? 'error' : 'closed')
    this.#closing?.resolve(result)
  }
  #setState(state) {
    this.#state = state
    this.#notify('onStateChanged', state)
  }
  #notify(name, value) {
    try {
      this.#options[name]?.(value)
    } catch (error) {
      if (name !== 'onError')
        try {
          this.#options.onError?.(new ConversationError(error.message, 'callback_error', 'callback'))
        } catch {}
    }
  }
  #after(delay, callback) {
    const timer = this.#platform.setTimeout(() => {
      this.#timers.delete(timer)
      callback()
    }, delay)
    this.#timers.add(timer)
    return timer
  }
  #cancelTimer(timer) {
    if (this.#timers.delete(timer)) this.#platform.clearTimeout(timer)
  }
}
