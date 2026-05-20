import { getWasmFakeNetworks } from 'setup-ui-model'
import type { WifiNetwork } from 'setup-ui-model'

export const getInitialSetupNetworks = (): WifiNetwork[] => getWasmFakeNetworks()
