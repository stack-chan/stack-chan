#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const ignoredDirectories = new Set(['node_modules', 'dist-tests', 'build', 'tmp', '.git'])
const ignoredFiles = new Set(['package-lock.json', 'scripts/check-legacy-names.js'])
const textExtensions = new Set(['.c', '.d.ts', '.h', '.js', '.json', '.md', '.mjs', '.ts', '.txt', '.yaml', '.yml'])
const allowedContentChecks = new Set(['host/modules/preferences/loadPreference.test.ts:renderer.type'])

const contentChecks = [
  { name: 'RendererCompat', pattern: /RendererCompat/ },
  { name: 'renderer-', pattern: /renderer-/ },
  { name: 'useRenderer', pattern: /useRenderer/ },
  { name: 'addDecorator', pattern: /addDecorator/ },
  { name: 'removeDecorator', pattern: /removeDecorator/ },
  { name: 'robot.renderer', pattern: /robot\.renderer/ },
  { name: 'renderer.type', pattern: /renderer\.type/ },
  { name: 'renderers-piu', pattern: /renderers-piu/ },
]

const pathChecks = [
  {
    name: 'firmware/tests',
    matches(path) {
      return path === 'tests' || path.startsWith(`tests${sep}`)
    },
  },
  {
    name: 'renderers-piu',
    matches(path) {
      return path.split(sep).includes('renderers-piu')
    },
  },
]

const findings = []

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const absolutePath = join(directory, entry.name)
    const relativePath = relative(root, absolutePath)

    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(...(await collectFiles(absolutePath)))
      }
      continue
    }

    if (entry.isFile() && !ignoredFiles.has(relativePath)) {
      files.push(absolutePath)
    }
  }

  return files
}

function isTextFile(path) {
  return [...textExtensions].some((extension) => path.endsWith(extension))
}

function isAllowedContentCheck(relativePath, check) {
  return allowedContentChecks.has(`${relativePath}:${check.name}`)
}

async function checkFile(file) {
  const relativePath = relative(root, file)

  for (const check of pathChecks) {
    if (check.matches(relativePath)) {
      findings.push(`${relativePath}: path contains ${check.name}`)
    }
  }

  if (!isTextFile(file)) {
    return
  }

  const content = await readFile(file, 'utf8')
  const lines = content.split(/\r?\n/)

  for (const [index, line] of lines.entries()) {
    for (const check of contentChecks) {
      if (isAllowedContentCheck(relativePath, check)) {
        continue
      }
      if (check.pattern.test(line)) {
        const preview = line.trim().slice(0, 140)
        findings.push(`${relativePath}:${index + 1}: ${check.name}: ${preview}`)
      }
    }
  }
}

for (const file of await collectFiles(root)) {
  await checkFile(file)
}

if (findings.length > 0) {
  console.error(`Legacy names found: ${findings.length}`)
  console.error(findings.join('\n'))
  process.exitCode = 1
} else {
  console.log('No legacy names found.')
}
