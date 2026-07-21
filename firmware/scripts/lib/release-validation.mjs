import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const VERSIONED_PACKAGES = [
  'firmware/package.json',
  'firmware/package-lock.json',
  'web/package.json',
  'web/package-lock.json',
]

export function versionFromStableTag(tag) {
  const match = /^v(\d+\.\d+\.\d+)$/.exec(tag)
  if (!match) throw new Error(`stable release tag must match vX.Y.Z: ${tag}`)
  return match[1]
}

export function validateRelease(rootDirectory, tag) {
  const version = versionFromStableTag(tag)

  for (const relativePath of VERSIONED_PACKAGES) {
    const document = JSON.parse(readFileSync(path.join(rootDirectory, relativePath), 'utf8'))
    if (document.version !== version) {
      throw new Error(`${relativePath} version is ${document.version ?? 'missing'}; expected ${version}`)
    }
    if (relativePath.endsWith('package-lock.json') && document.packages?.['']?.version !== version) {
      throw new Error(
        `${relativePath} root package version is ${document.packages?.['']?.version ?? 'missing'}; expected ${version}`,
      )
    }
  }

  const releaseNotePath = path.join(rootDirectory, 'docs', 'release-notes', `v${version}.md`)
  if (!existsSync(releaseNotePath) || readFileSync(releaseNotePath, 'utf8').trim().length === 0) {
    throw new Error(`release note is missing or empty: docs/release-notes/v${version}.md`)
  }

  const changesetDirectory = path.join(rootDirectory, '.changeset')
  const pendingChangesets = readdirSync(changesetDirectory).filter(
    (name) => name.endsWith('.md') && name !== 'README.md',
  )
  if (pendingChangesets.length > 0) {
    throw new Error(`pending Changesets must be consumed before release: ${pendingChangesets.join(', ')}`)
  }

  return { releaseNotePath, version }
}
