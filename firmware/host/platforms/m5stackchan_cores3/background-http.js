import { createBackgroundFetch } from 'realtimeHttpDispatcher'
import { normalizeRequest } from 'realtimeHttpOptions'
import Timer from 'timer'

class Request extends Native('xs_realtime_http_destructor') {
  constructor() {
    super()
    native('xs_realtime_http_constructor').call(this)
  }
  start(...args) {
    return native('xs_realtime_http_start').apply(this, args)
  }
  read() {
    return native('xs_realtime_http_read').call(this)
  }
  close() {
    native('xs_realtime_http_close').call(this)
  }
}

export default createBackgroundFetch({
  createRequest: () => new Request(),
  normalize: (url, options) => normalizeRequest(url, options, (text) => ArrayBuffer.fromString(text)),
  decode: (body) => String.fromArrayBuffer(body),
  schedule: (callback, delay) => Timer.set(callback, delay),
  cancel: (timer) => {
    if (timer !== undefined) Timer.clear(timer)
  },
})
