export function createAccountNetwork({
  createWiFi,
  connectNative,
  closeNative,
  wifiFailure,
  createNTP,
  setTime,
  setTimer,
  clearTimer,
  silenceLogs,
  onProgress,
  onDiagnostic,
}) {
  let wifi,
    ntp,
    timer,
    pending,
    rejectPending,
    closed = false,
    ready = false
  const progress = (value) => {
    try {
      onProgress?.(value)
    } catch {}
  }
  const diagnostic = (value) => {
    try {
      onDiagnostic?.(value)
    } catch {}
  }
  function stop() {
    try {
      closeNative?.()
    } catch {}
    if (timer !== undefined) clearTimer(timer)
    timer = undefined
    try {
      ntp?.close()
    } catch {}
    ntp = undefined
    try {
      wifi?.disconnect()
    } catch {}
    try {
      wifi?.close()
    } catch {}
    wifi = undefined
    ready = false
  }
  return {
    prepare(account, generation) {
      if (closed) return Promise.reject(new Error('network_closed'))
      if (ready) return Promise.resolve()
      if (pending) return pending
      const work = new Promise((resolve, reject) => {
        rejectPending = reject
        let active = true
        let stage = 'wifi'
        const fail = () => {
          if (stage === 'wifi') {
            try {
              const reason = wifiFailure?.()
              if (['none', 'ap_not_found', 'auth', 'handshake', 'timeout', 'other'].includes(reason))
                diagnostic(`wifi_reason_${reason}`)
            } catch {}
          }
          diagnostic(stage === 'wifi' ? 'wifi_failed' : 'ntp_failed')
          if (!active) return
          active = false
          if (!closed) progress('wifi_failed')
          stop()
          reject(new Error('network_unavailable'))
        }
        let syncing = false
        try {
          silenceLogs()
          wifi = createWiFi({
            onChanged() {
              if (closed || !active) return
              if (this.connection < 500) {
                if (syncing || ready) fail()
                return
              }
              if (syncing) return
              syncing = true
              stage = 'ntp_create'
              diagnostic('ntp_start')
              progress('wifi_connected')
              try {
                const client = createNTP()
                ntp = client
                stage = 'ntp_query'
                diagnostic('ntp_create_ready')
                client.getTime((error, value) => {
                  if (closed || !active || ntp !== client) return
                  ntp = undefined
                  try {
                    client.close()
                  } catch {}
                  if (error || !Number.isFinite(value) || value <= 0) {
                    diagnostic(error ? 'ntp_reply_failed' : 'ntp_reply_invalid')
                    fail()
                    return
                  }
                  try {
                    setTime(value / 1000)
                  } catch {
                    diagnostic('clock_failed')
                    fail()
                    return
                  }
                  clearTimer(timer)
                  timer = undefined
                  ready = true
                  diagnostic('ntp_ready')
                  resolve()
                })
              } catch {
                diagnostic(stage === 'ntp_create' ? 'ntp_create_failed' : 'ntp_query_failed')
                fail()
              }
            },
          })
          timer = setTimer(fail, 30000)
          progress('wifi_connecting')
          connectNative(account, generation)
        } catch {
          fail()
        }
      }).finally(() => {
        if (pending === work) {
          pending = undefined
          rejectPending = undefined
        }
      })
      pending = work
      return work
    },
    close() {
      if (closed) return
      closed = true
      stop()
      rejectPending?.(new Error('network_closed'))
    },
  }
}
