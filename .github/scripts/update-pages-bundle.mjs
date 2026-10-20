#!/usr/bin/env node

import { cp, lstat, mkdir, readdir, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

async function requireNonEmptyDirectory(directory, label) {
  const root = resolve(directory)
  const stat = await lstat(root)
  if (!stat.isDirectory()) throw new Error(`${label} is not a directory: ${root}`)
  if ((await readdir(root)).length === 0) throw new Error(`${label} is empty: ${root}`)
  return root
}

async function requireNonEmptyFile(file, label) {
  const path = resolve(file)
  const stat = await lstat(path)
  if (!stat.isFile() || stat.size === 0) throw new Error(`${label} is empty or invalid: ${path}`)
  return path
}

function resolvePagesDestination(pagesRoot, pagesDirectory) {
  if (!pagesDirectory || isAbsolute(pagesDirectory)) {
    throw new Error('Pages directory must be a non-empty relative path')
  }
  const root = resolve(pagesRoot)
  const target = resolve(root, pagesDirectory)
  const relativeTarget = relative(root, target)
  if (!relativeTarget || relativeTarget === '..' || relativeTarget.startsWith(`..${sep}`)) {
    throw new Error(`Pages directory escapes the Pages root: ${pagesDirectory}`)
  }
  return { root, target }
}

async function copyDirectoryContents(source, destination, skippedNames = new Set()) {
  await mkdir(destination, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (skippedNames.has(entry.name)) continue
    await cp(join(source, entry.name), join(destination, entry.name), {
      recursive: true,
      force: true,
    })
  }
}

export async function updatePagesBundle({
  webDirectory,
  firmwareDirectory,
  schemaFile,
  pagesRoot,
  pagesDirectory,
  schematicsDirectory,
}) {
  const webRoot = await requireNonEmptyDirectory(webDirectory, 'Web application artifact')
  const firmwareRoot = await requireNonEmptyDirectory(firmwareDirectory, 'Firmware bundle artifact')
  const schemaPath = await requireNonEmptyFile(schemaFile, 'MOD schema')
  await requireNonEmptyFile(join(webRoot, 'simulator/mc.js'), 'Simulator JavaScript')
  await requireNonEmptyFile(join(webRoot, 'simulator/mc.wasm'), 'Simulator WebAssembly')

  const candidateSchematics = schematicsDirectory
    ? await requireNonEmptyDirectory(schematicsDirectory, 'Schematics artifact')
    : undefined
  if (candidateSchematics) {
    await requireNonEmptyFile(join(candidateSchematics, 'index.html'), 'Schematics index')
  }

  const { target } = resolvePagesDestination(pagesRoot, pagesDirectory)
  await mkdir(target, { recursive: true })
  for (const entry of await readdir(target, { withFileTypes: true })) {
    if (!candidateSchematics && entry.name === 'schematics') continue
    await rm(join(target, entry.name), { recursive: true, force: true })
  }

  await copyDirectoryContents(webRoot, target, new Set(['schematics']))

  const firmwareTarget = join(target, 'flash/tech.moddable.stackchan')
  await rm(firmwareTarget, { recursive: true, force: true })
  await copyDirectoryContents(firmwareRoot, firmwareTarget)

  const schemaTarget = join(target, 'schemas/stackchan-mod.schema.json')
  await mkdir(join(target, 'schemas'), { recursive: true })
  await cp(schemaPath, schemaTarget, { force: true })

  if (candidateSchematics) {
    const schematicsTarget = join(target, 'schematics')
    await rm(schematicsTarget, { recursive: true, force: true })
    await copyDirectoryContents(candidateSchematics, schematicsTarget)
  }

  return { targetDirectory: target }
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (isMain) {
  const [webDirectory, firmwareDirectory, schemaFile, pagesRoot, pagesDirectory, schematicsDirectory] =
    process.argv.slice(2)
  if (!webDirectory || !firmwareDirectory || !schemaFile || !pagesRoot || !pagesDirectory) {
    console.error(
      'Usage: update-pages-bundle.mjs <web-directory> <firmware-directory> <schema-file> <pages-root> <pages-directory> [schematics-directory]'
    )
    process.exit(2)
  }
  try {
    const result = await updatePagesBundle({
      webDirectory,
      firmwareDirectory,
      schemaFile,
      pagesRoot,
      pagesDirectory,
      schematicsDirectory,
    })
    console.log(`Updated Pages bundle at ${result.targetDirectory}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
