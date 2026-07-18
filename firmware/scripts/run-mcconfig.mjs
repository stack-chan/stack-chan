#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { assertNoCustomBuildOutput, ensureBuildOutputDirectory, moddableOutputArguments } from './lib/build-output.mjs'

const args = process.argv.slice(2)

try {
  assertNoCustomBuildOutput(args)
} catch (error) {
  console.error(`[stack-chan] ${error.message}`)
  process.exit(1)
}

ensureBuildOutputDirectory()
const result = spawnSync('mcconfig', [...moddableOutputArguments(), ...args], { stdio: 'inherit' })

if (result.error) {
  console.error(`[stack-chan] mcconfigを実行できませんでした: ${result.error.message}`)
  process.exit(1)
}

process.exit(result.status ?? 1)
