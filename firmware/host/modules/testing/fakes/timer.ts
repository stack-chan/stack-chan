type TimerCallback = (timer: TimerHandle) => void

type TimerHandle = {
  active: boolean
  callback: TimerCallback
  due: number
  interval: number
  repeat: boolean
}

let now = 0
const timers: TimerHandle[] = []

function createTimer(callback: TimerCallback, interval = 0, repeat = false): TimerHandle {
  const timer: TimerHandle = {
    active: true,
    callback,
    due: now + interval,
    interval,
    repeat,
  }
  timers.push(timer)
  return timer
}

function drainDueTimers(): void {
  for (;;) {
    const timer = timers.find((timer) => timer.active && timer.due <= now)
    if (timer == null) {
      return
    }
    if (timer.repeat) {
      timer.due += timer.interval
    } else {
      timer.active = false
    }
    timer.callback(timer)
  }
}

const Timer = {
  set(callback: TimerCallback, interval = 0): TimerHandle {
    return createTimer(callback, interval, false)
  },
  repeat(callback: TimerCallback, interval: number): TimerHandle {
    return createTimer(callback, interval, true)
  },
  clear(timer: TimerHandle | null | undefined): void {
    if (timer != null) {
      timer.active = false
    }
  },
  schedule(timer: TimerHandle, interval = 0, repeat?: number): void {
    timer.active = true
    timer.due = now + interval
    timer.interval = repeat ?? interval
    timer.repeat = repeat != null
  },
  delay(milliseconds: number): void {
    now += milliseconds
    drainDueTimers()
  },
  advance(milliseconds: number): void {
    now += milliseconds
    drainDueTimers()
  },
  reset(): void {
    now = 0
    timers.length = 0
  },
}

export default Timer
