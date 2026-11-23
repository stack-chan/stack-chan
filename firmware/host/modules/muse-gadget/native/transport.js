const close = native('xs_muse_close')
const start = native('xs_muse_start')
const handshake = native('xs_muse_handshake')
const request = native('xs_muse_request')
const chunk = native('xs_muse_chunk')
const receive = native('xs_muse_receive')
const voiceRequest = native('xs_muse_voice_request')
const endCall = native('xs_muse_end_call')
const bodyChunk = native('xs_muse_body_chunk')
const resetStream = native('xs_muse_reset_stream')
const ttsRequest = native('xs_muse_tts_request')

export default class MuseNativeTransport extends Native('xs_muse_destructor') {
  constructor(onEvent) {
    super()
    this.onEvent = onEvent
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
  ttsRequest(stream, messageId, legacy = false) {
    if (typeof messageId !== 'string' || !/^[\x21-\x7e]{1,128}$/.test(messageId))
      throw new Error('invalid Muse message ID')
    ttsRequest.call(this, stream, messageId, legacy)
  }
  chunk(body) {
    chunk.call(this, body)
  }
  voiceRequest(stream, callId, body) {
    voiceRequest.call(this, stream, callId, body)
  }
  endCall(stream, body) {
    endCall.call(this, stream, body)
  }
  bodyChunk(stream, body, end = false) {
    bodyChunk.call(this, stream, body, end)
  }
  resetStream(stream) {
    resetStream.call(this, stream)
  }
  receive(data) {
    return receive.call(this, data)
  }
}
