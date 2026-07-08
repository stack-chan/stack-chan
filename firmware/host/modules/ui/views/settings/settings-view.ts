import { KeyboardField } from 'common/keyboard'
import { HorizontalExpandingKeyboard } from 'keyboard'
import type {
  Application as PiuApplication,
  Column as PiuColumn,
  Container as PiuContainer,
  Content as PiuContent,
  Label as PiuLabel,
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

export const SettingsStatusValue = SettingsStatusValueConst
export const settingsStatusToLabel = settingsStatusToLabelImpl
export type SettingsStatusValue = SettingsStatusValueModel
export type { SettingsStatus }

export type SettingsStatusLabels = {
  wifi: PiuLabel
  scan: PiuLabel
  list: PiuColumn
  networkState: {
    networks: SettingsNetworkEntry[]
  }
  options: SettingsViewOptions
}

export type SettingsViewOptions = {
  onScan?: () => void
  onSelectNetwork?: (network: SettingsNetworkEntry) => void
}

export type SettingsPasswordViewOptions = {
  onBack?: () => void
  onPassword?: (password: string) => void
}

const CONTENT_TOP = 8
const SCREEN_WIDTH = 320
const HEADER_HEIGHT = 36
const STATUS_ROW_HEIGHT = 24
const NETWORK_ROW_HEIGHT = 40
const SCAN_TOUCH_TOP = CONTENT_TOP + HEADER_HEIGHT + STATUS_ROW_HEIGHT
const SCAN_TOUCH_BOTTOM = SCAN_TOUCH_TOP + STATUS_ROW_HEIGHT
const NETWORK_LIST_TOP = SCAN_TOUCH_BOTTOM + 6
const PASSWORD_HEADER_HEIGHT = 46
const PASSWORD_TITLE_HEIGHT = 26
const PASSWORD_SSID_HEIGHT = 20
const PASSWORD_KEYBOARD_HEIGHT = 164

let screenSkin: PiuSkin | null = null
let rowPressedSkin: PiuSkin | null = null
let titleStyle: PiuStyle | null = null
let labelStyle: PiuStyle | null = null
let networkStyle: PiuStyle | null = null
let keyboardFieldSkinTemplate: SkinTemplate | null = null
let keyboardFieldStyleTemplate: StyleTemplate | null = null

function getScreenSkin() {
  if (!screenSkin) screenSkin = new Skin({ fill: '#000000' })
  return screenSkin
}

function getRowPressedSkin() {
  if (!rowPressedSkin) rowPressedSkin = new Skin({ fill: '#202020' })
  return rowPressedSkin
}

function getTitleStyle() {
  if (!titleStyle) {
    titleStyle = new Style({
      font: '20px Open Sans',
      color: '#ffffff',
      horizontal: 'left',
      vertical: 'middle',
    })
  }
  return titleStyle
}

function getLabelStyle() {
  if (!labelStyle) {
    labelStyle = new Style({
      font: '16px Open Sans',
      color: '#ffffff',
      horizontal: 'left',
      vertical: 'middle',
    })
  }
  return labelStyle
}

function getNetworkStyle() {
  if (!networkStyle) {
    networkStyle = new Style({
      font: '18px Open Sans',
      color: '#ffffff',
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
    port.fillColor(index < bars ? '#ffffff' : '#505050', x + index * 6, y + 18 - height, 4, height)
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
  options: SettingsViewOptions
  moved?: boolean
  startY?: number
}

export const buildSettingsView = (
  application: PiuApplication,
  status: SettingsStatus,
  options: SettingsViewOptions = {},
): SettingsStatusLabels => {
  const networkState = {
    networks: [] as SettingsNetworkEntry[],
  }
  const labels: SettingsStatusLabels = {
    wifi: new Label(null, { left: 0, right: 0, height: STATUS_ROW_HEIGHT, style: getLabelStyle() }),
    scan: new Label(null, { left: 0, right: 0, height: STATUS_ROW_HEIGHT, style: getLabelStyle() }),
    list: new Column(null, { left: 0, width: SCREEN_WIDTH, top: 0 }),
    networkState,
    options,
  }

  application.empty()
  application.skin = getScreenSkin()
  application.add(
    new Container(
      { options, networkState },
      {
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        active: true,
        contents: [
          new Column(null, {
            left: 10,
            right: 10,
            top: CONTENT_TOP,
            contents: [
              new Label(null, {
                left: 0,
                right: 0,
                height: HEADER_HEIGHT,
                string: 'Wi-Fi Setup',
                style: getTitleStyle(),
              }),
              labels.wifi,
              labels.scan,
            ],
          }),
          new Scroller(null, {
            left: 0,
            right: 0,
            top: NETWORK_LIST_TOP,
            bottom: 0,
            active: true,
            backgroundTouch: true,
            clip: true,
            Behavior: VerticalScrollerBehavior,
            contents: [labels.list],
          }),
        ],
        Behavior: class extends Behavior {
          options: SettingsViewOptions | null = null

          onCreate(
            _container: PiuContainer,
            data: { options: SettingsViewOptions; networkState: { networks: SettingsNetworkEntry[] } },
          ) {
            this.options = data.options
          }

          onTouchEnded(_container: PiuContainer, _id?: number, _x?: number, y?: number) {
            if (typeof y === 'number' && y >= SCAN_TOUCH_TOP && y < SCAN_TOUCH_BOTTOM) {
              this.options?.onScan?.()
            }
          }
        },
      },
    ),
  )
  updateSettingsStatusLabels(labels, status)
  updateSettingsNetworkLabels(labels, [])
  return labels
}

export const updateSettingsStatusLabels = (labels: SettingsStatusLabels, status: SettingsStatus): void => {
  labels.wifi.string = `Wi-Fi: ${settingsStatusToLabel(status.wifi)}`
  labels.scan.string = status.wifi === SettingsStatusValue.SCANNING ? 'Scanning...' : 'Scan Wi-Fi'
}

export const updateSettingsNetworkLabels = (
  labels: SettingsStatusLabels,
  networks: readonly SettingsNetworkEntry[],
): void => {
  labels.list.empty()
  if (networks.length === 0) {
    labels.list.add(
      new Label(null, {
        left: 10,
        right: 10,
        height: NETWORK_ROW_HEIGHT,
        string: 'No networks scanned',
        style: getLabelStyle(),
      }),
    )
  } else {
    for (const network of networks) {
      const data: NetworkRowData = { network, options: labels.options }
      labels.list.add(
        new Port(data, {
          left: 0,
          width: SCREEN_WIDTH,
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
              this.data.options.onSelectNetwork?.(this.data.network)
            }

            onDraw(port: PiuPort) {
              if (!this.data) return
              port.fillColor('#000000', 0, 0, port.width, port.height)
              port.fillColor('#303030', 0, port.height - 1, port.width, 1)
              drawSignalIcon(port, this.data.network.signal, 10, 11)
              port.drawString(this.data.network.ssid, getNetworkStyle(), '#ffffff', 42, 4, SCREEN_WIDTH - 52, 32)
            }
          },
        }),
      )
    }
  }
  labels.networkState.networks = [...networks]
}

export const buildSettingsPasswordView = (
  application: PiuApplication,
  ssid: string,
  options: SettingsPasswordViewOptions = {},
): void => {
  const data: {
    options: SettingsPasswordViewOptions
    password?: string
    FIELD?: { visible?: boolean }
    KEYBOARD?: { add: (content: unknown) => void; length: number; first?: unknown }
  } = { options }

  application.empty()
  application.skin = getScreenSkin()
  application.add(
    new Column(data, {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      active: true,
      skin: getScreenSkin(),
      contents: [
        new Container(null, {
          left: 0,
          right: 0,
          height: PASSWORD_HEADER_HEIGHT,
          active: true,
          contents: [
            new Label(null, {
              left: 10,
              right: 10,
              height: PASSWORD_TITLE_HEIGHT,
              string: 'Wi-Fi Password',
              style: getTitleStyle(),
            }),
            new Label(null, {
              left: 10,
              right: 10,
              top: PASSWORD_TITLE_HEIGHT,
              height: PASSWORD_SSID_HEIGHT,
              string: `SSID: ${ssid}`,
              style: getLabelStyle(),
            }),
          ],
          Behavior: class extends Behavior {
            onTouchEnded() {
              options.onBack?.()
            }
          },
        }),
        KeyboardField(data, {
          anchor: 'FIELD',
          password: true,
          left: 32,
          right: 0,
          top: 0,
          bottom: 0,
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

        onCreate(_column: PiuColumn, viewData: typeof data) {
          this.data = viewData
          this.addKeyboard()
        }

        onTouchEnded() {
          if (this.data?.KEYBOARD && this.data.KEYBOARD.length !== 1) {
            this.addKeyboard()
          }
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

        onKeyboardOK(_column: PiuColumn, password: string) {
          if (!this.data) return
          this.data.password = password
          if (this.data.FIELD) this.data.FIELD.visible = false
        }

        onKeyboardTransitionFinished(_column: PiuColumn, out: boolean) {
          if (!this.data) return
          if (out) {
            this.data.options.onPassword?.(this.data.password ?? '')
          } else if (this.data.FIELD) {
            this.data.FIELD.visible = true
          }
        }
      },
    }),
  )
}
type SkinTemplate = PiuSkinConstructor & { new (): PiuSkin }
type StyleTemplate = PiuStyleConstructor & { new (): PiuStyle }
