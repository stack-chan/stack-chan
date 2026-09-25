import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const galleryRoot = fileURLToPath(new URL('./samples/', import.meta.url))
const firmwareRoot = fileURLToPath(new URL('../../firmware/mods/examples/', import.meta.url))
const sources = JSON.parse(readFileSync(new URL('./sample-sources.json', import.meta.url), 'utf8'))

function packagePath(root, path) {
  if (
    typeof path !== 'string' ||
    path.includes('\\') ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`Invalid sample path: ${path}`)
  }
  return resolve(root, path)
}

// Read every source before writing anything: a missing input must not leave a
// partially synchronized gallery. Only explicitly mapped files are owned here.
export function syncSamples({
  check = false,
  inputRoot = firmwareRoot,
  outputRoot = galleryRoot,
  mappings = sources,
} = {}) {
  const targets = new Set()
  const copies = mappings.flatMap(({ source, target, files }) =>
    files.map((file) => {
      const destination = packagePath(outputRoot, `${target}/${file}`)
      if (targets.has(destination)) throw new Error(`Duplicate sample destination: ${destination}`)
      targets.add(destination)
      return {
        destination,
        name: `${target}/${file}`,
        bytes: readFileSync(packagePath(inputRoot, `${source}/${file}`)),
      }
    })
  )
  const changed = []
  for (const { destination, name, bytes } of copies) {
    let current
    try {
      current = readFileSync(destination)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if (current?.equals(bytes)) continue
    changed.push(name)
    if (!check) {
      mkdirSync(dirname(destination), { recursive: true })
      writeFileSync(destination, bytes)
    }
  }
  return changed
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    if (args.some((arg) => arg !== '--check')) throw new Error('Usage: node sync-samples.mjs [--check]')
    const check = args.includes('--check')
    const changed = syncSamples({ check })
    if (changed.length) {
      console.log(`${check ? 'Outdated' : 'Updated'} gallery source files:\n${changed.join('\n')}`)
      if (check) {
        console.error('Run npm --prefix web run sync:gallery and include the updated files.')
        process.exitCode = 1
      }
    } else {
      console.log('Gallery source files are up to date.')
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
