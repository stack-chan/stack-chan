declare module 'stackchanvoice' {
  export default class StackchanVoice {
    static readonly sampleRate: 8000
    static readonly outputSampleRate: 24000
    static readonly Normal: 0
    static readonly Cute: 1
    constructor(voice: number, dictionaryResource: object)
    setVoice(voice: number): void
    say(text: string, speed?: number): void
    koe(koe: string, speed?: number): void
    read(buffer: ArrayBuffer): number
    read24(buffer: ArrayBuffer): number
  }
}
