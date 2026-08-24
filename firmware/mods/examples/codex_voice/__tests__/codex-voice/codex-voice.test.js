import { onContextCreated } from 'mod'
import { equal } from 'testing/assert'

function createTouchPanel(events) {
  let handler
  return {
    subscribe(value) {
      events.push('gesture')
      handler = value
      return () => {
        if (handler === value) handler = undefined
      }
    },
    emit(event) {
      handler?.(event)
    },
  }
}

function createRemoteSession(events, activationErrors = []) {
  let state = 'standby'
  let activationState = 'inactive'
  let activationAttempt = 0
  let stateListener
  const requests = []
  return {
    get state() {
      return state
    },
    get activationState() {
      return activationState
    },
    requests,
    transportState: 'disconnected',
    activate() {
      events.push('activate')
      const activationError = activationErrors[activationAttempt++]
      if (activationError) throw activationError
      activationState = 'active'
    },
    subscribe(listener) {
      events.push('subscribe')
      stateListener = listener
      return () => {}
    },
    subscribeTransport() {
      events.push('subscribeTransport')
      return () => {}
    },
    requestStart() {
      if (activationState !== 'active') throw new Error('USB remote conversation session is inactive')
      events.push('start')
      requests.push('start')
      state = 'connecting'
      stateListener?.(state)
      return 'start-1'
    },
    requestStop() {
      events.push('stop')
      requests.push('stop')
      state = 'standby'
      stateListener?.(state)
      return 'stop-1'
    },
  }
}

function createDrawer(events) {
  const buttons = []
  const states = []
  return {
    buttons,
    states,
    drawer: {
      addDrawerButton(button) {
        events.push('drawer')
        buttons.push(button)
      },
      setDrawerButtonState(key, active) {
        states.push([key, active])
      },
    },
  }
}

{
  const events = []
  const touchPanel = createTouchPanel(events)
  onContextCreated({
    conversation: {},
    input: { touchPanel },
  })
  equal(events.length, 0, 'missing capability should not activate or install a gesture handler')
}

{
  const events = []
  const touchPanel = createTouchPanel(events)
  const remoteSession = createRemoteSession(events)
  const drawer = createDrawer(events)
  const statuses = []
  let hiddenStatuses = 0
  onContextCreated({
    conversation: { remoteSession },
    input: { touchPanel },
    ui: {
      drawer: drawer.drawer,
      showBalloon(message) {
        statuses.push(message)
      },
      hideBalloon() {
        hiddenStatuses += 1
      },
    },
  })

  equal(
    events.join(','),
    'drawer,activate,subscribe,subscribeTransport,gesture',
    'activation should precede subscriptions',
  )
  equal(drawer.buttons.length, 1, 'Codex MOD should register one session drawer button')
  equal(drawer.buttons[0].key, 'codex-voice:session', 'session drawer button should have a stable key')
  equal(drawer.buttons[0].kind, 'toggle', 'session drawer button should be a toggle')
  equal(drawer.buttons[0].initialState, false, 'session drawer button should start inactive')
  drawer.buttons[0].callback()
  drawer.buttons[0].callback()
  touchPanel.emit({ gesture: 'forwardSwipe' })
  touchPanel.emit({ gesture: 'backwardSwipe' })
  equal(
    remoteSession.requests.join(','),
    'start,stop,start,stop',
    'drawer and swipes should request conversation start and stop',
  )
  equal(statuses.length, 0, 'successful session requests should not leave a status balloon')
  equal(hiddenStatuses, 4, 'each successful session request should clear an earlier status balloon')
  equal(drawer.states[drawer.states.length - 1][1], false, 'stopping should clear the drawer state')
}

{
  const events = []
  const touchPanel = createTouchPanel(events)
  const drawer = createDrawer(events)
  const remoteSession = createRemoteSession(events, [new Error('USB unavailable'), new Error('USB unavailable')])
  const statuses = []
  let hiddenStatuses = 0
  onContextCreated({
    conversation: { remoteSession },
    input: { touchPanel },
    ui: {
      drawer: drawer.drawer,
      showBalloon(message) {
        statuses.push(message)
      },
      hideBalloon() {
        hiddenStatuses += 1
      },
    },
  })
  equal(
    events.join(','),
    'drawer,activate,subscribe,subscribeTransport,gesture',
    'activation failure should preserve subscriptions and gesture handling for retry',
  )
  equal(drawer.buttons.length, 1, 'activation failure should not remove the diagnostic drawer button')
  drawer.buttons[0].callback()
  equal(remoteSession.requests.length, 0, 'a persistent activation failure should not issue a start request')
  equal(events[events.length - 1], 'activate', 'drawer start should retry activation')
  equal(
    statuses[statuses.length - 1],
    'Codex有効化失敗\nUSB unavailable',
    'persistent activation failure should remain visible with its root error',
  )
  equal(hiddenStatuses, 0, 'a failed request should keep its diagnostic balloon visible')
}

{
  const events = []
  const touchPanel = createTouchPanel(events)
  const drawer = createDrawer(events)
  const remoteSession = createRemoteSession(events, [new Error('boot not ready')])
  onContextCreated({
    conversation: { remoteSession },
    input: { touchPanel },
    ui: { drawer: drawer.drawer },
  })
  drawer.buttons[0].callback()
  equal(
    events.join(','),
    'drawer,activate,subscribe,subscribeTransport,gesture,activate,start',
    'drawer start should recover from a transient activation failure',
  )
  equal(remoteSession.requests[0], 'start', 'a recovered activation should issue the requested start')
}

{
  const events = []
  const remoteSession = createRemoteSession(events)
  const drawer = createDrawer(events)
  onContextCreated({
    conversation: { remoteSession },
    input: {},
    ui: { drawer: drawer.drawer },
  })
  equal(
    events.join(','),
    'drawer,activate,subscribe,subscribeTransport',
    'missing touch should leave remote approval handling active',
  )
  drawer.buttons[0].callback()
  equal(remoteSession.requests[0], 'start', 'drawer should start the session without a touch panel')
}

{
  const events = []
  const drawer = createDrawer(events)
  onContextCreated({
    conversation: {},
    input: {},
    ui: { drawer: drawer.drawer },
  })
  equal(events.join(','), 'drawer', 'diagnostic drawer button should be visible without USB capability')
  equal(drawer.buttons[0].initialState, false, 'missing USB capability should leave the button inactive')
}

trace('ok\n')
