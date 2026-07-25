import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const bridgeSource = readFileSync('host/modules/usb-audio/bridge.ts', 'utf8')
const workerBridgeSource = readFileSync('host/modules/usb-audio/worker-bridge.ts', 'utf8')
const workerSource = readFileSync('host/modules/usb-audio/worker.ts', 'utf8')
const sharedOutputSource = readFileSync('host/modules/usb-audio/shared-speaker-output.ts', 'utf8')
const mainSource = readFileSync('host/app/main.ts', 'utf8')
const appManifest = JSON.parse(readFileSync('host/app/manifest.json', 'utf8')) as { include?: string[] }
const usbAppManifest = JSON.parse(readFileSync('host/app/manifest_android_usb_audio.json', 'utf8')) as {
  include?: string[]
  config?: { usbAudio?: { enabled?: boolean; speakerVolume?: number } }
}
const diagnosticAppManifest = JSON.parse(
  readFileSync('host/app/manifest_android_usb_audio_diagnostics.json', 'utf8'),
) as {
  include?: string[]
  config?: { usbAudio?: { enabled?: boolean; diagnostics?: boolean; speakerVolume?: number } }
}
const diagnosticNoUiAppManifest = JSON.parse(
  readFileSync('host/app/manifest_android_usb_audio_diagnostics_no_ui.json', 'utf8'),
) as {
  include?: string[]
  config?: { usbAudio?: { presentationEnabled?: boolean } }
}
const usbModuleManifest = JSON.parse(readFileSync('host/modules/usb-audio/manifest.json', 'utf8')) as {
  include?: string[]
  modules?: Record<string, string>
  preload?: string[]
  platforms?: Record<string, { modules?: Record<string, string> }>
}
const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts?: Record<string, string>
}

test('USB audio exposes the default entry point consumed by Modules.importNow', () => {
  assert.match(workerBridgeSource, /export default startUsbAudioBridge/)
  assert.match(mainSource, /Modules\.importNow\('stackchan-usb-audio'\)/)
  assert.match(mainSource, /speakerVolume: usbAudio\.speakerVolume/)
  assert.match(mainSource, /usbAudioBridge\?\.setPresentation\(createUsbAudioPresentation\(context\)\)/)
})

test('USB polling runs in a high-priority worker while physical audio I/O stays on the main VM', () => {
  assert.match(workerBridgeSource, /new Worker\('stackchan-usb-audio-worker'/)
  assert.match(workerBridgeSource, /core: 1/)
  assert.match(workerBridgeSource, /priority: 5/)
  assert.match(workerBridgeSource, /SharedByteRing\.allocate\(SHARED_PCM_RING_BYTES\)/)
  assert.match(workerBridgeSource, /new AudioIn\(/)
  assert.match(workerBridgeSource, /new AudioOut\(/)
  assert.match(workerSource, /from 'stackchan-usb-audio-core'/)
  assert.match(workerSource, /new SharedSpeakerOutputService/)
  assert.doesNotMatch(workerSource, /new AudioIn\(/)
  assert.doesNotMatch(workerSource, /new AudioOut\(/)
  assert.doesNotMatch(bridgeSource, /new AudioIn\(/)
  assert.doesNotMatch(bridgeSource, /new AudioOut\(/)
  assert.doesNotMatch(sharedOutputSource, /id: 'audio-data'/)
  assert.match(workerBridgeSource, /Timer\.repeat\(\(\) => this\.#drainAudio\(\), SHARED_PCM_PUMP_MILLISECONDS\)/)
  assert.equal(usbModuleManifest.modules?.['stackchan-usb-audio'], './worker-bridge')
  assert.equal(usbModuleManifest.modules?.['stackchan-usb-audio-core'], './bridge')
  assert.equal(usbModuleManifest.modules?.['stackchan-usb-audio-worker'], './worker')
  assert.equal(usbModuleManifest.modules?.['stackchan-usb-shared-output'], './shared-speaker-output')
  assert.match(workerBridgeSource, /from 'web-radio-byte-ring'/)
  assert.deepEqual(usbModuleManifest.preload, ['stackchan-usb-audio'])
})

test('USB speaker playback keeps one second of PCM and starts with a 500 ms prebuffer', () => {
  const pcmHandler = bridgeSource.slice(
    bridgeSource.indexOf('#handleSpeakerPcm'),
    bridgeSource.indexOf('#handleSpeakerText'),
  )
  assert.match(bridgeSource, /const SPEAKER_BUFFER_MILLISECONDS = 1000/)
  assert.match(bridgeSource, /const SPEAKER_PREBUFFER_MILLISECONDS = 500/)
  assert.match(bridgeSource, /#readBuffer = new Uint8Array\(USB_RX_READ_BYTES\)/)
  assert.match(bridgeSource, /reads < MAX_USB_RX_READS_PER_POLL/)
  assert.match(bridgeSource, /new StackChanFrameParser\(crc32UsbSerial\)/)
  assert.match(bridgeSource, /encodeStackChanFrame\(frame, crc32UsbSerial\)/)
  assert.match(workerBridgeSource, /const SHARED_PCM_RING_BYTES = 64 \* 1024/)
  assert.match(workerBridgeSource, /const SPEAKER_DMA_BUFFER_BYTES = 2048/)
  assert.match(bridgeSource, /payload\.byteLength > this\.#speakerCreditOutstanding/)
  assert.match(bridgeSource, /this\.#speakerCreditOutstanding -= payload\.byteLength/)
  assert.match(bridgeSource, /targetOutstanding = Math\.min\(SPEAKER_CREDIT_WINDOW_BYTES, freeBytes\)/)
  assert.doesNotMatch(pcmHandler, /#drainSpeaker/)
  assert.match(bridgeSource, /this\.#speakerBuffer\.setWritableBytes\(writable\)/)
  assert.match(workerBridgeSource, /this\.#outputRing\.readableView\(this\.#audioWritableBytes\)/)
  assert.match(workerBridgeSource, /audio\.write\(SPEAKER_SILENCE\.subarray\(0, padding\)\)/)
  assert.match(workerBridgeSource, /this\.#audioDrainCallbacksRemaining = SPEAKER_DMA_DRAIN_CALLBACKS/)
  assert.match(workerBridgeSource, /if \(amp\) amp\.sampleRate = sampleRate/)
  assert.match(workerSource, /position: outputService\?\.writtenBytes \?\? 0/)
  assert.match(bridgeSource, /case StackChanControl\.STATUS:/)
  assert.match(workerSource, /id: 'status-changed'/)
  assert.match(workerBridgeSource, /case 'status-changed':/)
})

test('USB audio remains isolated to the dedicated CoreS3 release manifest', () => {
  assert.ok(!appManifest.include?.includes('../modules/usb-audio/manifest.json'))
  assert.ok(usbAppManifest.include?.includes('../modules/usb-audio/manifest.json'))
  assert.equal(usbAppManifest.config?.usbAudio?.enabled, true)
  assert.equal(usbAppManifest.config?.usbAudio?.speakerVolume, 0.25)
  assert.ok(diagnosticAppManifest.include?.includes('./manifest_android_usb_audio.json'))
  assert.equal(diagnosticAppManifest.config?.usbAudio?.enabled, true)
  assert.equal(diagnosticAppManifest.config?.usbAudio?.diagnostics, true)
  assert.equal(diagnosticAppManifest.config?.usbAudio?.speakerVolume, 0)
  assert.ok(diagnosticNoUiAppManifest.include?.includes('./manifest_android_usb_audio_diagnostics.json'))
  assert.equal(diagnosticNoUiAppManifest.config?.usbAudio?.presentationEnabled, false)
  assert.deepEqual(Object.keys(usbModuleManifest.platforms ?? {}), ['esp32/m5stackchan_cores3'])
  assert.equal(usbModuleManifest.modules?.['stackchan-usb-serial'], undefined)
  assert.equal(usbModuleManifest.modules?.['stackchan-usb-speaker-buffer'], './speaker-buffer')
  assert.ok(usbModuleManifest.include?.includes('$(MODDABLE)/modules/data/text/decoder/manifest.json'))
  assert.equal(
    usbModuleManifest.platforms?.['esp32/m5stackchan_cores3']?.modules?.['stackchan-usb-serial'],
    './usb-serial',
  )
  for (const script of ['build:android-usb-audio', 'flash:android-usb-audio']) {
    assert.match(packageJson.scripts?.[script] ?? '', /--mode=release/)
  }
  for (const script of ['build:android-usb-audio-diagnostics', 'flash:android-usb-audio-diagnostics']) {
    assert.match(packageJson.scripts?.[script] ?? '', /manifest_android_usb_audio_diagnostics\.json/)
  }
  for (const script of ['build:android-usb-audio-diagnostics-no-ui', 'flash:android-usb-audio-diagnostics-no-ui']) {
    assert.match(packageJson.scripts?.[script] ?? '', /manifest_android_usb_audio_diagnostics_no_ui\.json/)
  }
  assert.match(packageJson.scripts?.['flash:android-usb-audio'] ?? '', /firmware\.mjs deploy/)
})
