import { PreferenceServer } from 'preference-server'
import { SETTING_KEYS, SETTINGS_MESSAGE_MAX_BYTES } from 'settings-schema'
import { SettingsService } from 'settings-service'
import { assert, equal } from 'testing/assert'
import Timer from 'timer'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => Timer.set(() => resolve(), ms))
}
function messages(server: PreferenceServer): Record<string, unknown>[] {
  const total = server.notifications.reduce((size, item) => size + item.value.byteLength, 0)
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const notification of server.notifications) {
    bytes.set(new Uint8Array(notification.value), offset)
    offset += notification.value.byteLength
  }
  const lastDelimiter = bytes.lastIndexOf(10)
  if (lastDelimiter < 0) return []
  const lines = String.fromArrayBuffer(bytes.slice(0, lastDelimiter + 1).buffer).split('\n')
  lines.pop() // A notification can end in the middle of a frame.
  return lines.map((line) => JSON.parse(line))
}
async function until(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (condition()) return
    await wait(10)
  }
  throw new Error('settings response did not complete')
}

async function run() {
  const stored = new Map<string, unknown>([
    ['wifi.password', 'private-password'],
    ['driver.type', 'scservo'],
  ])
  const applied: string[] = []
  let writes = 0
  const settings = new SettingsService({
    profile: () => ({ driver: { type: 'm5stackchan', typeLocked: true } }),
    app: () => ({}),
    storage: {
      get: (domain, key) => stored.get(`${domain}.${key}`),
      set: (domain, key, value) => {
        writes++
        stored.set(`${domain}.${key}`, value)
      },
      delete: (domain, key) => {
        writes++
        stored.delete(`${domain}.${key}`)
      },
    },
  })
  const server = new PreferenceServer({ settings, onPreferenceChanged: (key) => applied.push(key) })
  server.onCharacteristicNotifyEnabled({ name: 'tx' })
  await until(() => messages(server).filter((message) => message.prop).length === SETTING_KEYS.length)
  const initial = messages(server)
  equal(initial[0].protocol, 2)
  const driver = initial.find((message) => message.prop === 'driver.type')
  equal(driver?.value, 'm5stackchan')
  equal(driver?.readOnly, true)
  assert(!JSON.stringify(initial).includes('private-password'), 'the initial snapshot redacts stored secrets')
  assert(
    server.notifications.every((item) => item.value.byteLength <= 20),
    'notifications fit the default ATT MTU',
  )

  server.onMTUExchanged(131)
  const request = ArrayBuffer.fromString(
    JSON.stringify({
      requestId: 1,
      _batch: { 'wifi.ssid': 'ｽﾀｯｸﾁｬﾝ🤖', 'wifi.password': 'new-private-password', 'tts.volume': '0.375' },
    }),
  )
  for (let index = 0; index < request.byteLength; index++) server.onRX(request.slice(index, index + 1))
  await until(() => messages(server).some((message) => message.requestId === 1))
  equal(settings.get('wifi.ssid'), 'ｽﾀｯｸﾁｬﾝ🤖', 'UTF-8 characters survive arbitrary byte boundaries')
  equal(settings.get('tts.volume'), 0.375)
  equal(messages(server).find((message) => message.requestId === 1)?.kind, 'saved')
  equal(applied.length, 3)
  assert(!JSON.stringify(messages(server)).includes('private-password'), 'save receipts also redact secrets')

  const before = writes
  server.onRX(
    ArrayBuffer.fromString(JSON.stringify({ requestId: 2, _batch: { 'tts.volume': 0.8, 'unknown.key': 'secret' } })),
  )
  await until(() => messages(server).some((message) => message.requestId === 2))
  equal(messages(server).find((message) => message.requestId === 2)?.code, 'INVALID_ARGUMENT')
  equal(writes, before, 'an invalid batch writes nothing')
  server.onRX(ArrayBuffer.fromString(JSON.stringify({ requestId: 3, _batch: { 'driver.type': 'none' } })))
  await until(() => messages(server).some((message) => message.requestId === 3))
  equal(messages(server).find((message) => message.requestId === 3)?.code, 'CONFIG')
  equal(settings.get('driver.type'), 'm5stackchan')

  server.onRX(new ArrayBuffer(SETTINGS_MESSAGE_MAX_BYTES + 1))
  await until(() => messages(server).some((message) => message.message === 'Settings message is too large'))
  equal(writes, before)
  server.onRX(ArrayBuffer.fromString('{"_batch":'))
  server.onDisconnected()
  server.notifications.length = 0
  server.onCharacteristicNotifyEnabled({ name: 'tx' })
  server.onRX(ArrayBuffer.fromString(JSON.stringify({ requestId: 4, _batch: { 'tts.volume': 0.25 } })))
  await until(() => messages(server).some((message) => message.requestId === 4))
  equal(settings.get('tts.volume'), 0.25, 'a reconnect discards the preceding partial request')

  server.onRX(ArrayBuffer.fromString('{"_batch":'))
  server.close()
  server.close()
  const afterClose = server.notifications.length
  server.onCharacteristicNotifyEnabled({ name: 'tx' })
  server.onRX(request)
  server.onDisconnected()
  await wait(3100)
  equal(server.notifications.length, afterClose, 'close cancels timers and rejects late BLE callbacks')
  assert(server.closed, 'the UART transport is closed')
  trace('ok\n')
}
run().catch((error) => {
  trace(`settings transport failed: ${error}\n`)
  throw error
})
