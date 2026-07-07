import type { Application as PiuApplication, Label as PiuLabel, Skin as PiuSkin, Style as PiuStyle } from 'piu/MC'
import { Application, Column, Container, Label, Skin, Style } from 'piu/MC'

export type StartupSplashOptions = {
  message?: string
  hint?: string
  onTouch?: () => void
}

export type WiFiConnectionStatusOptions = {
  attempt: number
  maxAttempts: number
}

export type WiFiRecoveryChoiceOptions = {
  message: string
  onRetry?: () => void
  onOffline?: () => void
}

const TITLE_FONT = '24px Open Sans'
const MESSAGE_FONT = 'k8x12-12'

let backgroundSkin: PiuSkin | null = null
let titleStyle: PiuStyle | null = null
let messageStyle: PiuStyle | null = null
let hintStyle: PiuStyle | null = null
let currentMessageLabel: PiuLabel | null = null
let currentHintLabel: PiuLabel | null = null
let currentTouchHandler: (() => void) | undefined

function getBackgroundSkin() {
  if (!backgroundSkin) backgroundSkin = new Skin({ fill: '#000000' })
  return backgroundSkin
}

function getTitleStyle() {
  if (!titleStyle) {
    titleStyle = new Style({
      font: TITLE_FONT,
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
      font: MESSAGE_FONT,
      color: '#ffffff',
      horizontal: 'center',
      vertical: 'middle',
    })
  }
  return messageStyle
}

function getHintStyle() {
  if (!hintStyle) {
    hintStyle = new Style({
      font: MESSAGE_FONT,
      color: '#ffffff',
      horizontal: 'center',
      vertical: 'middle',
    })
  }
  return hintStyle
}

function updateStartupSplash(options: StartupSplashOptions): void {
  currentTouchHandler = options.onTouch
  if (currentMessageLabel) {
    currentMessageLabel.string = options.message ?? 'Starting...'
  }
  if (currentHintLabel) {
    currentHintLabel.string = options.hint ?? ''
  }
}

export function showStartupSplash(options: StartupSplashOptions = {}): PiuApplication {
  const messageLabel = new Label(null, {
    left: 0,
    right: 0,
    height: 28,
    string: options.message ?? 'Starting...',
    style: getMessageStyle(),
  })
  const hintLabel = new Label(null, {
    left: 0,
    right: 0,
    height: 24,
    string: options.hint ?? '',
    style: getHintStyle(),
  })
  currentMessageLabel = messageLabel
  currentHintLabel = hintLabel
  currentTouchHandler = options.onTouch

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
              messageLabel,
              hintLabel,
            ],
          }),
        ],
        Behavior: class extends Behavior {
          onTouchBegan() {
            currentTouchHandler?.()
          }
        },
      }),
    ],
  })
}

export function showWiFiConnectionStatus(options: WiFiConnectionStatusOptions): void {
  updateStartupSplash({
    message: `Wi-Fi接続中... (${options.attempt}/${options.maxAttempts})`,
    hint: '',
  })
}

export function showWiFiRecoveryChoice(options: WiFiRecoveryChoiceOptions): void {
  updateStartupSplash({
    message: options.message,
    hint: 'A: リトライ / C: オフラインで起動',
    onTouch: options.onRetry,
  })
}
