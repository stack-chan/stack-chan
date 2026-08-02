import type { StackchanInboundApplicationEvent, TaskExecutionState } from 'stackchan-application-event'
import type { RealtimeSession } from 'stackchan-realtime-session'

export type TaskStateListener = (state: TaskExecutionState) => void

export type TaskSessionTransport = Pick<RealtimeSession, 'addApplicationEventHandler' | 'subscribeTransport'>

export type TaskSession = {
  readonly state: TaskExecutionState
  subscribe(listener: TaskStateListener): () => void
  close(): void
}

export function createTaskSession(transport: TaskSessionTransport): TaskSession {
  let state: TaskExecutionState = 'idle'
  let closed = false
  const listeners = new Set<TaskStateListener>()

  const updateState = (nextState: TaskExecutionState) => {
    if (closed || nextState === state) return
    state = nextState
    for (const listener of listeners) {
      try {
        listener(state)
      } catch (error) {
        log(`[remote-task] state listener failed: ${errorMessage(error)}\n`)
      }
    }
  }

  const handleEvent = (event: StackchanInboundApplicationEvent) => {
    if (event.type !== 'task.status') return false
    updateState(event.state)
    return true
  }

  const removeApplicationHandler = transport.addApplicationEventHandler(handleEvent)
  const removeTransportListener = transport.subscribeTransport((transportState) => {
    if (transportState !== 'ready') updateState('idle')
  })

  return {
    get state() {
      return state
    },
    subscribe(listener) {
      if (closed) return () => undefined
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    },
    close() {
      if (closed) return
      let firstError: unknown
      const attempt = (operation: () => void) => {
        try {
          operation()
        } catch (error) {
          firstError ??= error
        }
      }
      attempt(removeApplicationHandler)
      attempt(removeTransportListener)
      updateState('idle')
      closed = true
      listeners.clear()
      if (firstError !== undefined) throw firstError
    },
  }
}

function log(message: string): void {
  if (typeof trace === 'function') trace(message)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
