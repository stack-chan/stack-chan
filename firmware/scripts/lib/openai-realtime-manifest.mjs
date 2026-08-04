import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { firmwareDirectory } from './build-output.mjs'

const GENERATED_MANIFEST_MODE = 0o600
const DEFAULT_MODEL_ID = 'gpt-realtime-mini'
const DEFAULT_VOICE_ID = 'marin'

/**
 * Loads an OpenAI API key without placing it in a command-line argument.
 * OPENAI_API_KEY takes precedence over an explicitly selected key file.
 *
 * A key file may contain the key as plain text or in one of the local manifest
 * shapes used by this repository:
 * - config.chat.apiKey
 * - config.openAIKey
 *
 * @param {{
 *   environment?: NodeJS.ProcessEnv,
 *   keyFile?: string,
 * }} options
 * @returns {{apiKey: string, source: 'environment' | 'key-file'}}
 */
export function loadOpenAIApiKey({ environment = process.env, keyFile } = {}) {
  const environmentKey = normalizeApiKey(environment.OPENAI_API_KEY)
  if (environmentKey) return { apiKey: environmentKey, source: 'environment' }

  if (!keyFile) {
    throw new Error('OPENAI_API_KEY is not set. Set it or pass --key-file with a private key file.')
  }

  const resolvedKeyFile = path.resolve(keyFile)
  assertPrivateKeyFile(resolvedKeyFile)
  const source = readFileSync(resolvedKeyFile, 'utf8')
  let key = source
  if (source.trimStart().startsWith('{')) {
    let document
    try {
      document = JSON.parse(source)
    } catch {
      throw new Error('the selected API key JSON file is invalid')
    }
    key = document?.config?.chat?.apiKey ?? document?.config?.openAIKey
  }

  const apiKey = normalizeApiKey(key)
  if (!apiKey) throw new Error('the selected API key file does not contain an OpenAI API key')
  return { apiKey, source: 'key-file' }
}

/**
 * Generates the local, ignored manifest used for direct Realtime API testing.
 * The API key is compiled into the firmware, so this is intentionally a
 * development-only path.
 *
 * @param {{
 *   apiKey: string,
 *   manifestPath?: string,
 *   hostManifestPath?: string,
 *   modelID?: string,
 *   voiceID?: string,
 *   autoMicrophone?: boolean,
 *   inputProbe?: boolean,
 *   automatedSmoke?: boolean,
 *   faceAnimation?: boolean,
 * }} options
 * @returns {{manifestPath: string}}
 */
export function prepareOpenAIRealtimeManifest({
  apiKey,
  manifestPath = path.join(firmwareDirectory, 'host/app/manifest.openai-realtime.local.json'),
  hostManifestPath = path.join(firmwareDirectory, 'host/app/manifest_local.json'),
  modelID = DEFAULT_MODEL_ID,
  voiceID = DEFAULT_VOICE_ID,
  autoMicrophone = false,
  inputProbe = false,
  automatedSmoke = true,
  faceAnimation = true,
}) {
  const normalizedKey = normalizeApiKey(apiKey)
  if (!normalizedKey) throw new Error('an OpenAI API key is required')
  if (inputProbe && !automatedSmoke) {
    throw new Error('the digital input probe requires automated smoke mode')
  }

  const resolvedManifestPath = path.resolve(manifestPath)
  const resolvedOutputDirectory = path.dirname(resolvedManifestPath)
  const resolvedHostManifestPath = path.resolve(hostManifestPath)
  mkdirSync(resolvedOutputDirectory, { recursive: true })

  let includePath = path.relative(resolvedOutputDirectory, resolvedHostManifestPath)
  if (!includePath.startsWith('.')) includePath = `./${includePath}`

  const chat = {
    type: 'openAIRealtime',
    specifier: 'stackchanOpenAIRealtime',
    modelID,
    voiceID,
    apiKey: normalizedKey,
    traceEvents: true,
  }
  if (!faceAnimation) chat.faceAnimation = false
  if (automatedSmoke) {
    Object.assign(chat, {
      autoStart: true,
      autoStartDelayMs: 5000,
      autoPrompt: '接続確認です。「接続できました」とだけ短く答えてください。',
      autoStop: true,
      autoMicrophone: autoMicrophone || inputProbe,
      smokeTimeoutMs: 105000,
    })
  }

  const manifest = {
    include: [includePath],
    config: {
      startupSound: false,
      driver: {
        type: 'none',
        typeLocked: true,
      },
      chat,
    },
  }
  if (inputProbe) {
    manifest.config.chat.autoExpectedResponses = 2
    manifest.config.chat.inputProbe = {
      enabled: true,
      startDelayMs: 250,
      durationMs: 1500,
      level: 4000,
      vadSilenceDurationMs: 1500,
    }
  }
  writeFileSync(resolvedManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    mode: GENERATED_MANIFEST_MODE,
  })
  chmodSync(resolvedManifestPath, GENERATED_MANIFEST_MODE)
  return { manifestPath: resolvedManifestPath }
}

function normalizeApiKey(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function assertPrivateKeyFile(keyFile) {
  if (process.platform === 'win32') return
  const permissions = statSync(keyFile).mode & 0o777
  if ((permissions & 0o077) !== 0) {
    throw new Error(`API key file must not be accessible by group or others (chmod 600 ${keyFile})`)
  }
}
