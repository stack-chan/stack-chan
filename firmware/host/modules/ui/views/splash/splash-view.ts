import type { Application as PiuApplication, Container as PiuContainer, Label as PiuLabel } from 'piu/MC'
import { Application, Column, Container, Label } from 'piu/MC'
import { ActionButton } from 'ui-controls'
import { UI, uiStyles } from 'ui-theme'

export type StartupSplashOptions = {
  message?: string
  onSettings?: () => void
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

let currentMessageLabel: PiuLabel | null = null
let currentActionArea: PiuContainer | null = null

function showActions(contents: PiuContainer[]) {
  if (!currentActionArea) return
  currentActionArea.empty()
  for (const content of contents) currentActionArea.add(content)
}

function setMessage(message: string) {
  if (currentMessageLabel) currentMessageLabel.string = message
}

export function showStartupSplash(options: StartupSplashOptions = {}): PiuApplication {
  const styles = uiStyles()
  const messageLabel = new Label(null, {
    left: 12,
    right: 12,
    height: 28,
    string: options.message ?? 'まもなく起動します',
    style: styles.bodyMuted,
  })
  const actionArea = new Container(null, {
    left: 0,
    right: 0,
    bottom: 12,
    height: UI.touchTarget,
  })
  currentMessageLabel = messageLabel
  currentActionArea = actionArea

  const application = new Application(options, {
    commandListLength: 4096,
    displayListLength: 4096,
    touchCount: 1,
    skin: styles.screen,
    contents: [
      new Column(null, {
        left: 0,
        right: 0,
        top: 66,
        contents: [
          new Label(null, {
            left: 0,
            right: 0,
            height: 42,
            string: 'Stack-chan[・＿・]',
            style: styles.brand,
          }),
          messageLabel,
        ],
      }),
      actionArea,
    ],
  })

  showActions([
    new ActionButton(
      {
        icon: 'settings',
        label: '設定',
        onTap: options.onSettings,
      },
      { left: 104, width: 112 },
    ),
  ])
  return application
}

export function showWiFiConnectionStatus(options: WiFiConnectionStatusOptions): void {
  setMessage(`Wi-Fi接続中 (${options.attempt}/${options.maxAttempts})`)
  showActions([])
}

export function showWiFiRecoveryChoice(options: WiFiRecoveryChoiceOptions): void {
  setMessage(options.message)
  showActions([
    new ActionButton(
      {
        icon: 'retry',
        label: '再試行',
        onTap: options.onRetry,
      },
      { left: 8, width: 148 },
    ),
    new ActionButton(
      {
        icon: 'offline',
        label: 'オフライン',
        onTap: options.onOffline,
      },
      { left: 164, width: 148 },
    ),
  ])
}
