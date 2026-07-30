#!/usr/bin/env node

import { loadOpenAIApiKey, prepareOpenAIRealtimeManifest } from './lib/openai-realtime-manifest.mjs'

const rawArguments = process.argv.slice(2)
const keyFile = readOption(rawArguments, 'key-file')
const manifestPath = readOption(rawArguments, 'output')
const inputProbe = rawArguments.includes('--input-probe')
const autoMicrophone = rawArguments.includes('--microphone') || inputProbe
const automatedSmoke = !rawArguments.includes('--interactive')
const faceAnimation = !rawArguments.includes('--disable-face-animation')

try {
  const { apiKey, source } = loadOpenAIApiKey({ keyFile })
  const result = prepareOpenAIRealtimeManifest({
    apiKey,
    manifestPath,
    autoMicrophone,
    inputProbe,
    automatedSmoke,
    faceAnimation,
  })
  console.log(`[stack-chan] prepared private OpenAI Realtime manifest: ${result.manifestPath}`)
  console.log(`[stack-chan] API key source: ${source === 'environment' ? 'OPENAI_API_KEY' : 'private key file'}`)
  console.log(
    `[stack-chan] startup sound disabled; motion driver locked to none; mode ${
      automatedSmoke ? 'automated smoke' : 'interactive'
    }; microphone ${automatedSmoke && !autoMicrophone ? 'disabled' : 'enabled'}; digital input probe ${
      inputProbe ? 'enabled' : 'disabled'
    }; face animation ${faceAnimation ? 'enabled' : 'disabled'}`,
  )
  console.warn('[stack-chan] development only: the API key is embedded in the generated firmware')
} catch (error) {
  console.error(`[stack-chan] OpenAI Realtime manifest could not be prepared: ${error.message}`)
  process.exit(1)
}

function readOption(values, name) {
  const prefix = `--${name}=`
  const index = values.indexOf(`--${name}`)
  if (index >= 0) return values[index + 1]
  return values.find((value) => value.startsWith(prefix))?.slice(prefix.length)
}
