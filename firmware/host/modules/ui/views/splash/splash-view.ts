import { localize } from 'localization'
import type { Application as PiuApplication } from 'piu/MC'
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

  const actions = [
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
  ]
  for (const action of actions) actionArea.add(action)
  return application
}

export function showStartupSplash(options: StartupSplashOptions = {}): PiuApplication {
  return createStartupSplash(options, true)
}

export function showStartupFailure(options: StartupSplashOptions): PiuApplication {
  return createStartupSplash(options, false)
}
