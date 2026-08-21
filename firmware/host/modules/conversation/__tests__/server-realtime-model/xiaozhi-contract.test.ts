import { equal } from 'testing/assert'
import {
  type JsonRpcMessage,
  parseJsonRpcMessage,
  parseXiaozhiGlyphPushV1,
  parseXiaozhiV1ClientEvent,
  parseXiaozhiV1ServerEvent,
  sanitizeXiaozhiV1HelloExtension,
} from 'xiaozhi-contract'

trace('=== xiaozhi-contract test ===\n')

function methodOf(message: JsonRpcMessage) {
  return 'method' in message ? message.method : undefined
}

function idOf(message: JsonRpcMessage) {
  return 'id' in message ? message.id : undefined
}

const audio = { format: 'opus', sample_rate: 24000, channels: 1, frame_duration: 20 }
const serverEvents = [
  { type: 'hello', version: 1, transport: 'websocket', session_id: 's', audio_params: audio },
  { type: 'stt', text: 'hello' },
  { type: 'llm', emotion: 'happy', text: '😀' },
  { type: 'tts', state: 'start' },
  { type: 'tts', state: 'sentence_start', text: 'hello' },
  { type: 'tts', state: 'stop' },
  { type: 'mcp', payload: { jsonrpc: '2.0', method: 'notifications/test' } },
  { type: 'system', command: 'reboot' },
  { type: 'alert', status: 'Warning', message: 'Battery low', emotion: 'sad' },
  { type: 'custom', payload: { value: true } },
]
for (const event of serverEvents) {
  equal(parseXiaozhiV1ServerEvent(event).known, true, `server event should be recognized: ${event.type}`)
}
equal(
  parseXiaozhiV1ServerEvent({ type: 'vendor_extension', payload: 1 }).known,
  false,
  'unknown server events should be preserved',
)

const clientEvents = [
  { type: 'hello', version: 1, transport: 'websocket', audio_params: { ...audio, sample_rate: 16000 } },
  { type: 'listen', state: 'start', mode: 'auto' },
  { type: 'listen', state: 'stop' },
  { type: 'listen', state: 'detect', text: 'Hi Stack-chan' },
  { type: 'abort', reason: 'wake_word_detected' },
  { type: 'mcp', payload: { jsonrpc: '2.0', id: 1, result: { ok: true } } },
]
for (const event of clientEvents) {
  equal(parseXiaozhiV1ClientEvent(event).type, event.type, `client event should be recognized: ${event.type}`)
}

equal(
  parseXiaozhiV1ClientEvent({
    type: 'hello',
    version: 1,
    transport: 'websocket',
    features: { mcp: true, aec: false },
    text_font: { bundle: 'noto-v1', charset: 'common', size: 20, bpp: 4 },
    audio_params: { ...audio, sample_rate: 16000 },
  }).type,
  'hello',
  'hello capabilities should be validated',
)
let featureError = ''
try {
  parseXiaozhiV1ClientEvent({
    type: 'hello',
    version: 1,
    transport: 'websocket',
    features: { mcp: 'yes' },
    audio_params: { ...audio, sample_rate: 16000 },
  })
} catch (error) {
  featureError = String(error)
}
equal(featureError.includes('must be a boolean'), true, 'non-boolean hello features should be rejected')

equal(methodOf(parseJsonRpcMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' })), 'tools/list')
equal(methodOf(parseJsonRpcMessage({ jsonrpc: '2.0', method: 'notifications/test' })), 'notifications/test')
equal(idOf(parseJsonRpcMessage({ jsonrpc: '2.0', id: 1, result: true })), 1)
equal(idOf(parseJsonRpcMessage({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'missing' } })), 1)

const glyphPush = {
  v: 1,
  bundle: 'noto-v1',
  size: 20,
  bpp: 1,
  glyphs: [
    {
      codepoint: 0x20bb7,
      adv_w: 320,
      box_w: 1,
      box_h: 1,
      ofs_x: 0,
      ofs_y: 0,
      bitmap: 'AA==',
    },
  ],
}
equal(parseXiaozhiGlyphPushV1(glyphPush).glyphs.length, 1, 'valid glyph push should parse')
equal(
  parseXiaozhiV1ServerEvent({ type: 'stt', text: '𠮷', glyph_push: glyphPush }).known,
  true,
  'glyph push should be accepted on STT',
)
equal(
  parseXiaozhiV1ServerEvent({ type: 'tts', state: 'sentence_start', text: '𠮷', glyph_push: glyphPush }).known,
  true,
  'glyph push should be accepted on TTS sentence_start',
)

let glyphError = ''
try {
  parseXiaozhiGlyphPushV1({ ...glyphPush, glyphs: [{ ...glyphPush.glyphs[0], bitmap: '' }] })
} catch (error) {
  glyphError = String(error)
}
equal(glyphError.includes('unexpected length'), true, 'invalid glyph bitmap length should be rejected')
let nonCanonicalBase64Error = ''
try {
  parseXiaozhiGlyphPushV1({ ...glyphPush, glyphs: [{ ...glyphPush.glyphs[0], bitmap: 'AB==' }] })
} catch (error) {
  nonCanonicalBase64Error = String(error)
}
equal(nonCanonicalBase64Error.includes('invalid base64'), true, 'non-canonical base64 should be rejected')

const extension = sanitizeXiaozhiV1HelloExtension({ vendor_agent: 'agent-1' })
equal(extension.vendor_agent, 'agent-1', 'vendor extensions should remain available')
let extensionError = ''
try {
  sanitizeXiaozhiV1HelloExtension({ type: 'custom' })
} catch (error) {
  extensionError = String(error)
}
equal(extensionError.includes('cannot override type'), true, 'extensions should not override protocol fields')
