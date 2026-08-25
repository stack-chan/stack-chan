const DRAWER_KEY = 'codex-voice:session'

function isSessionActive(state) {
  return state !== 'standby' && state !== 'blocked'
}

function showStatus(robot, message) {
  try {
    if (typeof robot.ui?.showBalloon === 'function') {
      robot.ui.showBalloon(message)
    }
  } catch (error) {
    trace(`[codex-voice] status display failed: ${String(error)}\n`)
  }
}

function hideStatus(robot) {
  try {
    if (typeof robot.ui?.hideBalloon === 'function') {
      robot.ui.hideBalloon()
    }
  } catch (error) {
    trace(`[codex-voice] status clear failed: ${String(error)}\n`)
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

export function onContextCreated(robot) {
  const drawer = robot.ui?.drawer
  const remoteSession = robot.conversation?.remoteSession
  let sessionActive = remoteSession ? isSessionActive(remoteSession.state) : false
  let activationError
  const setDrawerState = (active) => {
    sessionActive = active
    drawer?.setDrawerButtonState?.(DRAWER_KEY, active)
  }
  const activateSession = () => {
    if (!remoteSession) return false
    if (remoteSession.activationState === 'active') return true
    try {
      remoteSession.activate()
      activationError = undefined
      return true
    } catch (error) {
      activationError = errorMessage(error)
      trace(`[codex-voice] activation failed: ${activationError}\n`)
      return false
    }
  }
  const requestStart = () => {
    if (!remoteSession) {
      showStatus(robot, 'USB会話未接続')
      trace('[codex-voice] cannot start: USB remote conversation capability is unavailable\n')
      return
    }
    if (!activateSession()) {
      setDrawerState(false)
      showStatus(robot, `Codex有効化失敗\n${activationError ?? '不明なエラー'}`)
      return
    }
    try {
      const requestId = remoteSession.requestStart()
      setDrawerState(isSessionActive(remoteSession.state))
      hideStatus(robot)
      trace(`[codex-voice] start request=${requestId}\n`)
      return requestId
    } catch (error) {
      setDrawerState(false)
      showStatus(robot, `Codex開始失敗\n${errorMessage(error)}`)
      trace(`[codex-voice] start failed: ${errorMessage(error)}\n`)
    }
  }
  const requestStop = () => {
    if (!remoteSession) {
      showStatus(robot, 'USB会話未接続')
      trace('[codex-voice] cannot stop: USB remote conversation capability is unavailable\n')
      return
    }
    try {
      const requestId = remoteSession.requestStop()
      setDrawerState(isSessionActive(remoteSession.state))
      hideStatus(robot)
      trace(`[codex-voice] stop request=${requestId}\n`)
      return requestId
    } catch (error) {
      showStatus(robot, `Codex停止失敗\n${errorMessage(error)}`)
      trace(`[codex-voice] stop failed: ${errorMessage(error)}\n`)
    }
  }

  if (drawer?.addDrawerButton) {
    drawer.addDrawerButton({
      key: DRAWER_KEY,
      label: 'Codex会話',
      kind: 'toggle',
      initialState: sessionActive,
      callback: () => {
        if (sessionActive) requestStop()
        else requestStart()
      },
    })
    trace('[codex-voice] drawer button registered\n')
  } else {
    trace('[codex-voice] drawer capability is unavailable\n')
  }

  if (!remoteSession) {
    trace('[codex-voice] USB remote conversation capability is unavailable\n')
    return
  }

  const activated = activateSession()

  remoteSession.subscribe((state, error) => {
    setDrawerState(isSessionActive(state))
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
  const handleTouch = (event) => {
    if (event.gesture === 'forwardSwipe') {
      requestStart()
    } else if (event.gesture === 'backwardSwipe') {
      requestStop()
    }
  }
  if (typeof touchPanel.subscribe === 'function') {
    touchPanel.subscribe(handleTouch)
  } else {
    touchPanel.onEvent = handleTouch
  }
  trace(
    `[codex-voice] ready: activation=${activated ? 'active' : 'retry'}, transport=${remoteSession.transportState}, forward swipe starts, backward swipe stops\n`,
  )
}
