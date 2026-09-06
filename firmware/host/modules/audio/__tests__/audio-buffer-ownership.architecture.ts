import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const playbackCopyPatterns = [
  /\.slice\(/,
  /ArrayBuffer\.from\(/,
  /new ArrayBuffer\(buffer\.byteLength\)/,
  /new Uint8Array\(buffer\)/,
]

test('wasm microphone reuses the shared ownership helper instead of casting', () => {
  const wasmMicrophone = readFileSync('host/modules/audio/wasm/microphone.ts', 'utf8')

  assert.doesNotMatch(wasmMicrophone, /function ownAudioBuffer/)
  assert.doesNotMatch(wasmMicrophone, /as OwnedAudioBuffer/)
})

test('playback path forwards large ArrayBuffers without copy helpers', () => {
  const playbackSources = [
    readFileSync('host/app/runtime-audio.ts', 'utf8'),
    readFileSync('host/modules/audio/wasm/speaker.ts', 'utf8'),
  ].join('\n')

  for (const pattern of playbackCopyPatterns) {
    assert.doesNotMatch(playbackSources, pattern)
  }
})

test('wasm remote TTS engines share one stub while stackchan-voice keeps its native renderer', () => {
  const manifest = JSON.parse(readFileSync('host/modules/audio/manifest_wasm.json', 'utf8')) as {
    include: string[]
    modules: Record<string, string>
  }
  const stubbedEngines = ['tts-local', 'tts-remote', 'tts-voicevox', 'tts-voicevox-web', 'tts-elevenlabs', 'tts-openai']

  assert.equal(manifest.modules['tts-stub'], './wasm/tts-stub')
  assert.match(readFileSync('host/modules/audio/wasm/tts-stub.ts', 'utf8'), /export class TTS/)

  for (const engine of stubbedEngines) {
    assert.equal(manifest.modules[engine], `./wasm/${engine}`)
    assert.equal(readFileSync(`host/modules/audio/wasm/${engine}.ts`, 'utf8').trim(), "export { TTS } from 'tts-stub'")
  }

  assert.ok(manifest.include.includes('../../../vendor/stackchan-voice/manifest.json'))
  assert.equal(manifest.modules['tts-stackchan-voice'], './wasm/tts-stackchan-voice')
  const stackchanVoice = readFileSync('host/modules/audio/wasm/tts-stackchan-voice.ts', 'utf8')
  assert.match(stackchanVoice, /from 'stackchanvoice'/)
  assert.match(stackchanVoice, /renderStackchanVoiceWav/)
  assert.match(stackchanVoice, /startPlayBuffer\(rendered\.buffer\)/)
  assert.doesNotMatch(stackchanVoice, /from 'tts-stub'/)
})

test('M5StackChan CoreS3 excludes the fallback stackchan-voice module before selecting the device renderer', () => {
  const manifest = JSON.parse(readFileSync('host/modules/audio/manifest.json', 'utf8')) as {
    platforms: Record<string, { modules: Record<string, string> }>
  }
  const modules = manifest.platforms['esp32/m5stackchan_cores3'].modules

  assert.equal(modules['~'], './tts-stackchan-voice')
  assert.equal(modules['tts-stackchan-voice'], './stackchan-voice/tts-stackchan-voice')
  assert.equal(modules.stackchanOpusDecoder, './platforms/m5stackchan-cores3/esp32-opus-decoder')
  assert.equal(modules.stackchanOpusEncoder, './platforms/m5stackchan-cores3/esp32-opus-encoder')
})

test('M5StackChan CoreS3 excludes the generic PCM writer before selecting its target adapter', () => {
  const manifest = JSON.parse(readFileSync('host/modules/conversation/manifest.json', 'utf8')) as {
    modules: Record<string, string>
    platforms: Record<string, { modules: Record<string, string | string[]> }>
  }
  const fallback = manifest.modules.stackchanPcmRingWriter
  const modules = manifest.platforms['esp32/m5stackchan_cores3'].modules

  assert.ok(Array.isArray(modules['~']))
  assert.ok(modules['~'].includes(fallback))
  assert.equal(modules.stackchanPcmRingWriter, './chat-audioio/pcm-ring-writer-native')
  assert.notEqual(modules.stackchanPcmRingWriter, fallback)
})

test('XiaoZhi uplink has one native SPSC path without spin locks', () => {
  const workerStack = readFileSync('host/modules/conversation/chat-audioio/worker-stack.js', 'utf8')
  const encoder = readFileSync('host/modules/audio/platforms/m5stackchan-cores3/esp32-opus-encoder.c', 'utf8')
  const model = readFileSync('host/modules/conversation/chat-audioio/xiaozhi-model.js', 'utf8')

  assert.match(workerStack, /from 'stackchanPcmRingWriter'/)
  assert.doesNotMatch(workerStack, /xs_pcm_ring_write_downmix/)
  assert.match(encoder, /xs_pcm_ring_write_downmix/)
  assert.doesNotMatch(workerStack, /audioInFlight/)
  assert.doesNotMatch(encoder, /__sync_lock|pcmRingMakeSpace|queueLatest|xs_esp32_opus_encoder_enqueue/)
  assert.doesNotMatch(model, /sendAudio\(message\)/)
})

test('conversation modules stay independent of app layer contracts', () => {
  const conversationFiles: string[] = []
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) {
        visit(path)
      } else if (/\.(ts|js)$/.test(path)) {
        conversationFiles.push(path)
      }
    }
  }
  visit('host/modules/conversation')

  for (const file of conversationFiles) {
    const source = readFileSync(file, 'utf8')
    assert.doesNotMatch(source, /from ['"]capabilities['"]/, `${file} should not depend on app capability contracts`)
    assert.doesNotMatch(source, /from ['"]app-[^'"]+['"]/, `${file} should not depend on app layer modules`)
    assert.doesNotMatch(source, /from ['"].*host\/app/, `${file} should not depend on host/app modules`)
  }
})

// TTS completion, PCM drain, ownership, rollback, and stale callbacks are
// exercised in the XS playback-lifecycle, http-playback, and stackchan-voice-device tests.
// Do not pin their implementation syntax or DMA chunk size here.

test('Whisper multipart upload does not concatenate the whole recording buffer', () => {
  const sttWhisper = readFileSync('host/modules/audio/stt-whisper.ts', 'utf8')

  assert.doesNotMatch(sttWhisper, /new ArrayBuffer\(header\.length \+ buffer\.byteLength \+ footer\.length\)/)
  assert.doesNotMatch(sttWhisper, /bodyView\.set\(new Uint8Array\(buffer\)/)
  assert.doesNotMatch(sttWhisper, /body:\s*bodyView\.buffer/)
})
