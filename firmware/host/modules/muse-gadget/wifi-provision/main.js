import WiFi from 'embedded:network/interface/wifi'
import silenceLogs from 'muse-wifi-privacy'
import { close, connect, open, poll } from 'muse-wifi-provision'
import Timer from 'timer'

let timer,
  deadline,
  wifi,
  ended = false
function stop(message) {
  if (ended) return
  ended = true
  if (timer !== undefined) Timer.clear(timer)
  if (deadline !== undefined) Timer.clear(deadline)
  try {
    wifi?.disconnect()
    wifi?.close()
  } catch {}
  close()
  trace(`MUSE WIFI ${message}\n`)
}
try {
  silenceLogs()
  open()
  trace('MUSE WIFI INPUT READY\n')
  deadline = Timer.set(() => stop('TIMEOUT'), 120000)
  timer = Timer.repeat(() => {
    try {
      const result = poll()
      if (!result) return
      Timer.clear(timer)
      timer = undefined
      if (result === 2) return stop('CANARY PASS')
      if (result !== 1 && result !== 4) return stop('REJECTED')
      trace(result === 1 ? 'MUSE WIFI ACCOUNT UPDATED\n' : 'MUSE WIFI FALLBACK SAVED\n')
      Timer.clear(deadline)
      deadline = Timer.set(() => stop('CONNECT FAILED'), 30000)
      wifi = new WiFi({
        onChanged() {
          if (this.connection >= 500) stop('CONNECTED')
        },
      })
      if (!connect()) stop('CONNECT FAILED')
    } catch {
      stop('CONNECT FAILED')
    }
  }, 20)
} catch {
  stop('UNAVAILABLE')
}
