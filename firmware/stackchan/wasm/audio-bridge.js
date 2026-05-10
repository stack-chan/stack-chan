import Timer from 'timer'

function tone(hz, duration, volume) @ "xs_stackchan_wasm_audio_tone";
function close() @ "xs_stackchan_wasm_audio_close";
function startPlayBuffer(buffer) @ "xs_stackchan_wasm_audio_start_play_buffer";
function playStatus() @ "xs_stackchan_wasm_audio_play_status";
function startRecord(duration) @ "xs_stackchan_wasm_audio_start_record";
function recordStatus() @ "xs_stackchan_wasm_audio_record_status";
function recordBuffer() @ "xs_stackchan_wasm_audio_record_buffer";

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
