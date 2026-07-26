import type { RemoteConversationSession, RemoteConversationState, StackchanContext } from 'capabilities'
import { createApprovalSession, type ApprovalSession } from 'stackchan-approval-session'
import { createConversationSession, type ConversationRetryScheduler } from 'stackchan-conversation-session'
import {
  createRealtimeSession,
  type RealtimeEventBridge,
  type RealtimeSession,
  type RealtimeToolProvider,
} from 'stackchan-realtime-session'

export type RemoteSessionTransport = RealtimeEventBridge & {
  close(): void
}

export type RemoteSessionRuntime = {
  readonly remoteConversationSession: RemoteConversationSession
  onContextCreated(context: StackchanContext, provider: RealtimeToolProvider): void
  updateConversationState(state: RemoteConversationState, error?: string): void
  close(): void
}

export function createRemoteSessionRuntime(
  transport: RemoteSessionTransport,
  scheduler: ConversationRetryScheduler,
): RemoteSessionRuntime {
  const realtimeSession: RealtimeSession = createRealtimeSession(transport)
  const conversationSession = createConversationSession(realtimeSession, scheduler)
  let approvalSession: ApprovalSession | undefined
  let removeApprovalHandler: (() => void) | undefined
  let removeConversationHandler: (() => void) | undefined
  let contextAttached = false
  let closed = false

  return {
    remoteConversationSession: conversationSession.remoteSession,
    onContextCreated(context, provider) {
      if (closed) throw new Error('remote session runtime is closed')
      if (contextAttached) throw new Error('remote session runtime is already attached')
      contextAttached = true
      approvalSession = createApprovalSession(realtimeSession, context)
      removeApprovalHandler = realtimeSession.addApplicationEventHandler(approvalSession.handleEvent)
      removeConversationHandler = realtimeSession.addApplicationEventHandler(conversationSession.handleEvent)
      realtimeSession.setProvider(provider)
    },
    updateConversationState(state, error) {
      conversationSession.updateState(state, error)
    },
    close() {
      if (closed) return
      closed = true
      let firstError: unknown
      let hasError = false
      const close = (operation: () => void) => {
        try {
          operation()
        } catch (error) {
          if (!hasError) {
            firstError = error
            hasError = true
          }
        }
      }
      close(() => removeApprovalHandler?.())
      close(() => removeConversationHandler?.())
      close(() => approvalSession?.close())
      close(() => conversationSession.close())
      close(() => realtimeSession.close())
      close(() => transport.close())
      removeApprovalHandler = undefined
      removeConversationHandler = undefined
      approvalSession = undefined
      if (hasError) throw firstError
    },
  }
}
