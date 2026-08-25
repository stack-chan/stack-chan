import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'

const esp32PlatformManifest = JSON.parse(readFileSync('host/platforms/esp32/manifest.json', 'utf8'))
const coreS3AudioOutSource = readFileSync('host/platforms/core_s3_audioout.js', 'utf8')
const coreS3SdkconfigSource = readFileSync(
  'host/modules/audio/platforms/m5stackchan-cores3/sdkconfig/sdkconfig.defaults',
  'utf8',
)
const defaultBehaviorSource = readFileSync('host/app/default-behavior/on-context-created.ts', 'utf8')
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))

type Subplatform = {
  readonly name: string
  readonly manifest: {
    include?: string[]
    build?: { SUBPLATFORM?: string }
    defines?: { camera?: { i2c_port?: number } }
    modules?: Record<string, string>
    config?: {
      serial?: unknown
      driver?: { type?: string; typeLocked?: boolean; serial?: unknown }
    }
  }
}

function readJson(path: string) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function npmRunScripts(source: string): string[] {
  return Array.from(source.matchAll(/\bnpm run ([\w:-]+)/g), ([, script]) => script)
}

function listSubplatforms(): Subplatform[] {
  return readdirSync('host/platforms', { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, manifestPath: join('host/platforms', entry.name, 'manifest.json') }))
    .filter(({ manifestPath }) => existsSync(manifestPath))
    .map(({ name, manifestPath }) => ({ name, manifest: readJson(manifestPath) }))
    .filter(({ manifest }) => typeof manifest.build?.SUBPLATFORM === 'string')
}

function baseTargetOf(subplatform: Subplatform): string | undefined {
  for (const includePath of subplatform.manifest.include ?? []) {
    const match = includePath.match(/^\$\(BUILD\)\/devices\/esp32\/targets\/([^/]+)\/manifest\.json$/)
    if (match) return match[1]
  }
  return undefined
}

describe('Stack-chan platform manifest', () => {
  test('subplatforms reuse the XS creation block of their base target', () => {
    // A SUBPLATFORM build without its own platforms entry inherits the target's
    // fixed-size heap and aborts with "memory full"; each subplatform must be
    // registered in the esp32 platform manifest with the base target's
    // expandable creation block.
    for (const subplatform of listSubplatforms()) {
      const base = baseTargetOf(subplatform)
      assert.ok(base, `${subplatform.name} should include a $(BUILD)/devices/esp32/targets base manifest`)

      const baseCreation = esp32PlatformManifest.platforms[`esp32/${base}`]?.creation
      const creation = esp32PlatformManifest.platforms[`esp32/${subplatform.name}`]?.creation
      assert.ok(baseCreation, `esp32/${base} should define a creation block`)
      assert.deepEqual(
        creation,
        baseCreation,
        `esp32/${subplatform.name} should reuse the esp32/${base} creation block`,
      )
    }
  })

  test('subplatforms ship a provider, an app manifest, and npm scripts', () => {
    const subplatforms = listSubplatforms()
    assert.ok(subplatforms.length > 0, 'expected at least one subplatform directory')

    for (const subplatform of subplatforms) {
      const { name, manifest } = subplatform
      assert.equal(manifest.build?.SUBPLATFORM, name, `${name} SUBPLATFORM should match its directory name`)

      // A SUBPLATFORM build resolves $(SUBPLATFORMDIRECTORY)/host/provider, so
      // every subplatform must ship its own device provider.
      const providerPath = join('host/platforms', name, 'host', 'provider.js')
      assert.ok(existsSync(providerPath), `${name} should ship ${providerPath}`)
      assert.match(readFileSync(providerPath, 'utf8'), /export default device/)

      const appManifest = readJson(join('host/app', `manifest_${name}.json`))
      assert.ok(appManifest.include?.length > 0, `host/app/manifest_${name}.json should include base manifests`)

      for (const script of ['build', 'deploy', 'flash', 'debug', 'mod']) {
        assert.ok(packageJson.scripts[`${script}:${name}`], `package.json should define ${script}:${name}`)
      }

      // Protocols read config.driver.serial first, but keep the top-level
      // serial aligned for tooling that still reads it.
      if (manifest.config?.serial && manifest.config?.driver?.serial) {
        assert.deepEqual(manifest.config.serial, manifest.config.driver.serial)
      }
    }
  })

  test('dedicated smart-servo platforms lock their hardware driver', () => {
    const expectedDrivers = new Map([
      ['m5stackchan_cores3', 'm5stackchan'],
      ['stackchan_rt', 'dynamixel'],
    ])

    for (const [platform, expectedType] of expectedDrivers) {
      const manifest = readJson(join('host/platforms', platform, 'manifest.json'))
      assert.equal(manifest.config?.driver?.type, expectedType)
      assert.equal(manifest.config?.driver?.typeLocked, true)
    }
  })

  test('M5StackChan extends CoreS3 setup through a distinct setup module', () => {
    const manifest = readJson('host/platforms/m5stackchan_cores3/manifest.json')

    assert.equal(manifest.modules?.['setup/m5stackchan-power'], './setup-target')
    assert.equal(
      manifest.modules?.['setup/target'],
      undefined,
      'the inherited CoreS3 setup module must remain selected',
    )
  })

  test('M5StackChan keeps MOD selector modules in the host application', () => {
    const platformManifest = readJson('host/platforms/m5stackchan_cores3/manifest.json')
    const appManifest = readJson('host/app/manifest_m5stackchan_cores3.json')

    for (const module of ['mod-installer', 'mod-manager']) {
      assert.equal(platformManifest.modules?.[module], undefined, `${module} must not leak into device programs`)
      assert.equal(appManifest.modules?.[module], `./${module}`)
    }
  })

  test('CoreS3 AudioOut applies the sample rate without overriding amplifier volume', () => {
    assert.match(coreS3AudioOutSource, /globalThis\.amp\.sampleRate = this\.sampleRate/)
    assert.doesNotMatch(
      coreS3AudioOutSource,
      /globalThis\.amp\.volume\s*=/,
      'AudioOut should not force the amplifier back to a loud volume',
    )
  })

  test('camera-sharing subplatform providers pin the internal I2C bus to port 1', () => {
    // The camera SCCB reuses the internal I2C bus (defines.camera sda/scl=-1,
    // i2c_port=1). esp32-camera only finds the already-initialized bus handle
    // when the provider pins the internal bus to port 1 — otherwise
    // SCCB_Use_Port(1) fails and camera init fails.
    for (const subplatform of listSubplatforms()) {
      if (subplatform.manifest.defines?.camera?.i2c_port !== 1) continue
      const providerSource = readFileSync(join('host/platforms', subplatform.name, 'host', 'provider.js'), 'utf8')
      assert.match(
        providerSource,
        /internal:\s*\{[^}]*port:\s*1\b/s,
        `${subplatform.name} internal I2C should use port 1 so the camera SCCB can share the bus`,
      )
    }
  })

  test('CoreS3 camera preview fits the available internal DMA block', () => {
    assert.match(coreS3SdkconfigSource, /^CONFIG_CAMERA_DMA_BUFFER_SIZE_MAX=16384$/m)
    assert.doesNotMatch(coreS3SdkconfigSource, /^CONFIG_CAMERA_PSRAM_DMA=y$/m)
    assert.match(defaultBehaviorSource, /^const CAMERA_PREVIEW_CAPTURE_WIDTH = 160$/m)
    assert.match(defaultBehaviorSource, /^const CAMERA_PREVIEW_CAPTURE_HEIGHT = 120$/m)
  })

  test('CoreS3 XS heap growth stays in PSRAM and preserves DMA-capable internal RAM', () => {
    const alwaysInternalMatch = coreS3SdkconfigSource.match(/^CONFIG_SPIRAM_MALLOC_ALWAYSINTERNAL=(\d+)$/m)
    assert.ok(alwaysInternalMatch, 'CoreS3 sdkconfig should declare the internal allocation threshold')
    const alwaysInternal = Number(alwaysInternalMatch[1])
    const heap = esp32PlatformManifest.platforms['esp32/m5stack_cores3'].creation.heap
    const esp32XsSlotBytes = 16

    assert.ok(heap.initial * esp32XsSlotBytes > alwaysInternal)
    assert.ok(
      heap.incremental * esp32XsSlotBytes > alwaysInternal,
      'incremental XS slot blocks must bypass ESP-IDF always-internal allocation so display SPI keeps DMA memory',
    )
  })

  test('the M5StackChan CoreS3 smoke MOD exercises hardware APIs and documents real npm scripts', () => {
    const smokeSource = readFileSync('mods/examples/m5stackchan_smoke/mod.js', 'utf8')
    const smokeDocs = readFileSync('docs/m5stackchan-cores3-smoke.md', 'utf8')

    for (const api of ['lightOn', 'lightBlink', 'lightRainbow', 'lightOff']) {
      assert.match(
        smokeSource,
        new RegExp(`robot\\.lighting\\.${api}\\b`),
        `smoke MOD should exercise robot.lighting.${api}`,
      )
    }
    for (const api of ['setTorque', 'setPose']) {
      assert.match(
        smokeSource,
        new RegExp(`robot\\.motion\\.${api}\\b`),
        `smoke MOD should exercise robot.motion.${api}`,
      )
    }

    const documentedScripts = npmRunScripts(smokeDocs)
    assert.ok(documentedScripts.includes('build:m5stackchan_cores3'))
    assert.ok(documentedScripts.includes('flash:m5stackchan_cores3'))
    assert.ok(documentedScripts.includes('mod:m5stackchan_cores3'))
    for (const script of documentedScripts) {
      assert.ok(packageJson.scripts[script], `smoke docs reference missing npm script: ${script}`)
    }
  })
})
