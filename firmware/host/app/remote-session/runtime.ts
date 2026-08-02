import type { RemoteConversationSessionDelegate, RemoteConversationState, StackchanContext } from 'capabilities'
import { type ApprovalSession, createApprovalSession } from 'stackchan-approval-session'
import { type ConversationRetryScheduler, createConversationSession } from 'stackchan-conversation-session'
import {
  createRealtimeSession,
  type RealtimeEventBridge,
  type RealtimeSession,
  type RealtimeToolProvider,
} from 'stackchan-realtime-session'
import { createTaskSession, type TaskStateListener } from 'stackchan-task-session'

export type RemoteSessionTransport = RealtimeEventBridge

export type RemoteSessionActivation = {
  readonly remoteConversationSession: RemoteConversationSessionDelegate
  updateConversationState(state: RemoteConversationState, error?: string): void
  close(): void
}

export type RemoteSessionRuntime = {
  activate(context: StackchanContext, provider: RealtimeToolProvider): RemoteSessionActivation
  subscribeTaskState(listener: TaskStateListener): () => void
  close(): void
}

export function createRemoteSessionRuntime(
  transport: RemoteSessionTransport,
  scheduler: ConversationRetryScheduler,
): RemoteSessionRuntime {
  const realtimeSession: RealtimeSession = createRealtimeSession(transport)
  const taskSession = createTaskSession(realtimeSession)
  let active: RemoteSessionActivation | undefined
  let closed = false

  return {
    activate(context, provider) {
      if (closed) throw new Error('remote session runtime is closed')
      if (active) throw new Error('remote session runtime is already active')
      const conversationSession = createConversationSession(realtimeSession, scheduler)
      let approvalSession: ApprovalSession | undefined
      let removeApprovalHandler: (() => void) | undefined
      let removeConversationHandler: (() => void) | undefined
      try {
        approvalSession = createApprovalSession(realtimeSession, context)
        removeApprovalHandler = realtimeSession.addApplicationEventHandler(approvalSession.handleEvent)
        removeConversationHandler = realtimeSession.addApplicationEventHandler(conversationSession.handleEvent)
        realtimeSession.setProvider(provider)
      } catch (error) {
        tryClose(() => realtimeSession.setProvider(undefined))
        tryClose(removeConversationHandler)
        tryClose(removeApprovalHandler)
        tryClose(() => approvalSession?.close())
        tryClose(() => conversationSession.close())
        throw error
      }

      let activationClosed = false
      const activation: RemoteSessionActivation = {
        remoteConversationSession: conversationSession.remoteSession,
        updateConversationState(state, error) {
          conversationSession.updateState(state, error)
        },
        close() {
          if (activationClosed) return
          activationClosed = true
          if (active === activation) active = undefined
          let firstError: unknown
          const close = (operation?: () => void) => {
            if (!operation) return
            try {
              operation()
            } catch (error) {
              firstError ??= error
            }
          }
          close(() => realtimeSession.setProvider(undefined))
          close(removeConversationHandler)
          close(removeApprovalHandler)
          close(() => approvalSession?.close())
          close(() => conversationSession.close())
          removeConversationHandler = undefined
          removeApprovalHandler = undefined
          approvalSession = undefined
          if (firstError !== undefined) throw firstError
        },
      }
      active = activation
      return activation
    },
    subscribeTaskState(listener) {
      return taskSession.subscribe(listener)
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
      close(() => active?.close())
      close(() => taskSession.close())
      close(() => realtimeSession.close())
      active = undefined
      if (hasError) throw firstError
    },
  }
}

function tryClose(operation?: () => void): void {
  if (!operation) return
  try {
    operation()
  } catch {
    // Preserve the original activation error.
  }
}
