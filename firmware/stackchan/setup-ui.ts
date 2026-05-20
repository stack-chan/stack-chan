import { Column, Container, Label, Skin, Style } from 'piu/MC'
import type { Application as PiuApplication, Container as PiuContainer, Label as PiuLabel } from 'piu/MC'
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

type SetupLabels = {
  title: PiuLabel
  status: PiuLabel
  detail: PiuLabel
  rows: PiuLabel[]
}

let screenSkin: Skin | null = null
let selectedSkin: Skin | null = null
let titleStyle: Style | null = null
let labelStyle: Style | null = null
let dimStyle: Style | null = null

const getScreenSkin = () => {
  if (!screenSkin) screenSkin = new Skin({ fill: '#000000' })
  return screenSkin
}

const getSelectedSkin = () => {
  if (!selectedSkin) selectedSkin = new Skin({ fill: '#202020' })
  return selectedSkin
}

const getTitleStyle = () => {
  if (!titleStyle) titleStyle = new Style({ font: '24px Open Sans', color: '#ffffff', horizontal: 'left' })
  return titleStyle
}

const getLabelStyle = () => {
  if (!labelStyle) labelStyle = new Style({ font: '24px Open Sans', color: '#ffffff', horizontal: 'left' })
  return labelStyle
}

const getDimStyle = () => {
  if (!dimStyle) dimStyle = new Style({ font: '24px Open Sans', color: '#b0b0b0', horizontal: 'left' })
  return dimStyle
}

const signalIcon = (network: WifiNetwork): string => {
  const bars = signalStrengthForRssi(network.rssi)
  return ['.', '|', '||', '|||'][bars]
}

const formatNetwork = (network: WifiNetwork): string =>
  `${signalIcon(network)} ${network.ssid} ${network.authentication === 'open' ? 'open' : 'locked'}`

const buildScreen = (state: SetupState): { container: PiuContainer; labels: SetupLabels } => {
  const labels: SetupLabels = {
    title: new Label(null, { left: 0, right: 0, height: 24, style: getTitleStyle() }),
    status: new Label(null, { left: 0, right: 0, height: 22, style: getLabelStyle() }),
    detail: new Label(null, { left: 0, right: 0, height: 20, style: getDimStyle() }),
    rows: [],
  }
  const rows = new Column(null, { left: 0, right: 0, top: 74, contents: [] })
  const container = new Container(null, {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    contents: [
      new Column(null, {
        left: 10,
        right: 10,
        top: 8,
        contents: [labels.title, labels.status, labels.detail],
      }),
      rows,
    ],
  })

  const rowCount = state.view === 'networks' ? Math.min(state.networks.length, 5) : 4
  for (let index = 0; index < rowCount; index += 1) {
    const rowIndex = index
    const rowOptions = {
      left: 10,
      right: 10,
      height: 28,
      active: true,
      style: getLabelStyle(),
      Behavior: class extends Behavior {
        onTouchEnded(label: PiuLabel) {
          label.bubble('onSetupRowSelected', rowIndex)
        }
      },
    }
    const row = new Label(index, state.view === 'networks' ? { ...rowOptions, skin: getSelectedSkin() } : rowOptions)
    labels.rows.push(row)
    rows.add(row)
  }

  return { container, labels }
}

const updateLabels = (labels: SetupLabels, state: SetupState) => {
  labels.title.string = 'Stack-chan Setup'
  labels.rows.forEach((row) => {
    row.string = ''
  })

  if (state.view === 'networks') {
    labels.status.string = 'Select Wi-Fi'
    labels.detail.string = 'Open networks skip password'
    state.networks.slice(0, labels.rows.length).forEach((network, index) => {
      labels.rows[index].string = formatNetwork(network)
    })
    return
  }

  if (state.view === 'password') {
    labels.status.string = `Password: ${state.selectedNetwork?.ssid ?? ''}`
    labels.detail.string = maskPassword(state.passwordInput)
    labels.rows[0].string = 'Type keys, Enter OK'
    labels.rows[1].string = 'Backspace deletes'
    return
  }

  labels.status.string = state.draft.ssid ? `SSID: ${state.draft.ssid}` : 'Wi-Fi not configured'
  labels.detail.string =
    state.status === 'draft-ready' ? 'Draft ready for later Preference.set' : 'Tap to choose network'
  labels.rows[0].string = 'Networks'
  labels.rows[1].string = state.draft.password ? `Password: ${maskPassword(state.draft.password)}` : 'Password: not set'
}

export function showSetupUI(options: SetupUIOptions) {
  const networks = options.initialNetworks ?? getInitialSetupNetworks()
  let state = { ...createSetupState(networks), draft: options.initialDraft ?? {} }
  let screen = buildScreen(state)

  const render = () => {
    options.application.empty()
    options.application.skin = getScreenSkin()
    screen = buildScreen(state)
    options.application.add(screen.container)
    updateLabels(screen.labels, state)
  }

  const publishDraft = () => {
    if (state.draft.ssid !== undefined) options.onDraftChanged?.(state.draft)
  }

  options.application.behavior = new (class extends Behavior {
    onSetupRowSelected(_application: PiuApplication, index: number) {
      if (state.view === 'home') {
        state = showNetworks(state)
        render()
        return
      }
      if (state.view !== 'networks') return
      const network = state.networks[index]
      if (!network) return
      state = selectNetwork(state, network.ssid)
      publishDraft()
      render()
    }

    onKeyUp(_application: PiuApplication, key: string) {
      state = reducePasswordInput(state, key)
      publishDraft()
      render()
    }

    onTouchEnded() {
      if (state.view === 'home') {
        state = showNetworks(state)
        render()
      }
    }
  })()

  render()

  return {
    getState: () => state,
    showNetworks: () => {
      state = showNetworks(state)
      render()
    },
    selectNetwork: (ssid: string) => {
      state = selectNetwork(state, ssid)
      publishDraft()
      render()
    },
    inputPassword: (input: string) => {
      state = reducePasswordInput(state, input)
      publishDraft()
      render()
    },
  }
}
