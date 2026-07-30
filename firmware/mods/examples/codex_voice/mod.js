export function onContextCreated(robot) {
  const remoteSession = robot.conversation.remoteSession
  if (!remoteSession) {
    trace('[codex-voice] USB remote conversation capability is unavailable\n')
    return
  }

  try {
    remoteSession.activate()
  } catch (error) {
    trace(`[codex-voice] activation failed: ${String(error)}\n`)
    return
  }

  remoteSession.subscribe((state, error) => {
    trace(`[codex-voice] state=${state}${error ? ` error=${error}` : ''}\n`)
  })
  remoteSession.subscribeTransport((state) => {
    trace(`[codex-voice] transport=${state}\n`)
  })

  const touchPanel = robot.input.touchPanel
  if (!touchPanel) {
    trace('[codex-voice] top touch panel is unavailable; approval handling remains active\n')
    return
  }
  touchPanel.onEvent = (event) => {
    if (event.gesture === 'forwardSwipe') {
      const requestId = remoteSession.requestStart()
      trace(`[codex-voice] start request=${requestId}\n`)
    } else if (event.gesture === 'backwardSwipe') {
      const requestId = remoteSession.requestStop()
      trace(`[codex-voice] stop request=${requestId}\n`)
    }
  }
  trace(`[codex-voice] ready: transport=${remoteSession.transportState}, forward swipe starts, backward swipe stops\n`)
}
