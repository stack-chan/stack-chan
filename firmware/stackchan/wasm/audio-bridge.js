import Timer from 'timer'

const tone = native('xs_stackchan_wasm_audio_tone')
const close = native('xs_stackchan_wasm_audio_close')
const startPlayBuffer = native('xs_stackchan_wasm_audio_start_play_buffer')
const playStatus = native('xs_stackchan_wasm_audio_play_status')
const startRecord = native('xs_stackchan_wasm_audio_start_record')
const recordStatus = native('xs_stackchan_wasm_audio_record_status')
const recordBuffer = native('xs_stackchan_wasm_audio_record_buffer')

export default {
  close,
  playStatus,
  recordBuffer,
  recordStatus,
  startPlayBuffer,
  startRecord,
  setTimer: Timer.set,
  tone,
}

globalThis.__stackchanWasmAudioBridge = {
  close,
  playStatus,
  recordBuffer,
  recordStatus,
  startPlayBuffer,
  startRecord,
  setTimer: Timer.set,
  tone,
}
