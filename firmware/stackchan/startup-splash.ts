import { Application, Column, Container, Label, Skin, Style } from 'piu/MC'
import type {
  Application as PiuApplication,
  Container as PiuContainer,
  Skin as PiuSkin,
  Style as PiuStyle,
} from 'piu/MC'

export type StartupSplashOptions = {
  onTouch?: () => void
}

export type WiFiRecoveryChoice = 'retry' | 'offline'

export type WiFiRecoveryOptions = {
  message?: string
  onRetry?: () => void
  onOffline?: () => void
}

const SPLASH_FONT = '24px Open Sans'

let backgroundSkin: PiuSkin | null = null
let titleStyle: PiuStyle | null = null
let messageStyle: PiuStyle | null = null
let choiceButtonSkin: PiuSkin | null = null
let choiceButtonPressedSkin: PiuSkin | null = null
let choiceButtonStyle: PiuStyle | null = null

type GlobalWithApplication = typeof globalThis & {
  application?: PiuApplication
}

type WiFiChoiceButtonData = {
  label: string
  choice: WiFiRecoveryChoice
  options: WiFiRecoveryOptions
}

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

function getChoiceButtonSkin() {
  if (!choiceButtonSkin) choiceButtonSkin = new Skin({ fill: '#ffffff' })
  return choiceButtonSkin
}

function getChoiceButtonPressedSkin() {
  if (!choiceButtonPressedSkin) choiceButtonPressedSkin = new Skin({ fill: '#c0c0c0' })
  return choiceButtonPressedSkin
}

function getChoiceButtonStyle() {
  if (!choiceButtonStyle) {
    choiceButtonStyle = new Style({
      font: '20px Open Sans',
      color: '#111111',
      horizontal: 'center',
      vertical: 'middle',
    })
  }
  return choiceButtonStyle
}

const WiFiChoiceButton = Container.template(($: WiFiChoiceButtonData) => ({
  left: 24,
  right: 24,
  height: 42,
  active: true,
  skin: getChoiceButtonSkin(),
  contents: [
    new Label(null, {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      string: $.label,
      style: getChoiceButtonStyle(),
    }),
  ],
  Behavior: class extends Behavior {
    choice: WiFiRecoveryChoice | null = null
    options: WiFiRecoveryOptions | null = null

    onCreate(_container: PiuContainer, data: WiFiChoiceButtonData) {
      this.choice = data.choice
      this.options = data.options
    }

    onTouchBegan(container: PiuContainer) {
      container.skin = getChoiceButtonPressedSkin()
    }

    onTouchCancelled(container: PiuContainer) {
      container.skin = getChoiceButtonSkin()
    }

    onTouchEnded(container: PiuContainer) {
      container.skin = getChoiceButtonSkin()
      if (this.choice === 'retry') {
        this.options?.onRetry?.()
      } else if (this.choice === 'offline') {
        this.options?.onOffline?.()
      }
    }
  },
}))

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

export function showWiFiRecoveryChoice(options: WiFiRecoveryOptions): PiuApplication {
  const contents = [
    new Container(options, {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      contents: [
        new Column(null, {
          left: 0,
          right: 0,
          top: 36,
          contents: [
            new Label(null, {
              left: 0,
              right: 0,
              height: 36,
              string: 'Wi-Fi failed',
              style: getTitleStyle(),
            }),
            new Label(null, {
              left: 0,
              right: 0,
              height: 34,
              string: options.message ?? 'Connection failed',
              style: getMessageStyle(),
            }),
            new WiFiChoiceButton({
              label: 'A: Retry',
              choice: 'retry',
              options,
            }),
            new WiFiChoiceButton({
              label: 'C: Start offline',
              choice: 'offline',
              options,
            }),
          ],
        }),
      ],
    }),
  ]

  const existingApplication = (globalThis as GlobalWithApplication).application
  if (existingApplication) {
    existingApplication.empty()
    existingApplication.skin = getBackgroundSkin()
    existingApplication.add(contents[0])
    return existingApplication
  }

  return new Application(options, {
    displayListLength: 4096,
    touchCount: 1,
    skin: getBackgroundSkin(),
    contents,
  })
}
