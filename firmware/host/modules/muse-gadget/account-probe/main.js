import { AccountSession, pairingSelftest } from 'muse-pairing-native'
import { createDeviceAccountNetwork } from 'muse-setup/device-account-network'
import Timer from 'timer'

let account, network
const allowed = [
  'wifi_connecting',
  'wifi_connected',
  'wifi_failed',
  'wifi_reason_none',
  'wifi_reason_ap_not_found',
  'wifi_reason_auth',
  'wifi_reason_handshake',
  'wifi_reason_timeout',
  'wifi_reason_other',
  'ntp_start',
  'ntp_ready',
  'ntp_failed',
  'ntp_create_ready',
  'ntp_create_failed',
  'ntp_query_failed',
  'ntp_reply_failed',
  'ntp_reply_invalid',
  'clock_failed',
]
const report = (value) => {
  if (allowed.includes(value)) trace(`MUSE_PROBE ${value}\n`)
}
const failures = new Set([
  'account invalid',
  'account cancelled',
  'account approval required',
  'account storage failed',
  'account HTTP failed',
  'account access denied',
  'account refresh rejected',
  'account response invalid',
  'account busy',
  'account access expired',
  'account worker unavailable',
  'account owner expired',
  'account worker result unavailable',
  'account HTTP clock',
  'account HTTP input',
  'account HTTP privacy',
  'account HTTP allocation',
  'account HTTP configuration',
  'account HTTP cancelled',
  'account HTTP deadline',
  'account HTTP redirect',
  'account HTTP response limit',
  'account HTTP transport',
  'account HTTP unsupported transport',
  'account HTTP SDK unavailable',
  'account HTTP DNS',
  'account HTTP socket',
  'account HTTP connect',
  'account HTTP connect timeout',
  'account HTTP certificate',
  'account HTTP TLS handshake',
  'account HTTP TLS IO',
  'account HTTP TLS setup',
])
async function run() {
  let stage = 'restore'
  try {
    const checks = pairingSelftest()
    if (!checks.counter || !checks.crypto) throw Error('selftest')
    account = AccountSession.restore()
    trace('MUSE_PROBE account_restored\n')
    network = createDeviceAccountNetwork(report, report)
    stage = 'network'
    await network.prepare(account, account.generation)
    trace('MUSE_PROBE network_ready\n')
    stage = 'account'
    const result = await account.connectApproved(account.generation)
    trace(result?.prepared === true ? 'MUSE_PROBE account_ready\n' : 'MUSE_PROBE account_failed\n')
  } catch (error) {
    if (failures.has(error?.message)) trace(`MUSE_PROBE ${error.message.replaceAll(' ', '_')}\n`)
    trace(`MUSE_PROBE ${stage}_failed\n`)
  } finally {
    network?.close()
    account?.close()
    trace('MUSE_PROBE closed\n')
  }
}
Timer.set(() => void run(), 1000)
