/** Incremental, bounded rows for bitmap-font displays. History is caller-owned. */
export class RollingTextLines {
  #rows: string[] = ['']
  #width = 0
  #characters = 0
  #advances = new Map<string, number>()
  constructor(
    private options: {
      width: number
      rows: number
      measure: (character: string) => number
    },
  ) {
    if (!(options.width > 0) || !Number.isInteger(options.rows) || options.rows < 1 || options.rows > 8)
      throw new RangeError('Positive width and 1..8 rows required')
  }
  clear() {
    this.#rows = ['']
    this.#width = this.#characters = 0
  }
  #newline() {
    this.#rows.push('')
    if (this.#rows.length > this.options.rows) this.#rows.shift()
    this.#width = this.#characters = 0
  }
  append(text: string) {
    for (const character of text) {
      if (character === '\r') continue
      if (character === '\n') {
        this.#newline()
        continue
      }
      let advance = this.#advances.get(character)
      if (advance === undefined) {
        advance = Math.max(0, this.options.measure(character))
        if (this.#advances.size < 128) this.#advances.set(character, advance)
      }
      if ((this.#width > 0 && this.#width + advance > this.options.width) || this.#characters >= 128) this.#newline()
      const index = this.#rows.length - 1
      this.#rows[index] += character
      this.#width += advance
      this.#characters++
    }
    return this.lines
  }
  get lines(): string[] {
    const rows = this.#rows.slice()
    while (rows.length < this.options.rows) rows.push('')
    return rows
  }
}
