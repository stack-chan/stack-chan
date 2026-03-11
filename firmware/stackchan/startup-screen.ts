import { Application, Column, Container, Content, Label, Row, Skin, Style, Texture } from 'piu/MC'
import type { Container as PiuContainer, Label as PiuLabel } from 'piu/MC'

const screenSkin = new Skin({ fill: '#070a10' })
const frameSkin = new Skin({
  fill: '#121826',
  stroke: '#2a3e5f',
  borders: { left: 2, right: 2, top: 2, bottom: 2 },
})
const topAccentSkin = new Skin({ fill: '#2f7ee3' })
const statusAccentSkin = new Skin({ fill: '#294063' })
const setupButtonSkin = new Skin({
  fill: '#1f4f99',
  stroke: '#8db7ff',
  borders: { left: 2, right: 2, top: 2, bottom: 2 },
})
const setupButtonPressedSkin = new Skin({
  fill: '#173c74',
  stroke: '#7ea4e7',
  borders: { left: 2, right: 2, top: 2, bottom: 2 },
})
const setupButtonDisabledSkin = new Skin({
  fill: '#3a4352',
  stroke: '#6b7586',
  borders: { left: 2, right: 2, top: 2, bottom: 2 },
})
const titleStyle = new Style({
  font: '20px Open Sans',
  color: '#f7fbff',
  horizontal: 'left',
  vertical: 'middle',
})
const statusStyle = new Style({
  font: '16px Open Sans',
  color: '#c4d5f1',
  horizontal: 'center',
  vertical: 'middle',
})
const buttonStyle = new Style({
  font: 'k8x12-12',
  color: '#ffffff',
  horizontal: 'center',
  vertical: 'middle',
})
const buttonDisabledStyle = new Style({
  font: 'k8x12-12',
  color: '#d2d7df',
  horizontal: 'center',
  vertical: 'middle',
})

const createIconSkin = () =>
  new Skin({
    texture: new Texture('startup-stackchan-icon.png'),
    color: ['#d9e7ff'],
    x: 0,
    y: 0,
    width: 64,
    height: 48,
  })

type StartupScreenOptions = {
  onOpenSetup?: () => void
}

const formatError = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export class StartupScreen {
  #status?: PiuLabel
  #setupButton?: PiuContainer
  #setupButtonLabel?: PiuLabel
  #setupRequested = false
  #onOpenSetup?: () => void

  constructor(options: StartupScreenOptions = {}) {
    this.#onOpenSetup = options.onOpenSetup
    try {
      const self = this
      const iconSkin = createIconSkin()
      const status = new Label(null, {
        left: 0,
        right: 0,
        height: 24,
        string: 'Preparing startup...',
        style: statusStyle,
      })
      const setupButtonLabel = new Label(null, {
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        string: '管理画面へ進む',
        style: buttonStyle,
      })
      const setupButton = new Container(null, {
        left: 0,
        right: 0,
        height: 38,
        active: true,
        skin: setupButtonSkin,
        contents: [setupButtonLabel],
        Behavior: class extends Behavior {
          #pressed = false
          #startX = 0
          #startY = 0
          onTouchBegan(content: PiuContainer, _id: number, x: number, y: number) {
            this.#pressed = true
            this.#startX = x
            this.#startY = y
            content.skin = setupButtonPressedSkin
          }
          onTouchMoved(content: PiuContainer, _id: number, x: number, y: number) {
            if (!this.#pressed) return
            if (Math.abs(x - this.#startX) > 6 || Math.abs(y - this.#startY) > 6) {
              this.#pressed = false
              content.skin = setupButtonSkin
            }
          }
          onTouchCancelled(content: PiuContainer) {
            this.#pressed = false
            content.skin = setupButtonSkin
          }
          onTouchEnded(content: PiuContainer) {
            content.skin = setupButtonSkin
            if (this.#pressed) {
              self.openSetup()
            }
            this.#pressed = false
          }
        },
      })
      this.#status = status
      this.#setupButton = setupButton
      this.#setupButtonLabel = setupButtonLabel
      new Application(null, {
        skin: screenSkin,
        contents: [
          new Container(null, {
            left: 8,
            right: 8,
            top: 8,
            bottom: 8,
            skin: frameSkin,
            contents: [
              new Content(null, {
                left: 0,
                right: 0,
                top: 0,
                height: 5,
                skin: topAccentSkin,
              }),
              new Column(null, {
                left: 14,
                right: 14,
                top: 14,
                bottom: 14,
                contents: [
                  new Content(null, {
                    top: 0,
                    bottom: 0,
                  }),
                  new Row(null, {
                    left: 0,
                    right: 0,
                    height: 52,
                    contents: [
                      new Content(null, {
                        left: 0,
                        right: 0,
                      }),
                      new Content(null, {
                        width: 64,
                        height: 48,
                        skin: iconSkin,
                      }),
                      new Content(null, {
                        width: 8,
                      }),
                      new Label(null, {
                        width: 132,
                        height: 40,
                        string: 'Stack-chan',
                        style: titleStyle,
                      }),
                      new Content(null, {
                        left: 0,
                        right: 0,
                      }),
                    ],
                  }),
                  new Content(null, {
                    left: 24,
                    right: 24,
                    height: 2,
                    skin: statusAccentSkin,
                  }),
                  new Content(null, {
                    height: 8,
                  }),
                  status,
                  new Content(null, {
                    height: 18,
                  }),
                  setupButton,
                  new Content(null, {
                    top: 0,
                    bottom: 0,
                  }),
                ],
              }),
            ],
          }),
        ],
      })
    } catch (error) {
      trace(`Startup screen is not available: ${formatError(error)}\n`)
      try {
        const status = new Label(null, {
          left: 8,
          right: 8,
          top: 40,
          height: 24,
          string: 'Preparing startup...',
        })
        this.#status = status
        new Application(null, {
          skin: new Skin({ fill: '#000000' }),
          contents: [
            new Label(null, {
              left: 8,
              right: 8,
              top: 12,
              height: 24,
              string: 'Stack-chan',
            }),
            status,
          ],
        })
        this.setStatus(`Fallback mode: ${formatError(error)}`)
      } catch (fallbackError) {
        trace(`Startup fallback is not available: ${formatError(fallbackError)}\n`)
        this.#status = undefined
      }
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

  isSetupRequested(): boolean {
    return this.#setupRequested
  }

  private openSetup(): void {
    if (this.#setupRequested) return
    this.#setupRequested = true
    this.setStatus('Opening setup screen...')
    if (this.#setupButton) {
      this.#setupButton.active = false
      this.#setupButton.skin = setupButtonDisabledSkin
    }
    if (this.#setupButtonLabel) {
      this.#setupButtonLabel.string = '管理画面を開いています'
      this.#setupButtonLabel.style = buttonDisabledStyle
    }
    this.#onOpenSetup?.()
  }
}
