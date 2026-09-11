export default class AudioFake {
  static get instances(): AudioFake[] {
    const state = globalThis as { usbTestAudio?: AudioFake[] }
    state.usbTestAudio ??= []
    return state.usbTestAudio
  }
  static get failClose(): boolean {
    return !!(globalThis as { usbTestCloseFailure?: boolean }).usbTestCloseFailure
  }
  static set failClose(value: boolean) {
    ;(globalThis as { usbTestCloseFailure?: boolean }).usbTestCloseFailure = value
  }
  closed = false
  stops = 0
  volume = 1
  constructor(
    readonly options: {
      sampleRate?: number
      channels?: number
      bitsPerSample?: number
      onReadable?(this: AudioFake, size: number): void
      onWritable?(this: AudioFake, size: number): void
    },
  ) {
    AudioFake.instances.push(this)
  }
  start() {}
  stop() {
    this.stops++
  }
  read() {
    return new ArrayBuffer(0)
  }
  write(_bytes: Uint8Array) {}
  close() {
    if (AudioFake.failClose) throw new Error('native audio release failed')
    this.closed = true
  }
}
