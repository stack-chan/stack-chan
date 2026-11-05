// Only fixed labels and bounded numbers cross the diagnostic boundary. Never
// stringify an exception: provider messages/codes can contain private content.
const errorCodes = [
  'closed',
  'cancelled',
  'connect_timeout',
  'close_timeout',
  'not_connected',
  'command_pending',
  'command_timeout',
  'invalid_sdp',
  'http_error',
  'response_limit',
  'invalid_json',
  'invalid_session',
  'transport_error',
  'connection_lost',
  'event_limit',
  'invalid_event',
  'session_mismatch',
  'invalid_transcript',
  'operation_failed',
  'hangup_failed',
  'callback_error',
  'transport_create_failed',
  'transport_start_failed',
  'transport_answer_failed',
  'transport_close_failed',
  'https_connection_failed',
  'https_timeout',
  'https_write_failed',
  'https_read_failed',
  'https_response_limit',
  'https_request_failed',
  'https_capacity',
  'https_ipc_failed',
]
const errorStages = [
  'connect',
  'close',
  'mute',
  'signaling',
  'transport',
  'events',
  'callback',
  'https',
  'webrtc',
  'send',
  'audio_allocate',
  'audio_buffers',
  'aec_create',
  'resampler_open',
  'i2s_new_channel',
  'i2s_init_tx',
  'i2s_init_rx',
  'i2s_enable_rx',
  'i2s_enable_tx',
  'audio_task',
  'capture_open',
  'render_alloc',
  'render_open',
  'render_format',
  'i2s_read',
  'i2s_write',
  'event_loop_watchdog',
  'capture_probe_setup',
]
export function safeFailure(error) {
  const result = { code: 'unknown', stage: 'unknown', errorClass: 'unknown' }
  // Even getters/proxies supplied by a caller must not break cleanup.
  try {
    const code = error?.code,
      stage = error?.stage,
      name = error?.name
    if (errorCodes.includes(code)) result.code = code
    else if (stage === 'events') result.code = 'provider_error'
    if (errorStages.includes(stage)) result.stage = stage
    if (['Error', 'TypeError', 'RangeError', 'URIError', 'SyntaxError', 'ConversationError'].includes(name))
      result.errorClass = name
    const status = error?.status,
      nativeCode = error?.nativeCode
    if (Number.isInteger(status) && status >= 100 && status <= 599) result.status = status
    if (Number.isInteger(nativeCode) && nativeCode >= -2147483648 && nativeCode <= 2147483647)
      result.nativeCode = nativeCode
  } catch {}
  return result
}

// Conversation owns the protocol, native media and HTTP worker. This adapter
// only coordinates the host's audio/radio ownership and explicit user actions.
export class LiveSession {
  constructor({ Conversation, audio, networkReady, acquireLowLatency, amp, settings, onState, onDiagnostic }) {
    Object.assign(this, { Conversation, audio, networkReady, acquireLowLatency, amp, settings, onState, onDiagnostic })
  }

  diagnostic(entry, event, error, phase = entry.phase) {
    try {
      const record = { attempt: entry.attempt, sequence: ++entry.sequence, phase, event }
      if (event === 'failure') {
        if (this.active !== entry) record.late = true
        record.primary = !entry.failed
        entry.failed = true
        Object.assign(record, safeFailure(error))
      }
      this.onDiagnostic?.(record)
    } catch {
      // Logging must not change connection/cleanup behavior.
    }
  }

  phase(entry, phase) {
    entry.phase = phase
    this.diagnostic(entry, 'begin')
  }

  start() {
    if (this.active) return this.active.starting
    this.attempt = (this.attempt ?? 0) + 1
    const entry = { cancelled: false, attempt: this.attempt, sequence: 0 }
    this.active = entry
    this.onState('connecting')
    entry.starting = this.connect(entry)
    return entry.starting
  }

  async connect(entry) {
    try {
      this.phase(entry, 'configuration')
      if (typeof this.settings.apiKey !== 'string' || !this.settings.apiKey.trim()) {
        this.diagnostic(entry, 'failure')
        entry.failure = 'configuration'
        return false
      }
      this.phase(entry, 'network_ready')
      const ready = await this.networkReady
      if (entry.cancelled || this.active !== entry) return false
      if (ready?.status !== 'connected') throw new Error('network unavailable')
      this.phase(entry, 'audio_acquire')
      entry.releaseAudio = this.audio.acquireExclusive()
      this.phase(entry, 'radio_acquire')
      entry.radio = this.acquireLowLatency()
      // The CoreS3 SDK amplifier has a setter but no sample-rate getter.
      // Return it to the SDK's 24 kHz baseline after native audio has stopped.
      this.phase(entry, 'amp_configure')
      entry.ampChanged = true
      this.amp.sampleRate = 48000
      this.phase(entry, 'conversation_create')
      const conversation = new this.Conversation({
        apiKey: this.settings.apiKey,
        model: this.settings.model,
        voice: this.settings.voice,
        instructions: this.settings.instructions,
        delegation: {
          type: 'responses',
          responses: { model: this.settings.backendModel ?? 'gpt-6-luna' },
        },
        onDiagnostic: (phase) => {
          if (
            this.active === entry &&
            !entry.cancelled &&
            [
              'transport_create',
              'transport_start',
              'signaling_request',
              'signaling_response',
              'transport_answer',
              'session_wait',
              'session_started',
            ].includes(phase)
          )
            this.phase(entry, phase)
        },
        onError: (error) => {
          if (this.active !== entry) {
            // Best-effort hangup can fail after native close has completed. Keep
            // that old attempt's safe evidence without touching its replacement.
            if (entry.cancelled && safeFailure(error).stage === 'close')
              this.diagnostic(entry, 'failure', error, 'conversation_close')
            return
          }
          this.diagnostic(entry, 'failure', error)
          entry.failure = 'error'
          if (!entry.cancelled) void this.stop()
        },
        onStateChanged: (state) => {
          if (this.active !== entry) return
          if (state === 'error' && !entry.failure) {
            this.diagnostic(entry, 'failure')
            entry.failure = 'error'
          }
          if ((state === 'closed' || state === 'error') && !entry.cancelled) void this.stop()
        },
      })
      entry.conversation = conversation
      this.phase(entry, 'volume_configure')
      conversation.setVolume(this.settings.volume ?? 0.1)
      this.phase(entry, 'conversation_connect')
      await conversation.connect()
      if (entry.cancelled || this.active !== entry) return false
      this.phase(entry, 'conversation_active')
      this.diagnostic(entry, 'success')
      this.onState('connected')
      return true
    } catch (error) {
      if (!entry.cancelled) {
        this.diagnostic(entry, 'failure', error)
        entry.failure = 'error'
      }
      return false
    } finally {
      if (entry.failure && this.active === entry) await this.stop()
    }
  }

  stop() {
    const entry = this.active
    if (!entry) return Promise.resolve()
    if (entry.closing) return entry.closing
    entry.cancelled = true
    this.onState('closing')
    // Publish the promise before close() can synchronously call onError again.
    entry.closing = Promise.resolve().then(() => this.finish(entry))
    return entry.closing
  }

  async finish(entry) {
    try {
      this.phase(entry, 'conversation_close')
      const result = await entry.conversation?.close()
      if (result && !result.finalized) {
        this.diagnostic(entry, 'failure')
        entry.failure = 'error'
      } else this.diagnostic(entry, 'success')
    } catch (error) {
      this.diagnostic(entry, 'failure', error)
      entry.failure = 'error'
    } finally {
      for (const [phase, release] of [
        [
          'amp_restore',
          () => {
            if (entry.ampChanged) this.amp.sampleRate = 24000
          },
        ],
        ['radio_release', () => entry.radio?.close()],
        ['audio_release', () => entry.releaseAudio?.()],
      ]) {
        this.phase(entry, phase)
        try {
          release()
          this.diagnostic(entry, 'success')
        } catch (error) {
          this.diagnostic(entry, 'failure', error)
          entry.failure = 'error'
        }
      }
      if (this.active === entry) {
        this.active = undefined
        this.onState(entry.failure ?? 'idle')
      }
    }
  }

  async setMuted(muted) {
    const entry = this.active,
      conversation = entry?.conversation
    if (!conversation || entry.cancelled) return false
    try {
      this.phase(entry, 'mute')
      await conversation.setMuted(muted)
      if (this.active === entry && !entry.cancelled) this.phase(entry, 'conversation_active')
      return this.active === entry && !entry.cancelled && conversation.muted
    } catch (error) {
      if (this.active === entry && !entry.cancelled) {
        this.diagnostic(entry, 'failure', error)
        entry.failure = 'error'
        await this.stop()
      }
      return false
    }
  }
}
