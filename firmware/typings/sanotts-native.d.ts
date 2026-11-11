declare module 'sanotts-native' {
  export default class NativeSanoTTS {
    start(kana: string): void
    read(buffer: ArrayBuffer): number
    readonly available: number
    readonly done: boolean
    stop(): void
    close(): void
  }
}
