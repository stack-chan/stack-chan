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

test('wasm TTS engines share one stub through stable module specifiers', () => {
  const manifest = JSON.parse(readFileSync('host/modules/audio/manifest_wasm.json', 'utf8')) as {
    modules: Record<string, string>
  }
  const engines = ['tts-local', 'tts-remote', 'tts-voicevox', 'tts-voicevox-web', 'tts-elevenlabs', 'tts-openai']

  assert.equal(manifest.modules['tts-stub'], './wasm/tts-stub')
  assert.match(readFileSync('host/modules/audio/wasm/tts-stub.ts', 'utf8'), /export class TTS/)

  for (const engine of engines) {
    assert.equal(manifest.modules[engine], `./wasm/${engine}`)
    assert.equal(readFileSync(`host/modules/audio/wasm/${engine}.ts`, 'utf8').trim(), "export { TTS } from 'tts-stub'")
  }
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
})

test('Whisper multipart upload does not concatenate the whole recording buffer', () => {
  const sttWhisper = readFileSync('host/modules/audio/stt-whisper.ts', 'utf8')

  assert.doesNotMatch(sttWhisper, /new ArrayBuffer\(header\.length \+ buffer\.byteLength \+ footer\.length\)/)
  assert.doesNotMatch(sttWhisper, /bodyView\.set\(new Uint8Array\(buffer\)/)
  assert.doesNotMatch(sttWhisper, /body:\s*bodyView\.buffer/)
})
