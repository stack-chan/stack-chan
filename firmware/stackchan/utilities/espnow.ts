import EspNowNative from 'espnow-native'

export type EspNowOptions = {
  channel?: number
}

export default class EspNow {
  constructor(options: EspNowOptions = {}) {
    EspNowNative.start(options.channel ?? 1)
  }

  read(): ArrayBuffer | undefined {
    return EspNowNative.read()
  }

  send(data: ArrayBuffer) {
    EspNowNative.send(data)
  }

  close() {
    EspNowNative.close()
  }
}
