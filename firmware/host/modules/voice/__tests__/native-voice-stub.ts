export const native = {
  starts: [] as Array<{ method: string; text: string; speed: number; preset: number }>,
  reads: 0,
  invalidCount: false,
  instances: 0,
  frames: 1050,
}

export default class NativeVoice {
  static Normal = 0
  static Cute = 1
  #frames = 0
  constructor(
    private preset: number,
    resource: { name: string },
  ) {
    if (resource.name !== 'stackchan-ja.aqd') throw new Error('missing dictionary')
    native.instances++
  }
  setVoice(preset: number) {
    this.preset = preset
  }
  say(text: string, speed: number) {
    this.start('say', text, speed)
  }
  koe(text: string, speed: number) {
    this.start('koe', text, speed)
  }
  private start(method: string, text: string, speed: number) {
    native.starts.push({ method, text, speed, preset: this.preset })
    this.#frames = native.frames
  }
  read24(buffer: ArrayBuffer) {
    ++native.reads
    const samples = new Int16Array(buffer)
    const count = Math.min(samples.length, this.#frames)
    samples.fill(this.#frames, 0, count)
    this.#frames -= count
    return native.invalidCount ? samples.length + 1 : count
  }
}
