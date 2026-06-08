import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const splashPath = 'stackchan/startup-splash.ts'
const defaultLaunchPath = 'stackchan/default-mods/on-launch.ts'
const wasmModPath = 'stackchan/default-mods/wasm/mod.ts'
const manifestPath = 'stackchan/manifest.json'
const wasmManifestPath = 'stackchan/manifest_wasm.json'
const splashFontResource = '$(MODDABLE)/examples/assets/fonts/OpenSans-Regular-24'

function readManifest(path: string) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

describe('startup splash screen', () => {
  test('uses a simple Label-based Stack-chan loading splash screen', () => {
    const source = readFileSync(splashPath, 'utf8')
    assert.match(source, /new Application/)
    assert.match(source, /new Container/)
    assert.match(source, /new Column/)
    assert.match(source, /new Label/)
    assert.match(source, /new Skin/)
    assert.match(source, /new Style/)
    assert.match(source, /const SPLASH_FONT = '24px Open Sans'/)
    assert.match(source, /Stack-chan/)
    assert.match(source, /Starting\.\.\./)
    assert.doesNotMatch(source, /startup-splash\.png/)
    assert.doesNotMatch(source, /new Texture/)
    assert.doesNotMatch(source, /28px Open Sans/)
  })

  test('does not register a startup splash image resource for device or wasm builds', () => {
    assert.doesNotMatch(readFileSync(manifestPath, 'utf8'), /\.\/assets\/images\/startup-splash/)
    assert.doesNotMatch(readFileSync(wasmManifestPath, 'utf8'), /\.\/assets\/images\/startup-splash/)
  })

  test('uses a font resource registered for both device and wasm builds', () => {
    const manifest = readManifest(manifestPath)
    const wasmManifest = readManifest(wasmManifestPath)

    assert.match(readFileSync(splashPath, 'utf8'), /const SPLASH_FONT = '24px Open Sans'/)
    assert.deepEqual(manifest.resources['*-mask'], [splashFontResource])
    assert.deepEqual(wasmManifest.resources['*-mask'], [splashFontResource])
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

    assert.match(source, /type StartupChoice = 'boot' \| 'settings'/)
    assert.match(source, /const STARTUP_AUTO_BOOT_DELAY_MS = 3000/)
    assert.match(source, /function waitForStartupChoice/)
    assert.match(source, /showStartupSplash\(\{ onTouch: \(\) => Timer\.set\(\(\) => choose\('settings'\), 0\) \}\)/)
    assert.match(source, /choose\('boot'\)/)
    assert.match(source, /resolve\(\{ choice, application \}\)/)
    assert.match(source, /startupChoice\.choice === 'boot'/)
  })

  test('wasm default mod uses the wasm-specific startup splash hook', () => {
    const mainSource = readFileSync('stackchan/main.ts', 'utf8')
    const source = readFileSync(wasmModPath, 'utf8')
    const manifest = readFileSync(wasmManifestPath, 'utf8')

    assert.match(mainSource, /Modules\.importNow\('default-mods\/wasm\/mod'\)/)
    assert.match(source, /default-mods\/wasm\/on-launch/)
    assert.doesNotMatch(source, /default-mods\/on-launch'/)
    assert.match(manifest, /"default-mods\/wasm\/mod"/)
  })
})
