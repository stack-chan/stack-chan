import type { SettingsService, SettingsStorage } from '../../settings-service.js'

type Stored = Map<string, unknown>

/** Storage snapshots include the erase-before-set gap in Moddable's ESP32 Preference binding. */
export function checkSettingsRecovery(
  Service: typeof SettingsService,
  assert: (condition: boolean, message?: string) => void,
): number {
  const before = { 'wifi.ssid': 'old-network', 'wifi.password': 'old-secret', 'tts.port': '1234' }
  const update = {
    'wifi.ssid': 'new-network',
    'wifi.password': 'new-secret',
    'tts.port': undefined,
    'ui.language': 'en',
  }
  const oldValues = ['old-network', 'old-secret', 1234, 'ja']
  const newValues = ['new-network', 'new-secret', undefined, 'en']
  const make = (initial: Stored) => {
    const stored = new Map(initial)
    const images: Stored[] = []
    const snapshot = () => images.push(new Map(stored))
    const storage: SettingsStorage = {
      get: (domain, name) => stored.get(`${domain}.${name}`),
      set(domain, name, value) {
        snapshot()
        stored.delete(`${domain}.${name}`)
        snapshot()
        stored.set(`${domain}.${name}`, value)
        snapshot()
      },
      delete(domain, name) {
        snapshot()
        stored.delete(`${domain}.${name}`)
        snapshot()
      },
    }
    const service = new Service({ profile: () => ({}), app: () => ({}), storage })
    const values = () => [
      service.get('wifi.ssid'),
      service.get('wifi.password'),
      service.get('tts.port'),
      service.get('ui.language'),
    ]
    return { service, images, values }
  }
  const same = (actual: unknown[], expected: unknown[]) => actual.every((value, index) => value === expected[index])
  const committed = make(new Map(Object.entries(before)))
  committed.service.write(update)
  assert(same(committed.values(), newValues), 'a successful save commits all fields and the optional reset')
  let reboots = 0
  for (const interrupted of committed.images) {
    const recovery = make(interrupted)
    const result = recovery.values()
    assert(same(result, oldValues) || same(result, newValues), 'an interrupted save never mixes configurations')
    reboots++
    for (const interruptedRecovery of recovery.images) {
      const restarted = make(interruptedRecovery)
      assert(same(restarted.values(), result), 'another power loss during recovery is idempotent')
      reboots++
    }
  }
  for (let index = 0; index < 100; index++) {
    committed.service.write({ 'wifi.ssid': `network-${index}`, 'wifi.password': `secret-${index}` })
    assert(committed.service.get('wifi.ssid') === `network-${index}`, 'the next save can reuse the journal')
  }
  return reboots
}
