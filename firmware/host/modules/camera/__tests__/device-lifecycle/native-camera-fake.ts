export default class NativeCamera {
  static current: NativeCamera | undefined
  static startFailure: Error | undefined
  width = 176
  height = 144
  imageType = 0
  closes = 0
  stops = 0
  stopFailure: Error | undefined
  frame: ArrayBuffer | undefined
  readable: () => void
  constructor(options: { onReadable: () => void }) {
    this.readable = options.onReadable
    NativeCamera.current = this
  }
  start() {
    if (NativeCamera.startFailure) throw NativeCamera.startFailure
  }
  stop() {
    this.stops += 1
    if (this.stopFailure) throw this.stopFailure
  }
  close() {
    this.closes += 1
  }
  read() {
    const frame = this.frame
    this.frame = undefined
    return frame
  }
}
