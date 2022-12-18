/* eslint-disable prefer-const */
import AudioOut from 'pins/audioout'
import ResourceStreamer from 'resourcestreamer'
import calculatePower from 'calculate-power'

/* global trace, SharedArrayBuffer */

export type TTSProperty = {
  onPlayed: (number) => void
}

export class TTS {
  static streamer: ResourceStreamer
  static audio: AudioOut
  onPlayed: (number) => void
  constructor(props: TTSProperty) {
    this.onPlayed = props.onPlayed
  }
  async stream(key: string): Promise<void> {
    if (TTS.audio == null) {
      TTS.audio = new AudioOut({ streams: 1 })
    }
    return new Promise((resolve, reject) => {
      if (TTS.streamer != null) {
        reject(new Error('already playing'))
        return
      }
      TTS.streamer = new ResourceStreamer({
        path: `${key}.maud`,
        audio: {
          out: TTS.audio,
          stream: 0,
          sampleRate: 11025,
        },
        onPlayed(buffer) {
          const power = calculatePower(buffer)
          this.onPlayed(power)
        },
        onReady(state) {
          trace(`Ready: ${state}\n`)
          if (state) {
            TTS.audio.start()
          } else {
            TTS.audio.stop()
          }
        },
        onError(e) {
          trace('ERROR: ', e, '\n')
          TTS.streamer = null
          reject(new Error('unknown error occured'))
        },
        onDone() {
          trace('DONE\n')
          TTS.streamer.close()
          TTS.streamer = null
          resolve()
        },
      })
    })
  }
}
