import Preference from 'preference'
import { CONTROL_TICK_MS, StriderDrive } from 'strider-drive'
import Time from 'time'
import Timer from 'timer'

const SERVICE = 'strider'
const TURN_CENTER_KEY = 'turn-right'

let runtime

function reportError(error) {
  trace(`[strider] ${String(error)}\n`)
}

function openGyro(imu) {
  let latest
  let failed = false
  const close = imu.subscribeSamples((sample) => {
    latest = sample?.gyroscope
    if (!latest) failed = true
  })
  return {
    read() {
      if (failed) throw new Error('Could not sample the gyroscope')
      return latest
    },
    close,
  }
}

export async function onContextCreated(robot) {
  const localPeer = robot.connectivity.localPeer
  if (!localPeer || typeof robot.motion.startContinuousYaw !== 'function') {
    trace('[strider] BLE Local Peer and continuous yaw must be available\n')
    return
  }

  const imu = robot.input.imu
  const drive = new StriderDrive(
    {
      now: () => Time.ticks,
      elapsed: (start) => Time.delta(start),
      startContinuousYaw: () => robot.motion.startContinuousYaw(),
      openGyro: typeof imu?.subscribeSamples === 'function' ? () => openGyro(imu) : undefined,
      saveTurnCenter: (value) => Preference.set(SERVICE, TURN_CENTER_KEY, value),
      notify: (state) => instance.session?.broadcast('state', state).catch(reportError),
      reportError,
    },
    Preference.get(SERVICE, TURN_CENTER_KEY),
  )
  const instance = { drive, session: undefined, timer: undefined }
  runtime = instance

  try {
    const session = await localPeer.open({
      transport: 'ble',
      service: SERVICE,
      displayName: 'Stack-chan Strider',
      onDisconnect: () => drive.disconnect(),
    })
    if (runtime !== instance) {
      session.close()
      return
    }
    instance.session = session
    session.subscribe('state-request', () => {
      void session.broadcast('state', drive.state()).catch(reportError)
    })
    session.subscribe('drive', ({ payload }) => {
      if (!drive.receive(payload) || instance.timer !== undefined || !drive.tick()) return
      instance.timer = Timer.repeat(() => {
        if (drive.tick()) return
        Timer.clear(instance.timer)
        instance.timer = undefined
      }, CONTROL_TICK_MS)
    })
    trace('[strider] ready for a browser connection\n')
  } catch (error) {
    reportError(error)
    if (runtime === instance) await onClose()
  }
}

export async function onClose() {
  const instance = runtime
  runtime = undefined
  if (!instance) return
  if (instance.timer !== undefined) Timer.clear(instance.timer)
  try {
    await instance.drive.close()
  } finally {
    instance.session?.close()
  }
}
