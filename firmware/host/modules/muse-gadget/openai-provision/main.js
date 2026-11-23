import { close, open, poll } from 'openai-key-provision'
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
  trace('OPENAI KEY INPUT READY\n')
  timer = Timer.repeat(() => {
    const result = poll()
    if (!result) return
    trace(
      result === 1
        ? 'OPENAI KEY SAVED\n'
        : result === 2
          ? 'OPENAI KEY CANARY PASS\n'
          : result === 4
            ? 'OPENAI KEY EXISTS\n'
            : 'OPENAI KEY REJECTED\n',
    )
    Timer.clear(timer)
    Timer.set(stop, 500)
  }, 20)
  deadline = Timer.set(() => {
    trace('OPENAI KEY INPUT CLOSED\n')
    stop()
  }, 120000)
} catch {
  trace('OPENAI KEY UNAVAILABLE\n')
  stop()
}
