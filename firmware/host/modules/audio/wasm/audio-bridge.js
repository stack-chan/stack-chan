import Timer from 'timer'
import { MAX_RECORDING_BYTES } from 'stackchan-contracts/audio-recording'

const tone = native('xs_stackchan_wasm_audio_tone')
const close = native('xs_stackchan_wasm_audio_close')
const startPlayBuffer = native('xs_stackchan_wasm_audio_start_play_buffer')
const playStatus = native('xs_stackchan_wasm_audio_play_status')
const startRecord = native('xs_stackchan_wasm_audio_start_record')
const recordStatus = native('xs_stackchan_wasm_audio_record_status')
const readRecordBuffer = native('xs_stackchan_wasm_audio_record_buffer')
const readRecordDetails = native('xs_stackchan_wasm_audio_record_details')
const recordAvailable = native('xs_stackchan_wasm_audio_record_available')
const stopRecord = native('xs_stackchan_wasm_audio_stop_record')
const releaseRecord = native('xs_stackchan_wasm_audio_release_record')

globalThis.__stackchanWasmAudioBridge = {
  close,
  playStatus,
  recordBuffer: (id) => readRecordBuffer(id, MAX_RECORDING_BYTES),
  recordDetails: (id) => JSON.parse(readRecordDetails(id)),
  recordAvailable,
  stopRecord,
  releaseRecord,
  recordStatus,
  startPlayBuffer,
  startRecord,
  setTimer: Timer.set,
  clearTimer: Timer.clear,
  tone,
}
