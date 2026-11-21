import { close, open, poll } from 'gemini-key-provision'
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
  trace('GEMINI KEY INPUT READY\n')
  timer = Timer.repeat(() => {
    const result = poll()
    if (!result) return
    trace(
      result === 1
        ? 'GEMINI KEY SAVED\n'
        : result === 2
          ? 'GEMINI KEY CANARY PASS\n'
          : result === 4
            ? 'GEMINI KEY EXISTS\n'
            : 'GEMINI KEY REJECTED\n',
    )
    Timer.clear(timer)
    Timer.set(stop, 500)
  }, 20)
  deadline = Timer.set(() => {
    trace('GEMINI KEY INPUT CLOSED\n')
    stop()
  }, 120000)
} catch {
  trace('GEMINI KEY UNAVAILABLE\n')
  stop()
}
