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

test('device TTS engines delegate playback state and AudioOut lifecycle to the shared helper', () => {
  const engineFiles = [
    'host/modules/audio/tts-local.ts',
    'host/modules/audio/tts-remote.ts',
    'host/modules/audio/tts-voicevox.ts',
    'host/modules/audio/tts-voicevox-web.ts',
    'host/modules/audio/tts-elevenlabs.ts',
    'host/modules/audio/tts-openai.ts',
  ]

  for (const file of engineFiles) {
    const source = readFileSync(file, 'utf8')
    assert.match(source, /from 'tts-playback-lifecycle'/, `${file} should use the shared TTS playback lifecycle`)
    assert.doesNotMatch(source, /new AudioOut\(/, `${file} should not construct AudioOut directly`)
    assert.doesNotMatch(source, /this\.streaming\s*=\s*true/, `${file} should not own streaming activation`)
  }

  const streamingSource = readFileSync('host/modules/audio/stackchan-voice/tts-stackchan-voice.ts', 'utf8')
  assert.match(streamingSource, /from 'tts-playback-lifecycle'/)
  assert.match(streamingSource, /beginTTSPlayback\(this, callback/)
  assert.match(streamingSource, /lifecycle\.addCleanup\(/)
  assert.match(streamingSource, /new AudioOut\(/)
  assert.match(streamingSource, /onWritable: \(size\) => this\.#onWritable\(size\)/)
  assert.match(streamingSource, /writable - this\.#freeBytes/)
  assert.match(streamingSource, /const DMA_CHUNK_SAMPLES = 2046/)
  assert.match(streamingSource, /output\.write\(chunk\.bytes\)/)
  assert.doesNotMatch(streamingSource, /output\.write\(chunk\.buffer\)/)
  assert.doesNotMatch(streamingSource, /DRAIN_SAMPLES|drainTimer/)
  assert.match(streamingSource, /new Resource\('stackchan-ja\.aqd'\)/)
  assert.match(streamingSource, /props\.volume \?\? 0\.1/)
  assert.match(streamingSource, /props\.speed \?\? 100/)
  assert.match(streamingSource, /lifecycle\.onPower\(/)
  assert.doesNotMatch(streamingSource, /this\.streaming\s*=\s*true/)
})

test('Whisper multipart upload does not concatenate the whole recording buffer', () => {
  const sttWhisper = readFileSync('host/modules/audio/stt-whisper.ts', 'utf8')

  assert.doesNotMatch(sttWhisper, /new ArrayBuffer\(header\.length \+ buffer\.byteLength \+ footer\.length\)/)
  assert.doesNotMatch(sttWhisper, /bodyView\.set\(new Uint8Array\(buffer\)/)
  assert.doesNotMatch(sttWhisper, /body:\s*bodyView\.buffer/)
})
