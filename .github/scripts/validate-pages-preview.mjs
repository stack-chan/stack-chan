#!/usr/bin/env node

import { lstat, readdir } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export const MAX_FILE_COUNT = 20_000
export const MAX_FILE_SIZE = 25 * 1024 * 1024

const REQUIRED_FILES = [
  'index.html',
  'flash/tech.moddable.stackchan/m5stackchan_cores3/bootloader.bin',
  'flash/tech.moddable.stackchan/m5stackchan_cores3/partition-table.bin',
  'flash/tech.moddable.stackchan/m5stackchan_cores3/xs_esp32.bin',
  'simulator/index.html',
  'simulator/mc.js',
  'simulator/mc.wasm',
  'schemas/stackchan-mod.schema.json',
  'schematics/index.html',
]
const FORBIDDEN_FILES = new Set(['.assetsignore', '_routes.json', '_worker.js'])

function displayPath(root, path) {
  return relative(root, path).split(sep).join('/') || '.'
}

export async function validatePagesPreview(directory) {
  const root = resolve(directory)
  const rootStat = await lstat(root)
  if (!rootStat.isDirectory()) throw new Error(`Preview root is not a directory: ${root}`)

  let fileCount = 0
  const pending = [root]
  while (pending.length > 0) {
    const current = pending.pop()
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      const relativePath = displayPath(root, path)
      const stat = await lstat(path)

      if (stat.isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${relativePath}`)
      if (entry.isDirectory()) {
        if (relativePath === 'functions') {
          throw new Error('Cloudflare Pages Functions are not allowed in PR previews')
        }
        pending.push(path)
        continue
      }
      if (!entry.isFile()) throw new Error(`Unsupported filesystem entry: ${relativePath}`)
      if (FORBIDDEN_FILES.has(basename(relativePath))) {
        throw new Error(`Cloudflare runtime controls are not allowed in PR previews: ${relativePath}`)
      }

      fileCount += 1
      if (fileCount > MAX_FILE_COUNT) {
        throw new Error(`Preview contains more than ${MAX_FILE_COUNT} files`)
      }
      if (stat.size > MAX_FILE_SIZE) {
        throw new Error(`File exceeds the Cloudflare Pages 25 MiB limit: ${relativePath}`)
      }
    }
  }

  for (const requiredFile of REQUIRED_FILES) {
    let stat
    try {
      stat = await lstat(join(root, requiredFile))
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error(`Required preview file is missing: ${requiredFile}`)
      throw error
    }
    if (!stat.isFile() || stat.size === 0) {
      throw new Error(`Required preview file is empty or invalid: ${requiredFile}`)
    }
  }

  return { fileCount }
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (isMain) {
  const directory = process.argv[2]
  if (!directory) {
    console.error('Usage: validate-pages-preview.mjs <preview-directory>')
    process.exit(2)
  }
  try {
    const result = await validatePagesPreview(directory)
    console.log(`Validated ${result.fileCount} static preview files`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
