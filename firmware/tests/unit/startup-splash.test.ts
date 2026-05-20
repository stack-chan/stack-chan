import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const splashPath = 'stackchan/startup-splash.ts'
const splashImagePath = 'stackchan/assets/images/startup-splash.png'
const defaultLaunchPath = 'stackchan/default-mods/on-launch.ts'
const wasmModPath = 'stackchan/default-mods/wasm/mod.ts'
const manifestPath = 'stackchan/manifest.json'
const wasmManifestPath = 'stackchan/manifest_wasm.json'

function readPngSize(path: string) {
  const buffer = readFileSync(path)
  assert.equal(buffer.toString('ascii', 1, 4), 'PNG')
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

describe('startup splash screen', () => {
  test('uses the requested 320x240 Stack-chan loading splash image', () => {
    assert.equal(existsSync(splashPath), true)
    assert.equal(existsSync(splashImagePath), true)

    const source = readFileSync(splashPath, 'utf8')
    assert.match(source, /startup-splash\.png/)
    assert.match(source, /new Texture/)
    assert.match(source, /new Skin/)
    assert.match(source, /new Application/)
    assert.match(source, /new Content/)

    assert.deepEqual(readPngSize(splashImagePath), { width: 320, height: 240 })
  })

  test('registers the splash texture resource for device and wasm builds', () => {
    assert.match(readFileSync(manifestPath, 'utf8'), /\.\/assets\/images\/startup-splash/)
    assert.match(readFileSync(wasmManifestPath, 'utf8'), /\.\/assets\/images\/startup-splash/)
  })

  test('default launch shows a touchable splash before startup choice branching', () => {
    const splashSource = readFileSync(splashPath, 'utf8')
    const launchSource = readFileSync(defaultLaunchPath, 'utf8')

    assert.match(splashSource, /onTouchBegan/)
    assert.match(splashSource, /touchCount: 1/)
    assert.match(launchSource, /showStartupSplash\(\{ onTouch:/)
    assert.ok(launchSource.indexOf('showStartupSplash') < launchSource.indexOf('waitForStartupChoice'))
  })

  test('startup choice automatically boots after timeout and enters settings on screen touch', () => {
    const source = readFileSync(defaultLaunchPath, 'utf8')

    assert.match(source, /import \{ showSetupUI \} from 'setup-ui'/)
    assert.match(source, /type StartupChoice = 'boot' \| 'settings'/)
    assert.match(source, /const STARTUP_AUTO_BOOT_DELAY_MS = 3000/)
    assert.match(source, /function waitForStartupChoice/)
    assert.match(source, /showStartupSplash\(\{ onTouch: \(\) => Timer\.set\(\(\) => choose\('settings'\), 0\) \}\)/)
    assert.match(source, /choose\('boot'\)/)
    assert.match(source, /resolve\(\{ choice, application \}\)/)
    assert.match(source, /startupChoice\.choice === 'boot'/)
    assert.match(source, /showSetupUI\(\{/)
  })

  test('wasm default mod uses the same touch-or-timeout launch choice', () => {
    const mainSource = readFileSync('stackchan/main.ts', 'utf8')
    const source = readFileSync(wasmModPath, 'utf8')
    const manifest = readFileSync(wasmManifestPath, 'utf8')

    assert.match(mainSource, /Modules\.importNow\('default-mods\/wasm\/mod'\)/)
    assert.match(source, /default-mods\/on-launch/)
    assert.doesNotMatch(source, /default-mods\/wasm\/on-launch/)
    assert.match(manifest, /"setup-ui-networks": "\.\/wasm\/setup-ui-networks"/)
    assert.match(manifest, /"default-mods\/wasm\/mod"/)
  })
})
