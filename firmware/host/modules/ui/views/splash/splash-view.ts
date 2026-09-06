import { localize } from 'localization'
import type { Application as PiuApplication, Container as PiuContainer, Label as PiuLabel } from 'piu/MC'
import { Application, Column, Container, Label, Text } from 'piu/MC'
import { ActionButton } from 'ui-controls'
import { UI, uiStyles } from 'ui-theme'

export type StartupSplashOptions = {
  message?: string
  onMods?: () => void
  onSettings?: () => void
  detail?: string
  onRestart?: () => void
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
let actionVersion = 0

function showActions(contents: PiuContainer[]) {
  actionVersion++
  if (!currentActionArea) return
  currentActionArea.empty()
  for (const content of contents) currentActionArea.add(content)
}

function setMessage(message: string) {
  if (currentMessageLabel) currentMessageLabel.string = message
}

function createStartupSplash(options: StartupSplashOptions, includeSettings: boolean): PiuApplication {
  const styles = uiStyles()
  const messageLabel = new Label(null, {
    left: 12,
    right: 12,
    height: 28,
    string: options.message ?? localize('splash.starting'),
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
          ...(options.detail
            ? [new Text(null, { left: 12, right: 12, height: 40, string: options.detail, style: styles.bodyMuted })]
            : []),
        ],
      }),
      actionArea,
    ],
  })

  showActions([
    ...(options.onMods
      ? [
          new ActionButton(
            {
              name: 'startup:mods',
              icon: 'apps',
              label: localize('mods.title'),
              onTap: options.onMods,
            },
            { left: 8, width: 148 },
          ),
        ]
      : []),
    ...(options.onRestart || includeSettings
      ? [
          new ActionButton(
            {
              name: options.onRestart ? 'startup:restart' : 'startup:settings',
              icon: options.onRestart ? 'play' : 'settings',
              label: localize(options.onRestart ? 'mods.restart' : 'settings.title'),
              onTap: options.onRestart ?? options.onSettings,
            },
            options.onMods ? { right: 8, width: 148 } : { left: 104, width: 112 },
          ),
        ]
      : []),
  ])
  return application
}

export function showStartupSplash(options: StartupSplashOptions = {}): PiuApplication {
  return createStartupSplash(options, true)
}

export function showStartupFailure(options: StartupSplashOptions): PiuApplication {
  return createStartupSplash(options, false)
}

export function showWiFiConnectionStatus(options: WiFiConnectionStatusOptions): void {
  setMessage(localize('splash.connecting', options))
  showActions([])
}

export function showWiFiRecoveryChoice(options: WiFiRecoveryChoiceOptions): () => void {
  setMessage(options.message)
  showActions([
    new ActionButton(
      {
        icon: 'retry',
        label: localize('splash.retry'),
        onTap: options.onRetry,
      },
      { left: 8, width: 148 },
    ),
    new ActionButton(
      {
        icon: 'offline',
        label: localize('splash.offline'),
        onTap: options.onOffline,
      },
      { left: 164, width: 148 },
    ),
  ])
  const owner = currentActionArea
  const version = actionVersion
  return () => {
    if (currentActionArea === owner && actionVersion === version) showActions([])
  }
}
