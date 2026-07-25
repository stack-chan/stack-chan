export function onContextCreated(robot) {
  const remoteSession = robot.conversation.remoteSession
  const touchPanel = robot.input.touchPanel
  if (!remoteSession) {
    trace('[codex-voice] USB remote conversation capability is unavailable\n')
    return
  }
  if (!touchPanel) {
    trace('[codex-voice] top touch panel is unavailable\n')
    return
  }

  remoteSession.subscribe((state, error) => {
    trace(`[codex-voice] state=${state}${error ? ` error=${error}` : ''}\n`)
  })
  touchPanel.onEvent = (event) => {
    if (event.gesture === 'forwardSwipe') {
      const requestId = remoteSession.requestStart()
      trace(`[codex-voice] start request=${requestId}\n`)
    } else if (event.gesture === 'backwardSwipe') {
      const requestId = remoteSession.requestStop()
      trace(`[codex-voice] stop request=${requestId}\n`)
    }
  }
  trace('[codex-voice] ready: forward swipe starts, backward swipe stops\n')
}
