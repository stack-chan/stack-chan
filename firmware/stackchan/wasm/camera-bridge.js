const start = native('xs_stackchan_wasm_camera_start')
const stop = native('xs_stackchan_wasm_camera_stop')
const capture = native('xs_stackchan_wasm_camera_capture')

export default {
  capture,
  start,
  stop,
}

globalThis.__stackchanWasmCameraBridge = {
  capture,
  start,
  stop,
}
