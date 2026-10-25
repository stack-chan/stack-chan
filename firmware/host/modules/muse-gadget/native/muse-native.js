const construct = native('xs_muse_constructor')
const close = native('xs_muse_close')
const start = native('xs_muse_start')
const handshake = native('xs_muse_handshake')
const request = native('xs_muse_request')
const chunk = native('xs_muse_chunk')
const receive = native('xs_muse_receive')

export default class MuseNative extends Native('xs_muse_destructor') {
  constructor(options, onEvent) {
    super()
    this.onEvent = onEvent
    construct.call(this, options.host, options.vmId, options.token)
  }
  close() {
    close.call(this)
  }
  start() {
    start.call(this)
  }
  handshake(data) {
    handshake.call(this, data)
  }
  request(stream, chat, body) {
    request.call(this, stream, chat, body)
  }
  chunk(body) {
    chunk.call(this, body)
  }
  receive(data) {
    return receive.call(this, data)
  }
}
