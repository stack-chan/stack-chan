import { close, open, poll } from 'muse-sdk-provision'
import Timer from 'timer'

let timer,
  deadline,
  ended = false
function stop() {
  if (ended) return
  ended = true
  if (timer !== undefined) Timer.clear(timer)
  if (deadline !== undefined) Timer.clear(deadline)
  close()
}
try {
  open()
  trace('MUSE SDK INPUT READY\n')
  timer = Timer.repeat(() => {
    const result = poll()
    if (!result) return
    trace(
      result === 1
        ? 'MUSE SDK SAVED\n'
        : result === 2
          ? 'MUSE SDK CANARY PASS\n'
          : result === 4
            ? 'MUSE SDK EXISTS\n'
            : 'MUSE SDK REJECTED\n',
    )
    Timer.clear(timer)
    Timer.set(stop, 500)
  }, 20)
  deadline = Timer.set(() => {
    trace('MUSE SDK INPUT CLOSED\n')
    stop()
  }, 120000)
} catch {
  trace('MUSE SDK UNAVAILABLE\n')
  stop()
}
