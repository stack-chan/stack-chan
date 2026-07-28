import type { RemoteConversationSession, RemoteConversationState, RemoteConversationTransportState } from 'capabilities'
import {
  conversationRequest,
  type StackchanInboundApplicationEvent,
  type StackchanOutboundApplicationEvent,
} from 'stackchan-application-event'
import type { RealtimeEventSendResult } from 'stackchan-realtime-session'

const RETRY_MILLISECONDS = 2_000
const REQUEST_TIMEOUT_MILLISECONDS = 10_000
const BOOT_REQUEST_TOKEN = Math.trunc(Math.random() * 0x1_0000_0000)
  .toString(16)
  .padStart(8, '0')

type ConversationOperation = 'start' | 'stop'

type ConversationTransport = {
  readonly transportState: RemoteConversationTransportState
  sendApplicationEvent(event: StackchanOutboundApplicationEvent): Promise<RealtimeEventSendResult>
  subscribeTransport(listener: (state: RemoteConversationTransportState) => void): () => void
}

export type ConversationRetryScheduler = {
  set(callback: () => void, milliseconds: number): unknown
  clear(handle: unknown): void
}

export type ConversationSessionOptions = {
  createRequestId?: () => string
}

export type ConversationSession = {
  readonly remoteSession: RemoteConversationSession
  handleEvent(event: StackchanInboundApplicationEvent): boolean
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

export function createConversationSession(
  transport: ConversationTransport,
  scheduler: ConversationRetryScheduler,
  options: ConversationSessionOptions = {},
): ConversationSession {
  let state: RemoteConversationState = 'standby'
  let lastError: string | undefined
  let transportState = transport.transportState
  let pending: PendingRequest | undefined
  let closed = false
  const listeners = new Set<(state: RemoteConversationState, error?: string) => void>()
  const transportListeners = new Set<(state: RemoteConversationTransportState) => void>()
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

  const failPending = (request: PendingRequest, error: string) => {
    if (pending !== request) return
    clearPending()
    updateState('blocked', error)
  }

  const failUnsupported = (request: PendingRequest) => {
    failPending(
      request,
      `conversation.${request.operation} is unavailable because the connected Dock does not support EVENT`,
    )
  }

  const sendPending = (request: PendingRequest) => {
    if (closed || pending !== request || transportState !== 'ready') return
    let result: Promise<RealtimeEventSendResult>
    try {
      result = transport.sendApplicationEvent(conversationRequest(request.operation, request.requestId))
    } catch (error) {
      failPending(request, `conversation.${request.operation} send failed: ${errorMessage(error)}`)
      return
    }
    void result.then(
      (sendResult) => {
        if (closed || pending !== request) return
        if (sendResult === 'queued') return
        if (sendResult === 'overflow') {
          failPending(request, `conversation.${request.operation} send queue is full`)
          return
        }
        updateTransportState(sendResult)
        if (sendResult === 'unsupported' && pending === request) failUnsupported(request)
      },
      (error) => {
        if (closed || pending !== request) return
        failPending(request, `conversation.${request.operation} send failed: ${errorMessage(error)}`)
      },
    )
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
      if (transportState === 'ready') sendPending(request)
      if (pending === request) scheduleRetry(request)
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
    if (transportState === 'unsupported') {
      updateState(
        'blocked',
        `conversation.${operation} is unavailable because the connected Dock does not support EVENT`,
      )
      return next.requestId
    }
    pending = next
    updateState(operation === 'start' ? 'connecting' : 'standby')
    if (transportState === 'ready') sendPending(next)
    if (pending === next) scheduleRetry(next)
    return next.requestId
  }

  const updateTransportState = (nextState: RemoteConversationTransportState) => {
    if (closed || transportState === nextState) return
    transportState = nextState
    for (const listener of transportListeners) {
      try {
        listener(nextState)
      } catch (error) {
        log(`[remote-conversation] transport listener failed: ${errorMessage(error)}\n`)
      }
    }
    const request = pending
    if (!request) return
    if (nextState === 'unsupported') failUnsupported(request)
    else if (nextState === 'ready') sendPending(request)
  }

  const unsubscribeTransport = transport.subscribeTransport(updateTransportState)

  const remoteSession: RemoteConversationSession = {
    get state() {
      return state
    },
    get lastError() {
      return lastError
    },
    get transportState() {
      return transportState
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
    subscribeTransport(listener) {
      if (closed) return () => undefined
      transportListeners.add(listener)
      return () => transportListeners.delete(listener)
    },
  }

  return {
    remoteSession,
    handleEvent(event) {
      if (event.type !== 'conversation.result') return false
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
      unsubscribeTransport()
      state = 'standby'
      lastError = undefined
      transportState = 'disconnected'
      closed = true
      listeners.clear()
      transportListeners.clear()
    },
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function log(message: string): void {
  if (typeof trace === 'function') trace(message)
}
