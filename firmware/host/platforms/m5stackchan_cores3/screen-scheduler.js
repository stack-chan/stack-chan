// Install through the screen's public start/stop/context interface. Piu may
// request a 5 ms repeating idle timer; after a slow frame, replaying those old
// ticks competes with application Workers without producing useful frames.
function coalesceScreen(screen, Timer, minimumIntervalMs) {
  let timer, interval
  function stop() {
    interval = undefined
    if (timer !== undefined) Timer.schedule(timer)
  }
  function tick() {
    if (timer === undefined) return
    const context = screen.context
    if (!context) {
      stop()
      return
    }
    context.onIdle()
    // onIdle may start, stop or replace the application. Preserve its choice.
    if (timer === undefined) return
    if (screen.context && interval !== undefined) Timer.schedule(timer, interval, interval)
    else stop()
  }
  function start(requested) {
    interval = Math.max(minimumIntervalMs, Number.isFinite(requested) ? requested : minimumIntervalMs)
    if (timer === undefined) timer = Timer.set(tick, interval, interval)
    else Timer.schedule(timer, interval, interval)
  }
  function close() {
    const previousTimer = timer
    timer = undefined
    interval = undefined
    if (previousTimer !== undefined) Timer.clear(previousTimer)
  }
  return { start, stop, close }
}

function setScreenMethods(screen, start, stop) {
  // XS can freeze the inherited methods during preload. Install own methods.
  Object.defineProperties(screen, {
    start: { value: start, configurable: true, writable: true },
    stop: { value: stop, configurable: true, writable: true },
  })
}

export function scheduleScreen(screen, Timer, minimumIntervalMs = 16) {
  const { start, stop } = coalesceScreen(screen, Timer, minimumIntervalMs)
  setScreenMethods(screen, start, stop)
}

export function trackScreenSchedule(screen, Timer, minimumIntervalMs = 16) {
  const normalStart = screen.start
  const normalStop = screen.stop
  let coalesced, requested, scheduledContext

  // Piu calls start/stop only when its requested interval changes. The SDK
  // keeps its timer private, so observe those requests from before Piu starts.
  setScreenMethods(
    screen,
    function start(interval) {
      if (coalesced) coalesced.start(interval)
      else normalStart.call(screen, interval)
      scheduledContext = screen.context
      requested = interval
    },
    function stop() {
      if (coalesced) coalesced.stop()
      else normalStop.call(screen)
      scheduledContext = undefined
    },
  )

  return function acquire() {
    if (coalesced) throw new Error('Screen scheduler already acquired')
    const next = coalesceScreen(screen, Timer, minimumIntervalMs)
    const isScheduled = () => scheduledContext && scheduledContext === screen.context
    function release() {
      if (coalesced !== next) return
      coalesced = undefined
      try {
        next.close()
      } finally {
        if (isScheduled()) normalStart.call(screen, requested)
      }
    }
    normalStop.call(screen)
    coalesced = next
    try {
      if (isScheduled()) next.start(requested)
    } catch (error) {
      release()
      throw error
    }
    return release
  }
}
