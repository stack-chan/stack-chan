import { state } from 'stackchan-voice-test-state'

export default class StackchanVoice {
  static readonly Cute = 1
  static readonly Normal = 0

  #finished = false

  constructor(preset: number, resource: { name: string }) {
    state.constructors.push({ preset, resourceName: resource.name })
  }

  say(text: string, speed: number): void {
    this.#finished = false
    state.says.push({ speed, text })
  }

  koe(koe: string, speed: number): void {
    this.#finished = false
    state.koes.push({ koe, speed })
  }

  read24(buffer: ArrayBuffer): number {
    if (this.#finished) return 0
    const samples = new Int16Array(buffer)
    samples[0] = 1000
    samples[1] = -1000
    this.#finished = true
    return 2
  }
}
