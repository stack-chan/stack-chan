import { checkScope, failure } from 'stackchan-ai-core'
import { base64, encodedImage, type ImageBytes } from 'stackchan-ai-image'
import type { Image, Scope } from '../voice/contracts.js'

export type Body = { length: number; read(): Iterable<Uint8Array> }
export type ResponseConsumer = (bytes: Uint8Array) => Promise<void>
export type SendResponseRequest = (
  body: Body,
  consume: ResponseConsumer,
  scope: Scope,
  isComplete?: () => boolean,
) => Promise<void>

export class ImageURL {
  readonly image: Image
  constructor(image: Image) {
    this.image = image
  }
}

export function jsonBody(value: unknown, maxBytes: number): Body {
  const parts: (Uint8Array | ImageBytes)[] = []
  let length = 0,
    text = ''
  function reserve(bytes: number) {
    length += bytes
    if (length > maxBytes) throw failure('resource_exhausted', 'request exceeds byte limit')
  }
  function flush() {
    if (!text) return
    const bytes = new Uint8Array(ArrayBuffer.fromString(text))
    reserve(bytes.length)
    parts.push(bytes)
    text = ''
  }
  function raw(s: string) {
    if (s.length + text.length > maxBytes - length) throw failure('resource_exhausted', 'request exceeds byte limit')
    text += s
    if (text.length >= 1024) flush()
  }
  function write(v: unknown, depth: number) {
    if (depth > 40) throw failure('resource_exhausted', 'request nesting exceeds limit')
    if (v instanceof ImageURL) {
      const image = encodedImage(v.image)
      raw('"data:' + image.mime + ';base64,')
      flush()
      reserve(4 * Math.ceil(image.length / 3))
      parts.push(image)
      raw('"')
    } else if (Array.isArray(v)) {
      raw('[')
      v.forEach((s, i) => {
        if (i) raw(',')
        write(s, depth + 1)
      })
      raw(']')
    } else if (v !== null && typeof v === 'object') {
      raw('{')
      let first = true
      for (const key of Object.keys(v)) {
        const child = (v as Record<string, unknown>)[key]
        if (child === undefined) continue
        if (!first) raw(',')
        first = false
        raw(JSON.stringify(key))
        raw(':')
        write(child, depth + 1)
      }
      raw('}')
    } else {
      if (typeof v === 'string' && v.length > maxBytes - length)
        throw failure('resource_exhausted', 'request exceeds byte limit')
      raw(JSON.stringify(v ?? null))
    }
  }
  write(value, 0)
  flush()
  return {
    length,
    *read() {
      for (const part of parts) {
        if ('mime' in part) yield* base64(part.read())
        else yield part
      }
    },
  }
}

export function consumeSSE(maxBytes: number, scope: Scope, receive: (json: string) => Promise<void>): ResponseConsumer {
  let buffer = new Uint8Array(Math.min(512, maxBytes))
  let count = 0,
    lineStart = 0
  return async (bytes) => {
    checkScope(scope)
    for (let offset = 0; offset < bytes.length; ) {
      const newline = bytes.indexOf(10, offset)
      const end = newline < 0 ? bytes.length : newline + 1
      const needed = count + end - offset
      if (needed > maxBytes) throw failure('resource_exhausted', 'SSE event exceeds byte limit')
      if (needed > buffer.length) {
        let capacity = buffer.length
        while (capacity < needed) capacity = Math.min(capacity * 2, maxBytes)
        const next = new Uint8Array(capacity)
        next.set(buffer)
        buffer = next
      }
      buffer.set(bytes.subarray(offset, end), count)
      count = needed
      offset = end
      if (newline < 0) continue
      if (count - lineStart === 1 || (count - lineStart === 2 && buffer[lineStart] === 13)) {
        // The usual audio event is one data line. Do not allocate a string array
        // (and several mapped copies) containing its large Base64 payload.
        let data = ''
        const text = String.fromArrayBuffer(buffer.buffer.slice(0, lineStart))
        let start = 0,
          fields = 0
        while (start < text.length) {
          const newline = text.indexOf('\n', start)
          const next = newline < 0 ? text.length : newline
          const end = text.charCodeAt(next - 1) === 13 ? next - 1 : next
          if (text.startsWith('data:', start)) {
            const value = text.slice(start + 5, end).trimStart()
            data = fields++ ? data + '\n' + value : value
          }
          start = next + 1
        }
        if (data && data !== '[DONE]') await receive(data)
        checkScope(scope)
        count = 0
      }
      lineStart = count
    }
  }
}
