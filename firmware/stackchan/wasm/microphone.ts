export default class Microphone {
  constructor(_options?: unknown) {}
  async record(_durationMilliSec = 3000): Promise<ArrayBuffer> {
    return new ArrayBuffer(0)
  }
  close() {}
}
