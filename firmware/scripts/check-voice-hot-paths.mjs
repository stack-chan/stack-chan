import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { checkVoiceHotPaths } from './lib/voice-hot-paths.mjs'
const root = new URL('../host/modules/', import.meta.url)
const paths = readdirSync(new URL('voice/', root))
  .filter((name) => name.endsWith('.ts'))
  .map((name) => new URL(`voice/${name}`, root))
paths.push(new URL('ai/ai-wire.ts', root))
const failures = paths.flatMap((path) => checkVoiceHotPaths(readFileSync(path, 'utf8'), fileURLToPath(path)))
for (const failure of failures) console.error(`${failure.file}:${failure.line}:${failure.column} ${failure.message}`)
if (failures.length) process.exitCode = 1
else console.log('Voice provider and SSE hot-path boundaries passed')
