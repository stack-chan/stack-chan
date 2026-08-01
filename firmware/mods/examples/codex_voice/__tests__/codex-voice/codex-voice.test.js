import { onContextCreated } from 'mod'
import { equal } from 'testing/assert'

function createTouchPanel(events) {
  let handler
  const touchPanel = {}
  Object.defineProperty(touchPanel, 'onEvent', {
    get() {
      return handler
    },
    set(value) {
      events.push('gesture')
      handler = value
    },
  })
  return touchPanel
}

function createRemoteSession(events, activationError) {
  return {
    transportState: 'disconnected',
    activate() {
      events.push('activate')
      if (activationError) throw activationError
    },
    subscribe() {
      events.push('subscribe')
      return () => {}
    },
    subscribeTransport() {
      events.push('subscribeTransport')
      return () => {}
    },
    requestStart() {
      events.push('start')
      return 'start-1'
    },
    requestStop() {
      events.push('stop')
      return 'stop-1'
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
  onContextCreated({
    conversation: { remoteSession },
    input: { touchPanel },
  })

  equal(events.join(','), 'activate,subscribe,subscribeTransport,gesture', 'activation should precede subscriptions')
  touchPanel.onEvent({ gesture: 'forwardSwipe' })
  touchPanel.onEvent({ gesture: 'backwardSwipe' })
  equal(events.slice(-2).join(','), 'start,stop', 'swipes should request conversation start and stop')
}

{
  const events = []
  const touchPanel = createTouchPanel(events)
  const remoteSession = createRemoteSession(events, new Error('USB unavailable'))
  onContextCreated({
    conversation: { remoteSession },
    input: { touchPanel },
  })
  equal(events.join(','), 'activate', 'activation failure should not subscribe or install a gesture handler')
}

{
  const events = []
  const remoteSession = createRemoteSession(events)
  onContextCreated({
    conversation: { remoteSession },
    input: {},
  })
  equal(
    events.join(','),
    'activate,subscribe,subscribeTransport',
    'missing touch should leave remote approval handling active',
  )
}

trace('ok\n')
