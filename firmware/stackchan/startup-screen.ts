import { Application, Column, Container, Label, Skin, Style } from 'piu/MC'
import type { Label as PiuLabel } from 'piu/MC'

const screenSkin = new Skin({ fill: '#000000' })
const titleStyle = new Style({
  font: '20px Open Sans',
  color: '#ffffff',
  horizontal: 'left',
  vertical: 'middle',
})
const statusStyle = new Style({
  font: '16px Open Sans',
  color: '#ffffff',
  horizontal: 'left',
  vertical: 'top',
})

const formatError = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export class StartupScreen {
  #status?: PiuLabel

  constructor() {
    try {
      const status = new Label(null, {
        left: 0,
        right: 0,
        top: 8,
        height: 120,
        string: 'Preparing startup...',
        style: statusStyle,
      })
      this.#status = status
      new Application(null, {
        skin: screenSkin,
        contents: [
          new Container(null, {
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            contents: [
              new Column(null, {
                left: 10,
                right: 10,
                top: 20,
                contents: [
                  new Label(null, {
                    left: 0,
                    right: 0,
                    height: 26,
                    string: 'Stack-chan Startup',
                    style: titleStyle,
                  }),
                  status,
                ],
              }),
            ],
          }),
        ],
      })
    } catch (error) {
      trace(`Startup screen is not available: ${formatError(error)}\n`)
      this.#status = undefined
    }
  }

  setStatus(message: string): void {
    trace(`[startup] ${message}\n`)
    if (this.#status) {
      this.#status.string = message
    }
  }

  showError(error: unknown): void {
    this.setStatus(`Error: ${formatError(error)}`)
  }
}
