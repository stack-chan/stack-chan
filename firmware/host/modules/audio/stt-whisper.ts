import type HTTPClient from 'embedded:network/http/client'
import type { HTTPClientProvider } from 'embedded:network/http/client'
import Headers from 'headers'
import Timer from 'timer'
import type { VoiceSignal } from '../voice/contracts.js'
import type { Maybe } from 'stackchan-util'
import { URL } from 'url'
import UUID from 'uuid'

declare const device: {
  network: {
    https: {
      client: HTTPClientProvider
    }
  }
}

type AudioBufferMetadata = {
  filename?: string
}

type MultipartPart = ArrayBuffer | HostBuffer | Uint8Array

type MultipartWriteState = {
  partIndex: number
  offset: number
  ended: boolean
}

type MultipartResponse = {
  status: number
  statusText?: string
  body: ArrayBuffer
}

function multipartContentLength(parts: MultipartPart[]): number {
  let length = 0
  for (const part of parts) {
    length += part.byteLength
  }
  return length
}

function partView(part: MultipartPart, offset: number, byteLength: number): MultipartPart | DataView {
  if (offset === 0 && byteLength === part.byteLength) {
    return part
  }
  if (ArrayBuffer.isView(part)) return new DataView(part.buffer, part.byteOffset + offset, byteLength)
  return new DataView(part as ArrayBuffer, offset, byteLength)
}

function writeMultipartChunk(
  writer: { write(chunk?: MultipartPart | DataView): void },
  parts: MultipartPart[],
  state: MultipartWriteState,
  count: number,
): void {
  if (state.ended) return

  while (count > 0 && state.partIndex < parts.length) {
    const part = parts[state.partIndex]
    const remaining = part.byteLength - state.offset
    if (remaining <= 0) {
      state.partIndex += 1
      state.offset = 0
      continue
    }

    const byteLength = count < remaining ? count : remaining
    writer.write(partView(part, state.offset, byteLength))
    count -= byteLength
    state.offset += byteLength
    if (state.offset >= part.byteLength) {
      state.partIndex += 1
      state.offset = 0
    }
  }

  state.ended = state.partIndex === parts.length
}

/** Post multipart audio using the HTTPS provider and collect the transcription response. */
function postMultipart(
  url: string,
  headers: Headers,
  parts: MultipartPart[],
  signal?: VoiceSignal,
): Promise<MultipartResponse> {
  return new Promise((resolve, reject) => {
    const endpoint = new URL(url)
    const path = `${endpoint.pathname}${endpoint.search}`
    const uploadHeaders = new Headers(headers)
    uploadHeaders.set('content-length', String(multipartContentLength(parts)))

    let client: HTTPClient | undefined
    let responseStatus = 0
    let responseStatusText: string | undefined
    let responseBody: ArrayBuffer | undefined
    let settled = false
    const writeState: MultipartWriteState = { partIndex: 0, offset: 0, ended: false }

    let deadline: ReturnType<typeof Timer.set>
    const abort = () => fail(signal?.reason ?? new Error('cancelled'))
    const closeClient = () => {
      signal?.removeEventListener('abort', abort)
      if (deadline !== undefined) Timer.clear(deadline)
      client?.close()
      client = undefined
    }

    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      closeClient()
      reject(error)
    }

    const succeed = () => {
      if (settled) return
      settled = true
      closeClient()
      resolve({
        status: responseStatus,
        statusText: responseStatusText,
        body: responseBody ?? new ArrayBuffer(0),
      })
    }

    if (signal?.aborted) {
      abort()
      return
    }
    signal?.addEventListener('abort', abort)
    deadline = Timer.set(() => fail(new Error('speech request timed out')), 30000)
    try {
      client = new device.network.https.client.io({
        ...device.network.https.client,
        host: endpoint.hostname,
        port: endpoint.port ? Number(endpoint.port) : 443,
        onError(error) {
          fail(error ?? new Error('network error'))
        },
      })

      client.request({
        method: 'POST',
        path,
        headers: uploadHeaders,
        onHeaders(status, _headers, statusText) {
          responseStatus = status
          responseStatusText = statusText
        },
        onWritable(count) {
          writeMultipartChunk(this, parts, writeState, count)
        },
        onReadable(count) {
          if (count === 0 || settled) return
          if ((responseBody?.byteLength ?? 0) + count > 32 * 1024) {
            fail(new Error('transcription response too large'))
            return
          }
          const chunk = this.read(count)
          if (!chunk) return
          if (responseBody) {
            const joined = new Uint8Array(responseBody.byteLength + chunk.byteLength)
            joined.set(new Uint8Array(responseBody))
            joined.set(new Uint8Array(chunk), responseBody.byteLength)
            responseBody = joined.buffer
          } else responseBody = chunk
        },
        onDone(error) {
          if (error) {
            fail(error)
          } else {
            succeed()
          }
        },
      })
    } catch (error) {
      fail(error)
    }
  })
}

export type STTProperty = {
  apiKey: string
  model?: string
  language?: string
}

export default class STT {
  apiKey: string
  model: string
  language: string

  constructor(props: STTProperty) {
    this.apiKey = props.apiKey
    this.model = props.model ?? 'whisper-1'
    this.language = props.language ?? 'ja'
  }
  async transcribe(buffer: MultipartPart, signal?: VoiceSignal): Promise<Maybe<string>> {
    try {
      const audio = buffer as ArrayBuffer & AudioBufferMetadata
      const filename = audio.filename ?? 'speak.wav'
      const boundary = `--------------------------${UUID().replaceAll('-', '').substring(0, 22)}`
      const header =
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="model"\r\n\r\n${this.model}\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="language"\r\n\r\n${this.language}\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n'
      const footer = `\r\n--${boundary}--\r\n`
      const response = await postMultipart(
        'https://api.openai.com/v1/audio/transcriptions',
        new Headers([
          ['Content-Type', `multipart/form-data; boundary=${boundary}`],
          ['Authorization', `Bearer ${this.apiKey}`],
        ]),
        [ArrayBuffer.fromString(header), buffer, ArrayBuffer.fromString(footer)],
        signal,
      )

      if (response.status !== 200) {
        return { success: false, reason: `request error: ${response.status}(${response.statusText})` }
      }

      const obj = JSON.parse(String.fromArrayBuffer(response.body))
      if (typeof obj?.text !== 'string') return { success: false, reason: 'Invalid transcription response' }
      return {
        success: true,
        value: obj.text,
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return { success: false, reason: `Exception occurred: ${reason}` }
    }
  }
}
