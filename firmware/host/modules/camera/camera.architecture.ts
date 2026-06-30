import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('camera manifest selects runtime implementation by platform', () => {
  const manifest = JSON.parse(readFileSync('host/modules/camera/manifest.json', 'utf8'))
  const wasmManifest = JSON.parse(readFileSync('host/modules/camera/manifest_wasm.json', 'utf8'))
  const deviceTargets = [
    'esp32/m5stack_cores3',
    'esp32/m5stackchan_cores3',
    'esp32/m5atom_s3r_cam',
    'esp32/m5atom_s3r_m12',
    'esp32/lilygo_t_camera_plus_s3',
    'esp32/xiao_esp32s3_sense',
  ]

  assert.equal(manifest.modules, undefined)
  assert.equal(manifest.platforms.esp32.modules.camera, './lin/camera')
  assert.equal(manifest.platforms.lin.modules.camera, './lin/camera')
  assert.equal(manifest.platforms.mac.modules.camera, './lin/camera')
  assert.equal(manifest.platforms.win.modules.camera, './lin/camera')
  for (const target of deviceTargets) {
    assert.equal(manifest.platforms[target].modules.camera, './device/camera')
    assert.ok(manifest.platforms[target].include.includes('./manifest_device.json'))
    assert.equal(
      manifest.platforms[target].include.includes('$(MODDABLE)/modules/io/imagein/camera/manifest.json'),
      false,
    )
  }
  assert.equal(wasmManifest.modules.camera, './wasm/camera')
})
