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

export type RealtimeEventBridge = {
  setEventHandler(handler?: (event: string) => void): void
  sendEvent(event: string): void
}

export type UsbRealtimeSession = {
  setProvider(provider: RealtimeToolProvider): void
  setApplicationEventHandler(handler?: (event: Record<string, unknown>) => boolean): void
  addApplicationEventHandler(handler: (event: Record<string, unknown>) => boolean): () => void
  sendApplicationEvent(event: Record<string, unknown>): void
  close(): void
}

export function createUsbRealtimeSession(bridge: RealtimeEventBridge): UsbRealtimeSession {
  let provider: RealtimeToolProvider = { tools: [] }
  let androidSessionCreated = false
  let applicationEventHandler: ((event: Record<string, unknown>) => boolean) | undefined
  const applicationEventHandlers = new Set<(event: Record<string, unknown>) => boolean>()

  const send = (event: Record<string, unknown>) => bridge.sendEvent(JSON.stringify(event))
  const updateSession = () => {
    if (!androidSessionCreated) return
    send({
      type: 'session.update',
      event_id: nextId('session'),
      session: {
        instructions: provider.instructions ?? '',
        tools: provider.tools.map((tool) =>
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
    })
  }
  const handle = async (serialized: string) => {
    let event: Record<string, unknown>
    try {
      event = JSON.parse(serialized) as Record<string, unknown>
    } catch {
      return
    }
    if (applicationEventHandler?.(event)) return
    for (const handler of applicationEventHandlers) {
      if (handler(event)) return
    }
    switch (event.type) {
      case 'session.created':
        androidSessionCreated = true
        updateSession()
        break
      case 'response.function_call_arguments.done':
        await executeFunction(event)
        break
    }
  }
  const executeFunction = async (event: Record<string, unknown>) => {
    const callId = typeof event.call_id === 'string' ? event.call_id : ''
    const name = typeof event.name === 'string' ? event.name : ''
    const tool = provider.tools.find(
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
    send({
      type: 'conversation.item.create',
      event_id: nextId('output'),
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: typeof output === 'string' ? output : JSON.stringify(output),
      },
    })
    send({ type: 'response.create', event_id: nextId('response') })
  }

  bridge.setEventHandler((event) => void handle(event))
  return {
    setProvider(next) {
      provider = next
      updateSession()
    },
    setApplicationEventHandler(handler) {
      applicationEventHandler = handler
    },
    addApplicationEventHandler(handler) {
      applicationEventHandlers.add(handler)
      return () => applicationEventHandlers.delete(handler)
    },
    sendApplicationEvent(event) {
      send(event)
    },
    close() {
      bridge.setEventHandler(undefined)
      androidSessionCreated = false
      applicationEventHandler = undefined
      applicationEventHandlers.clear()
    },
  }
}

let eventSequence = 0
function nextId(prefix: string): string {
  eventSequence = (eventSequence + 1) >>> 0
  return `${prefix}-${eventSequence}`
}
