import { onContextCreated } from 'media-mod'
import { assert, equal } from 'testing/assert'
import { STATIONS } from 'web-radio-config'

function context(volume, releaseFails = false) {
  const state = {
    registrations: [],
    buttons: new Map(),
    balloons: [],
    torque: [],
    gazes: [],
    away: 0,
    audio: volume === undefined ? {} : { volume },
    i18n: { localize: (key) => key },
    showBalloon(message) {
      state.balloons.push(message)
    },
    drawer: {
      addDrawerButton(button) {
        state.buttons.set(button.key, button)
      },
      setDrawerButtonState(key, enabled) {
        state.buttons.get(key).enabled = enabled
      },
    },
    motion: {
      async setTorque(enabled) {
        state.torque.push(enabled)
        if (!enabled && releaseFails) throw new Error('servo unavailable')
      },
      lookAway() {
        state.away++
      },
      lookAt(point) {
        state.gazes.push(point)
      },
    },
  }
  return state
}

async function run() {
  const oldHost = context()
  await onContextCreated(oldHost)
  equal(oldHost.balloons[0], 'podcast.hostRequired', 'old host gets a visible update instruction')
  equal(oldHost.registrations.length, 0, 'old host does not install unusable apps')
  equal(oldHost.buttons.size, 0)
  equal(oldHost.torque.length, 0)

  const previous = context(0.35, true)
  await onContextCreated(previous)
  equal(previous.registrations.length, 1)
  equal(previous.audio.volume, 0.35, 'startup preserves the saved level')
  equal(previous.torque.length, 0, 'startup does not enable motion')

  const next = context(0.5)
  await onContextCreated(next)
  equal(previous.torque[0], false, 'attempt release of previous controller')
  equal(previous.away, 1)
  equal(next.registrations.length, 1, 'failed old release does not prevent new player registration')
  equal(next.registrations[0][0].title, STATIONS[0].label)
  assert(next.buttons.has('media:volume') && next.buttons.has('media:look-around'))
  next.buttons.get('media:volume').callback(next, '0')
  equal(next.audio.volume, 0, 'new volume controls remain usable')
  const look = next.buttons.get('media:look-around')
  await look.callback()
  equal(next.torque[0], true)
  equal(next.gazes.length, 1)
  await look.callback()
  equal(next.torque[1], false)
  equal(next.away, 1)
  equal(next.audio.volume, 0, 'motion controls preserve shared mute')
  trace('@@STACKCHAN_TEST:PASS@@\n')
}
void run().catch((error) => {
  trace('@@STACKCHAN_TEST:FAIL@@\n')
  trace(`${error}\n`)
  throw error
})
