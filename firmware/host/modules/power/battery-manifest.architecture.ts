import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

type PlatformDefinition = {
  include?: string[]
  modules?: Record<string, string>
}

const manifest = JSON.parse(readFileSync('host/modules/power/manifest.json', 'utf8')) as {
  platforms: Record<string, PlatformDefinition>
}

test('battery status module covers every supported M5 PMIC target', () => {
  const batteryModules = Object.fromEntries(
    Object.entries(manifest.platforms)
      .filter(([, definition]) => definition.modules?.['battery-status'])
      .map(([platform, definition]) => [platform, definition.modules?.['battery-status']]),
  )

  assert.deepEqual(batteryModules, {
    'esp32/m5stack': './platforms/ip5306-battery-status',
    'esp32/m5stack_core2': './platforms/core2-battery-status',
    'esp32/takao_core2_sg90': './platforms/core2-battery-status',
    'esp32/m5stack_cores3': './platforms/axp2101-battery-status',
    'esp32/m5stackchan_cores3': './platforms/axp2101-battery-status',
    'esp32/stackchan_rt': './platforms/axp2101-battery-status',
  })

  assert.ok(
    manifest.platforms['esp32/m5stack'].include?.includes('$(MODULES)/pins/smbus/manifest.json'),
    'esp32/m5stack should include the SMBus dependency used by its IP5306 battery reader',
  )

  for (const platform of ['esp32/m5stack_cores3', 'esp32/m5stackchan_cores3', 'esp32/stackchan_rt']) {
    assert.equal(
      manifest.platforms[platform].modules?.['embedded:peripheral/Power/axp2101'],
      './platforms/axp2101-power-bridge',
      `${platform} should capture the existing PMIC instance instead of opening a duplicate I2C address`,
    )
  }
})
