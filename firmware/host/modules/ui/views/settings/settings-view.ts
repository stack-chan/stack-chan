import { KeyboardField } from 'common/keyboard'
import { HorizontalExpandingKeyboard } from 'keyboard'
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
import { ActionButton, ScreenHeader, setActionButtonEnabled, setActionButtonLabel } from 'ui-controls'
import { UI, uiStyles } from 'ui-theme'

export const SettingsStatusValue = SettingsStatusValueConst
export const settingsStatusToLabel = settingsStatusToLabelImpl
export type SettingsStatusValue = SettingsStatusValueModel
export type { SettingsStatus }

export const SettingsViewId = Object.freeze({
  MENU: 0,
  WIFI: 1,
  PASSWORD: 2,
} as const)

export type SettingsViewId = (typeof SettingsViewId)[keyof typeof SettingsViewId]
export type SettingsApplication = PiuApplication

export type SettingsViewState = Readonly<{
  status: SettingsStatus
  networks: readonly SettingsNetworkEntry[]
  selectedSSID: string
}>

export type SettingsViewActions = Readonly<{
  exit(): void
  boot(): void
  navigate(view: SettingsViewId): void
  scanWifi(): void
  cancelWifiScan(): void
  selectWifiNetwork(network: SettingsNetworkEntry): void
  submitWifiPassword(password: string): void
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
  list: PiuColumn
  networkState: {
    networks: SettingsNetworkEntry[]
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

let rowPressedSkin: PiuSkin | null = null
let networkStyle: PiuStyle | null = null
let keyboardFieldSkinTemplate: SkinTemplate | null = null
let keyboardFieldStyleTemplate: StyleTemplate | null = null

function getRowPressedSkin() {
  if (!rowPressedSkin) rowPressedSkin = new Skin({ fill: UI.colors.surfacePressed })
  return rowPressedSkin
}

function getNetworkStyle() {
  if (!networkStyle) {
    networkStyle = new Style({
      font: 'k8x12-12',
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
        new ScreenHeader({ title: '設定', leading: 'back', onLeading: context.actions.exit }),
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
                    label: 'Wi-Fi設定',
                    onTap: () => context.actions.navigate(SettingsViewId.WIFI),
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

const SettingsWifiView = {
  create(context: SettingsViewContext): SettingsViewInstance {
    const styles = uiStyles()
    const networkState = { networks: [] as SettingsNetworkEntry[] }
    const scan = new ActionButton(
      { icon: 'scan', label: 'スキャン', onTap: context.actions.scanWifi },
      { left: 8, top: ACTION_TOP, width: 148 },
    )
    const boot = new ActionButton(
      {
        icon: 'play',
        label: '起動',
        onTap: context.actions.boot,
        enabled: false,
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
          title: 'Wi-Fi設定',
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
  handles.wifi.string = `Wi-Fi: ${settingsStatusToLabel(status.wifi)}`
  const scanning = status.wifi === SettingsStatusValue.SCANNING
  setActionButtonLabel(handles.scan, scanning ? 'スキャン中' : 'スキャン')
  setActionButtonEnabled(handles.scan, !scanning)
  setActionButtonEnabled(handles.boot, status.wifi === SettingsStatusValue.CONNECTED)
}

function updateSettingsNetworks(handles: SettingsWifiViewHandles, networks: readonly SettingsNetworkEntry[]) {
  const styles = uiStyles()
  handles.list.empty()
  if (networks.length === 0) {
    handles.list.add(
      new Label(null, {
        left: 12,
        right: 12,
        height: NETWORK_ROW_HEIGHT,
        string: 'ネットワークなし',
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
  handles.networkState.networks = [...networks]
}

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
              title: 'Wi-Fiパスワード',
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

export const settingsViews: readonly SettingsViewDefinition[] = [
  SettingsMenuView,
  SettingsWifiView,
  SettingsPasswordView,
]

type SkinTemplate = PiuSkinConstructor & { new (): PiuSkin }
type StyleTemplate = PiuStyleConstructor & { new (): PiuStyle }
