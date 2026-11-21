const construct = native('xs_muse_vc_constructor')
const close = native('xs_muse_vc_close')
const begin = native('xs_muse_vc_begin')
const head = native('xs_muse_vc_head')
const event = native('xs_muse_vc_event')
const action = native('xs_muse_vc_action')
const admission = native('xs_muse_vc_admission')
const endCallBody = native('xs_muse_vc_end_body')
const uplink = native('xs_muse_vc_uplink')

export default class MuseVoiceCore extends Native('xs_muse_vc_destructor') {
  constructor() {
    super()
    construct.call(this)
  }
  close() {
    close.call(this)
  }
  begin(callId, nowUs) {
    return begin.call(this, callId, nowUs)
  }
  head(status, nowUs) {
    return head.call(this, status, nowUs)
  }
  event(line, nowUs) {
    return event.call(this, line, nowUs)
  }
  action(method, nowUs, argument = 0) {
    return action.call(this, method, nowUs, argument)
  }
  admission(callId, deviceId = '', greeting = false) {
    return admission.call(this, callId, deviceId, greeting)
  }
  endCallBody(wallMs, nowUs) {
    return endCallBody.call(this, wallMs, nowUs)
  }
  uplink(pcm16, nowUs) {
    return uplink.call(this, pcm16, nowUs)
  }
}
