import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const splashPath = 'stackchan/startup-splash.ts'
const defaultLaunchPath = 'stackchan/default-mods/on-launch.ts'
const wasmModPath = 'stackchan/default-mods/wasm/mod.ts'
const manifestPath = 'stackchan/manifest.json'
const wasmManifestPath = 'stackchan/manifest_wasm.json'
const serviceManifestPath = 'stackchan/services/manifest_service.json'
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
    assert.match(source, /resolve\(\{ choice, application: state\.application as PiuApplication \}\)/)
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

  test('device boot shows launch splash before attempting Wi-Fi', () => {
    const mainSource = readFileSync('stackchan/main.ts', 'utf8')
    const launchBlock = mainSource.slice(
      mainSource.indexOf('async function launchDefaultPath()'),
      mainSource.indexOf('function launchWasmPath()'),
    )

    assert.match(mainSource, /await launchDefaultPath\(\)/)
    assert.match(launchBlock, /await \(onLaunch\?\.\(\) \?\? true\)/)
    assert.match(launchBlock, /await bootRobot\(onRobotCreated\)/)
    assert.ok(
      launchBlock.indexOf('await (onLaunch?.() ?? true)') < launchBlock.indexOf('await bootRobot(onRobotCreated)'),
    )
  })

  test('Wi-Fi recovery screen offers retry and offline choices', () => {
    const splashSource = readFileSync(splashPath, 'utf8')
    const mainSource = readFileSync('stackchan/main.ts', 'utf8')

    assert.match(splashSource, /export function showWiFiRecoveryChoice/)
    assert.match(splashSource, /A: Retry/)
    assert.match(splashSource, /C: Start offline/)
    assert.match(mainSource, /const WIFI_CONNECT_ATTEMPTS = 3/)
    assert.match(mainSource, /function loadWiFiPreferences\(\)/)
    assert.match(mainSource, /ssid: typeof config\.ssid === 'string' \? config\.ssid : undefined/)
    assert.match(mainSource, /password: typeof config\.password === 'string' \? config\.password : undefined/)
    assert.match(mainSource, /\.\.\.\(loadPreferences\('wifi'\) as WiFiPreferences\)/)
    assert.match(mainSource, /showWiFiRecoveryChoice/)
    assert.match(mainSource, /choose\('retry'\)/)
    assert.match(mainSource, /choose\('offline'\)/)
  })

  test('Wi-Fi connection helper is not preloaded before startup splash', () => {
    const serviceManifest = readManifest(serviceManifestPath)
    const manifest = readManifest(manifestPath)
    const mainSource = readFileSync('stackchan/main.ts', 'utf8')
    const launchSource = readFileSync(defaultLaunchPath, 'utf8')

    assert.equal(
      serviceManifest.modules['wifi/connection'],
      '$(MODDABLE)/examples/network/wifi/wificonnection/wificonnection',
    )
    assert.ok(!manifest.include.includes('$(MODDABLE)/examples/manifest_net.json'))
    assert.equal(manifest.modules['~'], '$(BUILD)/devices/esp32/setup/network')
    assert.doesNotMatch(JSON.stringify(manifest.modules), /"setup\/network"/)
    assert.ok(!serviceManifest.include.includes('$(MODULES)/network/wifi/manifest.json'))
    assert.doesNotMatch(JSON.stringify(serviceManifest.preload ?? []), /wifi\/connection/)
    assert.doesNotMatch(JSON.stringify(serviceManifest.preload ?? []), /"wifi"/)
    assert.doesNotMatch(mainSource, /import \{ NetworkService \} from 'network-service'/)
    assert.doesNotMatch(launchSource, /import \{ NetworkService \} from 'network-service'/)
    assert.match(mainSource, /Modules\.importNow\('network-service'\)/)
    assert.match(launchSource, /Modules\.importNow\('network-service'\)/)
  })
})
