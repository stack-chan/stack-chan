import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceFlag = process.argv.indexOf('--source')
if (sourceFlag < 0 || !process.argv[sourceFlag + 1]) {
  throw new Error('usage: node scripts/vendor-stackchan-dock.mjs --source /path/to/stack-chan-dock')
}

const source = resolve(process.argv[sourceFlag + 1])
const firmware = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const destination = join(firmware, 'vendor', 'stack-chan-dock')
const files = [
  ['LICENSE', 'LICENSE'],
  ['contracts/usb-cdc-v2/test-vectors.json', 'contracts/usb-cdc-v2/test-vectors.json'],
  ['contracts/usb-cdc-v2/negotiation-vectors.json', 'contracts/usb-cdc-v2/negotiation-vectors.json'],
  ['contracts/usb-cdc-v2/application-event-vectors.json', 'contracts/usb-cdc-v2/application-event-vectors.json'],
]
const sourcePaths = files.map(([from]) => from)

const revision = git(['rev-parse', 'HEAD']).trim()
const scopedStatus = git(['status', '--porcelain', '--untracked-files=all', '--', ...sourcePaths]).trim()
if (scopedStatus) {
  throw new Error(`refusing to vendor modified Dock contract sources:\n${scopedStatus}`)
}

for (const [from, to] of files) {
  const target = join(destination, to)
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(join(source, from), target)
}

const copied = Object.fromEntries(files.map(([, to]) => [to, sha256(join(destination, to))]))
const provenance = {
  upstream: 'https://github.com/meganetaaan/stack-chan-dock',
  revision,
  files: copied,
}
writeFileSync(join(destination, 'VENDOR_SOURCE.json'), `${JSON.stringify(provenance, null, 2)}\n`)
console.log(`vendored ${files.length} files from stack-chan-dock (${revision})`)

function git(arguments_) {
  return execFileSync('git', ['-C', source, ...arguments_], { encoding: 'utf8' })
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}
