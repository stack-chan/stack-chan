import PairingNative from 'muse-pairing-native'
import { createPairingPeripheral } from 'muse-pairing/peripheral'
import { createReceiver, frameRecord } from 'muse-pairing/framing'

const source = new Uint8Array([123, 125])
const rx = createReceiver()
let result
for (const frame of frameRecord(source)) result = rx.push(frame)
if (
  typeof PairingNative !== 'function' ||
  typeof createPairingPeripheral !== 'function' ||
  result?.length !== 2 ||
  result[0] !== 123
)
  throw new Error('fixture_failed')
const native = new PairingNative({
  nodeId: 'fixture-node',
  deviceId: 'fixture-device',
  mac: '00:00:00:00:00:00',
  firmwareVersion: 'fixture-only',
})
try {
  if (JSON.parse(native.info()).type !== 'device_info') throw new Error('fixture_failed')
  native.reset()
} finally {
  native.close()
}
trace('MUSE_PAIRING fixture_pass radio_not_started\n')
