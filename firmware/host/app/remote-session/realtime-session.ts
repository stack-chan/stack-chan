import type { RemoteConversationTransportState } from 'capabilities'
import {
  isStackchanApplicationEventEnvelope,
  parseStackchanApplicationEvent,
  type StackchanInboundApplicationEvent,
  type StackchanOutboundApplicationEvent,
} from 'stackchan-application-event'

export type RealtimeFunctionTool = {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
  execute(arguments_: Record<string, unknown>): Promise<unknown> | unknown
}

export type RealtimeMcpTool = {
  type: 'mcp'
  server_label: string
  connector_id?: string
  server_url?: string
  allowed_tools?: string[]
  require_approval?: 'always' | 'never'
}

export type RealtimeToolProvider = {
  instructions?: string
  tools: Array<RealtimeFunctionTool | RealtimeMcpTool>
}

export type RealtimeEventSendResult = 'queued' | 'overflow' | Exclude<RemoteConversationTransportState, 'ready'>

export type RealtimeEventBridge = {
  setEventHandler(handler?: (event: string) => void): void
  setTransportStateHandler(handler?: (state: RemoteConversationTransportState) => void): void
  sendEvent(event: string): Promise<RealtimeEventSendResult>
}

export type RealtimeRetryScheduler = {
  set(callback: () => void, milliseconds: number): unknown
  clear(handle: unknown): void
}

export type RealtimeSession = {
  readonly transportState: RemoteConversationTransportState
  setProvider(provider?: RealtimeToolProvider): void
  addApplicationEventHandler(handler: (event: StackchanInboundApplicationEvent) => boolean): () => void
  sendApplicationEvent(event: StackchanOutboundApplicationEvent): Promise<RealtimeEventSendResult>
  subscribeTransport(listener: (state: RemoteConversationTransportState) => void): () => void
  close(): void
}

type RealtimeProviderLease = {
  readonly provider: RealtimeToolProvider
  readonly retryWaiters: Set<() => void>
  continuationTail: Promise<void>
}

type RealtimeTransportSessionLease = {
  readonly retryWaiters: Set<() => void>
}

const CONTINUATION_RETRY_MILLISECONDS = 2_000
const CONTINUATION_TIMEOUT_MILLISECONDS = 10_000

export function createRealtimeSession(bridge: RealtimeEventBridge, scheduler: RealtimeRetryScheduler): RealtimeSession {
  let providerLease: RealtimeProviderLease | undefined
  let transportSessionLease: RealtimeTransportSessionLease | undefined
  let androidSessionCreated = false
  let transportState: RemoteConversationTransportState = 'disconnected'
  let sendTail: Promise<void> = Promise.resolve()
  let closed = false
  const applicationEventHandlers = new Set<(event: StackchanInboundApplicationEvent) => boolean>()
  const transportListeners = new Set<(state: RemoteConversationTransportState) => void>()

  const enqueueSend = <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const result = sendTail.then(operation)
    sendTail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
  const send = (event: Record<string, unknown>): Promise<RealtimeEventSendResult> => {
    const serialized = JSON.stringify(event)
    return enqueueSend(() => bridge.sendEvent(serialized))
  }
  const sendOwned = (
    event: Record<string, unknown>,
    ownsEvent: () => boolean,
  ): Promise<RealtimeEventSendResult | undefined> => {
    const serialized = JSON.stringify(event)
    return enqueueSend(() => {
      if (!ownsEvent()) return Promise.resolve(undefined)
      return bridge.sendEvent(serialized)
    })
  }
  const cancelRetryLease = (lease: { readonly retryWaiters: Set<() => void> }) => {
    for (const wake of [...lease.retryWaiters]) wake()
  }
  const waitForContinuationRetry = (
    activeProviderLease: RealtimeProviderLease,
    activeTransportLease: RealtimeTransportSessionLease,
  ): Promise<void> =>
    new Promise((resolve) => {
      let handle: unknown
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        activeProviderLease.retryWaiters.delete(finish)
        activeTransportLease.retryWaiters.delete(finish)
        if (handle !== undefined) scheduler.clear(handle)
        resolve()
      }
      activeProviderLease.retryWaiters.add(finish)
      activeTransportLease.retryWaiters.add(finish)
      try {
        const scheduledHandle = scheduler.set(() => {
          handle = undefined
          finish()
        }, CONTINUATION_RETRY_MILLISECONDS)
        handle = scheduledHandle
        if (settled) scheduler.clear(scheduledHandle)
      } catch (error) {
        activeProviderLease.retryWaiters.delete(finish)
        activeTransportLease.retryWaiters.delete(finish)
        throw error
      }
    })
  const enqueueContinuation = (lease: RealtimeProviderLease, operation: () => Promise<void>): Promise<void> => {
    const result = lease.continuationTail.then(operation)
    lease.continuationTail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
  const ownsFunctionResult = (
    activeProviderLease: RealtimeProviderLease,
    activeTransportLease: RealtimeTransportSessionLease,
  ): boolean =>
    !closed &&
    transportState === 'ready' &&
    providerLease === activeProviderLease &&
    transportSessionLease === activeTransportLease
  const sendFunctionResult = (
    outputEvent: Record<string, unknown>,
    continuationEvent: Record<string, unknown>,
    activeProviderLease: RealtimeProviderLease,
    activeTransportLease: RealtimeTransportSessionLease,
  ): Promise<void> => {
    const serializedOutput = JSON.stringify(outputEvent)
    const serializedContinuation = JSON.stringify(continuationEvent)
    return enqueueSend(async () => {
      if (!ownsFunctionResult(activeProviderLease, activeTransportLease)) return undefined
      let outputResult: RealtimeEventSendResult
      try {
        outputResult = await bridge.sendEvent(serializedOutput)
      } catch (error) {
        log(`[remote-session] function output send failed: ${errorMessage(error)}\n`)
        return undefined
      }
      return outputResult
    }).then((outputResult) => {
      if (outputResult === undefined) return
      if (!ownsFunctionResult(activeProviderLease, activeTransportLease)) return
      if (outputResult !== 'queued') {
        log(`[remote-session] function output was not queued: ${outputResult}\n`)
        return
      }

      // Serialize continuation loops per activation, but reserve the shared
      // send tail for one physical send at a time. Retry waits therefore do
      // not block conversation control or later function outputs.
      return enqueueContinuation(activeProviderLease, async () => {
        let elapsedMilliseconds = 0
        let lastFailure = 'unknown failure'
        while (ownsFunctionResult(activeProviderLease, activeTransportLease)) {
          let result: RealtimeEventSendResult | undefined
          try {
            result = await enqueueSend(() => {
              if (!ownsFunctionResult(activeProviderLease, activeTransportLease)) {
                return Promise.resolve(undefined)
              }
              return bridge.sendEvent(serializedContinuation)
            })
          } catch (error) {
            lastFailure = errorMessage(error)
          }
          if (!ownsFunctionResult(activeProviderLease, activeTransportLease)) return
          if (result !== undefined) {
            if (result === 'queued') return
            if (result === 'unsupported' || result === 'disconnected') {
              log(`[remote-session] response.create is unavailable because EVENT is ${result}\n`)
              return
            }
            lastFailure = result
          }
          if (elapsedMilliseconds >= CONTINUATION_TIMEOUT_MILLISECONDS) {
            log(`[remote-session] response.create delivery timed out after function output: ${lastFailure}\n`)
            return
          }
          try {
            await waitForContinuationRetry(activeProviderLease, activeTransportLease)
          } catch (error) {
            log(`[remote-session] response.create retry scheduling failed: ${errorMessage(error)}\n`)
            return
          }
          elapsedMilliseconds += CONTINUATION_RETRY_MILLISECONDS
        }
      })
    })
  }
  const updateSession = (): Promise<RealtimeEventSendResult | undefined> | undefined => {
    const activeProviderLease = providerLease
    const activeTransportLease = transportSessionLease
    if (!androidSessionCreated || !activeProviderLease || !activeTransportLease) return
    const activeProvider = activeProviderLease.provider
    return sendOwned(
      {
        type: 'session.update',
        event_id: nextId('session'),
        session: {
          instructions: activeProvider.instructions ?? '',
          tools: activeProvider.tools.map((tool) =>
            tool.type === 'function'
              ? {
                  type: tool.type,
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters,
                }
              : tool,
          ),
        },
      },
      () =>
        providerLease === activeProviderLease &&
        transportSessionLease === activeTransportLease &&
        transportState === 'ready',
    )
  }
  const handle = async (serialized: string) => {
    let value: unknown
    try {
      value = JSON.parse(serialized) as unknown
    } catch {
      return
    }
    if (isStackchanApplicationEventEnvelope(value)) {
      const applicationEvent = parseStackchanApplicationEvent(value)
      if (!applicationEvent) {
        log('[remote-session] ignored malformed stackchan.event.v1 message\n')
        return
      }
      for (const handler of applicationEventHandlers) {
        if (handler(applicationEvent)) return
      }
      log(`[remote-session] no handler for ${applicationEvent.type}\n`)
      return
    }
    if (!isRecord(value)) return
    const event = value
    switch (event.type) {
      case 'session.created':
        if (transportState !== 'ready') break
        if (transportSessionLease) cancelRetryLease(transportSessionLease)
        transportSessionLease = { retryWaiters: new Set() }
        androidSessionCreated = true
        await updateSession()
        break
      case 'response.function_call_arguments.done':
        await executeFunction(event)
        break
    }
  }
  const executeFunction = async (event: Record<string, unknown>) => {
    const activeProviderLease = providerLease
    const activeTransportLease = transportSessionLease
    if (!activeProviderLease || !activeTransportLease || transportState !== 'ready') {
      log('[remote-session] ignored function call outside an active transport session\n')
      return
    }
    const callId = typeof event.call_id === 'string' ? event.call_id : ''
    const name = typeof event.name === 'string' ? event.name : ''
    const tool = activeProviderLease.provider.tools.find(
      (candidate): candidate is RealtimeFunctionTool => candidate.type === 'function' && candidate.name === name,
    )
    let output: unknown
    try {
      if (!callId || !tool) throw new Error(`function tool is unavailable: ${name}`)
      const arguments_ = typeof event.arguments === 'string' ? JSON.parse(event.arguments) : (event.arguments ?? {})
      output = await tool.execute(arguments_ as Record<string, unknown>)
    } catch (error) {
      output = { error: error instanceof Error ? error.message : String(error) }
    }
    if (!ownsFunctionResult(activeProviderLease, activeTransportLease)) {
      log('[remote-session] discarded function output after its activation or transport session ended\n')
      return
    }
    await sendFunctionResult(
      {
        type: 'conversation.item.create',
        event_id: nextId('output'),
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: typeof output === 'string' ? output : JSON.stringify(output),
        },
      },
      { type: 'response.create', event_id: nextId('response') },
      activeProviderLease,
      activeTransportLease,
    )
  }

  bridge.setEventHandler((event) => {
    void handle(event).catch((error) => {
      log(`[remote-session] inbound event failed: ${errorMessage(error)}\n`)
    })
  })
  bridge.setTransportStateHandler((nextState) => {
    if (closed || nextState === transportState) return
    if (transportSessionLease) cancelRetryLease(transportSessionLease)
    transportSessionLease = nextState === 'ready' ? { retryWaiters: new Set() } : undefined
    if (nextState !== 'ready') androidSessionCreated = false
    transportState = nextState
    for (const listener of transportListeners) {
      try {
        listener(nextState)
      } catch (error) {
        log(`[remote-session] transport listener failed: ${errorMessage(error)}\n`)
      }
    }
  })
  return {
    get transportState() {
      return transportState
    },
    setProvider(next) {
      if (providerLease) cancelRetryLease(providerLease)
      providerLease = next
        ? { provider: next, retryWaiters: new Set(), continuationTail: Promise.resolve() }
        : undefined
      if (!providerLease) return
      const result = updateSession()
      if (result) {
        void result.catch((error) => {
          log(`[remote-session] session.update failed: ${errorMessage(error)}\n`)
        })
      }
    },
    addApplicationEventHandler(handler) {
      applicationEventHandlers.add(handler)
      return () => applicationEventHandlers.delete(handler)
    },
    sendApplicationEvent(event) {
      return send(event)
    },
    subscribeTransport(listener) {
      if (closed) return () => undefined
      transportListeners.add(listener)
      return () => transportListeners.delete(listener)
    },
    close() {
      if (closed) return
      closed = true
      bridge.setEventHandler(undefined)
      bridge.setTransportStateHandler(undefined)
      androidSessionCreated = false
      if (providerLease) cancelRetryLease(providerLease)
      if (transportSessionLease) cancelRetryLease(transportSessionLease)
      providerLease = undefined
      transportSessionLease = undefined
      applicationEventHandlers.clear()
      transportListeners.clear()
    },
  }
}

let eventSequence = 0
function nextId(prefix: string): string {
  eventSequence = (eventSequence + 1) >>> 0
  return `${prefix}-${eventSequence}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function log(message: string): void {
  if (typeof trace === 'function') trace(message)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
