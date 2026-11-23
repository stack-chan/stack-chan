import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

test('privacy wrapper performs no startup action and delegates explicit suppression without data', async () => {
  const calls = []
  const context = vm.createContext({
    native(name) {
      assert.equal(name, 'xs_muse_silence_wifi_logs')
      return function (...args) {
        calls.push(args)
      }
    },
  })
  const mod = new vm.SourceTextModule(await readFile(new URL('./silence.js', import.meta.url), 'utf8'), { context })
  await mod.link(() => {
    throw new Error('unexpected import')
  })
  await mod.evaluate()
  assert.deepEqual(calls, [])
  mod.namespace.default()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].length, 0)
})

test('native guard suppresses only the two WiFi tags and verifies effective level', async () => {
  const source = await readFile(new URL('./silence.c', import.meta.url), 'utf8')
  for (const tag of ['wifi', 'wifi_init']) {
    assert.ok(source.includes(`esp_log_level_set("${tag}", ESP_LOG_NONE)`))
    assert.ok(source.includes(`esp_log_level_get("${tag}") != ESP_LOG_NONE`))
  }
  assert.ok(source.includes('#if !CONFIG_LOG_DYNAMIC_LEVEL_CONTROL'))
  assert.ok(!source.includes('esp_log_level_set("*"'))
  assert.ok(!source.includes('printf('))
})
