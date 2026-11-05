import { localize } from 'localization'
import type {
  Application as PiuApplication,
  Container as PiuContainer,
  Scroller as PiuScroller,
  Text as PiuText,
} from 'piu/MC'
import { Application, Column, Container, Label, Scroller, Text } from 'piu/MC'
import { ActionButton } from 'ui-controls'
import { UI, uiStyles } from 'ui-theme'

export type StartupSplashOptions = {
  message?: string
  onMods?: () => void
  onSettings?: () => void
}

export type WiFiConnectionStatusOptions = {
  attempt: number
  maxAttempts: number
}

export type WiFiRecoveryChoiceOptions = {
  message: string
  sntpHost?: string
  onRetry?: () => void
  onOffline?: () => void
}

export type StartupPhase = 'initialization' | 'launch' | 'network' | 'context' | 'behavior'

export function startupErrorClass(error: unknown): string {
  try {
    if (error instanceof TypeError) return 'TypeError'
    if (error instanceof RangeError) return 'RangeError'
    if (error instanceof ReferenceError) return 'ReferenceError'
    if (error instanceof SyntaxError) return 'SyntaxError'
    if (error instanceof URIError) return 'URIError'
    if (error instanceof EvalError) return 'EvalError'
  } catch {
    // A thrown Proxy can reject prototype inspection. Keep diagnostics safe.
  }
  return 'Error'
}

export function showStartupError(options: {
  phase: StartupPhase
  error: unknown
  onRestart: () => void
}): PiuApplication {
  const environment = globalThis as typeof globalThis & { application?: PiuApplication }
  const application = environment.application ?? showStartupSplash()
  const styles = uiStyles()
  // Clear detached splash references so late Wi-Fi callbacks cannot replace
  // this failure with a status message or recovery choice.
  currentMessageScroller = null
  currentActionArea = null
  let restarting = false
  const root = new Container(null, {
    name: 'startup:error',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    skin: styles.screen,
    contents: [
      new Column(null, {
        top: 44,
        left: 12,
        right: 12,
        contents: [
          new Label(null, { left: 0, right: 0, height: 28, string: localize('splash.failed'), style: styles.title }),
          new Label(null, {
            left: 0,
            right: 0,
            height: 28,
            string: localize(`splash.phase.${options.phase}`),
            style: styles.body,
          }),
          new Label(null, {
            left: 0,
            right: 0,
            height: 28,
            string: startupErrorClass(options.error),
            style: styles.bodyMuted,
          }),
        ],
      }),
      new ActionButton(
        {
          name: 'startup:restart',
          icon: 'retry',
          label: localize('mods.restart'),
          onTap: () => {
            if (restarting || environment.application !== application || root.container !== application) return
            restarting = true
            options.onRestart()
          },
        },
        { left: 104, width: 112, bottom: 12 },
      ),
    ],
  })
  application.empty()
  application.behavior = new Behavior()
  application.add(root)
  return application
}

const SPLASH_TOP = 66
const SPLASH_MESSAGE_HEIGHT = 72
const RECOVERY_TOP = 12
const BRAND_HEIGHT = 42

let currentMessageScroller: PiuScroller | null = null
let currentActionArea: PiuContainer | null = null

function showActions(contents: PiuContainer[]) {
  if (!currentActionArea) return
  currentActionArea.empty()
  for (const content of contents) currentActionArea.add(content)
}

function setMessage(message: string, sntpHost?: string) {
  const scroller = currentMessageScroller
  if (!scroller || !currentActionArea) return
  const text = scroller.first as PiuText
  const column = scroller.container as PiuContainer
  const brand = column.first as PiuContainer
  column.y = sntpHost ? RECOVERY_TOP : SPLASH_TOP
  brand.height = BRAND_HEIGHT
  brand.visible = true
  scroller.height = SPLASH_MESSAGE_HEIGHT
  scroller.active = Boolean(sntpHost)
  scroller.scrollTo(0, 0)
  if (!sntpHost) {
    text.string = message
    return
  }

  // Piu Text does not break a long ASCII word at a dot or hyphen.
  const width = scroller.width
  const style = text.style ?? uiStyles().bodyMuted
  const lines = [message]
  let line = ''
  for (const character of sntpHost) {
    if (line && (style.measure(line + character).width ?? 0) > width) {
      lines.push(line)
      line = ''
    }
    line += character
  }
  lines.push(line)
  text.string = lines.join('\n')
  const availableHeight = currentActionArea.y - RECOVERY_TOP - UI.space
  // Use the title's space when needed so a full hostname can fit on devices without touch.
  if (text.height > availableHeight - BRAND_HEIGHT) {
    brand.visible = false
    brand.height = 0
  }
  scroller.height = availableHeight - brand.height
}

export function showStartupSplash(options: StartupSplashOptions = {}): PiuApplication {
  const styles = uiStyles()
  const messageScroller = new Scroller(null, {
    left: 12,
    right: 12,
    height: SPLASH_MESSAGE_HEIGHT,
    clip: true,
    Behavior: class extends Behavior {
      startY = 0
      offsetY = 0

      onTouchBegan(scroller: PiuScroller, _id: number, _x: number, y: number) {
        this.startY = y
        this.offsetY = scroller.scroll.y ?? 0
      }

      onTouchMoved(scroller: PiuScroller, _id: number, _x: number, y: number) {
        scroller.scrollTo(0, this.offsetY + this.startY - y)
      }
    },
    contents: [
      new Text(null, {
        top: 0,
        left: 0,
        right: 0,
        string: options.message ?? localize('splash.starting'),
        style: styles.bodyMuted,
      }),
    ],
  })
  const actionArea = new Container(null, {
    left: 0,
    right: 0,
    bottom: 12,
    height: UI.touchTarget,
  })
  currentMessageScroller = messageScroller
  currentActionArea = actionArea

  const application = new Application(options, {
    commandListLength: 4096,
    // This Application is reused by the main face and multiline balloons.
    displayListLength: 8192,
    touchCount: 1,
    skin: styles.screen,
    contents: [
      new Column(null, {
        left: 0,
        right: 0,
        top: SPLASH_TOP,
        contents: [
          new Label(null, {
            left: 0,
            right: 0,
            height: BRAND_HEIGHT,
            string: 'Stack-chan[・＿・]',
            style: styles.brand,
          }),
          messageScroller,
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
    new ActionButton(
      {
        name: 'startup:settings',
        icon: 'settings',
        label: localize('settings.title'),
        onTap: options.onSettings,
      },
      options.onMods ? { right: 8, width: 148 } : { left: 104, width: 112 },
    ),
  ])
  return application
}

export function showWiFiConnectionStatus(options: WiFiConnectionStatusOptions): void {
  setMessage(localize('splash.connecting', options))
  showActions([])
}

export function showWiFiRecoveryChoice(options: WiFiRecoveryChoiceOptions): void {
  setMessage(options.message, options.sntpHost)
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
}
