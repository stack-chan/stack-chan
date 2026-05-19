import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const splashPath = 'stackchan/startup-splash.ts'
const splashImagePath = 'stackchan/assets/images/startup-splash.png'
const defaultLaunchPath = 'stackchan/default-mods/on-launch.ts'
const wasmLaunchPath = 'stackchan/default-mods/wasm/on-launch.ts'
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

  test('default launch shows the splash before setup-mode branching', () => {
    const source = readFileSync(defaultLaunchPath, 'utf8')

    assert.match(source, /showStartupSplash/)
    assert.ok(source.indexOf('showStartupSplash') < source.indexOf('waitForKey'))
  })

  test('wasm launch keeps the splash visible long enough to smoke in the simulator', () => {
    const source = readFileSync(wasmLaunchPath, 'utf8')

    assert.match(source, /showStartupSplash/)
    assert.match(source, /Timer\.set/)
    assert.match(source, /resolve\(true\)/)
  })

  test('wasm default mod imports the wasm-specific launch hook', () => {
    const mainSource = readFileSync('stackchan/main.ts', 'utf8')
    const source = readFileSync(wasmModPath, 'utf8')
    const manifest = readFileSync(wasmManifestPath, 'utf8')

    assert.match(mainSource, /Modules\.importNow\('default-mods\/wasm\/mod'\)/)
    assert.match(source, /default-mods\/wasm\/on-launch/)
    assert.match(manifest, /"default-mods\/wasm\/mod"/)
  })
})
