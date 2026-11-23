const accountDiagnostics = Object.freeze({
  'account invalid': 'account_invalid',
  'account cancelled': 'account_cancelled',
  'account approval required': 'account_approval_required',
  'account storage failed': 'account_storage_failed',
  'account HTTP failed': 'account_http_failed',
  'account access denied': 'account_access_denied',
  'account refresh rejected': 'account_refresh_rejected',
  'account response invalid': 'account_response_invalid',
  'account busy': 'account_busy',
  'account access expired': 'account_access_expired',
  'account worker unavailable': 'account_worker_unavailable',
  'account owner expired': 'account_owner_expired',
  'account worker result unavailable': 'account_worker_result_unavailable',
  'account HTTP clock': 'account_http_clock',
  'account HTTP input': 'account_http_input',
  'account HTTP privacy': 'account_http_privacy',
  'account HTTP allocation': 'account_http_allocation',
  'account HTTP configuration': 'account_http_configuration',
  'account HTTP cancelled': 'account_http_cancelled',
  'account HTTP deadline': 'account_http_deadline',
  'account HTTP redirect': 'account_http_redirect',
  'account HTTP response limit': 'account_http_response_limit',
  'account HTTP transport': 'account_http_transport',
  'account HTTP unsupported transport': 'account_http_unsupported_transport',
  'account HTTP SDK unavailable': 'account_http_sdk_unavailable',
  'account HTTP DNS': 'account_http_dns',
  'account HTTP socket': 'account_http_socket',
  'account HTTP connect': 'account_http_connect',
  'account HTTP connect timeout': 'account_http_connect_timeout',
  'account HTTP certificate': 'account_http_certificate',
  'account HTTP TLS handshake': 'account_http_tls_handshake',
  'account HTTP TLS IO': 'account_http_tls_io',
  'account HTTP TLS setup': 'account_http_tls_setup',
  'account unavailable': 'account_unavailable',
  'account closed': 'account_closed',
  'account preparation failed': 'account_preparation_failed',
  account_not_prepared: 'account_not_prepared',
  account_unavailable: 'account_unavailable',
})
const connectionDiagnostics = new Set([
  'pipeline_audio_acquire',
  'pipeline_audio_ready',
  'pipeline_audio_mute',
  'pipeline_conversation_open',
  'pipeline_conversation_ready',
  'pipeline_input_gate',
  'pipeline_ready',
  'pipeline_error_cancelled',
  'pipeline_error_unsupported_capability',
  'pipeline_error_resource_exhausted',
  'pipeline_error_device_busy',
  'pipeline_error_provider_failed',
  'pipeline_error_input_overrun',
  'pipeline_error_deadline_exceeded',
  'pipeline_error_native_transport',
  'pipeline_error_unknown',
  'pipeline_error_native_configuration',
  'pipeline_error_native_allocation',
  'pipeline_error_native_noise',
  'pipeline_error_native_websocket',
  'pipeline_error_native_websocket_events',
  'pipeline_error_native_websocket_start',
  'bridge_failure_certificate_expired',
  'bridge_failure_certificate_future',
  'bridge_failure_certificate_name',
  'bridge_failure_certificate_trust',
  'bridge_response_200',
  'bridge_response_400',
  'bridge_response_401',
  'bridge_response_403',
  'bridge_response_404',
  'bridge_response_409',
  'bridge_response_429',
  'bridge_response_500',
  'bridge_response_503',
  'bridge_response_other',
  'bridge_failed_event',
  'bridge_failed_decode',
  'bridge_failed_head',
  'bridge_failed_body',
  'bridge_error_body_empty',
  'bridge_error_body_route',
  'bridge_error_body_device',
  'bridge_error_body_app',
  'bridge_error_body_not_found',
  'bridge_error_body_other',
  'bridge_server_error',
  'bridge_failure_unknown',
  'bridge_failure_certificate',
  'bridge_failure_tls',
  'bridge_failure_unauthorized',
  'bridge_failure_forbidden',
  'bridge_failure_http',
  'bridge_failure_handshake',
  'bridge_failure_transport',
  'bridge_failure_timeout',
  'bridge_core_create',
  'bridge_input_connect',
  'bridge_native_open',
  'bridge_native_ready',
  'bridge_websocket_open',
  'bridge_noise_ready',
  'bridge_admission_sent',
  'bridge_admission_timeout',
  'network_start',
  'account_saved',
  'ntp_start',
  'ntp_create_ready',
  'ntp_create_failed',
  'ntp_query_failed',
  'ntp_reply_failed',
  'ntp_reply_invalid',
  'ntp_ready',
  'ntp_failed',
  'clock_failed',
  'wifi_failed',
  'wifi_reason_none',
  'wifi_reason_ap_not_found',
  'wifi_reason_auth',
  'wifi_reason_handshake',
  'wifi_reason_timeout',
  'wifi_reason_other',
  'network_ready',
  'account_start',
  'account_prepared',
  'pipeline_create',
  'pipeline_start',
  'connected',
  'cancelled',
  'failed_network',
  'failed_account',
  'failed_pipeline_create',
  'failed_pipeline_start',
  'account_unknown',
  ...Object.values(accountDiagnostics),
])
export function isConnectionDiagnostic(value) {
  return typeof value === 'string' && connectionDiagnostics.has(value)
}

export function createConversationAccountOwner(
  account,
  {
    createConversation,
    createPipeline,
    createScope,
    microphone,
    speaker,
    onEvent,
    onProgress,
    onDiagnostic,
    network,
    mediaBudget = { maxBufferedMs: 500, maxBufferedBytes: 24576 },
  },
) {
  let closed = false,
    pipeline,
    scope,
    connecting,
    closing,
    ending,
    accountClosed = false
  const progress = (value) => {
    try {
      Promise.resolve(onProgress?.(value)).catch(() => {})
    } catch {}
  }
  function diagnostic(value) {
    if (!isConnectionDiagnostic(value)) return
    try {
      onDiagnostic?.(value)
    } catch {}
  }
  function closeAccount() {
    if (!accountClosed) {
      accountClosed = true
      account.close()
    }
  }
  const current = (generation) => {
    try {
      return !closed && account.current(generation) === true
    } catch {
      return false
    }
  }
  async function release() {
    scope?.abort()
    const active = pipeline
    pipeline = undefined
    scope = undefined
    if (active) await active.close({ mode: 'abort', timeoutMs: 10000 })
  }
  return {
    current,
    commitApproved(generation) {
      if (!current(generation)) throw new Error('account_unavailable')
      const result = account.commitApproved(generation)
      return Promise.resolve(result).then((saved) => {
        if (saved?.saved === true) diagnostic('account_saved')
        return saved
      })
    },
    connectApproved(generation) {
      if (!current(generation)) throw new Error('account_unavailable')
      if (ending) throw new Error('conversation_ending')
      if (connecting) return connecting
      if (pipeline) return Promise.resolve({ connected: true })
      let networkReady = false
      let stage = 'network'
      const work = Promise.resolve()
        .then(async () => {
          if (!current(generation)) throw new Error('account_unavailable')
          diagnostic('network_start')
          await network?.prepare(account, generation)
          networkReady = true
          diagnostic('network_ready')
          stage = 'account'
          if (!current(generation)) throw new Error('account_unavailable')
          diagnostic('account_start')
          return account.connectApproved(generation)
        })
        .then(async (result) => {
          if (!current(generation) || result?.prepared !== true) throw new Error('account_not_prepared')
          diagnostic('account_prepared')
          stage = 'pipeline_create'
          progress('auth_ok')
          if (!current(generation)) throw new Error('account_unavailable')
          diagnostic('pipeline_create')
          const localScope = createScope()
          scope = localScope
          let local
          local = createPipeline({
            microphone,
            speaker,
            mediaBudget,
            conversation: createConversation(account),
            microphoneMuted: true,
            onDiagnostic: (value) => diagnostic('pipeline_' + value),
            onEvent(event) {
              if (closed) return
              if (event.type === 'session.ended' && pipeline === local) {
                pipeline = undefined
                scope?.abort()
                scope = undefined
              }
              try {
                onEvent?.(event)
              } catch {}
            },
          })
          pipeline = local
          stage = 'pipeline_start'
          diagnostic('pipeline_start')
          await local.start(localScope)
          if (!current(generation) || pipeline !== local) throw new Error('account_unavailable')
          diagnostic('connected')
          return { connected: true }
        })
        .catch(async (error) => {
          diagnostic(closed ? 'cancelled' : 'failed_' + stage)
          if (!closed && stage === 'pipeline_start') {
            let reason = 'unknown'
            try {
              if (
                [
                  'cancelled',
                  'unsupported_capability',
                  'resource_exhausted',
                  'device_busy',
                  'provider_failed',
                  'input_overrun',
                  'deadline_exceeded',
                ].includes(error?.code)
              )
                reason = error.code
              else if (error?.message === 'Muse account transport unavailable') reason = 'native_transport'
              else if (error?.message === 'Muse account transport configuration') reason = 'native_configuration'
              else if (error?.message === 'Muse account transport allocation') reason = 'native_allocation'
              else if (error?.message === 'Muse account Noise initialization') reason = 'native_noise'
              else if (error?.message === 'Muse account WebSocket initialization') reason = 'native_websocket'
              else if (error?.message === 'Muse account WebSocket events') reason = 'native_websocket_events'
              else if (error?.message === 'Muse account WebSocket start') reason = 'native_websocket_start'
            } catch {}
            diagnostic('pipeline_error_' + reason)
          }
          if (!closed && stage === 'account') {
            let reason
            try {
              const message = error?.message
              if (typeof message === 'string' && Object.hasOwn(accountDiagnostics, message))
                reason = accountDiagnostics[message]
            } catch {}
            diagnostic(reason ?? 'account_unknown')
          }
          if (!closed && networkReady && stage === 'account') progress('auth_failed')
          try {
            await ending
            await release()
          } catch {}
          throw new Error('conversation_connection_failed')
        })
        .finally(() => {
          if (connecting === work) connecting = undefined
        })
      connecting = work
      return work
    },
    endCall() {
      if (closed || connecting) return Promise.reject(new Error('conversation_unavailable'))
      if (ending) return ending
      const work = release().finally(() => {
        if (ending === work) ending = undefined
      })
      ending = work
      return work
    },
    setMicrophoneMuted(value) {
      if (closed || !pipeline || connecting || ending) throw new Error('conversation_unavailable')
      return pipeline.setMicrophoneMuted(value)
    },
    close() {
      if (closing) return closing
      closed = true
      scope?.abort()
      if (!pipeline && !ending) {
        try {
          network?.close()
        } catch {}
        try {
          closeAccount()
        } catch {}
      }
      const work = Promise.resolve().then(async () => {
        try {
          await ending
          await release()
        } finally {
          try {
            network?.close()
          } finally {
            closeAccount()
          }
        }
        await connecting?.catch(() => {})
      })
      closing = work
      return work
    },
  }
}
