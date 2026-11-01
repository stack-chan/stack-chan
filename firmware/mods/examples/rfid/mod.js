import Timer from 'timer'

const TEST_URI = 'https://stack-chan.com/'
const DRAWER_KEYS = ['rfidPolling', 'rfidRead', 'rfidWrite']
// SDK 10.0.1 wrapNdef() exposes URIs on well-known U records, not the wrapper.
const getURI = (ndef) => ndef?.records?.find((record) => record.tnf === 1 && record.type === 'U')?.uri
let cleanup

export function onContextCreated(robot) {
  cleanup?.()
  cleanup = undefined
  const RFID = device.sensor?.RFID
  if (!RFID) {
    robot.ui.showBalloon('RFID: M5StackChan CoreS3 required')
    return
  }

  let reader, timer, card
  const report = (message) => {
    trace(`[rfid] ${message}\n`)
    robot.ui.showBalloon(message)
  }
  const stop = () => {
    if (timer !== undefined) Timer.clear(timer)
    timer = undefined
    card = undefined
    const previous = reader
    reader = undefined
    if (previous) {
      try {
        previous.configure({ antenna: false })
      } finally {
        previous.close()
      }
    }
  }
  const showNDEF = (ndef) => {
    trace(`[rfid] NDEF ${JSON.stringify(ndef ?? null)}\n`)
    report(getURI(ndef) ?? ndef?.text ?? (ndef ? 'NDEF: see log' : 'NDEF: empty or unavailable'))
  }
  const poll = () => {
    try {
      const sample = reader.sample()
      if (sample === undefined) return
      card = sample.present ? sample : undefined
      if (card) {
        trace(`[rfid] detected UID=${card.uidHex} SAK=${card.sak} type=${card.type}\n`)
        report(`UID: ${card.uidHex}`)
      } else {
        report('RFID: card removed')
      }
    } catch (error) {
      card = undefined
      report(`RFID poll failed: ${error}`)
    }
  }
  const selectPolling = (_context, value) => {
    if (!['off', '250', '1000'].includes(value)) return
    try {
      stop()
      if (value === 'off') {
        report('RFID: stopped (antenna OFF)')
        return
      }
      reader = new RFID()
      reader.configure({ antenna: true })
      timer = Timer.repeat(poll, Number(value))
      report(`RFID: polling ${value} ms (antenna ON)`)
    } catch (error) {
      try {
        stop()
      } catch (closeError) {
        trace(`[rfid] cleanup failed: ${closeError}\n`)
      }
      report(`RFID start failed: ${error}`)
    }
  }
  const withType2 = (operation) => {
    if (!reader) return report('RFID: start polling first')
    // Refresh at the time of the button press: do not trust a stale UID.
    poll()
    if (!card) return report('RFID: no card detected')
    if (card.sak !== 0) return report('NDEF: Type 2 only (no MIFARE Classic IO)')
    try {
      // Driver calls are synchronous on the JS event loop. The polling timer
      // cannot interleave with NDEF IO; do not create another I2C reader.
      operation()
    } catch (error) {
      report(`NDEF failed: ${error}`)
    }
  }

  robot.ui.drawer.addDrawerButton({
    key: DRAWER_KEYS[0],
    label: 'RFID polling',
    kind: 'choice',
    value: 'off',
    options: [
      { value: 'off', label: 'OFF' },
      { value: '250', label: '250 ms' },
      { value: '1000', label: '1000 ms' },
    ],
    callback: selectPolling,
  })
  robot.ui.drawer.addDrawerButton({
    key: DRAWER_KEYS[1],
    label: 'Read NDEF',
    callback: () => withType2(() => showNDEF(reader.readNDEF())),
  })
  robot.ui.drawer.addDrawerButton({
    key: DRAWER_KEYS[2],
    label: 'Write test URI',
    callback: () =>
      withType2(() => {
        reader.writeNDEF({ uri: TEST_URI })
        // Read back independently, rather than relying on the write return value.
        const ndef = reader.readNDEF()
        if (getURI(ndef) !== TEST_URI) throw new Error('URI read-back mismatch')
        showNDEF(ndef)
        report('NDEF: write/read-back OK')
      }),
  })
  cleanup = () => {
    try {
      stop()
    } finally {
      for (const key of DRAWER_KEYS) robot.ui.drawer.removeDrawerButton(key)
    }
  }
  report('RFID: stopped. Write test URI overwrites a Type 2 tag.')
}
