import { createReceiver, frameRecord } from './framing.js'

export function createPairingSession({
  native,
  transport,
  encode,
  decode,
  delay,
  startScan,
  onConfirmation = () => {},
  onProvision = () => {},
  onState = () => {},
  onDiagnostic = () => {},
}) {
  const receiver = createReceiver()
  let epoch = 0,
    busy = false,
    closed = false,
    encrypted = false,
    armed = false,
    confirmed = false,
    provisionReceived = false
  let mtu = 23,
    generation = 0,
    lastStatus = 'idle'
  let activeScan
  let sending = Promise.resolve()
  function diagnostic(value) {
    try {
      onDiagnostic(value)
    } catch {}
  }
  function state(value) {
    try {
      onState(value)
    } catch {}
  }
  function reset() {
    ++epoch
    try {
      activeScan?.close()
    } catch {}
    activeScan = undefined
    busy = false
    receiver.reset()
    armed = false
    confirmed = false
    provisionReceived = false
    encrypted = false
    generation = 0
    mtu = 23
    lastStatus = 'idle'
    try {
      native.reset()
    } finally {
      state('disconnected')
    }
  }
  function send(record, captured = epoch) {
    const task = sending.then(() => transmit(record, captured))
    sending = task.catch(() => {})
    return task
  }
  async function transmit(record, captured) {
    const { json, recordGeneration = 0 } = typeof record === 'string' ? { json: record } : record
    if (recordGeneration) lastStatus = 'encrypted_status'
    const bytes = encode(json)
    try {
      for (const frame of frameRecord(bytes, mtu)) {
        if (closed || captured !== epoch || (recordGeneration && !native.recordCurrent(recordGeneration)))
          throw new Error('stale_session')
        await transport.notify(frame.buffer)
        if (frame[1] + 1 < frame[2]) await delay(50)
      }
      if (closed || captured !== epoch || (recordGeneration && !native.recordCurrent(recordGeneration)))
        throw new Error('stale_session')
    } finally {
      bytes.fill(0)
    }
  }
  async function fail() {
    try {
      reset()
    } catch {
      closed = true
      try {
        native.close()
      } catch {}
    } finally {
      try {
        await transport.disconnect()
      } catch {}
    }
  }
  return {
    setMTU(value) {
      if (Number.isInteger(value) && value >= 23 && value <= 517) mtu = value
    },
    disconnect: reset,
    readStatus() {
      return lastStatus
    },
    poll() {
      try {
        if (!closed && generation && !native.current(generation)) void fail().catch(() => {})
      } catch {
        void fail().catch(() => {})
      }
    },
    close() {
      if (!closed) {
        closed = true
        try {
          reset()
        } finally {
          native.close()
        }
      }
    },
    async receive(value) {
      if (closed) return
      let record
      let stage = 'decode'
      try {
        record = receiver.push(value)
      } catch {
        diagnostic('frame_rejected')
        await fail()
        return
      }
      if (!record) return
      if (busy) {
        diagnostic('busy_rejected')
        record.fill(0)
        await fail()
        return
      }
      busy = true
      const captured = epoch
      try {
        const text = decode(record)
        const outer = JSON.parse(text)
        if (outer.action === 'pairing_client_hello' && !encrypted) {
          stage = 'hello'
          diagnostic('hello_received')
          const reply = native.hello(text)
          generation = native.generation()
          encrypted = true
          await send(reply, captured)
          state('handshake')
        } else if (outer.action === 'pairing_encrypted') {
          stage = 'encrypted'
          diagnostic('encrypted_received')
          stage = 'decrypt'
          const result = native.receive(text)
          stage = 'finished_check'
          if (result.kind === 'wifi_scan') {
            if (!confirmed || !native.current(result.generation)) throw new Error('scan_unavailable')
            if (provisionReceived || typeof startScan !== 'function') throw new Error('scan_unavailable')
            stage = 'scan'
            const scan = startScan()
            activeScan = scan
            let networks
            try {
              networks = await scan.promise
            } finally {
              if (activeScan === scan) activeScan = undefined
              scan.close()
            }
            if (closed || captured !== epoch || !native.current(result.generation)) throw new Error('stale_session')
            await send(native.scanResult(result.generation, JSON.stringify(networks)), captured)
            return
          }
          if (result.kind === 'provision') {
            if (!confirmed || !result.provisionReady || !native.current(result.generation))
              throw new Error('provisioning_unavailable')
            generation = result.generation
            provisionReceived = true
            state('provisioning_approval_required')
            onProvision({ generation, provisionReady: true })
            return
          }
          if (result.kind !== 'finished' || confirmed || !result.generation || !result.confirmationRequired)
            throw new Error('confirmation_required')
          generation = result.generation
          stage = 'status_create'
          const reply = native.status('confirm_required', generation)
          stage = 'status_send'
          await send(reply, captured)
          stage = 'arm'
          if (captured !== epoch || !native.arm(result.generation)) throw new Error('stale_session')
          armed = true
          state('confirm_required')
          onConfirmation()
        } else if (outer.action === 'get_device_info' && !encrypted) {
          stage = 'info'
          diagnostic('info_received')
          await send(native.info(), captured)
        } else throw new Error('unsupported_command')
      } catch (error) {
        const known = {
          'pairing finished phase mismatch': 'native_phase',
          'pairing decrypt expired': 'decrypt_expired',
          'pairing decrypt state': 'decrypt_state',
          'pairing decrypt envelope': 'decrypt_envelope',
          'pairing decrypt session': 'decrypt_session',
          'pairing decrypt counter': 'decrypt_counter',
          'pairing decrypt memory': 'decrypt_memory',
          'pairing decrypt base64': 'decrypt_base64',
          'pairing decrypt aead': 'decrypt_aead',

          'pairing finished decrypt rejected': 'native_decrypt',
          'pairing finished command rejected': 'native_command',
          'pairing finished expired': 'native_expired',
          'pairing status phase mismatch': 'native_status_phase',
          'pairing record unavailable': 'native_record',
        }
        const reason = known[error?.message]
        if (typeof reason === 'string') diagnostic(reason)
        diagnostic(`failed_${stage}`)
        if (captured === epoch) await fail()
      } finally {
        record.fill(0)
        if (captured === epoch) busy = false
      }
    },
    async reportProgress(name) {
      if (
        !['wifi_connecting', 'wifi_connected', 'auth_ok', 'wifi_failed', 'auth_failed', 'error_storage'].includes(name)
      )
        return false
      if (closed || !confirmed || !provisionReceived || !generation) return false
      try {
        await send(native.status(name, generation))
        return true
      } catch {
        return false
      }
    },
    async confirmPhysical() {
      if (closed || !armed || busy) return false
      armed = false
      busy = true
      const captured = epoch
      try {
        diagnostic('physical_confirm')
        generation = native.confirm()
        if (!generation) throw new Error('stale_session')
        await send(native.status('pairing_confirmed', generation), captured)
        confirmed = true
        state('confirmed')
        return true
      } catch {
        if (captured === epoch) await fail()
        return false
      } finally {
        if (captured === epoch) busy = false
      }
    },
  }
}
