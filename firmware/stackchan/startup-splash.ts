import type {
  Application as PiuApplication,
  Container as PiuContainer,
  Skin as PiuSkin,
  Style as PiuStyle,
} from 'piu/MC'
import { Application, Column, Container, Label, Skin, Style } from 'piu/MC'

export type StartupSplashOptions = {
  onTouch?: () => void
}

const SPLASH_FONT = '24px Open Sans'

let backgroundSkin: PiuSkin | null = null
let titleStyle: PiuStyle | null = null
let messageStyle: PiuStyle | null = null

function getBackgroundSkin() {
  if (!backgroundSkin) backgroundSkin = new Skin({ fill: '#000000' })
  return backgroundSkin
}

function getTitleStyle() {
  if (!titleStyle) {
    titleStyle = new Style({
      font: SPLASH_FONT,
      color: '#ffffff',
      horizontal: 'center',
      vertical: 'middle',
    })
  }
  return titleStyle
}

function getMessageStyle() {
  if (!messageStyle) {
    messageStyle = new Style({
      font: SPLASH_FONT,
      color: '#ffffff',
      horizontal: 'center',
      vertical: 'middle',
    })
  }
  return messageStyle
}

export function showStartupSplash(options: StartupSplashOptions = {}): PiuApplication {
  return new Application(options, {
    displayListLength: 4096,
    touchCount: 1,
    skin: getBackgroundSkin(),
    contents: [
      new Container(options, {
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        active: true,
        contents: [
          new Column(null, {
            left: 0,
            right: 0,
            top: 76,
            contents: [
              new Label(null, {
                left: 0,
                right: 0,
                height: 36,
                string: 'Stack-chan',
                style: getTitleStyle(),
              }),
              new Label(null, {
                left: 0,
                right: 0,
                height: 28,
                string: 'Starting...',
                style: getMessageStyle(),
              }),
            ],
          }),
        ],
        Behavior: class extends Behavior {
          options: StartupSplashOptions | null = null

          onCreate(_container: PiuContainer, data: StartupSplashOptions) {
            this.options = data
          }

          onTouchBegan(_container: PiuContainer) {
            this.options?.onTouch?.()
          }
        },
      }),
    ],
  })
}
