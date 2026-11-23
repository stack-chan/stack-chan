export class SpeechBalloon {
  readonly options: Record<string, unknown>
  readonly behavior: {
    setText: (_content: unknown, text: string) => void
    setLines: (_content: unknown, lines: readonly string[]) => void
  }
  text: string
  lines: readonly string[] = []

  constructor(options: Record<string, unknown> = {}) {
    this.options = options
    this.text = typeof options.text === 'string' ? options.text : ''
    this.behavior = {
      setText: (_content, text) => {
        this.text = text
      },
      setLines: (_content, lines) => {
        this.lines = lines
      },
    }
  }
}
