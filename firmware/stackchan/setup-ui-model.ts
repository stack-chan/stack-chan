export type WifiAuthentication = 'open' | 'wep' | 'wpa' | 'wpa2' | 'wpa3'

export type WifiNetwork = {
  ssid: string
  rssi: number
  authentication: WifiAuthentication
}

export type WifiDraft = {
  ssid?: string
  password?: string
}

export type SetupView = 'home' | 'networks' | 'password'

export type SetupStatus = 'idle' | 'select-network' | 'enter-password' | 'draft-ready'

export type SetupState = {
  view: SetupView
  status: SetupStatus
  networks: WifiNetwork[]
  selectedNetwork?: WifiNetwork
  passwordInput: string
  draft: WifiDraft
}

export type PasswordInput = 'backspace' | 'ok' | string

export const getWasmFakeNetworks = (): WifiNetwork[] => [
  { ssid: 'StackChan-Open', rssi: -44, authentication: 'open' },
  { ssid: 'StackChan-Secure', rssi: -63, authentication: 'wpa2' },
  { ssid: 'Workshop-WiFi', rssi: -78, authentication: 'wpa3' },
]

export const signalStrengthForRssi = (rssi: number): 0 | 1 | 2 | 3 => {
  if (rssi >= -55) return 3
  if (rssi >= -70) return 2
  if (rssi >= -82) return 1
  return 0
}

export const isOpenNetwork = (network: WifiNetwork): boolean => network.authentication === 'open'

export const maskPassword = (password: string): string => password.replace(/./g, '*')

export const createSetupState = (networks: WifiNetwork[] = []): SetupState => ({
  view: 'home',
  status: 'idle',
  networks,
  passwordInput: '',
  draft: {},
})

export const showNetworks = (state: SetupState): SetupState => ({
  ...state,
  view: 'networks',
  status: 'select-network',
  selectedNetwork: undefined,
  passwordInput: '',
})

export const selectNetwork = (state: SetupState, ssid: string): SetupState => {
  const selectedNetwork = state.networks.find((network) => network.ssid === ssid)
  if (!selectedNetwork) return state

  if (isOpenNetwork(selectedNetwork)) {
    return {
      ...state,
      view: 'home',
      status: 'draft-ready',
      selectedNetwork,
      passwordInput: '',
      draft: {
        ssid: selectedNetwork.ssid,
        password: '',
      },
    }
  }

  return {
    ...state,
    view: 'password',
    status: 'enter-password',
    selectedNetwork,
    passwordInput: '',
  }
}

export const reducePasswordInput = (state: SetupState, input: PasswordInput): SetupState => {
  if (state.view !== 'password' || !state.selectedNetwork) return state

  if (input === 'ok' || input === '\r') {
    return {
      ...state,
      view: 'home',
      status: 'draft-ready',
      draft: {
        ssid: state.selectedNetwork.ssid,
        password: state.passwordInput,
      },
    }
  }

  if (input === 'backspace' || input === '\b') {
    return {
      ...state,
      passwordInput: state.passwordInput.slice(0, -1),
    }
  }

  return {
    ...state,
    passwordInput: state.passwordInput + input,
  }
}
