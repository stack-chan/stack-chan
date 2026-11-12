import type HTTPClient from 'embedded:network/http/client'
import type { HTTPClientProvider } from 'embedded:network/http/client'
import Headers from 'headers'
import type { Maybe } from 'stackchan-util'
import Timer from 'timer'
import { URL } from 'url'
import UUID from 'uuid'
import { createMultipartUpload, type MultipartPart } from 'whisper-multipart'
import type { VoiceSignal } from '../voice/contracts.js'

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

type MultipartResponse = {
  status: number
  statusText?: string
  body: ArrayBuffer
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
    const upload = createMultipartUpload(parts)
    uploadHeaders.set('content-length', String(upload.byteLength))

    let client: HTTPClient | undefined
    let responseStatus = 0
    let responseStatusText: string | undefined
    let responseBody: ArrayBuffer | undefined
    let settled = false

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
          if (settled) return
          try {
            upload.write(this, count)
          } catch (error) {
            fail(error)
          }
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
            // SDKはリクエストのonDoneを呼んだ後に、DNSやTLSの失敗理由をクライアントのonErrorに渡す。
            void Promise.resolve().then(() =>
              fail(error.message ? error : new Error('transcription connection closed')),
            )
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
        let reason = response.statusText ?? 'request failed'
        try {
          const code = JSON.parse(String.fromArrayBuffer(response.body))?.error?.code
          if (typeof code === 'string' && /^[a-z0-9_]{1,64}$/.test(code)) reason = code
        } catch {}
        return { success: false, reason: `transcription HTTP ${response.status}: ${reason}` }
      }

      const obj = JSON.parse(String.fromArrayBuffer(response.body))
      if (typeof obj?.text !== 'string') return { success: false, reason: 'Invalid transcription response' }
      return {
        success: true,
        value: obj.text,
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message || error.name : String(error)
      return { success: false, reason: `Exception occurred: ${reason}` }
    }
  }
}
