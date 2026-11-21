import BLEServer from 'bleserver'
import { startDeviceWiFiScan } from './device-wifi-scan.js'
import { uuid } from 'btutils'
import TextDecoder from 'text/decoder'
import TextEncoder from 'text/encoder'
import Timer from 'timer'
import checkedNotify from './notify.js'
import { createPairingSession } from './session.js'

const service = uuid`7fdd3d1c-38ea-46cf-8b46-314ecf5f240c`

// Construction starts the radio; callers must obtain permission before calling this factory.
export function createPairingPeripheral({
  native,
  name,
  setupComplete,
  onConfirmation,
  onProvision,
  onState,
  onReady = () => {},
}) {
  if (setupComplete !== false) throw new Error('pairing_unavailable')
  if (typeof name !== 'string' || new TextEncoder().encode(name).length > 29) throw new Error('invalid_name')
  class Peripheral extends BLEServer {
    onReady() {
      this.deviceName = name
      this.ready = true
      onReady()
    }
    onConnected(client) {
      trace('MUSE_PAIR ble_connected\n')
      this.stopAdvertising()
      this.connected = true
      this.connection = client.connection
    }
    onDisconnected() {
      trace('MUSE_PAIR ble_disconnected\n')
      this.connected = false
      this.connection = undefined
      this.tx = undefined
      this.session?.disconnect()
    }
    onMTUExchanged(mtu) {
      this.session?.setMTU(mtu)
    }
    onCharacteristicNotifyEnabled(characteristic) {
      if (characteristic.name === 'pairingTx') {
        this.tx = characteristic
        trace('MUSE_PAIR subscribed\n')
      }
    }
    onCharacteristicNotifyDisabled() {
      this.tx = undefined
      this.session?.disconnect()
    }
    onCharacteristicWritten(characteristic, value) {
      if (characteristic.name === 'pairingRx' && this.tx) void this.session.receive(value)
    }
    onCharacteristicRead() {
      return new TextEncoder().encode(this.session?.readStatus() ?? 'idle').buffer
    }
  }
  const peripheral = new Peripheral()
  const session = createPairingSession({
    native,
    startScan: startDeviceWiFiScan,
    onDiagnostic(value) {
      if (
        [
          'frame_rejected',
          'busy_rejected',
          'hello_received',
          'encrypted_received',
          'info_received',
          'failed_decode',
          'failed_hello',
          'failed_encrypted',
          'failed_decrypt',
          'failed_finished_check',
          'failed_status_create',
          'failed_status_send',
          'failed_arm',
          'native_phase',
          'decrypt_expired',
          'decrypt_state',
          'decrypt_envelope',
          'decrypt_session',
          'decrypt_counter',
          'decrypt_memory',
          'decrypt_base64',
          'decrypt_aead',

          'native_decrypt',
          'native_command',
          'native_expired',
          'native_status_phase',
          'native_record',

          'failed_info',
          'failed_scan',
          'physical_confirm',
        ].includes(value)
      )
        trace(`MUSE_PAIR ${value}\n`)
    },
    onConfirmation,
    onProvision,
    onState,
    encode: (text) => new TextEncoder().encode(text),
    decode: (bytes) => new TextDecoder().decode(bytes),
    delay: (ms) => new Promise((resolve) => Timer.set(resolve, ms)),
    transport: {
      notify(buffer) {
        if (!peripheral.connected || !peripheral.tx) throw new Error('not_subscribed')
        checkedNotify(peripheral.connection, peripheral.tx.handle, buffer)
      },
      disconnect() {
        if (peripheral.connected) peripheral.disconnect()
      },
    },
  })
  peripheral.session = session
  const poll = Timer.repeat(() => session.poll(), 1000)
  return {
    advertise() {
      if (!peripheral.ready || peripheral.connected) throw new Error('not_ready')
      peripheral.startAdvertising({
        advertisingData: {
          flags: 6,
          completeUUID128List: [service],
          manufacturerSpecific: { identifier: 0xffff, data: [0] },
        },
        scanResponseData: { completeName: name },
      })
    },
    confirmPhysical: () => session.confirmPhysical(),
    reportProgress: (name) => session.reportProgress(name),
    close() {
      Timer.clear(poll)
      try {
        session.close()
      } finally {
        try {
          peripheral.stopAdvertising()
        } finally {
          peripheral.close()
        }
      }
    },
  }
}
