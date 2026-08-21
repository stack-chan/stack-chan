type ChatAudioIOOptions = {
  onStateChanged?: (state: number) => void
  onInputLevelChanged?: (level: number) => void
  onOutputLevelChanged?: (level: number) => void
  onInputTranscript?: (text: string, more: boolean) => void
  onOutputTranscript?: (text: string, more: boolean) => void
  onFunctionCall?: (call: string, name: string, params: Record<string, unknown>) => void
  onEmotionChanged?: (emotion: string, text?: string) => void
  onAlert?: (alert: Record<string, unknown>) => void
  onSystemCommand?: (command: Record<string, unknown>) => void
  onCustomEvent?: (event: Record<string, unknown>) => void
  onUnknownEvent?: (event: Record<string, unknown>) => void
  onProtocolWarning?: (message: string, event?: Record<string, unknown>) => void
  onMcpNotification?: (payload: Record<string, unknown>) => void
  onMcpResponse?: (payload: Record<string, unknown>) => void
  onGlyphPush?: (glyphPush: Record<string, unknown>) => void
}

export default class ChatAudioIO {
  static FAILED = 0
  static DISCONNECTED = 1
  static DISCONNECTING = 2
  static CONNECTING = 3
  static CONNECTED = 4
  static SPEAKING = 5
  static LISTENING = 6
  static WAITING = 7

  error = 'ChatAudioIO is unavailable on this target.'
  #onStateChanged?: (state: number) => void

  constructor(options: ChatAudioIOOptions = {}) {
    this.#onStateChanged = options.onStateChanged
  }

  connect(): void {
    this.#onStateChanged?.(ChatAudioIO.FAILED)
  }

  disconnect(): void {
    this.#onStateChanged?.(ChatAudioIO.DISCONNECTED)
  }

  close(): void {}

  sendText(_text: string): void {}

  sendFunctionResult(_call: string, _name: string, _result: unknown): void {}

  changeMicrophone(_enabled: boolean): void {}

  changeVolume(_volume: number): void {}

  startListening(_mode: 'auto' | 'manual' | 'realtime' = 'auto'): void {}

  stopListening(): void {}

  notifyWakeWordDetected(_text?: string): void {}

  abort(_reason?: string): void {}

  sendMcpMessage(_payload: Record<string, unknown>): void {}
}
