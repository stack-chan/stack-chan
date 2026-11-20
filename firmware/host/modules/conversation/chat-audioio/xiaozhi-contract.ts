export type JsonRpcId = string | number

export type JsonRpcRequest = {
  jsonrpc: '2.0'
  id: JsonRpcId
  method: string
  params?: unknown
}

export type JsonRpcNotification = {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

export type JsonRpcSuccess = {
  jsonrpc: '2.0'
  id: JsonRpcId
  result: unknown
}

export type JsonRpcFailure = {
  jsonrpc: '2.0'
  id: JsonRpcId | null
  error: {
    code: number
    message: string
    data?: unknown
  }
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcSuccess | JsonRpcFailure

export type XiaozhiV1SampleRate = 8000 | 12000 | 16000 | 24000 | 48000
export type XiaozhiV1FrameDuration = 10 | 20 | 40 | 60
export type XiaozhiV1ListeningMode = 'auto' | 'manual' | 'realtime'

export type XiaozhiV1AudioParams = {
  format: 'opus'
  sample_rate: XiaozhiV1SampleRate
  channels: 1
  frame_duration: XiaozhiV1FrameDuration
}

export type XiaozhiV1TextFont = {
  bundle: string
  charset: 'basic' | 'common' | (string & {})
  size: number
  bpp: 1 | 4
}

export type XiaozhiGlyphV1 = {
  codepoint: number
  adv_w: number
  box_w: number
  box_h: number
  ofs_x: number
  ofs_y: number
  bitmap: string
}

export type XiaozhiGlyphPushV1 = {
  v: 1
  bundle: string
  size: number
  bpp: 1 | 4
  glyphs: XiaozhiGlyphV1[]
}

export type XiaozhiV1ClientHello<Extension extends Record<string, unknown> = Record<string, never>> = {
  type: 'hello'
  version: 1
  transport: 'websocket'
  features?: {
    mcp?: boolean
    aec?: boolean
    glyph_push?: boolean
    [name: string]: boolean | undefined
  }
  text_font?: XiaozhiV1TextFont
  audio_params: XiaozhiV1AudioParams
} & Extension

export type XiaozhiV1ServerHello = {
  type: 'hello'
  version?: 1
  transport: 'websocket'
  session_id?: string
  audio_params?: XiaozhiV1AudioParams
}

export type XiaozhiV1ListenStart = {
  type: 'listen'
  session_id?: string
  state: 'start'
  mode: XiaozhiV1ListeningMode
}

export type XiaozhiV1ListenStop = {
  type: 'listen'
  session_id?: string
  state: 'stop'
}

export type XiaozhiV1ListenDetect = {
  type: 'listen'
  session_id?: string
  state: 'detect'
  text?: string
}

export type XiaozhiV1Abort = {
  type: 'abort'
  session_id?: string
  reason?: string
}

export type XiaozhiV1McpEvent = {
  type: 'mcp'
  session_id?: string
  payload: JsonRpcMessage
}

export type XiaozhiV1SttEvent = {
  type: 'stt'
  session_id?: string
  text: string
  glyph_push?: XiaozhiGlyphPushV1
}

export type XiaozhiV1LlmEvent = {
  type: 'llm'
  session_id?: string
  emotion?: string
  text?: string
}

export type XiaozhiV1TtsStartEvent = {
  type: 'tts'
  session_id?: string
  state: 'start'
}

export type XiaozhiV1TtsSentenceStartEvent = {
  type: 'tts'
  session_id?: string
  state: 'sentence_start'
  text: string
  glyph_push?: XiaozhiGlyphPushV1
}

export type XiaozhiV1TtsStopEvent = {
  type: 'tts'
  session_id?: string
  state: 'stop'
}

export type XiaozhiV1SystemEvent = {
  type: 'system'
  session_id?: string
  command: string
  [name: string]: unknown
}

export type XiaozhiV1AlertEvent = {
  type: 'alert'
  session_id?: string
  status?: string
  message: string
  emotion?: string
}

export type XiaozhiV1CustomEvent = {
  type: 'custom'
  session_id?: string
  payload: unknown
}

export type XiaozhiV1ClientEvent<Extension extends Record<string, unknown> = Record<string, never>> =
  | XiaozhiV1ClientHello<Extension>
  | XiaozhiV1ListenStart
  | XiaozhiV1ListenStop
  | XiaozhiV1ListenDetect
  | XiaozhiV1Abort
  | XiaozhiV1McpEvent

export type XiaozhiV1ServerEvent =
  | XiaozhiV1ServerHello
  | XiaozhiV1SttEvent
  | XiaozhiV1LlmEvent
  | XiaozhiV1TtsStartEvent
  | XiaozhiV1TtsSentenceStartEvent
  | XiaozhiV1TtsStopEvent
  | XiaozhiV1McpEvent
  | XiaozhiV1SystemEvent
  | XiaozhiV1AlertEvent
  | XiaozhiV1CustomEvent

export type ParsedXiaozhiV1ServerEvent =
  | { known: true; event: XiaozhiV1ServerEvent }
  | { known: false; event: Record<string, unknown> }

const SAMPLE_RATES = [8000, 12000, 16000, 24000, 48000]
const FRAME_DURATIONS = [10, 20, 40, 60]
const LISTENING_MODES = ['auto', 'manual', 'realtime']
const TTS_STATES = ['start', 'sentence_start', 'stop']
const MAX_STRING_LENGTH = 16 * 1024
const MAX_SESSION_ID_LENGTH = 200
const MAX_GLYPHS = 64
const MAX_GLYPH_BITMAP_BYTES = 64 * 1024
const RESERVED_HELLO_EXTENSION_KEYS: Record<string, true> = Object.freeze({
  type: true,
  version: true,
  transport: true,
  features: true,
  text_font: true,
  audio_params: true,
  session_id: true,
})

function own(object: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(object, key)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function requiredString(object: Record<string, unknown>, key: string, label = key): string {
  const value = object[key]
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  if (value.length > MAX_STRING_LENGTH) throw new Error(`${label} is too long`)
  return value
}

function optionalString(object: Record<string, unknown>, key: string, maximum = MAX_STRING_LENGTH): string | undefined {
  const value = object[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`${key} must be a string`)
  if (value.length > maximum) throw new Error(`${key} is too long`)
  return value
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} is out of range`)
  }
  return value as number
}

function sessionId(object: Record<string, unknown>): string | undefined {
  return optionalString(object, 'session_id', MAX_SESSION_ID_LENGTH)
}

export function parseXiaozhiV1AudioParams(value: unknown): XiaozhiV1AudioParams {
  const params = record(value, 'audio_params')
  if (params.format !== 'opus') throw new Error('audio_params.format must be opus')
  if (params.channels !== 1) throw new Error('audio_params.channels must be 1')
  if (!SAMPLE_RATES.includes(params.sample_rate as number)) throw new Error('audio_params.sample_rate is unsupported')
  if (!FRAME_DURATIONS.includes(params.frame_duration as number)) {
    throw new Error('audio_params.frame_duration is unsupported')
  }
  return params as XiaozhiV1AudioParams
}

export function parseJsonRpcMessage(value: unknown): JsonRpcMessage {
  const payload = record(value, 'MCP payload')
  if (payload.jsonrpc !== '2.0') throw new Error('MCP payload jsonrpc must be 2.0')

  if (own(payload, 'method')) {
    requiredString(payload, 'method', 'MCP method')
    if (own(payload, 'id')) {
      if (typeof payload.id !== 'string' && typeof payload.id !== 'number') {
        throw new Error('MCP request id must be a string or number')
      }
      return payload as JsonRpcRequest
    }
    return payload as JsonRpcNotification
  }

  if (!own(payload, 'id')) throw new Error('MCP response must include id')
  if (payload.id !== null && typeof payload.id !== 'string' && typeof payload.id !== 'number') {
    throw new Error('MCP response id must be a string, number, or null')
  }
  const hasResult = own(payload, 'result')
  const hasError = own(payload, 'error')
  if (hasResult === hasError) throw new Error('MCP response must include exactly one of result or error')
  if (hasError) {
    const error = record(payload.error, 'MCP error')
    integer(error.code, -2147483648, 2147483647, 'MCP error code')
    requiredString(error, 'message', 'MCP error message')
    return payload as JsonRpcFailure
  }
  if (payload.id === null) throw new Error('MCP success response id cannot be null')
  return payload as JsonRpcSuccess
}

export function parseXiaozhiGlyphPushV1(value: unknown): XiaozhiGlyphPushV1 {
  const push = record(value, 'glyph_push')
  if (push.v !== 1) throw new Error('glyph_push.v must be 1')
  const bundle = requiredString(push, 'bundle', 'glyph_push.bundle')
  if (!bundle) throw new Error('glyph_push.bundle is required')
  integer(push.size, 1, 256, 'glyph_push.size')
  if (push.bpp !== 1 && push.bpp !== 4) throw new Error('glyph_push.bpp must be 1 or 4')
  if (!Array.isArray(push.glyphs)) throw new Error('glyph_push.glyphs must be an array')
  if (push.glyphs.length > MAX_GLYPHS) throw new Error('glyph_push has too many glyphs')

  let totalBytes = 0
  for (let index = 0; index < push.glyphs.length; index += 1) {
    const glyph = record(push.glyphs[index], `glyph_push.glyphs[${index}]`)
    const codepoint = integer(glyph.codepoint, 1, 0x10ffff, `glyph_push.glyphs[${index}].codepoint`)
    if (codepoint >= 0xd800 && codepoint <= 0xdfff) {
      throw new Error(`glyph_push.glyphs[${index}].codepoint is a surrogate`)
    }
    integer(glyph.adv_w, 0, 65535, `glyph_push.glyphs[${index}].adv_w`)
    const boxW = integer(glyph.box_w, 0, 64, `glyph_push.glyphs[${index}].box_w`)
    const boxH = integer(glyph.box_h, 0, 64, `glyph_push.glyphs[${index}].box_h`)
    integer(glyph.ofs_x, -32768, 32767, `glyph_push.glyphs[${index}].ofs_x`)
    integer(glyph.ofs_y, -32768, 32767, `glyph_push.glyphs[${index}].ofs_y`)
    const bitmap = requiredString(glyph, 'bitmap', `glyph_push.glyphs[${index}].bitmap`)
    const decodedBytes = strictBase64DecodedLength(bitmap)
    if (decodedBytes === undefined) {
      throw new Error(`glyph_push.glyphs[${index}].bitmap is invalid base64`)
    }
    const expected = Math.ceil((boxW * boxH * (push.bpp as number)) / 8)
    if (decodedBytes !== expected) {
      throw new Error(`glyph_push.glyphs[${index}].bitmap has an unexpected length`)
    }
    totalBytes += decodedBytes
    if (totalBytes > MAX_GLYPH_BITMAP_BYTES) throw new Error('glyph_push bitmap data exceeds 64 KiB')
  }
  return push as XiaozhiGlyphPushV1
}

function base64Sextet(character: string): number {
  const code = character.charCodeAt(0)
  if (code >= 65 && code <= 90) return code - 65
  if (code >= 97 && code <= 122) return code - 71
  if (code >= 48 && code <= 57) return code + 4
  if (character === '+') return 62
  if (character === '/') return 63
  return -1
}

/** Returns the decoded byte length for canonical RFC 4648 base64, or undefined. */
function strictBase64DecodedLength(value: string): number | undefined {
  if (value.length === 0) return 0
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return undefined
  const firstPadding = value.indexOf('=')
  if (firstPadding >= 0 && firstPadding < value.length - 2) return undefined
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  if (padding === 2) {
    if (value.length < 4 || (base64Sextet(value[value.length - 3]) & 0x0f) !== 0) return undefined
  } else if (padding === 1) {
    if (value.length < 4 || (base64Sextet(value[value.length - 2]) & 0x03) !== 0) return undefined
  }
  return (value.length / 4) * 3 - padding
}

function validateOptionalGlyphPush(object: Record<string, unknown>): void {
  if (object.glyph_push !== undefined) parseXiaozhiGlyphPushV1(object.glyph_push)
}

function parseHello(value: Record<string, unknown>): XiaozhiV1ServerHello {
  if (value.version !== undefined && value.version !== 1) throw new Error('hello.version must be 1')
  if (value.transport !== 'websocket') throw new Error('hello.transport must be websocket')
  sessionId(value)
  if (value.audio_params !== undefined) parseXiaozhiV1AudioParams(value.audio_params)
  return value as XiaozhiV1ServerHello
}

export function parseXiaozhiV1ServerEvent(value: unknown): ParsedXiaozhiV1ServerEvent {
  const event = record(value, 'XiaoZhi server event')
  const type = requiredString(event, 'type', 'event type')
  sessionId(event)

  switch (type) {
    case 'hello':
      return { known: true, event: parseHello(event) }
    case 'stt':
      requiredString(event, 'text', 'stt.text')
      validateOptionalGlyphPush(event)
      return { known: true, event: event as XiaozhiV1SttEvent }
    case 'llm':
      optionalString(event, 'emotion')
      optionalString(event, 'text')
      return { known: true, event: event as XiaozhiV1LlmEvent }
    case 'tts': {
      if (!TTS_STATES.includes(event.state as string)) throw new Error('tts.state is unsupported')
      if (event.state === 'sentence_start') {
        requiredString(event, 'text', 'tts.text')
        validateOptionalGlyphPush(event)
      } else if (event.glyph_push !== undefined) {
        throw new Error('glyph_push is only valid for tts sentence_start')
      }
      return { known: true, event: event as XiaozhiV1ServerEvent }
    }
    case 'mcp':
      parseJsonRpcMessage(event.payload)
      return { known: true, event: event as XiaozhiV1McpEvent }
    case 'system':
      requiredString(event, 'command', 'system.command')
      return { known: true, event: event as XiaozhiV1SystemEvent }
    case 'alert': {
      optionalString(event, 'status')
      optionalString(event, 'emotion')
      const message =
        typeof event.message === 'string'
          ? requiredString(event, 'message', 'alert.message')
          : requiredString(event, 'text', 'alert.message')
      if (event.message === undefined) return { known: true, event: { ...event, message } as XiaozhiV1AlertEvent }
      return { known: true, event: event as XiaozhiV1AlertEvent }
    }
    case 'custom':
      if (!own(event, 'payload')) throw new Error('custom.payload is required')
      return { known: true, event: event as XiaozhiV1CustomEvent }
    default:
      return { known: false, event }
  }
}

export function parseXiaozhiV1ClientEvent(value: unknown): XiaozhiV1ClientEvent<Record<string, unknown>> {
  const event = record(value, 'XiaoZhi client event')
  const type = requiredString(event, 'type', 'event type')
  sessionId(event)
  switch (type) {
    case 'hello':
      if (event.version !== 1) throw new Error('hello.version must be 1')
      if (event.transport !== 'websocket') throw new Error('hello.transport must be websocket')
      parseXiaozhiV1AudioParams(event.audio_params)
      if (event.features !== undefined) {
        const features = record(event.features, 'hello.features')
        for (const key of Object.keys(features)) {
          if (typeof features[key] !== 'boolean') throw new Error(`hello.features.${key} must be a boolean`)
        }
      }
      if (event.text_font !== undefined) {
        const font = record(event.text_font, 'hello.text_font')
        if (!requiredString(font, 'bundle', 'hello.text_font.bundle')) {
          throw new Error('hello.text_font.bundle is required')
        }
        if (!requiredString(font, 'charset', 'hello.text_font.charset')) {
          throw new Error('hello.text_font.charset is required')
        }
        integer(font.size, 1, 256, 'hello.text_font.size')
        if (font.bpp !== 1 && font.bpp !== 4) throw new Error('hello.text_font.bpp must be 1 or 4')
      }
      return event as XiaozhiV1ClientHello<Record<string, unknown>>
    case 'listen':
      if (event.state === 'start') {
        if (!LISTENING_MODES.includes(event.mode as string)) throw new Error('listen.mode is unsupported')
      } else if (event.state === 'stop') {
        // No additional fields.
      } else if (event.state === 'detect') {
        optionalString(event, 'text')
      } else {
        throw new Error('listen.state is unsupported')
      }
      return event as XiaozhiV1ClientEvent<Record<string, unknown>>
    case 'abort':
      optionalString(event, 'reason')
      return event as XiaozhiV1Abort
    case 'mcp':
      parseJsonRpcMessage(event.payload)
      return event as XiaozhiV1McpEvent
    default:
      throw new Error(`unsupported XiaoZhi client event: ${type}`)
  }
}

export function sanitizeXiaozhiV1HelloExtension(value: unknown): Record<string, unknown> {
  if (value === undefined) return {}
  const extension = record(value, 'helloExtension')
  const sanitized: Record<string, unknown> = {}
  for (const key of Object.keys(extension)) {
    if (RESERVED_HELLO_EXTENSION_KEYS[key]) {
      throw new Error(`helloExtension cannot override ${key}`)
    }
    sanitized[key] = extension[key]
  }
  return sanitized
}
