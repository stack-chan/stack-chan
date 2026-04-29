export default class Microphone {
  constructor(_options?: unknown) {}
  async record(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0)
  }
  close() {}
}
