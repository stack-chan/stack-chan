import Timer from 'timer'

const start = native('xs_stackchan_wasm_camera_start')
const startStatus = native('xs_stackchan_wasm_camera_start_status')
const stop = native('xs_stackchan_wasm_camera_stop')
const capture = native('xs_stackchan_wasm_camera_capture')

globalThis.__stackchanWasmCameraBridge = {
  capture,
  setTimer: Timer.set,
  start,
  startStatus,
  stop,
}
