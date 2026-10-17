// Install through the screen's public start/stop/context interface. Piu may
// request a 5 ms repeating idle timer; after a slow frame, replaying those old
// ticks competes with application Workers without producing useful frames.
export function scheduleScreen(screen, Timer, minimumIntervalMs = 16) {
  let timer, interval
  function stop() {
    interval = undefined
    if (timer !== undefined) Timer.schedule(timer)
  }
  function tick() {
    const context = screen.context
    if (!context) {
      stop()
      return
    }
    context.onIdle()
    // onIdle may start, stop or replace the application. Preserve its choice.
    if (screen.context && interval !== undefined) Timer.schedule(timer, interval, interval)
    else stop()
  }
  function start(requested) {
    interval = Math.max(minimumIntervalMs, Number.isFinite(requested) ? requested : minimumIntervalMs)
    if (timer === undefined) timer = Timer.set(tick, interval, interval)
    else Timer.schedule(timer, interval, interval)
  }
  // XS can freeze the inherited methods during preload. Install own methods.
  Object.defineProperties(screen, {
    start: { value: start, configurable: true, writable: true },
    stop: { value: stop, configurable: true, writable: true },
  })
}
