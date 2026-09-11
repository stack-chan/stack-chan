import MP3Streamer from 'mp3streamer'
import type AudioOut from 'pins/audioout'
import { StackchanError } from 'stackchan/errors'
import { type PlaybackHttpOptions, playbackHttp } from 'tts-http-client'
import { requestTTSQuery } from 'tts-http-query'
import { runTTSPlayback } from 'tts-playback-lifecycle'
import { PlaybackProvider } from 'tts-playback-session'
import type { TTSCompletion, TTSDoneListener, TTSPlaybackListener } from 'tts-types'
import { URL } from 'url'

declare const device: { network: { https: { client: PlaybackHttpOptions } } }

export type TTSProperty = {
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
  token: string
  sampleRate?: number
  speakerId?: number
  volume?: number
}

export class TTS extends PlaybackProvider {
  audio?: AudioOut
  token: string
  speakerId: number
  sampleRate?: number
  volume: number

  constructor(props: TTSProperty) {
    super(props)
    this.speakerId = props.speakerId ?? 1
    this.token = props.token
    this.sampleRate = props.sampleRate
    this.volume = props.volume ?? 0.5
  }

  stream(text: string, volume?: number, callback?: TTSCompletion): void {
    runTTSPlayback(this, callback, (lifecycle) => {
      const http = device.network.https.client
      void requestTTSQuery(lifecycle, {
        http,
        host: 'api.tts.quest',
        port: 443,
        path: `/v3/voicevox/synthesis?key=${encodeURIComponent(this.token)}&text=${encodeURIComponent(text)}&speaker=${encodeURIComponent(this.speakerId)}`,
      }).then((query) => {
        if (lifecycle.closed) return
        try {
          if (
            !query ||
            typeof query !== 'object' ||
            !('mp3StreamingUrl' in query) ||
            typeof query.mp3StreamingUrl !== 'string'
          )
            throw new StackchanError('IO', 'VOICEVOX returned no playback URL')
          const url = new URL(query.mp3StreamingUrl)
          if (url.protocol !== 'https:' || url.username || url.password)
            throw new StackchanError('IO', 'VOICEVOX returned an invalid playback URL')
          const audio = lifecycle.openAudio(
            { streams: 1, bitsPerSample: 16, sampleRate: this.sampleRate ?? 22050 },
            volume ?? this.volume,
          )
          lifecycle.attach(
            new MP3Streamer({
              http: playbackHttp(lifecycle, http),
              host: url.hostname,
              path: `${url.pathname}${url.search}`,
              port: url.port ? Number(url.port) : 443,
              audio: { out: audio, stream: 0 },
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
