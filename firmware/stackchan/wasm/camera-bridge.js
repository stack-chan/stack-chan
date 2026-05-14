function start(width, height, useBrowserCamera) @ "xs_stackchan_wasm_camera_start";
function stop() @ "xs_stackchan_wasm_camera_stop";
function capture(width, height) @ "xs_stackchan_wasm_camera_capture";

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
