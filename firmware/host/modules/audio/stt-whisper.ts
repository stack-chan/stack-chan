import type HTTPClient from 'embedded:network/http/client'
import Headers from 'headers'
import type { Maybe } from 'stackchan-util'
import { URL } from 'url'
import UUID from 'uuid'

declare const device: {
  network: {
    https: {
      client: typeof HTTPClient.constructor & {
        io: typeof HTTPClient
        socket: unknown
        dns: unknown
      }
    }
  }
}

type AudioBufferMetadata = {
  filename?: string
}

type MultipartPart = ArrayBuffer | HostBuffer

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
  return new DataView(part as ArrayBuffer, offset, byteLength)
}

function writeMultipartChunk(
  writer: { write(chunk?: MultipartPart | DataView): void },
  parts: MultipartPart[],
  state: MultipartWriteState,
  count: number,
): void {
  if (state.ended) return

  while (state.partIndex < parts.length) {
    const part = parts[state.partIndex]
    const remaining = part.byteLength - state.offset
    if (remaining <= 0) {
      state.partIndex += 1
      state.offset = 0
      continue
    }

    const byteLength = count < remaining ? count : remaining
    writer.write(partView(part, state.offset, byteLength))
    state.offset += byteLength
    if (state.offset >= part.byteLength) {
      state.partIndex += 1
      state.offset = 0
    }
    return
  }

  state.ended = true
  writer.write()
}

function postMultipart(url: string, headers: Headers, parts: MultipartPart[]): Promise<MultipartResponse> {
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

    const closeClient = () => {
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
        if (count === 0) return
        const chunk = this.read(count)
        if (!chunk) return
        responseBody = responseBody ? responseBody.concat(chunk) : chunk
      },
      onDone(error) {
        if (error) {
          fail(error)
        } else {
          succeed()
        }
      },
    })
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
  async transcribe(buffer: ArrayBuffer | HostBuffer): Promise<Maybe<string>> {
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
      )

      if (response.status !== 200) {
        return { success: false, reason: `request error: ${response.status}(${response.statusText})` }
      }

      const obj = JSON.parse(String.fromArrayBuffer(response.body))
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
