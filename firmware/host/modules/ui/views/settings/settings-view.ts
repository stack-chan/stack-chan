import { KeyboardField } from 'common/keyboard'
import { HorizontalExpandingKeyboard } from 'keyboard'
import { localize, type SupportedLocale } from 'localization'
import type {
  Application as PiuApplication,
  Column as PiuColumn,
  Container as PiuContainer,
  Content as PiuContent,
  Port as PiuPort,
  Scroller as PiuScroller,
  Skin as PiuSkin,
  SkinConstructor as PiuSkinConstructor,
  Style as PiuStyle,
  StyleConstructor as PiuStyleConstructor,
} from 'piu/MC'
import { Column, Container, Label, Port, Scroller, Skin, Style } from 'piu/MC'
import type { SettingsNetworkEntry } from 'settings-network-list'
import type { SettingsStatus, SettingsStatusValue as SettingsStatusValueModel } from 'settings-status-model'
import {
  SettingsStatusValue as SettingsStatusValueConst,
  settingsStatusToLabel as settingsStatusToLabelImpl,
} from 'settings-status-model'
import { formatUtcOffset, TIMEZONE_PRESETS, type TimezoneId } from 'timezone-model'
import {
  ActionButton,
  ScreenHeader,
  setActionButtonEnabled,
  setActionButtonLabel,
  setActionButtonSelected,
} from 'ui-controls'
import { UI, uiFont, uiStyles } from 'ui-theme'
import { volumePercentToValue, volumeToPercent } from 'volume-model'

export const SettingsStatusValue = SettingsStatusValueConst
export const settingsStatusToLabel = settingsStatusToLabelImpl
export type SettingsStatusValue = SettingsStatusValueModel
export type { SettingsStatus }

export const SettingsViewId = Object.freeze({
  MENU: 0,
  WIFI: 1,
  PASSWORD: 2,
  LANGUAGE: 3,
  OFFLINE: 4,
  TIMEZONE: 5,
  VOLUME: 6,
} as const)

export type SettingsViewId = (typeof SettingsViewId)[keyof typeof SettingsViewId]
export type SettingsApplication = PiuApplication

export type SettingsViewState = Readonly<{
  status: SettingsStatus
  networks: readonly SettingsNetworkEntry[]
  selectedSSID: string
  language: SupportedLocale
  timezone: TimezoneId
  volume: number
}>

export type SettingsViewActions = Readonly<{
  exit(): void
  boot(): void
  bootOffline(): void
  navigate(view: SettingsViewId): void
  scanWifi(): void
  cancelWifiScan(): void
  selectWifiNetwork(network: SettingsNetworkEntry): void
  submitWifiPassword(password: string): void
  selectLanguage(locale: SupportedLocale): void
  saveTimezone(timezone: TimezoneId): void
  saveVolume(volume: number): void
}>

export type SettingsViewContext = Readonly<{
  state: SettingsViewState
  actions: SettingsViewActions
}>

export type SettingsViewInstance = Readonly<{
  content: PiuContainer
  update?(): void
  dispose?(): void
}>

export type SettingsViewDefinition = Readonly<{
  create(context: SettingsViewContext): SettingsViewInstance
}>

type SettingsWifiViewHandles = {
  wifi: PiuContent & { string?: string }
  scan: PiuContainer
  boot: PiuContainer
  bootState: {
    connected: boolean
  }
  list: PiuColumn
  networkState: {
    networks: readonly SettingsNetworkEntry[]
  }
  context: SettingsViewContext
}

const STATUS_TOP = UI.headerHeight + 4
const STATUS_HEIGHT = 28
const ACTION_TOP = STATUS_TOP + STATUS_HEIGHT + 4
const NETWORK_LIST_TOP = ACTION_TOP + UI.touchTarget + 6
const NETWORK_ROW_HEIGHT = 40
const PASSWORD_SSID_HEIGHT = 12
const PASSWORD_FIELD_TOP = UI.headerHeight + PASSWORD_SSID_HEIGHT
const PASSWORD_FIELD_HEIGHT = 20
const PASSWORD_KEYBOARD_HEIGHT = 164
const MAX_SSID_CHARS = 30
const TIMEZONE_ACTION_HEIGHT = UI.touchTarget + 16
const VOLUME_SLIDER_TRACK_INSET = 12
const VOLUME_SLIDER_TRACK_HEIGHT = 4
const VOLUME_SLIDER_KNOB_WIDTH = 14
const VOLUME_SLIDER_KNOB_HEIGHT = 22

let rowPressedSkin: PiuSkin | null = null
let networkStyle: PiuStyle | null = null
let networkStyleFont = ''
let keyboardFieldSkinTemplate: SkinTemplate | null = null
let keyboardFieldStyleTemplate: StyleTemplate | null = null

function getRowPressedSkin() {
  if (!rowPressedSkin) rowPressedSkin = new Skin({ fill: UI.colors.surfacePressed })
  return rowPressedSkin
}

function getNetworkStyle() {
  const font = uiFont()
  if (!networkStyle || networkStyleFont !== font) {
    networkStyleFont = font
    networkStyle = new Style({
      font,
      color: UI.colors.text,
      horizontal: 'left',
      vertical: 'middle',
    })
  }
  return networkStyle
}

function getKeyboardFieldSkinTemplate(): SkinTemplate {
  if (!keyboardFieldSkinTemplate) {
    keyboardFieldSkinTemplate = Skin.template({ fill: '#ffffff' }) as SkinTemplate
  }
  return keyboardFieldSkinTemplate
}

function getKeyboardFieldStyleTemplate(): StyleTemplate {
  if (!keyboardFieldStyleTemplate) {
    keyboardFieldStyleTemplate = Style.template({
      font: '20px Open Sans',
      color: '#000000',
      horizontal: 'left',
      vertical: 'middle',
    }) as StyleTemplate
  }
  return keyboardFieldStyleTemplate
}

function fitSSID(ssid: string): string {
  if (ssid.length <= MAX_SSID_CHARS) return ssid
  return `${ssid.slice(0, MAX_SSID_CHARS - 3)}...`
}

function signalBars(signal: number | undefined): number {
  if (signal === undefined) return 1
  if (signal >= -60) return 4
  if (signal >= -70) return 3
  if (signal >= -82) return 2
  return 1
}

function drawSignalIcon(port: PiuPort, signal: number | undefined, x: number, y: number): void {
  const bars = signalBars(signal)
  for (let index = 0; index < 4; index += 1) {
    const height = 5 + index * 4
    port.fillColor(index < bars ? UI.colors.text : UI.colors.disabled, x + index * 6, y + 18 - height, 4, height)
  }
}

class VerticalScrollerBehavior extends Behavior {
  anchor = 0
  y = 0
  waiting = false

  onTouchBegan(content: PiuContent, _id: number, _x: number, y: number) {
    const scroller = content as PiuScroller
    this.anchor = scroller.scroll.y ?? 0
    this.y = y
    this.waiting = true
  }

  onTouchMoved(content: PiuContent, id: number, x: number, y: number, ticks: number) {
    const scroller = content as PiuScroller
    const delta = y - this.y
    if (this.waiting) {
      if (Math.abs(delta) < 8) return
      this.waiting = false
      scroller.captureTouch(id as unknown as string, x, y, ticks)
    }
    scroller.scrollTo(0, this.anchor - delta)
  }
}

type NetworkRowData = {
  network: SettingsNetworkEntry
  context: SettingsViewContext
  moved?: boolean
  startY?: number
}

type VolumeSliderData = {
  context: SettingsViewContext
  valueLabel: PiuContent & { string?: string }
}

class VolumeSliderBehavior extends Behavior {
  data: VolumeSliderData | null = null
  committedPercent = 0
  draftPercent = 0
  dragging = false

  onCreate(port: PiuPort, data: VolumeSliderData) {
    this.data = data
    this.sync(port, data.context.state.volume)
  }

  onTouchBegan(port: PiuPort, _id: number, x: number) {
    this.dragging = true
    this.setDraft(port, this.percentForX(port, x))
  }

  onTouchMoved(port: PiuPort, _id: number, x: number) {
    if (!this.dragging) return
    this.setDraft(port, this.percentForX(port, x))
  }

  onTouchCancelled(port: PiuPort) {
    if (!this.dragging) return
    this.dragging = false
    this.setDraft(port, this.committedPercent)
  }

  onTouchEnded(port: PiuPort, _id: number, x: number) {
    if (!this.dragging) return
    this.setDraft(port, this.percentForX(port, x))
    this.dragging = false
    if (this.draftPercent === this.committedPercent) return
    this.committedPercent = this.draftPercent
    this.data?.context.actions.saveVolume(volumePercentToValue(this.committedPercent))
  }

  onDraw(port: PiuPort) {
    const trackWidth = Math.max(1, port.width - VOLUME_SLIDER_TRACK_INSET * 2)
    const trackY = Math.floor((port.height - VOLUME_SLIDER_TRACK_HEIGHT) / 2)
    const fillWidth = Math.round((trackWidth * this.draftPercent) / 100)
    const knobCenter = VOLUME_SLIDER_TRACK_INSET + fillWidth
    port.fillColor(UI.colors.border, VOLUME_SLIDER_TRACK_INSET, trackY, trackWidth, VOLUME_SLIDER_TRACK_HEIGHT)
    if (fillWidth > 0) {
      port.fillColor(UI.colors.accent, VOLUME_SLIDER_TRACK_INSET, trackY, fillWidth, VOLUME_SLIDER_TRACK_HEIGHT)
    }
    port.fillColor(
      UI.colors.text,
      knobCenter - Math.floor(VOLUME_SLIDER_KNOB_WIDTH / 2),
      Math.floor((port.height - VOLUME_SLIDER_KNOB_HEIGHT) / 2),
      VOLUME_SLIDER_KNOB_WIDTH,
      VOLUME_SLIDER_KNOB_HEIGHT,
    )
  }

  sync(port: PiuPort, volume: number) {
    this.committedPercent = volumeToPercent(volume)
    if (this.dragging) return
    this.setDraft(port, this.committedPercent)
  }

  setDraft(port: PiuPort, percent: number) {
    this.draftPercent = percent
    if (this.data) {
      this.data.valueLabel.string = localize('settings.volumeValue', { percent: this.draftPercent })
    }
    port.invalidate()
  }

  percentForX(port: PiuPort, x: number): number {
    const trackWidth = Math.max(1, port.width - VOLUME_SLIDER_TRACK_INSET * 2)
    const trackX = x - port.x - VOLUME_SLIDER_TRACK_INSET
    return Math.max(0, Math.min(100, Math.round((trackX * 100) / trackWidth)))
  }
}

const SettingsMenuView = {
  create(context: SettingsViewContext): SettingsViewInstance {
    const styles = uiStyles()
    const content = new Container(null, {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      skin: styles.screen,
      contents: [
        new ScreenHeader({ title: localize('settings.title'), leading: 'back', onLeading: context.actions.exit }),
        new Scroller(null, {
          left: 0,
          right: 0,
          top: UI.headerHeight,
          bottom: 0,
          active: true,
          backgroundTouch: true,
          clip: true,
          Behavior: VerticalScrollerBehavior,
          contents: [
            new Column(null, {
              left: 0,
              right: 0,
              top: 0,
              contents: [
                new ActionButton(
                  {
                    icon: 'wifi',
                    label: localize('settings.wifiTitle'),
                    onTap: () => context.actions.navigate(SettingsViewId.WIFI),
                  },
                  { left: 8, right: 8 },
                ),
                new ActionButton(
                  {
                    icon: 'volume',
                    label: localize('settings.volumeTitle'),
                    onTap: () => context.actions.navigate(SettingsViewId.VOLUME),
                  },
                  { left: 8, right: 8 },
                ),
                new ActionButton(
                  {
                    icon: 'clock',
                    label: localize('settings.timezoneTitle'),
                    onTap: () => context.actions.navigate(SettingsViewId.TIMEZONE),
                  },
                  { left: 8, right: 8 },
                ),
                new ActionButton(
                  {
                    icon: 'language',
                    label: localize('settings.languageTitle'),
                    onTap: () => context.actions.navigate(SettingsViewId.LANGUAGE),
                  },
                  { left: 8, right: 8 },
                ),
              ],
            }),
          ],
        }),
      ],
    })
    return { content }
  },
} satisfies SettingsViewDefinition

const SettingsVolumeView = {
  create(context: SettingsViewContext): SettingsViewInstance {
    const styles = uiStyles()
    const valueLabel = new Label(null, {
      left: 16,
      right: 16,
      top: UI.headerHeight + 18,
      height: 28,
      string: localize('settings.volumeValue', { percent: volumeToPercent(context.state.volume) }),
      style: styles.body,
    })
    const sliderData: VolumeSliderData = { context, valueLabel }
    const slider = new Port(sliderData, {
      left: 12,
      right: 12,
      top: UI.headerHeight + 58,
      height: 52,
      active: true,
      Behavior: VolumeSliderBehavior,
    }) as PiuPort
    const content = new Container(null, {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      skin: styles.screen,
      contents: [
        new ScreenHeader({
          title: localize('settings.volumeTitle'),
          leading: 'back',
          onLeading: () => context.actions.navigate(SettingsViewId.MENU),
        }),
        valueLabel,
        slider,
        new Label(null, {
          left: 16,
          right: 16,
          top: UI.headerHeight + 126,
          height: 40,
          string: localize('settings.volumeHint'),
          style: styles.bodyMuted,
        }),
      ],
    })
    return {
      content,
      update() {
        ;(slider.behavior as VolumeSliderBehavior).sync(slider, context.state.volume)
      },
    }
  },
} satisfies SettingsViewDefinition

const SettingsWifiView = {
  create(context: SettingsViewContext): SettingsViewInstance {
    const styles = uiStyles()
    const networkState = { networks: [] as SettingsNetworkEntry[] }
    const bootState = { connected: context.state.status.wifi === SettingsStatusValue.CONNECTED }
    const scan = new ActionButton(
      { icon: 'scan', label: localize('settings.scan'), onTap: context.actions.scanWifi },
      { left: 8, top: ACTION_TOP, width: 148 },
    )
    const boot = new ActionButton(
      {
        icon: 'play',
        label: localize(bootState.connected ? 'settings.boot' : 'splash.offline'),
        onTap: () => {
          if (bootState.connected) context.actions.boot()
          else context.actions.navigate(SettingsViewId.OFFLINE)
        },
        tone: 'success',
      },
      { left: 164, top: ACTION_TOP, width: 148 },
    )
    const handles: SettingsWifiViewHandles = {
      wifi: new Label(null, {
        left: 12,
        right: 12,
        top: STATUS_TOP,
        height: STATUS_HEIGHT,
        style: styles.bodyMuted,
      }),
      scan,
      boot,
      bootState,
      list: new Column(null, { left: 0, width: UI.screenWidth, top: 0 }),
      networkState,
      context,
    }

    const content = new Container(null, {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      skin: styles.screen,
      contents: [
        new ScreenHeader({
          title: localize('settings.wifiTitle'),
          leading: 'back',
          onLeading: () => context.actions.navigate(SettingsViewId.MENU),
        }),
        handles.wifi,
        scan,
        boot,
        new Scroller(null, {
          left: 0,
          right: 0,
          top: NETWORK_LIST_TOP,
          bottom: 0,
          active: true,
          backgroundTouch: true,
          clip: true,
          Behavior: VerticalScrollerBehavior,
          contents: [handles.list],
        }),
      ],
    })

    return {
      content,
      update() {
        updateSettingsStatus(handles, context.state.status)
        updateSettingsNetworks(handles, context.state.networks)
      },
      dispose() {
        context.actions.cancelWifiScan()
      },
    }
  },
} satisfies SettingsViewDefinition

function updateSettingsStatus(handles: SettingsWifiViewHandles, status: SettingsStatus): void {
  handles.wifi.string = localize('settings.wifiStatus', { status: settingsStatusToLabel(status.wifi) })
  const scanning = status.wifi === SettingsStatusValue.SCANNING
  setActionButtonLabel(handles.scan, localize(scanning ? 'settings.scanning' : 'settings.scan'))
  setActionButtonEnabled(handles.scan, !scanning)
  const connecting =
    status.wifi === SettingsStatusValue.CONNECTING ||
    status.wifi === SettingsStatusValue.SYNCING_TIME ||
    status.wifi === SettingsStatusValue.RECONNECTING
  handles.bootState.connected = status.wifi === SettingsStatusValue.CONNECTED
  setActionButtonLabel(handles.boot, localize(handles.bootState.connected ? 'settings.boot' : 'splash.offline'))
  setActionButtonEnabled(handles.boot, !scanning && !connecting)
}

function updateSettingsNetworks(handles: SettingsWifiViewHandles, networks: readonly SettingsNetworkEntry[]) {
  if (handles.networkState.networks === networks) return
  const styles = uiStyles()
  handles.list.empty()
  if (networks.length === 0) {
    handles.list.add(
      new Label(null, {
        left: 12,
        right: 12,
        height: NETWORK_ROW_HEIGHT,
        string: localize('settings.noNetworks'),
        style: styles.bodyMuted,
      }),
    )
  } else {
    for (const network of networks) {
      const data: NetworkRowData = { network, context: handles.context }
      handles.list.add(
        new Port(data, {
          left: 0,
          width: UI.screenWidth,
          height: NETWORK_ROW_HEIGHT,
          active: true,
          Behavior: class extends Behavior {
            data: NetworkRowData | null = null

            onCreate(_port: PiuPort, rowData: NetworkRowData) {
              this.data = rowData
            }

            onTouchBegan(port: PiuPort, _id: number, _x: number, y: number) {
              if (!this.data) return
              this.data.startY = y
              this.data.moved = false
              port.skin = getRowPressedSkin()
            }

            onTouchMoved(port: PiuPort, _id: number, _x: number, y: number) {
              if (!this.data) return
              if (this.data.startY !== undefined && Math.abs(y - this.data.startY) >= 8) {
                this.data.moved = true
                port.skin = null
              }
            }

            onTouchCancelled(port: PiuPort) {
              port.skin = null
            }

            onTouchEnded(port: PiuPort) {
              port.skin = null
              if (!this.data || this.data.moved) return
              this.data.context.actions.selectWifiNetwork(this.data.network)
            }

            onDraw(port: PiuPort) {
              if (!this.data) return
              port.fillColor(UI.colors.background, 0, 0, port.width, port.height)
              port.fillColor(UI.colors.border, 0, port.height - 1, port.width, 1)
              drawSignalIcon(port, this.data.network.signal, 10, 11)
              port.drawString(fitSSID(this.data.network.ssid), getNetworkStyle(), UI.colors.text, 42, 4, 268, 32)
            }
          },
        }),
      )
    }
  }
  handles.networkState.networks = networks
}

const SettingsOfflineView = {
  create(context: SettingsViewContext): SettingsViewInstance {
    const styles = uiStyles()
    const content = new Container(null, {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      skin: styles.screen,
      contents: [
        new ScreenHeader({
          title: localize('settings.offlineTitle'),
          leading: 'back',
          onLeading: () => context.actions.navigate(SettingsViewId.WIFI),
        }),
        new Label(null, {
          left: 20,
          right: 20,
          top: UI.headerHeight + 18,
          height: 72,
          string: localize('settings.offlineConfirm'),
          style: styles.body,
        }),
        new ActionButton(
          {
            icon: 'back',
            label: localize('settings.cancel'),
            onTap: () => context.actions.navigate(SettingsViewId.WIFI),
          },
          { left: 8, bottom: 16, width: 148 },
        ),
        new ActionButton(
          {
            icon: 'play',
            label: localize('settings.clearAndBoot'),
            onTap: context.actions.bootOffline,
            tone: 'danger',
          },
          { left: 164, bottom: 16, width: 148 },
        ),
      ],
    })
    return { content }
  },
} satisfies SettingsViewDefinition

const SettingsPasswordView = {
  create(context: SettingsViewContext): SettingsViewInstance {
    const styles = uiStyles()
    const data: {
      context: SettingsViewContext
      password?: string
      FIELD?: { visible?: boolean }
      KEYBOARD?: { add: (content: unknown) => void; length: number; first?: unknown }
    } = { context }

    const content = new Container(data, {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      active: true,
      skin: styles.screen,
      contents: [
        new Container(null, {
          left: 0,
          right: 0,
          top: 0,
          height: PASSWORD_FIELD_TOP,
          contents: [
            new ScreenHeader({
              title: localize('settings.passwordTitle'),
              leading: 'back',
              onLeading: () => context.actions.navigate(SettingsViewId.WIFI),
            }),
            new Label(null, {
              left: 12,
              right: 12,
              top: UI.headerHeight,
              height: PASSWORD_SSID_HEIGHT,
              string: fitSSID(context.state.selectedSSID),
              style: styles.bodyMuted,
            }),
          ],
        }),
        KeyboardField(data, {
          anchor: 'FIELD',
          password: true,
          left: 12,
          right: 12,
          top: PASSWORD_FIELD_TOP,
          height: PASSWORD_FIELD_HEIGHT,
          Skin: getKeyboardFieldSkinTemplate(),
          Style: getKeyboardFieldStyleTemplate(),
          visible: false,
        }),
        new Container(data, {
          anchor: 'KEYBOARD',
          left: 0,
          right: 0,
          bottom: 0,
          height: PASSWORD_KEYBOARD_HEIGHT,
          Skin: getKeyboardFieldSkinTemplate(),
        }),
      ],
      Behavior: class extends Behavior {
        data: typeof data | null = null

        onCreate(_container: PiuContainer, viewData: typeof data) {
          this.data = viewData
          this.addKeyboard()
        }

        onTouchEnded() {
          if (this.data?.KEYBOARD && this.data.KEYBOARD.length !== 1) this.addKeyboard()
        }

        addKeyboard() {
          if (!this.data?.KEYBOARD) return
          this.data.KEYBOARD.add(
            HorizontalExpandingKeyboard(this.data, {
              style: new (getKeyboardFieldStyleTemplate())(),
              target: this.data.FIELD,
              doTransition: true,
            }),
          )
        }

        onKeyboardOK(_container: PiuContainer, password: string) {
          if (!this.data) return
          this.data.password = password
          if (this.data.FIELD) this.data.FIELD.visible = false
        }

        onKeyboardTransitionFinished(_container: PiuContainer, out: boolean) {
          if (!this.data) return
          if (out) this.data.context.actions.submitWifiPassword(this.data.password ?? '')
          else if (this.data.FIELD) this.data.FIELD.visible = true
        }
      },
    })

    return { content }
  },
} satisfies SettingsViewDefinition

const SettingsLanguageView = {
  create(context: SettingsViewContext): SettingsViewInstance {
    const styles = uiStyles()
    const choices: readonly [SupportedLocale, string][] = [
      ['ja', 'language.japanese'],
      ['en', 'language.english'],
      ['zh-CN', 'language.chineseSimplified'],
    ]
    const content = new Container(null, {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      skin: styles.screen,
      contents: [
        new ScreenHeader({
          title: localize('settings.languageTitle'),
          leading: 'back',
          onLeading: () => context.actions.navigate(SettingsViewId.MENU),
        }),
        ...choices.map(
          ([locale, key], index) =>
            new ActionButton(
              {
                icon: 'language',
                label: localize(key),
                selected: context.state.language === locale,
                onTap: () => context.actions.selectLanguage(locale),
              },
              { left: 8, right: 8, top: UI.headerHeight + 8 + index * (UI.touchTarget + 8) },
            ),
        ),
      ],
    })
    return { content }
  },
} satisfies SettingsViewDefinition

const SettingsTimezoneView = {
  create(context: SettingsViewContext): SettingsViewInstance {
    const styles = uiStyles()
    let selectedTimezone = context.state.timezone
    const choiceButtons: Array<{ id: TimezoneId; button: PiuContainer }> = []

    function selectTimezone(id: TimezoneId) {
      selectedTimezone = id
      for (const choice of choiceButtons) {
        setActionButtonSelected(choice.button, choice.id === selectedTimezone)
      }
    }

    const choices = TIMEZONE_PRESETS.map((preset) => {
      const button = new ActionButton(
        {
          name: `timezone-${preset.id}`,
          icon: 'clock',
          label: `${localize(preset.labelKey)}  ${formatUtcOffset(preset.offsetMinutes)}`,
          selected: preset.id === selectedTimezone,
          onTap: () => selectTimezone(preset.id),
        },
        { left: 8, right: 8 },
      )
      choiceButtons.push({ id: preset.id, button })
      return button
    })

    const content = new Container(null, {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      skin: styles.screen,
      contents: [
        new ScreenHeader({
          title: localize('settings.timezoneTitle'),
          leading: 'back',
          onLeading: () => context.actions.navigate(SettingsViewId.MENU),
        }),
        new Scroller(null, {
          left: 0,
          right: 0,
          top: UI.headerHeight,
          bottom: TIMEZONE_ACTION_HEIGHT,
          active: true,
          backgroundTouch: true,
          clip: true,
          Behavior: VerticalScrollerBehavior,
          contents: [
            new Column(null, {
              left: 0,
              right: 0,
              top: 0,
              contents: choices,
            }),
          ],
        }),
        new ActionButton(
          {
            name: 'timezoneSave',
            icon: 'check',
            label: localize('settings.confirm'),
            tone: 'success',
            onTap: () => context.actions.saveTimezone(selectedTimezone),
          },
          { left: 8, right: 8, bottom: 8 },
        ),
      ],
    })
    return { content }
  },
} satisfies SettingsViewDefinition

export const settingsViews: readonly SettingsViewDefinition[] = [
  SettingsMenuView,
  SettingsWifiView,
  SettingsPasswordView,
  SettingsLanguageView,
  SettingsOfflineView,
  SettingsTimezoneView,
  SettingsVolumeView,
]

type SkinTemplate = PiuSkinConstructor & { new (): PiuSkin }
type StyleTemplate = PiuStyleConstructor & { new (): PiuStyle }
