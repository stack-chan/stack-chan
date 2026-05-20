import {
  Column,
  Container,
  Content,
  Label,
  Port,
  Scroller,
  Skin,
  Style,
  Texture,
  type Application as PiuApplication,
  type Container as PiuContainer,
} from 'piu/MC'
import { KeyboardField } from 'common/keyboard'
import { HorizontalExpandingKeyboard } from 'keyboard'
import {
  createSetupState,
  maskPassword,
  reducePasswordInput,
  selectNetwork,
  showNetworks,
  signalStrengthForRssi,
} from 'setup-ui-model'
import type { SetupState, WifiDraft, WifiNetwork } from 'setup-ui-model'
import { getInitialSetupNetworks } from 'setup-ui-networks'

type SetupUIOptions = {
  application: PiuApplication
  initialNetworks?: WifiNetwork[]
  initialDraft?: WifiDraft
  onDraftChanged?: (draft: WifiDraft) => void
}

type SetupRuntime = {
  state: SetupState
  application: PiuApplication
  onDraftChanged?: (draft: WifiDraft) => void
  render: () => void
  publishDraft: () => void
}

type NetworkListData = {
  runtime: SetupRuntime
  networks: WifiNetwork[]
}

type NetworkItemData = {
  index: number
  ssid: string
  variant: number
  authentication: WifiNetwork['authentication']
}

type KeyboardData = {
  FIELD?: PiuContainer
  KEYBOARD?: PiuContainer
  runtime: SetupRuntime
}

type PiuTemplate<T, R = Content> = { new (data?: T, dictionary?: unknown): R }

const WHITE = '#ffffff'
const BLACK = '#000000'
const LIGHTEST_GRAY = '#e6e6e6'
const SEPARATOR_GRAY = '#666666'
const LIGHT_BLUE = '#0082ff'
const DIM = '#b0b0b0'

const SCREEN_HEIGHT = 240
const PASSWORD_SCREEN_TOP = 0
const PASSWORD_FIELD_TOP = 4
const PASSWORD_FIELD_HEIGHT = 30
const HORIZONTAL_KEYBOARD_HEIGHT = 164
const STACKCHAN_SCREEN_BOTTOM_SAFE_AREA = 40
const HORIZONTAL_KEYBOARD_BOTTOM = SCREEN_HEIGHT - STACKCHAN_SCREEN_BOTTOM_SAFE_AREA
const HORIZONTAL_KEYBOARD_TOP = HORIZONTAL_KEYBOARD_BOTTOM - HORIZONTAL_KEYBOARD_HEIGHT
const PASSWORD_LAYOUT_FITS = HORIZONTAL_KEYBOARD_BOTTOM <= SCREEN_HEIGHT - STACKCHAN_SCREEN_BOTTOM_SAFE_AREA
void PASSWORD_LAYOUT_FITS

let whiteSkin: Skin | null = null
let blackSkin: Skin | null = null
let selectedSkin: Skin | null = null
let separatorGraySkin: Skin | null = null
let lightBlueSkin: Skin | null = null
let fieldSkin: Skin | null = null
let titleStyle: Style | null = null
let blackStyle: Style | null = null
let dimStyle: Style | null = null
let keyboardStyle: Style | null = null

const WiFiStripTexture = Texture.template({ path: 'wifi-strip.png' })

const getWhiteSkin = () => (whiteSkin ??= new Skin({ fill: WHITE }))
const getBlackSkin = () => (blackSkin ??= new Skin({ fill: BLACK }))
const getSelectedSkin = () => (selectedSkin ??= new Skin({ fill: LIGHTEST_GRAY }))
const getSeparatorGraySkin = () => (separatorGraySkin ??= new Skin({ fill: SEPARATOR_GRAY }))
const getLightBlueSkin = () => (lightBlueSkin ??= new Skin({ fill: LIGHT_BLUE }))
const getFieldSkin = () =>
  (fieldSkin ??= new Skin({ fill: WHITE, stroke: SEPARATOR_GRAY, borders: { left: 1, right: 1, top: 1, bottom: 1 } }))
const getTitleStyle = () =>
  (titleStyle ??= new Style({ font: '20px Open Sans', color: WHITE, horizontal: 'left', vertical: 'middle' }))
const getBlackStyle = () =>
  (blackStyle ??= new Style({ font: '20px Open Sans', color: BLACK, horizontal: 'left', vertical: 'middle' }))
const getDimStyle = () =>
  (dimStyle ??= new Style({ font: '20px Open Sans', color: DIM, horizontal: 'left', vertical: 'middle' }))
const getKeyboardStyle = () =>
  (keyboardStyle ??= new Style({ font: '20px Open Sans', color: BLACK, horizontal: 'left', vertical: 'middle' }))

function getVariantFromSignalLevel(value: number) {
  const low = -120
  const high = -40
  const clamped = Math.max(low, Math.min(high, value))
  return Math.round(4 * ((clamped - low) / (high - low)))
}

const toNetworkItemData = (network: WifiNetwork, index: number): NetworkItemData => ({
  index,
  ssid: network.ssid,
  variant: getVariantFromSignalLevel(network.rssi),
  authentication: network.authentication,
})

const Header: PiuTemplate<{ title: string }> = Container.template(($: { title: string }) => ({
  active: true,
  left: 0,
  right: 0,
  top: 0,
  height: 36,
  skin: getLightBlueSkin(),
  style: getTitleStyle(),
  contents: [new Label(null, { left: 12, right: 8, top: 0, bottom: 0, style: getTitleStyle(), string: $.title })],
}))

class HomeBehavior extends Behavior {
  runtime!: SetupRuntime

  onCreate(_container: PiuContainer, data: SetupRuntime) {
    this.runtime = data
  }

  onTouchEnded() {
    this.runtime.state = showNetworks(this.runtime.state)
    this.runtime.render()
  }
}

const HomeScreen: PiuTemplate<SetupRuntime> = Container.template(($: SetupRuntime) => ({
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
  skin: getBlackSkin(),
  active: true,
  Behavior: HomeBehavior,
  contents: [
    new Header({ title: 'Stack-chan Setup' }),
    new Column(null, {
      left: 12,
      right: 12,
      top: 58,
      contents: [
        new Label(null, {
          left: 0,
          right: 0,
          height: 28,
          style: getTitleStyle(),
          string: $.state.draft.ssid ? `SSID: ${$.state.draft.ssid}` : 'Wi-Fi not configured',
        }),
        new Label(null, {
          left: 0,
          right: 0,
          height: 28,
          style: getTitleStyle(),
          string: $.state.status === 'draft-ready' ? 'Draft ready for later Preference.set' : 'Tap to choose network',
        }),
        new Label(null, { left: 0, right: 0, height: 40, style: getTitleStyle(), string: 'Networks' }),
        new Label(null, {
          left: 0,
          right: 0,
          height: 32,
          style: getTitleStyle(),
          string: $.state.draft.password ? `Password: ${maskPassword($.state.draft.password)}` : 'Password: not set',
        }),
      ],
    }),
  ],
}))

class VerticalScrollerBehavior extends Behavior {
  anchor = 0
  y = 0
  waiting = false

  onTouchBegan(scroller: Scroller, _id: number, _x: number, y: number) {
    this.anchor = scroller.scroll.y
    this.y = y
    this.waiting = true
  }

  onTouchMoved(scroller: Scroller, id: number, x: number, y: number, ticks: number) {
    const delta = y - this.y
    if (this.waiting) {
      if (Math.abs(delta) < 8) return
      this.waiting = false
      scroller.captureTouch(id as unknown as string, x, y, ticks)
    }
    scroller.scrollTo(0, this.anchor - delta)
  }
}

const Separator = Content.template(() => ({
  name: 'SEPARATOR',
  left: 0,
  right: 0,
  top: 0,
  height: 1,
  skin: getSeparatorGraySkin(),
}))

class ListItemBehavior extends Behavior {
  data!: NetworkItemData & { state: number; xOffset: number; yOffset: number }
  startY = 0

  onCreate(_port: Port, data: NetworkItemData) {
    this.data = {
      ...data,
      xOffset: Math.max(0, data.variant) * 28,
      yOffset: data.authentication === 'open' ? 0 : 27,
      state: 0,
    }
  }

  onDraw(port: Port) {
    port.fillColor(this.data.state ? LIGHTEST_GRAY : WHITE, 0, 0, port.width, port.height)
    port.drawString(this.data.ssid, getBlackStyle(), BLACK, 32, 8, 210, port.height)
    port.drawTexture(new WiFiStripTexture(), BLACK, 276, 6, this.data.xOffset, this.data.yOffset, 28, 28)
  }

  onTouchBegan(port: Port, _id: number, _x: number, y: number) {
    this.data.state = 1
    port.invalidate()
    this.startY = y
  }

  onTouchCancelled(port: Port) {
    this.data.state = 0
    port.invalidate()
  }

  onTouchEnded(port: Port) {
    this.data.state = 0
    port.invalidate()
    port.bubble('onNetworkSelected', this.data.index)
  }
}

const ListItemTemplate: PiuTemplate<NetworkItemData> = Port.template(() => ({
  active: true,
  left: 0,
  right: 0,
  height: 40,
  Behavior: ListItemBehavior,
}))

class NetworkListScreenColumnBehavior extends Behavior {
  onCreate(column: Column, data: NetworkListData) {
    this.onUpdateNetworkList(column, data.networks)
  }

  onUpdateNetworkList(column: Column, networks: WifiNetwork[]) {
    column.empty()
    networks.forEach((network, index) => {
      column.add(new ListItemTemplate(toNetworkItemData(network, index)))
      column.add(new Separator(null))
    })
    column.add(new Content(null, { height: 40 }))
  }
}

class NetworkListBehavior extends Behavior {
  runtime!: SetupRuntime

  onCreate(_container: PiuContainer, data: NetworkListData) {
    this.runtime = data.runtime
  }

  onNetworkSelected(_container: PiuContainer, index: number) {
    const network = this.runtime.state.networks[index]
    if (!network) return
    this.runtime.state = selectNetwork(this.runtime.state, network.ssid)
    this.runtime.publishDraft()
    this.runtime.render()
  }
}

const NetworkListScreen: PiuTemplate<NetworkListData> = Container.template(($: NetworkListData) => ({
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
  skin: getWhiteSkin(),
  Behavior: NetworkListBehavior,
  contents: [
    new Scroller(null, {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      active: true,
      backgroundTouch: true,
      clip: true,
      Behavior: VerticalScrollerBehavior,
      contents: [
        new Column($, {
          left: 0,
          right: 0,
          top: 36,
          clip: true,
          Behavior: NetworkListScreenColumnBehavior,
        }),
      ],
    }),
    new Header({ title: 'Networks' }),
  ],
}))

const TRANSITION = true

const KeyboardContainer: PiuTemplate<KeyboardData, Column> = Column.template(($: KeyboardData) => ({
  left: 0,
  right: 0,
  top: PASSWORD_SCREEN_TOP,
  bottom: 0,
  active: true,
  contents: [
    new KeyboardField($, {
      anchor: 'FIELD',
      password: true,
      left: 12,
      right: 12,
      top: PASSWORD_FIELD_TOP,
      height: PASSWORD_FIELD_HEIGHT,
      skin: getFieldSkin(),
      style: getBlackStyle(),
      visible: true,
    }),
    new Container($, {
      anchor: 'KEYBOARD',
      left: 0,
      right: 0,
      top: HORIZONTAL_KEYBOARD_TOP,
      height: HORIZONTAL_KEYBOARD_HEIGHT,
      skin: getWhiteSkin(),
    }),
  ],
  Behavior: class extends Behavior {
    data!: KeyboardData

    onCreate(_column: Column, data: KeyboardData) {
      this.data = data
      this.addKeyboard()
    }

    onTouchEnded() {
      if (this.data.KEYBOARD && this.data.KEYBOARD.length !== 1) this.addKeyboard()
    }

    addKeyboard() {
      if (!this.data.KEYBOARD || !this.data.FIELD) return
      this.data.KEYBOARD.add(
        HorizontalExpandingKeyboard(this.data, {
          style: getKeyboardStyle(),
          target: this.data.FIELD,
          doTransition: TRANSITION,
        }),
      )
    }
  },
}))

class LoginScreenBehavior extends Behavior {
  runtime!: SetupRuntime
  password = ''

  onCreate(_column: Column, data: KeyboardData) {
    this.runtime = data.runtime
  }

  onKeyboardOK(_column: Column, string: string) {
    this.password = string
    for (const character of string) this.runtime.state = reducePasswordInput(this.runtime.state, character)
    this.runtime.state = reducePasswordInput(this.runtime.state, 'ok')
    this.runtime.publishDraft()
    this.runtime.render()
  }

  onKeyboardTransitionFinished(_column: Column, out: boolean) {
    if (out) return
  }
}

const LoginScreen: PiuTemplate<KeyboardData, Column> = Column.template(($: KeyboardData) => ({
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
  skin: getWhiteSkin(),
  contents: [new KeyboardContainer($)],
  Behavior: LoginScreenBehavior,
}))

function buildRuntime(options: SetupUIOptions): SetupRuntime {
  const networks = options.initialNetworks ?? getInitialSetupNetworks()
  const runtime: SetupRuntime = {
    state: { ...createSetupState(networks), draft: options.initialDraft ?? {} },
    application: options.application,
    onDraftChanged: options.onDraftChanged,
    render: () => {},
    publishDraft: () => {
      if (runtime.state.draft.ssid !== undefined) runtime.onDraftChanged?.(runtime.state.draft)
    },
  }

  runtime.render = () => {
    runtime.application.empty()
    runtime.application.skin = runtime.state.view === 'home' ? getBlackSkin() : getWhiteSkin()
    if (runtime.state.view === 'networks') {
      runtime.application.add(new NetworkListScreen({ runtime, networks: runtime.state.networks }))
      return
    }
    if (runtime.state.view === 'password') {
      runtime.application.add(new LoginScreen({ runtime }))
      return
    }
    runtime.application.add(new HomeScreen(runtime))
  }

  return runtime
}

export function showSetupUI(options: SetupUIOptions) {
  const runtime = buildRuntime(options)
  runtime.application.behavior = new (class extends Behavior {
    onTouchEnded() {
      if (runtime.state.view !== 'home') return
      runtime.state = showNetworks(runtime.state)
      runtime.render()
    }
  })()
  runtime.render()

  return {
    getState: () => runtime.state,
    showNetworks: () => {
      runtime.state = showNetworks(runtime.state)
      runtime.render()
    },
    selectNetwork: (ssid: string) => {
      runtime.state = selectNetwork(runtime.state, ssid)
      runtime.publishDraft()
      runtime.render()
    },
    inputPassword: (input: string) => {
      runtime.state = reducePasswordInput(runtime.state, input)
      runtime.publishDraft()
      runtime.render()
    },
  }
}
