import type { RemoteConversationSession, RemoteConversationState } from 'capabilities'

const STACKCHAN_EVENT_SCHEMA = 'stackchan.event.v1'
const RETRY_MILLISECONDS = 2_000
const REQUEST_TIMEOUT_MILLISECONDS = 10_000
const BOOT_REQUEST_TOKEN = Math.trunc(Math.random() * 0x1_0000_0000)
  .toString(16)
  .padStart(8, '0')

type ConversationOperation = 'start' | 'stop'

type ConversationTransport = {
  sendApplicationEvent(event: Record<string, unknown>): void
}

export type ConversationRetryScheduler = {
  set(callback: () => void, milliseconds: number): unknown
  clear(handle: unknown): void
}

export type UsbConversationSessionOptions = {
  createRequestId?: () => string
}

export type UsbConversationSession = {
  readonly remoteSession: RemoteConversationSession
  handleEvent(event: Record<string, unknown>): boolean
  updateState(state: RemoteConversationState, error?: string): void
  close(): void
}

type PendingRequest = {
  operation: ConversationOperation
  requestId: string
  elapsedMilliseconds: number
  retryHandle?: unknown
}

let requestSequence = 0

export function createUsbConversationSession(
  transport: ConversationTransport,
  scheduler: ConversationRetryScheduler,
  options: UsbConversationSessionOptions = {},
): UsbConversationSession {
  let state: RemoteConversationState = 'standby'
  let lastError: string | undefined
  let pending: PendingRequest | undefined
  let closed = false
  const listeners = new Set<(state: RemoteConversationState, error?: string) => void>()
  const createRequestId =
    options.createRequestId ??
    (() => {
      requestSequence = (requestSequence + 1) >>> 0
      return `conversation-${BOOT_REQUEST_TOKEN}-${requestSequence}`
    })

  const updateState = (nextState: RemoteConversationState, error?: string) => {
    if (closed) return
    if (state === nextState && lastError === error) return
    state = nextState
    lastError = error
    for (const listener of listeners) listener(state, lastError)
  }

  const clearPending = () => {
    if (pending?.retryHandle !== undefined) {
      scheduler.clear(pending.retryHandle)
    }
    pending = undefined
  }

  const sendPending = (request: PendingRequest) => {
    transport.sendApplicationEvent({
      schema: STACKCHAN_EVENT_SCHEMA,
      type: request.operation === 'start' ? 'conversation.start' : 'conversation.stop',
      requestId: request.requestId,
      source: 'headTouch',
      gesture: request.operation === 'start' ? 'forwardSwipe' : 'backwardSwipe',
    })
  }

  const scheduleRetry = (request: PendingRequest) => {
    request.retryHandle = scheduler.set(() => {
      if (closed || pending !== request) return
      request.retryHandle = undefined
      request.elapsedMilliseconds += RETRY_MILLISECONDS
      if (request.elapsedMilliseconds >= REQUEST_TIMEOUT_MILLISECONDS) {
        pending = undefined
        updateState('blocked', `conversation.${request.operation} timed out after ${REQUEST_TIMEOUT_MILLISECONDS} ms`)
        return
      }
      sendPending(request)
      scheduleRetry(request)
    }, RETRY_MILLISECONDS)
  }

  const request = (operation: ConversationOperation): string => {
    if (closed) throw new Error('USB conversation session is closed')
    if (pending?.operation === operation) return pending.requestId
    clearPending()
    const next: PendingRequest = {
      operation,
      requestId: createRequestId(),
      elapsedMilliseconds: 0,
    }
    pending = next
    updateState(operation === 'start' ? 'connecting' : 'standby')
    sendPending(next)
    scheduleRetry(next)
    return next.requestId
  }

  const remoteSession: RemoteConversationSession = {
    get state() {
      return state
    },
    get lastError() {
      return lastError
    },
    requestStart() {
      return request('start')
    },
    requestStop() {
      return request('stop')
    },
    subscribe(listener) {
      if (closed) return () => undefined
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }

  return {
    remoteSession,
    handleEvent(event) {
      if (!isConversationResultEvent(event)) return false
      if (event.requestId !== pending?.requestId) return true
      clearPending()
      if (event.success) updateState(event.state, event.error)
      else {
        updateState('blocked', event.error ?? `conversation request failed in state ${event.state}`)
      }
      return true
    },
    updateState,
    close() {
      if (closed) return
      clearPending()
      state = 'standby'
      lastError = undefined
      closed = true
      listeners.clear()
    },
  }
}

function isConversationResultEvent(event: Record<string, unknown>): event is Record<string, unknown> & {
  requestId: string
  success: boolean
  state: RemoteConversationState
  error?: string
} {
  return (
    event.schema === STACKCHAN_EVENT_SCHEMA &&
    event.type === 'conversation.result' &&
    typeof event.requestId === 'string' &&
    event.requestId.length > 0 &&
    typeof event.success === 'boolean' &&
    isRemoteConversationState(event.state) &&
    (event.error === undefined || typeof event.error === 'string')
  )
}

function isRemoteConversationState(value: unknown): value is RemoteConversationState {
  return (
    value === 'standby' ||
    value === 'connecting' ||
    value === 'listening' ||
    value === 'recognizing' ||
    value === 'speaking' ||
    value === 'blocked'
  )
}
