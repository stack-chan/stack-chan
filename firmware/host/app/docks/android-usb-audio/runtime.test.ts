import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  RemoteConversationListener,
  RemoteConversationSessionDelegate,
  RemoteConversationState,
  RemoteConversationTransportListener,
  RemoteConversationTransportState,
  StackchanContext,
} from 'capabilities'
import { installRemoteSessionTestAliases } from '../../remote-session/__tests__/node-aliases.js'
import type { TaskExecutionState } from '../../remote-session/application-event.js'
import type { RealtimeToolProvider } from '../../remote-session/realtime-session.js'
import type {
  UsbAudioBridgeControl,
  UsbAudioBridgeOptions,
  UsbAudioConfig,
  UsbAudioDockDependencies,
  UsbAudioPresentationControl,
  UsbAudioRemoteRuntime,
} from './runtime.js'

installRemoteSessionTestAliases()

const { createUsbAudioDockRuntime } = await import('./runtime.js')

class FakeRemoteSession implements RemoteConversationSessionDelegate {
  state: RemoteConversationState = 'standby'
  lastError: string | undefined
  transportState: RemoteConversationTransportState = 'disconnected'
  readonly stateListeners = new Set<RemoteConversationListener>()
  readonly transportListeners = new Set<RemoteConversationTransportListener>()

  requestStart(): string {
    return 'start'
  }

  requestStop(): string {
    return 'stop'
  }

  subscribe(listener: RemoteConversationListener): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  subscribeTransport(listener: RemoteConversationTransportListener): () => void {
    this.transportListeners.add(listener)
    return () => this.transportListeners.delete(listener)
  }

  updateState(state: RemoteConversationState, error?: string): void {
    this.state = state
    this.lastError = error
    for (const listener of this.stateListeners) listener(state, error)
  }
}

class FakeBridge implements UsbAudioBridgeControl<number> {
  statusHandler: ((status: number) => void) | undefined
  presentation: UsbAudioPresentationControl | undefined
  speakerVolume: number

  constructor(
    readonly id: number,
    private readonly events: string[],
    speakerVolume: number,
  ) {
    this.speakerVolume = speakerVolume
  }

  setSpeakerVolume(volume: number): void {
    this.speakerVolume = volume
    this.events.push(`bridge-${this.id}:volume:${volume}`)
  }

  setEventHandler(): void {}

  setTransportStateHandler(): void {}

  sendEvent(): Promise<'queued'> {
    return Promise.resolve('queued')
  }

  setStatusHandler(handler?: (status: number) => void): void {
    this.statusHandler = handler
    this.events.push(`bridge-${this.id}:status:${handler ? 'attach' : 'detach'}`)
  }

  setPresentation(presentation?: UsbAudioPresentationControl): void {
    this.presentation = presentation
    this.events.push(`bridge-${this.id}:presentation:${presentation ? 'attach' : 'detach'}`)
  }

  close(): void {
    this.events.push(`bridge-${this.id}:close`)
  }
}

type HarnessOptions = {
  events?: string[]
  failRemoteRuntime?: boolean
  resolveSpeakerVolume?: () => number
}

function createHarness(config: UsbAudioConfig = {}, options: HarnessOptions = {}) {
  const events = options.events ?? []
  const bridges: FakeBridge[] = []
  const sessions: FakeRemoteSession[] = []
  const taskListeners: Array<Set<(state: TaskExecutionState) => void>> = []
  const taskStates: TaskExecutionState[] = []
  const presentationTaskStates: TaskExecutionState[] = []
  let imports = 0
  let moduleChecks = 0
  let failPresentation = false
  const dependencies: UsbAudioDockDependencies<number> = {
    hasUsbAudioModule() {
      moduleChecks += 1
      return true
    },
    importUsbAudioModule() {
      imports += 1
      return (bridgeOptions?: UsbAudioBridgeOptions) => {
        const bridge = new FakeBridge(bridges.length + 1, events, bridgeOptions?.speakerVolume ?? 1)
        bridges.push(bridge)
        events.push(`bridge-${bridge.id}:create`)
        return bridge
      }
    },
    createRemoteRuntime(bridge) {
      events.push(`runtime-${(bridge as FakeBridge).id}:create`)
      if (options.failRemoteRuntime) throw new Error('runtime failed')
      const session = new FakeRemoteSession()
      sessions.push(session)
      const id = sessions.length
      const listeners = new Set<(state: TaskExecutionState) => void>()
      taskListeners.push(listeners)
      taskStates.push('idle')
      return {
        remoteConversationSession: session,
        onContextCreated() {
          events.push(`runtime-${id}:attach`)
        },
        updateConversationState(state, error) {
          session.updateState(state, error)
        },
        subscribeTaskState(listener) {
          listeners.add(listener)
          listener(taskStates[id - 1] ?? 'idle')
          return () => listeners.delete(listener)
        },
        close() {
          events.push(`runtime-${id}:close`)
        },
      } satisfies UsbAudioRemoteRuntime
    },
    createRealtimeToolProvider() {
      events.push('provider:create')
      return { tools: [] } satisfies RealtimeToolProvider
    },
    createPresentation() {
      events.push('presentation:create')
      if (failPresentation) throw new Error('presentation failed')
      const id = bridges.length
      return {
        onStatusChanged() {},
        onTaskStateChanged(state) {
          presentationTaskStates.push(state)
        },
        onPlaybackStarted() {},
        onPlaybackPower() {},
        onPlaybackText() {},
        onPlaybackStopped() {},
        close() {
          events.push(`presentation-${id}:close`)
        },
      }
    },
    conversationState() {
      return 'listening'
    },
    ...(options.resolveSpeakerVolume ? { resolveSpeakerVolume: options.resolveSpeakerVolume } : {}),
  }
  const runtime = createUsbAudioDockRuntime(config, dependencies)
  return {
    bridges,
    events,
    runtime,
    sessions,
    presentationTaskStates,
    taskListeners,
    emitTaskState(index: number, state: TaskExecutionState) {
      taskStates[index] = state
      for (const listener of taskListeners[index] ?? []) listener(state)
    },
    get imports() {
      return imports
    },
    get moduleChecks() {
      return moduleChecks
    },
    set failPresentation(value: boolean) {
      failPresentation = value
    },
  }
}

test('manual mode reserves the physical bridge before context attachment without activating a session', () => {
  const harness = createHarness({ autoStart: false })

  assert.equal(harness.moduleChecks, 1)
  assert.equal(harness.imports, 1)
  assert.deepEqual(harness.events, ['bridge-1:create', 'runtime-1:create'])

  harness.runtime.onContextCreated({} as StackchanContext)

  assert.equal(harness.runtime.remoteConversationSession?.activationState, 'inactive')
  assert.equal(harness.moduleChecks, 1)
  assert.equal(harness.imports, 1)
  assert.deepEqual(harness.events, ['bridge-1:create', 'runtime-1:create'])
})

test('context attachment reapplies the saved host volume without recreating the physical bridge', () => {
  let savedVolume = 0.25
  const harness = createHarness({ autoStart: false, speakerVolume: 0.1 }, { resolveSpeakerVolume: () => savedVolume })

  assert.equal(harness.bridges[0].speakerVolume, 0.1)
  savedVolume = 0.4
  harness.runtime.onContextCreated({} as StackchanContext)

  assert.equal(harness.bridges[0].speakerVolume, 0.4)
  assert.equal(harness.bridges.length, 1)
  assert.deepEqual(harness.events, ['bridge-1:create', 'runtime-1:create', 'bridge-1:volume:0.4'])
})

test('activate is idempotent and deactivate releases only activation-scoped resources', () => {
  const harness = createHarness({ speakerVolume: 0.25 })
  const remoteSession = harness.runtime.remoteConversationSession
  assert.ok(remoteSession)
  harness.runtime.onContextCreated({} as StackchanContext)
  const states: RemoteConversationState[] = []
  remoteSession.subscribe((state) => states.push(state))

  remoteSession.activate()
  remoteSession.activate()
  harness.bridges[0].statusHandler?.(0)

  assert.equal(harness.imports, 1)
  assert.equal(remoteSession.activationState, 'active')
  assert.equal(remoteSession.state, 'listening')
  assert.deepEqual(states, ['listening'])

  remoteSession.deactivate()
  remoteSession.deactivate()

  assert.equal(remoteSession.activationState, 'inactive')
  assert.equal(remoteSession.state, 'standby')
  assert.deepEqual(harness.events.slice(-3), [
    'bridge-1:status:detach',
    'bridge-1:presentation:detach',
    'presentation-1:close',
  ])

  remoteSession.activate()
  assert.equal(harness.imports, 1)
  assert.equal(harness.bridges.length, 1)
  assert.equal(harness.sessions.length, 1)
  assert.equal(harness.events.filter((event) => event === 'runtime-1:close').length, 0)
  assert.equal(harness.events.filter((event) => event === 'bridge-1:close').length, 0)
})

test('activation failure rolls back created resources and can be retried', () => {
  const harness = createHarness()
  const remoteSession = harness.runtime.remoteConversationSession
  assert.ok(remoteSession)
  harness.runtime.onContextCreated({} as StackchanContext)
  harness.failPresentation = true

  assert.throws(() => remoteSession.activate(), /presentation failed/)
  assert.equal(remoteSession.activationState, 'inactive')
  assert.deepEqual(harness.events.slice(-2), ['bridge-1:status:detach', 'bridge-1:presentation:detach'])

  harness.failPresentation = false
  remoteSession.activate()
  assert.equal(remoteSession.activationState, 'active')
  assert.equal(harness.imports, 1)
  assert.equal(harness.bridges.length, 1)
})

test('task state received before activation is retained and snapshots across reactivation', () => {
  const harness = createHarness()
  const remoteSession = harness.runtime.remoteConversationSession
  assert.ok(remoteSession)
  harness.emitTaskState(0, 'running')
  harness.runtime.onContextCreated({} as StackchanContext)
  remoteSession.activate()

  harness.emitTaskState(0, 'idle')
  harness.bridges[0].statusHandler?.(0)

  assert.deepEqual(harness.presentationTaskStates, ['running', 'idle'])
  assert.equal(harness.taskListeners[0].size, 1)
  remoteSession.deactivate()
  harness.emitTaskState(0, 'running')
  assert.deepEqual(harness.presentationTaskStates, ['running', 'idle'])
  assert.equal(harness.taskListeners[0].size, 0)

  remoteSession.activate()
  assert.deepEqual(harness.presentationTaskStates, ['running', 'idle', 'running'])
  assert.equal(harness.taskListeners[0].size, 1)
})

test('runtime creation failure closes the reserved bridge during Dock startup', () => {
  const events: string[] = []

  assert.throws(() => createHarness({}, { events, failRemoteRuntime: true }), /runtime failed/)
  assert.deepEqual(events, ['bridge-1:create', 'runtime-1:create', 'bridge-1:close'])
})

test('auto-start activates after context attachment and host close is idempotent', () => {
  const harness = createHarness({ autoStart: true })
  const remoteSession = harness.runtime.remoteConversationSession
  assert.ok(remoteSession)

  harness.runtime.onContextCreated({} as StackchanContext)
  assert.equal(remoteSession.activationState, 'active')
  assert.equal(harness.imports, 1)

  harness.runtime.close()
  harness.runtime.close()
  remoteSession.deactivate()

  assert.equal(remoteSession.activationState, 'inactive')
  assert.equal(harness.events.filter((event) => event === 'runtime-1:close').length, 1)
  assert.equal(harness.events.filter((event) => event === 'bridge-1:close').length, 1)
  assert.throws(() => remoteSession.activate(), /closed/)
})

test('auto-start failure is logged and leaves the attached context available for retry', () => {
  const harness = createHarness({ autoStart: true })
  const remoteSession = harness.runtime.remoteConversationSession
  assert.ok(remoteSession)
  harness.failPresentation = true
  const messages: string[] = []
  const testGlobal = globalThis as typeof globalThis & { trace?: (message: string) => void }
  const previousTrace = testGlobal.trace
  testGlobal.trace = (message) => messages.push(message)

  try {
    assert.doesNotThrow(() => harness.runtime.onContextCreated({} as StackchanContext))
  } finally {
    testGlobal.trace = previousTrace
  }

  assert.equal(remoteSession.activationState, 'inactive')
  assert.match(messages.join(''), /\[dock\] auto-start activation failed: presentation failed/)

  harness.failPresentation = false
  remoteSession.activate()
  assert.equal(remoteSession.activationState, 'active')
  assert.equal(harness.imports, 1)
  assert.equal(harness.bridges.length, 1)
})

test('activation before context attachment fails after reserving but without recreating the USB bridge', () => {
  const harness = createHarness()
  const remoteSession = harness.runtime.remoteConversationSession
  assert.ok(remoteSession)

  assert.throws(() => remoteSession.activate(), /before the Stack-chan context/)
  assert.equal(harness.moduleChecks, 1)
  assert.equal(harness.imports, 1)
  assert.equal(harness.bridges.length, 1)
  assert.deepEqual(harness.events, ['bridge-1:create', 'runtime-1:create'])
})

test('host close releases an inactive reserved bridge exactly once', () => {
  const harness = createHarness({ autoStart: false })

  harness.runtime.close()
  harness.runtime.close()

  assert.deepEqual(harness.events, ['bridge-1:create', 'runtime-1:create', 'runtime-1:close', 'bridge-1:close'])
})
