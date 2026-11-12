import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { validateSanoModelPayload } from './lib/sanotts-model-image.mjs'

const directory = new URL('../dist/models/sanotts/', import.meta.url)
const destination = new URL('sanotts-v4.bin', directory)
const url = 'https://github.com/ayutaz/sanoTTS-jp/releases/download/v1.2.0/saanotts-jp-v4-int8.bin'
let bytes
try {
  bytes = await readFile(destination)
} catch (error) {
  if (error.code !== 'ENOENT') throw error
  const response = await fetch(url)
  if (!response.ok) throw new Error(`sanoTTS model download failed: ${response.status}`)
  bytes = Buffer.from(await response.arrayBuffer())
  validateSanoModelPayload(bytes)
  await mkdir(directory, { recursive: true })
  await writeFile(destination, bytes)
}
const { sha256 } = validateSanoModelPayload(bytes)
console.log(`Verified ${fileURLToPath(destination)} (SHA256 ${sha256})`)
console.log('Model license, attribution and output restrictions: vendor/sanotts-jp/LICENSE-MODEL.md and NOTICE.md')
