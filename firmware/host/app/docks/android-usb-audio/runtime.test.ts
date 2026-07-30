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
import type { RealtimeToolProvider } from '../../remote-session/realtime-session.js'
import type {
  UsbAudioBridgeControl,
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

  constructor(
    readonly id: number,
    private readonly events: string[],
  ) {}

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

function createHarness(config: UsbAudioConfig = {}) {
  const events: string[] = []
  const bridges: FakeBridge[] = []
  const sessions: FakeRemoteSession[] = []
  let imports = 0
  let moduleChecks = 0
  let failRemoteRuntime = false
  let failPresentation = false
  const dependencies: UsbAudioDockDependencies<number> = {
    hasUsbAudioModule() {
      moduleChecks += 1
      return true
    },
    importUsbAudioModule() {
      imports += 1
      return () => {
        const bridge = new FakeBridge(bridges.length + 1, events)
        bridges.push(bridge)
        events.push(`bridge-${bridge.id}:create`)
        return bridge
      }
    },
    createRemoteRuntime(bridge) {
      events.push(`runtime-${(bridge as FakeBridge).id}:create`)
      if (failRemoteRuntime) throw new Error('runtime failed')
      const session = new FakeRemoteSession()
      sessions.push(session)
      const id = sessions.length
      return {
        remoteConversationSession: session,
        onContextCreated() {
          events.push(`runtime-${id}:attach`)
        },
        updateConversationState(state, error) {
          session.updateState(state, error)
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
  }
  const runtime = createUsbAudioDockRuntime(config, dependencies)
  return {
    bridges,
    events,
    runtime,
    sessions,
    get imports() {
      return imports
    },
    get moduleChecks() {
      return moduleChecks
    },
    set failRemoteRuntime(value: boolean) {
      failRemoteRuntime = value
    },
    set failPresentation(value: boolean) {
      failPresentation = value
    },
  }
}

test('manual mode attaches context without importing or starting the bridge', () => {
  const harness = createHarness({ autoStart: false })

  harness.runtime.onContextCreated({} as StackchanContext)

  assert.equal(harness.runtime.remoteConversationSession?.activationState, 'inactive')
  assert.equal(harness.moduleChecks, 0)
  assert.equal(harness.imports, 0)
  assert.deepEqual(harness.events, [])
})

test('activate is idempotent and deactivate releases resources in reverse ownership order', () => {
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
  assert.deepEqual(harness.events.slice(-5), [
    'bridge-1:status:detach',
    'bridge-1:presentation:detach',
    'presentation-1:close',
    'runtime-1:close',
    'bridge-1:close',
  ])

  remoteSession.activate()
  assert.equal(harness.imports, 2)
  assert.equal(harness.bridges.length, 2)
})

test('activation failure rolls back created resources and can be retried', () => {
  const harness = createHarness()
  const remoteSession = harness.runtime.remoteConversationSession
  assert.ok(remoteSession)
  harness.runtime.onContextCreated({} as StackchanContext)
  harness.failPresentation = true

  assert.throws(() => remoteSession.activate(), /presentation failed/)
  assert.equal(remoteSession.activationState, 'inactive')
  assert.deepEqual(harness.events.slice(-4), [
    'bridge-1:status:detach',
    'bridge-1:presentation:detach',
    'runtime-1:close',
    'bridge-1:close',
  ])

  harness.failPresentation = false
  remoteSession.activate()
  assert.equal(remoteSession.activationState, 'active')
  assert.equal(harness.imports, 2)
})

test('runtime creation failure closes the bridge without leaving an active facade', () => {
  const harness = createHarness()
  const remoteSession = harness.runtime.remoteConversationSession
  assert.ok(remoteSession)
  harness.runtime.onContextCreated({} as StackchanContext)
  harness.failRemoteRuntime = true

  assert.throws(() => remoteSession.activate(), /runtime failed/)
  assert.equal(remoteSession.activationState, 'inactive')
  assert.deepEqual(harness.events, [
    'bridge-1:create',
    'runtime-1:create',
    'bridge-1:status:detach',
    'bridge-1:presentation:detach',
    'bridge-1:close',
  ])
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

test('activation before context attachment fails without touching the USB module', () => {
  const harness = createHarness()
  const remoteSession = harness.runtime.remoteConversationSession
  assert.ok(remoteSession)

  assert.throws(() => remoteSession.activate(), /before the Stack-chan context/)
  assert.equal(harness.moduleChecks, 0)
  assert.equal(harness.imports, 0)
})
