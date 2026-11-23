export function pairingDeviceName(identity) {
  const mac = identity?.mac
  const nodeId = identity?.nodeId
  let macSuffix, nodeSuffix
  if (mac !== undefined) {
    if (typeof mac !== 'string' || !/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(mac))
      throw new Error('pairing_identity_invalid')
    macSuffix = mac.replaceAll(':', '').slice(-6).toUpperCase()
  }
  if (nodeId !== undefined) {
    if (typeof nodeId !== 'string' || !/^homelink-[0-9a-f]{6}$/.test(nodeId))
      throw new Error('pairing_identity_invalid')
    nodeSuffix = nodeId.slice(-6).toUpperCase()
  }
  if ((!macSuffix && !nodeSuffix) || (macSuffix && nodeSuffix && macSuffix !== nodeSuffix))
    throw new Error('pairing_identity_invalid')
  return 'MuseGadget-' + (macSuffix ?? nodeSuffix)
}

export function createPairingController({
  createNative,
  createPeripheral,
  createAccount,
  coordinator,
  identity,
  setupComplete,
  onChange = () => {},
}) {
  let name,
    closing,
    native,
    peripheral,
    phase = 'idle',
    closed = false,
    confirming = false,
    claimed = false
  const publish = () => {
    try {
      onChange(Object.freeze({ phase, name, canStart: phase === 'idle', canConfirm: phase === 'confirm', claimed }))
    } catch {}
  }
  const fail = () => {
    if (!closed) {
      phase = 'failed'
      publish()
    }
  }
  return {
    start() {
      if (closed || phase !== 'idle' || setupComplete !== false) throw new Error('pairing_start_unavailable')
      name = pairingDeviceName(identity)
      phase = 'starting'
      publish()
      try {
        native = createNative(identity)
        peripheral = createPeripheral({
          native,
          name,
          setupComplete: false,
          onReady() {
            Promise.resolve().then(() => {
              if (closed || phase !== 'starting') return
              try {
                peripheral.advertise()
                phase = 'advertising'
                publish()
              } catch {
                fail()
              }
            })
          },
          onConfirmation() {
            if (!closed && !claimed) {
              phase = 'confirm'
              publish()
            }
          },
          onState(value) {
            if (closed || claimed) return
            if (value === 'disconnected') {
              phase = 'disconnected'
              publish()
            }
          },
          onProvision({ generation, provisionReady }) {
            if (closed || claimed || provisionReady !== true) return
            let account
            try {
              account = createAccount(native, generation)
              coordinator.acceptProvision(account, generation)
              claimed = true
              phase = 'review'
              publish()
            } catch {
              try {
                account?.close()
              } catch {}
              fail()
            }
          },
        })
      } catch {
        try {
          peripheral?.close()
        } catch {}
        try {
          native?.close()
        } catch {}
        fail()
      }
    },
    async confirmPhysical() {
      if (closed || phase !== 'confirm' || confirming) return false
      confirming = true
      phase = 'confirming'
      publish()
      try {
        const ok = await peripheral.confirmPhysical()
        if (closed) return false
        if (!ok) {
          fail()
          return false
        }
        if (!claimed) {
          phase = 'waiting'
          publish()
        }
        return true
      } catch {
        fail()
        return false
      } finally {
        confirming = false
      }
    },
    reportProgress(name) {
      if (closed || !claimed) return Promise.resolve(false)
      return Promise.resolve(peripheral.reportProgress(name)).catch(() => false)
    },
    close() {
      if (closed) return closing
      closed = true
      phase = 'closed'
      publish()
      closing = Promise.resolve()
        .then(() => coordinator.close())
        .finally(() => {
          try {
            peripheral?.close()
          } finally {
            native?.close()
          }
        })
      return closing
    },
  }
}
