import Timer from 'timer'
import { MAX_RECORDING_BYTES } from 'stackchan-contracts/audio-recording'
import { DEFAULT_PLAYBACK_VOLUME, MAX_PLAYBACK_BYTES } from 'stackchan-contracts/audio-playback'

const startTone = native('xs_stackchan_wasm_audio_start_tone')
const startPlayBuffer = native('xs_stackchan_wasm_audio_start_play_buffer')
const playAvailable = native('xs_stackchan_wasm_audio_play_available')
const readPlayDetails = native('xs_stackchan_wasm_audio_play_details')
const stopPlay = native('xs_stackchan_wasm_audio_stop_play')
const releasePlay = native('xs_stackchan_wasm_audio_release_play')
const playStatus = native('xs_stackchan_wasm_audio_play_status')
const startRecord = native('xs_stackchan_wasm_audio_start_record')
const recordStatus = native('xs_stackchan_wasm_audio_record_status')
const readRecordBuffer = native('xs_stackchan_wasm_audio_record_buffer')
const readRecordDetails = native('xs_stackchan_wasm_audio_record_details')
const recordAvailable = native('xs_stackchan_wasm_audio_record_available')
const stopRecord = native('xs_stackchan_wasm_audio_stop_record')
const releaseRecord = native('xs_stackchan_wasm_audio_release_record')

globalThis.__stackchanWasmAudioBridge = {
  playAvailable,
  playStatus,
  playDetails: (id) => JSON.parse(readPlayDetails(id)),
  stopPlay,
  releasePlay,
  recordBuffer: (id) => readRecordBuffer(id, MAX_RECORDING_BYTES),
  recordDetails: (id) => JSON.parse(readRecordDetails(id)),
  recordAvailable,
  stopRecord,
  releaseRecord,
  recordStatus,
  startPlayBuffer: (buffer, volume = 1) => startPlayBuffer(buffer, volume, MAX_PLAYBACK_BYTES),
  startRecord,
  setTimer: Timer.set,
  clearTimer: Timer.clear,
  startTone: (hz, duration, volume = DEFAULT_PLAYBACK_VOLUME) => startTone(hz, duration, volume),
}
