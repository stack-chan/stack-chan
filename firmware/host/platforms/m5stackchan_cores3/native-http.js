import { normalizeRequest } from 'realtimeHttpOptions'
import Timer from 'timer'

class Request extends Native('xs_realtime_http_destructor') {
  constructor() {
    super()
    native('xs_realtime_http_constructor').call(this)
  }
  start(url, body, headers, certificate, timeout, keepAlive) {
    return native('xs_realtime_http_start').call(this, url, body, headers, certificate, timeout, keepAlive)
  }
  read() {
    return native('xs_realtime_http_read').call(this)
  }
  close() {
    native('xs_realtime_http_close').call(this)
  }
}
const errors = [
  '',
  'Live HTTPS request timed out',
  'Live HTTPS response exceeds limit',
  'Live HTTPS allocation failed',
  'Live HTTPS connection failed',
]

// The dispatcher uses the same message interface for JS and native backends.
export default class NativeHttp {
  constructor() {
    this.request = new Request()
  }
  postMessage({ id, url, options }) {
    if (this.closed || this.pending) throw new Error('Live HTTPS request already active')
    if (this.idleTimer !== undefined) Timer.clear(this.idleTimer)
    this.idleTimer = undefined
    const args = normalizeRequest(url, options, (text) => ArrayBuffer.fromString(text))
    this.pending = true
    let started = false
    const poll = () => {
      this.timer = undefined
      if (this.closed) return
      let result
      try {
        this.request ??= new Request()
        if (!started) started = this.request.start(...args)
        if (started) {
          const response = this.request.read()
          if (response)
            result = response.errorCode
              ? {
                  id,
                  error: {
                    name: 'Error',
                    message: `${errors[response.errorCode] ?? errors[4]} (native ${response.errorCode}, transport ${response.transportError}, HTTP ${response.status})`,
                  },
                }
              : { id, status: response.status, body: String.fromArrayBuffer(response.body), connectionReused: response.connectionReused }
        }
      } catch (error) {
        result = { id, error: { name: error.name, message: error.message } }
      }
      if (result) {
        this.pending = false
        if (!result.error && options.keepAlive === true)
          this.idleTimer = Timer.set(() => {
            this.idleTimer = undefined
            this.request?.close()
            this.request = undefined
          }, 3000)
        this.onmessage(result)
      } else this.timer = Timer.set(poll, 25)
    }
    poll()
  }
  terminate() {
    this.closed = true
    if (this.timer !== undefined) Timer.clear(this.timer)
    if (this.idleTimer !== undefined) Timer.clear(this.idleTimer)
    this.timer = undefined
    this.request?.close()
  }
}
