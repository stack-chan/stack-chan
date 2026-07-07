#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const targets = [
  { platform: 'esp32/m5stack', manifest: 'host/app/manifest_local.json' },
  { platform: 'esp32/m5stack_cores3', manifest: 'host/app/manifest_local.json' },
  { platform: 'esp32:./host/platforms/m5stackchan_cores3', manifest: 'host/app/manifest_m5stackchan_cores3.json' },
  { platform: 'esp32:./host/platforms/stackchan_rt', manifest: 'host/app/manifest_stackchan_rt.json' },
  { platform: 'esp32:./host/platforms/takao_core2_sg90', manifest: 'host/app/manifest_takao_core2_sg90.json' },
  { platform: 'wasm', manifest: 'host/app/manifest_wasm.json' },
]

// Known warnings that are allowed to stay. Match against the normalized warning
// text, where absolute paths under the firmware root are made relative.
// Example: { pattern: /^no modules match: typings\/btutils$/, reason: 'tracked by #123' }
const allowedWarnings = []

const missingResolutionPattern = /^no (?:modules|resources|data) match: /

function normalizeWarning(text) {
  return text.replaceAll(`${root}/`, '').replace(/!$/, '')
}

function collectWarnings(output) {
  const warnings = []
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^#\s*warning:\s*(.*)$/)
    if (match) warnings.push(normalizeWarning(match[1]))
  }
  return warnings
}

function checkTarget({ platform, manifest }) {
  const outputDirectory = mkdtempSync(join(tmpdir(), 'stackchan-check-manifest-'))
  let result
  try {
    result = spawnSync(
      'mcconfig',
      ['-d', '-p', platform, '-t', 'build', '-o', outputDirectory, resolve(root, manifest)],
      {
        cwd: root,
        encoding: 'utf8',
      },
    )
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true })
  }

  if (result.error) {
    console.error(`mcconfig could not be started: ${result.error.message}`)
    console.error('Set up the Moddable SDK first, e.g. source "$HOME/.local/share/xs-dev-export.sh" or npm run setup.')
    process.exit(1)
  }

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  const failures = []

  if (result.status !== 0) {
    failures.push(`mcconfig exited with status ${result.status}`)
    console.error(output.trimEnd())
  }

  for (const warning of collectWarnings(output)) {
    const allowed = allowedWarnings.find(({ pattern }) => pattern.test(warning))
    if (allowed) {
      console.log(`  allowed warning: ${warning} (${allowed.reason})`)
    } else if (missingResolutionPattern.test(warning)) {
      failures.push(`unexpected missing resolution: ${warning}`)
    } else {
      console.log(`  warning: ${warning}`)
    }
  }

  return failures
}

let failureCount = 0
for (const target of targets) {
  console.log(`Checking ${target.platform} with ${target.manifest}`)
  const failures = checkTarget(target)
  for (const failure of failures) {
    console.error(`  FAIL: ${failure}`)
  }
  failureCount += failures.length
}

if (failureCount > 0) {
  console.error(`Manifest preflight failed: ${failureCount} problem(s) found.`)
  process.exitCode = 1
} else {
  console.log(`Manifest preflight passed for ${targets.length} target(s).`)
}
