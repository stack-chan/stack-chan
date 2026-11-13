import type { VoiceSignal } from 'stackchan/voice/contracts'

export function voiceError(code: string, message = code) {
  return Object.assign(new Error(message), { code })
}

export function requireActive(signal: VoiceSignal) {
  if (signal.aborted) throw signal.reason ?? voiceError('cancelled')
}

export function createVoiceScope(parent?: VoiceSignal) {
  const listeners = new Set<() => void>()
  let aborted = false
  let reason: unknown
  const signal: VoiceSignal = {
    get aborted() {
      return aborted
    },
    get reason() {
      return reason
    },
    addEventListener(_type, listener) {
      if (!aborted) listeners.add(listener)
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener)
    },
  }
  const abort = (cause: unknown = voiceError('cancelled')) => {
    if (aborted) return
    aborted = true
    reason = cause
    dispose()
    try {
      for (const listener of [...listeners]) {
        try {
          listener()
        } catch {
          /* One failing listener cannot prevent other resource owners from stopping. */
        }
      }
    } finally {
      listeners.clear()
    }
  }
  const onParent = () => abort(parent?.reason)
  const dispose = () => parent?.removeEventListener('abort', onParent)
  if (parent?.aborted) onParent()
  else parent?.addEventListener('abort', onParent)
  return { signal, abort, dispose }
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok
    reject = fail
  })
  return { promise, resolve, reject }
}
