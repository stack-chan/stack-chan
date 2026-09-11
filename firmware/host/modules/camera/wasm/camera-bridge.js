import Timer from 'timer'

const start = native('xs_stackchan_wasm_camera_start')
const startStatus = native('xs_stackchan_wasm_camera_start_status')
const stop = native('xs_stackchan_wasm_camera_stop')
const capture = native('xs_stackchan_wasm_camera_capture')
const availability = native('xs_stackchan_wasm_camera_availability')
const error = native('xs_stackchan_wasm_camera_error')

globalThis.__stackchanWasmCameraBridge = {
  capture,
  availability,
  error,
  setTimer: Timer.set,
  clearTimer: Timer.clear,
  start,
  startStatus,
  stop,
}
