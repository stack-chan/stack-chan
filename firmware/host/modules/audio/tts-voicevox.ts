/* eslint-disable prefer-const */

import type HTTPClient from 'embedded:network/http/client'
import { File } from 'file'
import Headers from 'headers'
import config from 'mc/config'
import type AudioOut from 'pins/audioout'
import { beginTTSPlayback } from 'tts-playback-lifecycle'
import type { TTSCompletion, TTSDoneListener, TTSPlaybackListener } from 'tts-types'
import WavStreamer from 'wavstreamer'

const QUERY_PATH = `${config.file.root}query.json`

/* global trace, SharedArrayBuffer */
declare const device: {
  network: {
    http: {
      client: typeof HTTPClient.constructor & {
        io: typeof HTTPClient
        socket: unknown
        dns: unknown
      }
    }
  }
}

export type TTSProperty = {
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
  host: string
  port: number
  sampleRate?: number
  speakerId?: number
  volume?: number
}

export class TTS {
  audio?: AudioOut
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
  client?: HTTPClient
  host: string
  port: number
  streaming: boolean
  file?: File
  speakerId: number
  sampleRate: number
  volume: number
  constructor(props: TTSProperty) {
    this.onPlayed = props.onPlayed
    this.onDone = props.onDone
    this.streaming = false
    this.speakerId = props.speakerId ?? 1
    this.host = props.host
    this.port = props.port
    this.sampleRate = props.sampleRate ?? 11025
    this.volume = props.volume ?? 0.5
  }
  async getQuery(text: string, speakerId = 1): Promise<void> {
    return new Promise((resolve, reject) => {
      File.delete(QUERY_PATH)
      const file = new File(QUERY_PATH, true)
      const sampleRate = this.sampleRate
      const client = new device.network.http.client.io({
        ...device.network.http.client,
        host: this.host,
        port: this.port,
      })
      client.request({
        method: 'POST',
        path: encodeURI(`/audio_query?text=${text}&speaker=${speakerId}`),
        // TODO: https://github.com/Moddable-OpenSource/moddable/pull/1420
        headers: new Headers([['Content-Type', 'application/x-www-form-urlencoded']]),
        onHeaders(status) {
          if (status !== 200) {
            file.close()
            client.close()
            reject(`server returned ${status}`)
          }
        },
        onReadable(count) {
          const chunk = this.read(count)
          if (chunk != null) {
            file.write(chunk)
          }
          // trace(`${count} bytes written. position: ${file.position}\n`)
        },
        onDone(error) {
          if (error) {
            file.close()
            client.close()
            reject(`unknown error occured:${error.message}`)
          } else {
            if (sampleRate !== 24000) {
              file.position = file.length - 1
              file.write(`, "outputSamplingRate": ${sampleRate}}`)
            }
            file.close()
            client.close()
            resolve()
          }
        },
      })
    })
  }
  stream(key: string, volume?: number, callback?: TTSCompletion): void {
    const lifecycle = beginTTSPlayback(this, callback)
    if (!lifecycle) return

    const host = this.host
    const port = this.port
    const speakerId = this.speakerId
    this.getQuery(key, speakerId).then(
      () => {
        try {
          const file = new File(QUERY_PATH)
          lifecycle.addCleanup(() => file.close())
          trace(`file opened. length: ${file.length}, position: ${file.position}`)
          const audio = lifecycle.openAudio(
            { streams: 1, bitsPerSample: 16, sampleRate: this.sampleRate },
            volume ?? this.volume,
          )
          lifecycle.attach(
            new WavStreamer({
              http: device.network.http.client,
              host,
              port,
              path: encodeURI(`/synthesis?speaker=${speakerId}`),
              audio: {
                out: audio,
                stream: 0,
              },
              bufferDuration: 600,
              request: {
                method: 'POST',
                headers: new Headers([
                  ['content-type', 'application/json'],
                  ['content-length', `${file.length}`],
                ]),
                onWritable(count) {
                  const chunk = file.read(ArrayBuffer, count)
                  if (chunk != null) {
                    this.write(chunk)
                  }
                },
              },
              onPlayed: lifecycle.onPlayed,
              onReady: lifecycle.onReady,
              onError: lifecycle.onError,
              onDone: lifecycle.onDone,
            }),
          )
        } catch (error) {
          lifecycle.fail(error)
        }
      },
      (error) => {
        lifecycle.fail(error)
      },
    )
  }
}
