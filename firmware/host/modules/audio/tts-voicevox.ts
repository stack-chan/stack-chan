import type AudioOut from 'pins/audioout'
import { StackchanError } from 'stackchan/errors'
import { type PlaybackHttpOptions, playbackHttp, ttsJSONRequest } from 'tts-http-client'
import { requestTTSQuery } from 'tts-http-query'
import { runTTSPlayback } from 'tts-playback-lifecycle'
import { PlaybackProvider } from 'tts-playback-session'
import type { TTSCompletion, TTSDoneListener, TTSPlaybackListener } from 'tts-types'
import WavStreamer from 'wavstreamer'

declare const device: { network: { http: { client: PlaybackHttpOptions } } }

export type TTSProperty = {
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
  host: string
  port: number
  sampleRate?: number
  speakerId?: number
  volume?: number
}

export class TTS extends PlaybackProvider {
  audio?: AudioOut
  host: string
  port: number
  speakerId: number
  sampleRate: number
  volume: number

  constructor(props: TTSProperty) {
    super(props)
    this.speakerId = props.speakerId ?? 1
    this.host = props.host
    this.port = props.port
    this.sampleRate = props.sampleRate ?? 11025
    this.volume = props.volume ?? 0.5
  }

  stream(text: string, volume?: number, callback?: TTSCompletion): void {
    runTTSPlayback(this, callback, (lifecycle) => {
      const { host, port, speakerId, sampleRate } = this
      const http = device.network.http.client
      void requestTTSQuery(lifecycle, {
        http,
        host,
        port,
        method: 'POST',
        path: `/audio_query?text=${encodeURIComponent(text)}&speaker=${encodeURIComponent(speakerId)}`,
      }).then((query) => {
        if (lifecycle.closed) return
        try {
          if (!query || typeof query !== 'object' || Array.isArray(query))
            throw new StackchanError('IO', 'VOICEVOX returned an invalid audio query')
          const request = ttsJSONRequest(lifecycle, { ...query, outputSamplingRate: sampleRate })
          const audio = lifecycle.openAudio({ streams: 1, bitsPerSample: 16, sampleRate }, volume ?? this.volume)
          lifecycle.attach(
            new WavStreamer({
              http: playbackHttp(lifecycle, http),
              host,
              port,
              path: `/synthesis?speaker=${encodeURIComponent(speakerId)}`,
              audio: { out: audio, stream: 0 },
              bufferDuration: 600,
              request,
              onPlayed: lifecycle.onPlayed,
              onReady: lifecycle.onReady,
              onError: lifecycle.onError,
              onDone: lifecycle.onDone,
            }),
          )
        } catch (error) {
          lifecycle.fail(error)
        }
      }, lifecycle.fail)
    })
  }
}
