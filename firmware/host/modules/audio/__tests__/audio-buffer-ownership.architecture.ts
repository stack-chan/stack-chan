import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const playbackCopyPatterns = [
  /\.slice\(/,
  /ArrayBuffer\.from\(/,
  /new ArrayBuffer\(buffer\.byteLength\)/,
  /new Uint8Array\(buffer\)/,
]

test('audio buffer APIs document record ownership and playback borrowing', () => {
  const bufferTypes = readFileSync('host/modules/audio/audio-buffer.ts', 'utf8')
  const capabilities = readFileSync('host/app/capabilities.ts', 'utf8')
  const runtimeAudio = readFileSync('host/app/runtime-audio.ts', 'utf8')
  const microphone = readFileSync('host/modules/audio/microphone.ts', 'utf8')
  const speaker = readFileSync('host/modules/audio/speaker.ts', 'utf8')
  const wasmMicrophone = readFileSync('host/modules/audio/wasm/microphone.ts', 'utf8')
  const wasmSpeaker = readFileSync('host/modules/audio/wasm/speaker.ts', 'utf8')

  assert.match(bufferTypes, /export type OwnedAudioBuffer/)
  assert.match(bufferTypes, /export type BorrowedAudioBuffer/)
  assert.match(microphone, /Promise<OwnedAudioBuffer>/)
  assert.match(wasmMicrophone, /Promise<OwnedAudioBuffer>/)
  assert.match(wasmMicrophone, /import \{ ownAudioBuffer \} from 'audio-buffer'/)
  assert.doesNotMatch(wasmMicrophone, /function ownAudioBuffer/)
  assert.doesNotMatch(wasmMicrophone, /as OwnedAudioBuffer/)
  assert.match(capabilities, /record\(durationMilliSec\?: number\): Promise<OwnedAudioBuffer>/)
  assert.match(capabilities, /playAudio\(buffer: BorrowedAudioBuffer\): Promise<boolean>/)
  assert.match(runtimeAudio, /playAudio\(buffer: BorrowedAudioBuffer\): Promise<boolean>/)
  assert.match(speaker, /play\(buffer: BorrowedAudioBuffer\): Promise<boolean>/)
  assert.match(wasmSpeaker, /play\(buffer: BorrowedAudioBuffer\): Promise<boolean>/)
})

test('playback path forwards large ArrayBuffers without copy helpers', () => {
  const playbackSources = [
    readFileSync('host/app/runtime-audio.ts', 'utf8'),
    readFileSync('host/modules/audio/wasm/speaker.ts', 'utf8'),
  ].join('\n')

  for (const pattern of playbackCopyPatterns) {
    assert.doesNotMatch(playbackSources, pattern)
  }
  assert.match(playbackSources, /this\.#speaker\.play\(buffer\)/)
  assert.match(playbackSources, /audioBridge\.startPlayBuffer\(buffer\)/)
})

test('wasm TTS engines share one stub through stable module specifiers', () => {
  const manifest = JSON.parse(readFileSync('host/modules/audio/manifest_wasm.json', 'utf8')) as {
    modules: Record<string, string>
  }
  const engines = [
    'tts-local',
    'tts-remote',
    'tts-voicevox',
    'tts-voicevox-web',
    'tts-elevenlabs',
    'tts-openai',
    'tts-stackchan-voice',
  ]

  assert.equal(manifest.modules['tts-stub'], './wasm/tts-stub')
  assert.match(readFileSync('host/modules/audio/wasm/tts-stub.ts', 'utf8'), /export class TTS/)

  for (const engine of engines) {
    assert.equal(manifest.modules[engine], `./wasm/${engine}`)
    assert.equal(readFileSync(`host/modules/audio/wasm/${engine}.ts`, 'utf8').trim(), "export { TTS } from 'tts-stub'")
  }
})

test('audio owns TTS contract types used by app capabilities', () => {
  const ttsTypesPath = 'host/modules/audio/tts-types.ts'
  const capabilities = readFileSync('host/app/capabilities.ts', 'utf8')
  const appManifest = JSON.parse(readFileSync('host/app/manifest.json', 'utf8')) as {
    include: string[]
  }
  const audioWasmManifest = JSON.parse(readFileSync('host/modules/audio/manifest_wasm.json', 'utf8')) as {
    modules: Record<string, string>
  }

  assert.equal(existsSync(ttsTypesPath), true)
  assert.match(readFileSync(ttsTypesPath, 'utf8'), /export type TTSCompletion = \(error\?: unknown\) => void/)
  assert.match(capabilities, /import type \{ TTSCompletion, TTSDoneListener, TTSPlaybackListener \} from 'tts-types'/)
  assert.ok(appManifest.include.includes('../modules/audio/manifest.json'))
  assert.equal(audioWasmManifest.modules['tts-types'], './tts-types')

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
    assert.match(
      source,
      /\b(?:beginTTSPlayback|runTTSPlayback)\(this, callback/,
      `${file} should enter playback through the helper`,
    )
    assert.match(source, /lifecycle\.openAudio\(/, `${file} should open AudioOut through the helper`)
    assert.match(source, /onError:\s*lifecycle\.onError/, `${file} should route streamer errors through the helper`)
    assert.match(source, /onDone:\s*lifecycle\.onDone/, `${file} should route streamer completion through the helper`)
    assert.doesNotMatch(source, /new AudioOut\(/, `${file} should not construct AudioOut directly`)
    assert.doesNotMatch(source, /this\.streaming\s*=\s*true/, `${file} should not own streaming activation`)
  }

  const streamingSource = readFileSync('host/modules/audio/tts-stackchan-voice.ts', 'utf8')
  assert.match(streamingSource, /from 'tts-playback-lifecycle'/)
  assert.match(streamingSource, /beginTTSPlayback\(this, callback/)
  assert.match(streamingSource, /lifecycle\.addCleanup\(/)
  assert.match(streamingSource, /new AsyncAudioOut\(/)
  assert.match(streamingSource, /const DRAIN_SAMPLES = OUTPUT_SAMPLE_RATE \/ 2/)
  assert.match(streamingSource, /#queueDrain\(/)
  assert.match(streamingSource, /new Resource\('stackchan-ja\.aqd'\)/)
  assert.match(streamingSource, /props\.volume \?\? 0\.1/)
  assert.match(streamingSource, /props\.speed \?\? 100/)
  assert.match(streamingSource, /lifecycle\.onPower\(/)
  assert.doesNotMatch(streamingSource, /this\.streaming\s*=\s*true/)
})

test('Whisper multipart upload does not concatenate the whole recording buffer', () => {
  const sttWhisper = readFileSync('host/modules/audio/stt-whisper.ts', 'utf8')

  assert.match(sttWhisper, /function writeMultipartChunk/)
  assert.match(sttWhisper, /function postMultipart/)
  assert.match(sttWhisper, /device\.network\.https\.io/)
  assert.match(sttWhisper, /\[ArrayBuffer\.fromString\(header\), buffer, ArrayBuffer\.fromString\(footer\)\]/)
  assert.doesNotMatch(sttWhisper, /new ArrayBuffer\(header\.length \+ buffer\.byteLength \+ footer\.length\)/)
  assert.doesNotMatch(sttWhisper, /bodyView\.set\(new Uint8Array\(buffer\)/)
  assert.doesNotMatch(sttWhisper, /body:\s*bodyView\.buffer/)
})
