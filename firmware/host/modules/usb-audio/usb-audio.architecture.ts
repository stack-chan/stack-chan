import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'

type Manifest = {
  include?: string[]
  modules?: Record<string, string | string[]>
  preload?: string[]
  platforms?: Record<string, { modules?: Record<string, string> }>
  config?: {
    usbAudio?: {
      enabled?: boolean
      autoStart?: boolean
      diagnostics?: boolean
      presentationEnabled?: boolean
      speakerVolume?: number
    }
  }
}

const appManifest = readManifest('host/app/manifest.json')
const wasmManifest = readManifest('host/platforms/wasm/manifest.json')
const coreS3Manifest = readManifest('host/app/manifest_m5stackchan_cores3.json')
const usbAppManifest = readManifest('host/app/manifest_android_usb_audio.json')
const diagnosticAppManifest = readManifest('host/app/manifest_android_usb_audio_diagnostics.json')
const diagnosticNoUiAppManifest = readManifest('host/app/manifest_android_usb_audio_diagnostics_no_ui.json')
const dockManifest = readManifest('host/app/docks/android-usb-audio/manifest.json')
const usbModuleManifest = readManifest('host/modules/usb-audio/manifest.json')
const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts?: Record<string, string>
}

test('CoreS3 composes the USB Dock without leaking it into shared or WASM graphs', () => {
  const sharedModules = asModuleList(appManifest)
  const wasmModules = asModuleList(wasmManifest)

  assert.ok(sharedModules.includes('./dock'))
  assert.ok(wasmModules.includes('../../app/dock'))
  for (const specifier of [...sharedModules, ...wasmModules]) {
    assert.doesNotMatch(specifier, /usb|remote-session|approval/)
  }
  assert.ok(coreS3Manifest.include?.includes('./docks/android-usb-audio/manifest.json'))
  assert.ok(coreS3Manifest.include?.includes('../modules/usb-audio/manifest.json'))
  assert.deepEqual(usbAppManifest.include, ['./manifest_m5stackchan_cores3.json'])
  assert.equal(dockManifest.modules?.['stackchan-dock'], './dock')
  assert.equal(dockManifest.modules?.['stackchan-remote-session-facade'], '../../remote-session/facade')
  assert.equal(dockManifest.modules?.['stackchan-remote-session-runtime'], '../../remote-session/runtime')
  assert.equal(dockManifest.modules?.['stackchan-task-session'], '../../remote-session/task-session')
  assert.equal(dockManifest.modules?.['stackchan-usb-dock-presentation'], './presentation')
  assert.equal(dockManifest.modules?.['stackchan-usb-dock-runtime'], './runtime')
})

test('the dynamically imported USB Dock presentation exposes a default factory', () => {
  const manifestPath = 'host/app/docks/android-usb-audio/manifest.json'
  const modulePath = dockManifest.modules?.['stackchan-usb-dock-presentation']
  assert.equal(typeof modulePath, 'string')

  const sourcePath = resolve(dirname(manifestPath), `${modulePath}.ts`)
  assert.match(readFileSync(sourcePath, 'utf8'), /^\s*export\s+default\s+/m)
})

test('USB transport stays platform-specific while physical audio remains on the main VM', () => {
  const bridgeImports = importSpecifiers('host/modules/usb-audio/bridge.ts')
  const workerImports = importSpecifiers('host/modules/usb-audio/worker.ts')
  const workerBridgeImports = importSpecifiers('host/modules/usb-audio/worker-bridge.ts')

  assert.ok(workerImports.includes('stackchan-usb-audio-core'))
  assert.ok(workerImports.includes('stackchan-usb-crc32'))
  assert.ok(workerImports.includes('stackchan-usb-serial'))
  assert.ok(workerBridgeImports.includes('worker'))
  assert.ok(workerBridgeImports.includes('embedded:io/audio/in'))
  assert.ok(workerBridgeImports.includes('embedded:io/audio/out'))
  assert.ok(!bridgeImports.some((specifier) => specifier.startsWith('embedded:io/audio/')))
  assert.ok(!workerImports.some((specifier) => specifier.startsWith('embedded:io/audio/')))
  assert.ok(bridgeImports.includes('stackchan-usb-serial-types'))
  assert.ok(!bridgeImports.includes('stackchan-usb-crc32'))
  assert.ok(!bridgeImports.includes('stackchan-usb-serial'))

  assert.equal(usbModuleManifest.modules?.['stackchan-usb-audio'], './worker-bridge')
  assert.equal(usbModuleManifest.modules?.['stackchan-usb-audio-core'], './bridge')
  assert.equal(usbModuleManifest.modules?.['stackchan-usb-audio-worker'], './worker')
  assert.equal(usbModuleManifest.modules?.['stackchan-usb-media-session'], './media-session')
  assert.equal(usbModuleManifest.modules?.['stackchan-usb-serial-types'], './usb-serial-types')
  assert.equal(usbModuleManifest.preload, undefined)
  assert.deepEqual(Object.keys(usbModuleManifest.platforms ?? {}), ['esp32/m5stackchan_cores3'])
  assert.equal(usbModuleManifest.modules?.['stackchan-usb-serial'], undefined)
  assert.equal(usbModuleManifest.modules?.['stackchan-usb-crc32'], undefined)
  assert.equal(
    usbModuleManifest.platforms?.['esp32/m5stackchan_cores3']?.modules?.['stackchan-usb-crc32'],
    './usb-crc32',
  )
  assert.equal(
    usbModuleManifest.platforms?.['esp32/m5stackchan_cores3']?.modules?.['stackchan-usb-serial'],
    './usb-serial',
  )
})

test('release and diagnostic manifests compose the same USB Dock in layers', () => {
  assert.equal(coreS3Manifest.config?.usbAudio?.enabled, false)
  assert.equal(coreS3Manifest.config?.usbAudio?.autoStart, false)
  assert.equal(coreS3Manifest.config?.usbAudio?.speakerVolume, undefined)
  assert.equal(usbAppManifest.config?.usbAudio?.enabled, true)
  assert.equal(usbAppManifest.config?.usbAudio?.autoStart, true)
  assert.equal(usbAppManifest.config?.usbAudio?.speakerVolume, undefined)
  assert.ok(diagnosticAppManifest.include?.includes('./manifest_android_usb_audio.json'))
  assert.equal(diagnosticAppManifest.config?.usbAudio?.autoStart, true)
  assert.equal(diagnosticAppManifest.config?.usbAudio?.diagnostics, true)
  assert.equal(diagnosticAppManifest.config?.usbAudio?.speakerVolume, 0)
  assert.ok(diagnosticNoUiAppManifest.include?.includes('./manifest_android_usb_audio_diagnostics.json'))
  assert.equal(diagnosticNoUiAppManifest.config?.usbAudio?.autoStart, true)
  assert.equal(diagnosticNoUiAppManifest.config?.usbAudio?.presentationEnabled, false)

  for (const script of ['build:android-usb-audio', 'flash:android-usb-audio']) {
    assert.match(packageJson.scripts?.[script] ?? '', /manifest_android_usb_audio\.json/)
  }
  for (const script of ['build:android-usb-audio-diagnostics', 'flash:android-usb-audio-diagnostics']) {
    assert.match(packageJson.scripts?.[script] ?? '', /manifest_android_usb_audio_diagnostics\.json/)
  }
  for (const script of ['build:android-usb-audio-diagnostics-no-ui', 'flash:android-usb-audio-diagnostics-no-ui']) {
    assert.match(packageJson.scripts?.[script] ?? '', /manifest_android_usb_audio_diagnostics_no_ui\.json/)
  }
})

test('vendored Dock wire vectors retain pinned provenance and byte hashes', () => {
  const provenance = JSON.parse(readFileSync('vendor/stack-chan-dock/VENDOR_SOURCE.json', 'utf8')) as {
    upstream?: string
    revision?: string
    files?: Record<string, string>
  }
  assert.equal(provenance.upstream, 'https://github.com/meganetaaan/stack-chan-dock')
  assert.match(provenance.revision ?? '', /^[0-9a-f]{40}$/)
  assert.deepEqual(Object.keys(provenance.files ?? {}).sort(), [
    'LICENSE',
    'contracts/usb-cdc-v2/application-event-vectors.json',
    'contracts/usb-cdc-v2/negotiation-vectors.json',
    'contracts/usb-cdc-v2/test-vectors.json',
  ])
  for (const [path, expected] of Object.entries(provenance.files ?? {})) {
    const actual = createHash('sha256')
      .update(readFileSync(`vendor/stack-chan-dock/${path}`))
      .digest('hex')
    assert.equal(actual, expected, path)
  }
})

function readManifest(path: string): Manifest {
  return JSON.parse(readFileSync(path, 'utf8')) as Manifest
}

function asModuleList(manifest: Manifest): string[] {
  const modules = manifest.modules?.['*']
  assert.ok(Array.isArray(modules))
  return modules
}

function importSpecifiers(path: string): string[] {
  const source = readFileSync(path, 'utf8')
  return [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((match) => match[1])
}
