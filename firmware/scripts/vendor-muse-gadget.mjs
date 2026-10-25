import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const revision = 'c9354b7a765cfb7dd3c4f1945a9ca838d871630c'
const flag = process.argv.indexOf('--source')
if (flag < 0 || !process.argv[flag + 1])
  throw new Error('usage: npm run vendor:muse -- --source /path/to/muse-gadget-sdk')
const source = resolve(process.argv[flag + 1])
const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim()
if (git('rev-parse', 'HEAD') !== revision) throw new Error('Muse source must be at the reviewed revision')
if (git('status', '--porcelain', '--', 'LICENSE', 'esp32/components/noise_core'))
  throw new Error('Muse core source is modified')
const destination = resolve(dirname(fileURLToPath(import.meta.url)), '../vendor/muse-gadget-sdk')
const files = [['LICENSE', 'LICENSE']]
function visit(directory) {
  for (const entry of readdirSync(join(source, directory), { withFileTypes: true })) {
    const filename = `${directory}/${entry.name}`
    if (entry.isDirectory()) visit(filename)
    else files.push([filename, filename.replace('esp32/components/', '')])
  }
}
visit('esp32/components/noise_core')
const hashes = {}
for (const [from, to] of files.sort()) {
  const target = join(destination, to)
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(join(source, from), target)
  hashes[to] = createHash('sha256').update(readFileSync(target)).digest('hex')
}
writeFileSync(
  join(destination, 'VENDOR_SOURCE.json'),
  `${JSON.stringify(
    {
      upstream: 'https://github.com/facebookincubator/muse-gadget-sdk',
      revision,
      files: hashes,
    },
    null,
    2,
  )}\n`,
)
console.log(`Vendored Muse noise_core only (${files.length} files, ${revision})`)
