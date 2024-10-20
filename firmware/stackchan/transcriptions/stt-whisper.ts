import { fetch } from 'fetch'
import Headers from 'headers'
import UUID from 'uuid'
import type { Maybe } from 'stackchan-util'

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
      const boundary = `--------------------------${UUID().replaceAll('-', '').substring(0, 22)}`
      const header =
        // biome-ignore lint/style/useTemplate: too long sentence
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="model"\r\n\r\n${this.model}\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="language"\r\n\r\n${this.language}\r\n` +
        `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="file"; filename="speak.wav"\r\n' +
        'Content-Type: application/octet-stream\r\n\r\n'
      const footer = `\r\n--${boundary}--\r\n`
      const bodyView = new Uint8Array(new ArrayBuffer(header.length + buffer.byteLength + footer.length))
      let offset = 0
      bodyView.set(new Uint8Array(ArrayBuffer.fromString(header)), offset)
      offset += header.length
      bodyView.set(new Uint8Array(buffer), offset)
      offset += buffer.byteLength
      bodyView.set(new Uint8Array(ArrayBuffer.fromString(footer)), offset)

      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: new Headers([
          ['Content-Type', `multipart/form-data; boundary=${boundary}`],
          ['Authorization', `Bearer ${this.apiKey}`],
        ]),
        body: bodyView.buffer,
      })

      if (response.status !== 200) {
        return { success: false, reason: `request error: ${response.status}(${response.statusText})` }
      }

      const obj = await response.json()
      return {
        success: true,
        value: obj.text,
      }
    } catch (error) {
      return { success: false, reason: `Exception occurred: ${error.message}` }
    }
  }
}
