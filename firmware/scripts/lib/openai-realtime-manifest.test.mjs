import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { loadOpenAIApiKey, prepareOpenAIRealtimeManifest } from './openai-realtime-manifest.mjs'

test('generates a private, silent CoreS3 Realtime test manifest', () => {
  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'stackchan-openai-realtime-'))
  const hostManifestPath = path.join(temporaryDirectory, 'host/manifest_local.json')
  const manifestPath = path.join(temporaryDirectory, 'host/manifest.openai-realtime.local.json')

  try {
    mkdirSync(path.dirname(hostManifestPath), { recursive: true })
    writeFileSync(hostManifestPath, '{}\n')
    const result = prepareOpenAIRealtimeManifest({
      apiKey: 'test-openai-key',
      manifestPath,
      hostManifestPath,
    })
    const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8'))

    assert.deepEqual(manifest.include, ['./manifest_local.json'])
    assert.equal(manifest.config.startupSound, false)
    assert.deepEqual(manifest.config.driver, { type: 'none', typeLocked: true })
    assert.deepEqual(manifest.config.chat, {
      type: 'openAIRealtime',
      specifier: 'stackchanOpenAIRealtime',
      modelID: 'gpt-realtime-mini',
      voiceID: 'marin',
      apiKey: 'test-openai-key',
      traceEvents: true,
      autoStart: true,
      autoStartDelayMs: 5000,
      autoPrompt: '接続確認です。「接続できました」とだけ短く答えてください。',
      autoStop: true,
      autoMicrophone: false,
      smokeTimeoutMs: 300000,
    })
    if (process.platform !== 'win32') {
      assert.equal(statSync(result.manifestPath).mode & 0o777, 0o600)
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
})

test('loads OPENAI_API_KEY without requiring a key file', () => {
  assert.deepEqual(loadOpenAIApiKey({ environment: { OPENAI_API_KEY: ' env-key ' } }), {
    apiKey: 'env-key',
    source: 'environment',
  })
})

test('can generate a private microphone-enabled diagnostic manifest', () => {
  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'stackchan-openai-realtime-microphone-'))
  const hostManifestPath = path.join(temporaryDirectory, 'host/manifest_local.json')
  const manifestPath = path.join(temporaryDirectory, 'probe/manifest.json')

  try {
    mkdirSync(path.dirname(hostManifestPath), { recursive: true })
    writeFileSync(hostManifestPath, '{}\n')
    const result = prepareOpenAIRealtimeManifest({
      apiKey: 'test-openai-key',
      manifestPath,
      hostManifestPath,
      autoMicrophone: true,
    })
    const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8'))

    assert.equal(manifest.config.chat.autoMicrophone, true)
    assert.deepEqual(manifest.include, ['../host/manifest_local.json'])
    if (process.platform !== 'win32') {
      assert.equal(statSync(result.manifestPath).mode & 0o777, 0o600)
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
})

test('can generate an interactive manifest without unattended smoke actions', () => {
  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'stackchan-openai-realtime-interactive-'))
  const hostManifestPath = path.join(temporaryDirectory, 'host/manifest_local.json')
  const manifestPath = path.join(temporaryDirectory, 'interactive/manifest.json')

  try {
    mkdirSync(path.dirname(hostManifestPath), { recursive: true })
    writeFileSync(hostManifestPath, '{}\n')
    const result = prepareOpenAIRealtimeManifest({
      apiKey: 'test-openai-key',
      manifestPath,
      hostManifestPath,
      automatedSmoke: false,
    })
    const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8'))

    assert.deepEqual(manifest.config.chat, {
      type: 'openAIRealtime',
      specifier: 'stackchanOpenAIRealtime',
      modelID: 'gpt-realtime-mini',
      voiceID: 'marin',
      apiKey: 'test-openai-key',
      traceEvents: true,
    })
    if (process.platform !== 'win32') {
      assert.equal(statSync(result.manifestPath).mode & 0o777, 0o600)
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
})

test('can disable face animation in a diagnostic manifest', () => {
  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'stackchan-openai-realtime-no-face-animation-'))
  const hostManifestPath = path.join(temporaryDirectory, 'host/manifest_local.json')
  const manifestPath = path.join(temporaryDirectory, 'probe/manifest.json')

  try {
    mkdirSync(path.dirname(hostManifestPath), { recursive: true })
    writeFileSync(hostManifestPath, '{}\n')
    const result = prepareOpenAIRealtimeManifest({
      apiKey: 'test-openai-key',
      manifestPath,
      hostManifestPath,
      faceAnimation: false,
    })
    const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8'))

    assert.equal(manifest.config.chat.faceAnimation, false)
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
})

test('can generate a private, speaker-silent digital input probe manifest', () => {
  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'stackchan-openai-realtime-input-probe-'))
  const hostManifestPath = path.join(temporaryDirectory, 'host/manifest_local.json')
  const manifestPath = path.join(temporaryDirectory, 'probe/manifest.json')

  try {
    mkdirSync(path.dirname(hostManifestPath), { recursive: true })
    writeFileSync(hostManifestPath, '{}\n')
    const result = prepareOpenAIRealtimeManifest({
      apiKey: 'test-openai-key',
      manifestPath,
      hostManifestPath,
      inputProbe: true,
    })
    const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8'))

    assert.equal(manifest.config.chat.autoMicrophone, true)
    assert.equal(manifest.config.chat.autoExpectedResponses, 2)
    assert.deepEqual(manifest.config.chat.inputProbe, {
      enabled: true,
      startDelayMs: 250,
      durationMs: 1500,
      level: 4000,
      vadSilenceDurationMs: 1500,
    })
    if (process.platform !== 'win32') {
      assert.equal(statSync(result.manifestPath).mode & 0o777, 0o600)
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
})

test('rejects a digital input probe without automated smoke mode', () => {
  assert.throws(
    () =>
      prepareOpenAIRealtimeManifest({
        apiKey: 'test-openai-key',
        inputProbe: true,
        automatedSmoke: false,
      }),
    /requires automated smoke mode/,
  )
})

test('loads the legacy ignored manifest only when it is private', () => {
  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'stackchan-openai-key-'))
  const keyFile = path.join(temporaryDirectory, 'manifest.json')

  try {
    writeFileSync(keyFile, JSON.stringify({ config: { openAIKey: 'legacy-key' } }), { mode: 0o600 })
    assert.deepEqual(loadOpenAIApiKey({ environment: {}, keyFile }), {
      apiKey: 'legacy-key',
      source: 'key-file',
    })

    if (process.platform !== 'win32') {
      chmodSync(keyFile, 0o644)
      assert.throws(() => loadOpenAIApiKey({ environment: {}, keyFile }), /must not be accessible by group or others/)
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
})
