import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceFlag = process.argv.indexOf('--source')
if (sourceFlag < 0 || !process.argv[sourceFlag + 1]) {
  throw new Error('usage: node scripts/vendor-stackchan-voice.mjs --source /path/to/stackchan-voice')
}

const source = resolve(process.argv[sourceFlag + 1])
const revisionFlag = process.argv.indexOf('--revision')
const revision = revisionFlag >= 0 && process.argv[revisionFlag + 1] ? process.argv[revisionFlag + 1] : 'unknown'
const dirty = process.argv.includes('--dirty')
const firmware = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const destination = join(firmware, 'vendor', 'stackchan-voice')
const files = [
  ['LICENSE', 'LICENSE'],
  ['NOTICE', 'NOTICE'],
  ['include/aq_synth.h', 'include/aq_synth.h'],
  ['include/aqk2r.h', 'include/aqk2r.h'],
  ['src/synth/aq_synth.c', 'src/aq_synth.c'],
  ['src/compat/aqk2r_compat.c', 'src/aqk2r_compat.c'],
  ['moddable/stackchanvoice.c', 'moddable/stackchanvoice.c'],
  ['moddable/stackchanvoice.js', 'moddable/stackchanvoice.js'],
  ['data/frontend/stackchan-ja.aqd', 'data/stackchan-ja.aqd'],
  ['data/frontend/SOURCE.json', 'data/SOURCE.json'],
  ['data/frontend/UNIDIC-BSD.txt', 'data/UNIDIC-BSD.txt'],
  ['data/frontend/UNIDIC-AUTHORS.txt', 'data/UNIDIC-AUTHORS.txt'],
]

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const dictionaryMetadata = JSON.parse(readFileSync(join(source, 'data/frontend/SOURCE.json'), 'utf8'))
const dictionaryHash = sha256(join(source, 'data/frontend/stackchan-ja.aqd'))
if (dictionaryHash !== dictionaryMetadata.output_sha256) {
  throw new Error(`dictionary SHA-256 mismatch: expected ${dictionaryMetadata.output_sha256}, got ${dictionaryHash}`)
}

for (const [from, to] of files) {
  const target = join(destination, to)
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(join(source, from), target)
}

const manifest = {
  modules: {
    stackchanvoice: './moddable/stackchanvoice',
    '*': ['./include/*', './src/aq_synth', './src/aqk2r_compat'],
  },
  preload: ['stackchanvoice'],
  data: { '*': ['./data/stackchan-ja'] },
}
writeFileSync(join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

const copied = Object.fromEntries(files.map(([, to]) => [to, sha256(join(destination, to))]))
const provenance = {
  upstream: 'https://github.com/meganetaaan/stackchan-voice',
  revision,
  dirty,
  dictionary: {
    file: 'data/stackchan-ja.aqd',
    sha256: dictionaryHash,
    source: dictionaryMetadata.source,
    version: dictionaryMetadata.version,
    license: dictionaryMetadata.license_choice,
  },
  files: copied,
}
writeFileSync(join(destination, 'VENDOR_SOURCE.json'), `${JSON.stringify(provenance, null, 2)}\n`)
console.log(`vendored ${files.length} files from ${basename(source)} (${revision})`)
