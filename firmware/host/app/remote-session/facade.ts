import type {
  RemoteConversationActivationState,
  RemoteConversationListener,
  RemoteConversationSession,
  RemoteConversationSessionDelegate,
  RemoteConversationState,
  RemoteConversationTransportListener,
  RemoteConversationTransportState,
} from 'capabilities'

export type RemoteConversationSessionBinding = {
  readonly remoteSession: RemoteConversationSessionDelegate
  close(): void
}

export type RemoteConversationSessionFacade = {
  readonly remoteSession: RemoteConversationSession
  close(): void
}

type ActiveBinding = {
  binding: RemoteConversationSessionBinding
  removeStateListener: () => void
  removeTransportListener: () => void
}

export function createRemoteConversationSessionFacade(
  createBinding: () => RemoteConversationSessionBinding,
): RemoteConversationSessionFacade {
  let activationState: RemoteConversationActivationState = 'inactive'
  let state: RemoteConversationState = 'standby'
  let lastError: string | undefined
  let transportState: RemoteConversationTransportState = 'disconnected'
  let active: ActiveBinding | undefined
  let transitioning = false
  let closed = false
  const listeners = new Set<RemoteConversationListener>()
  const transportListeners = new Set<RemoteConversationTransportListener>()

  const notifyState = () => {
    for (const listener of listeners) {
      try {
        listener(state, lastError)
      } catch (error) {
        log(`[remote-conversation] state listener failed: ${errorMessage(error)}\n`)
      }
    }
  }

  const notifyTransport = () => {
    for (const listener of transportListeners) {
      try {
        listener(transportState)
      } catch (error) {
        log(`[remote-conversation] transport listener failed: ${errorMessage(error)}\n`)
      }
    }
  }

  const deactivateActiveBinding = () => {
    const current = active
    if (!current) return
    active = undefined
    activationState = 'inactive'
    state = 'standby'
    lastError = undefined
    transportState = 'disconnected'

    let firstError: unknown
    let failed = false
    const attempt = (operation: () => void) => {
      try {
        operation()
      } catch (error) {
        if (!failed) firstError = error
        failed = true
      }
    }

    // Deactivation owns the remote media lifecycle as well as the local UI.
    // Queue the data-channel stop while the activation's conversation session
    // and provider still exist, then release every activation-scoped binding.
    attempt(() => current.binding.remoteSession.requestStop())
    attempt(current.removeStateListener)
    attempt(current.removeTransportListener)
    notifyState()
    notifyTransport()
    attempt(() => current.binding.close())
    if (failed) throw firstError
  }

  const remoteSession: RemoteConversationSession = {
    get activationState() {
      return activationState
    },
    get state() {
      return state
    },
    get lastError() {
      return lastError
    },
    get transportState() {
      return transportState
    },
    activate() {
      if (closed) throw new Error('USB remote conversation session is closed')
      if (active) return
      if (transitioning) throw new Error('USB remote conversation session lifecycle transition is in progress')
      transitioning = true
      let binding: RemoteConversationSessionBinding | undefined
      let removeStateListener: (() => void) | undefined
      let removeTransportListener: (() => void) | undefined
      try {
        binding = createBinding()
        const previousState = state
        const previousError = lastError
        const previousTransportState = transportState
        removeStateListener = binding.remoteSession.subscribe((nextState, error) => {
          if (active?.binding !== binding) return
          if (state === nextState && lastError === error) return
          state = nextState
          lastError = error
          notifyState()
        })
        removeTransportListener = binding.remoteSession.subscribeTransport((nextState) => {
          if (active?.binding !== binding || transportState === nextState) return
          transportState = nextState
          notifyTransport()
        })
        state = binding.remoteSession.state
        lastError = binding.remoteSession.lastError
        transportState = binding.remoteSession.transportState
        active = {
          binding,
          removeStateListener,
          removeTransportListener,
        }
        activationState = 'active'
        if (state !== previousState || lastError !== previousError) notifyState()
        if (transportState !== previousTransportState) notifyTransport()
      } catch (error) {
        tryCleanup(removeStateListener)
        tryCleanup(removeTransportListener)
        tryCleanup(binding ? () => binding.close() : undefined)
        state = 'standby'
        lastError = undefined
        transportState = 'disconnected'
        activationState = 'inactive'
        active = undefined
        throw error
      } finally {
        transitioning = false
      }
    },
    deactivate() {
      if (closed || !active) return
      if (transitioning) throw new Error('USB remote conversation session lifecycle transition is in progress')
      transitioning = true
      try {
        deactivateActiveBinding()
      } finally {
        transitioning = false
      }
    },
    requestStart() {
      if (!active) throw new Error('USB remote conversation session is inactive')
      return active.binding.remoteSession.requestStart()
    },
    requestStop() {
      if (!active) throw new Error('USB remote conversation session is inactive')
      return active.binding.remoteSession.requestStop()
    },
    subscribe(listener) {
      if (closed) return () => undefined
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    subscribeTransport(listener) {
      if (closed) return () => undefined
      transportListeners.add(listener)
      return () => transportListeners.delete(listener)
    },
  }

  return {
    remoteSession,
    close() {
      if (closed) return
      closed = true
      try {
        deactivateActiveBinding()
      } finally {
        listeners.clear()
        transportListeners.clear()
      }
    },
  }
}

function tryCleanup(operation?: () => void): void {
  if (!operation) return
  try {
    operation()
  } catch (error) {
    log(`[remote-conversation] activation cleanup failed: ${errorMessage(error)}\n`)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function log(message: string): void {
  if (typeof trace === 'function') trace(message)
}
