#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { assertNoCustomBuildOutput, ensureBuildOutputDirectory, moddableOutputArguments } from './lib/build-output.mjs'
import { prepareCoreS3VersionSdkconfig } from './lib/moddable-version.mjs'

const args = process.argv.slice(2)

try {
  assertNoCustomBuildOutput(args)
} catch (error) {
  console.error(`[stack-chan] ${error.message}`)
  process.exit(1)
}

ensureBuildOutputDirectory()
let subprocessEnvironment = process.env
if (targetsM5StackChanCoreS3(args)) {
  try {
    const versionSdkconfig = prepareCoreS3VersionSdkconfig()
    subprocessEnvironment = { ...process.env, SDKCONFIGPATH: versionSdkconfig.directory }
  } catch (error) {
    console.error(`[stack-chan] CoreS3 firmware version could not be prepared: ${error.message}`)
    process.exit(1)
  }
}
const result = spawnSync('mcconfig', [...moddableOutputArguments(), ...args], {
  env: subprocessEnvironment,
  stdio: 'inherit',
})

if (result.error) {
  console.error(`[stack-chan] mcconfigを実行できませんでした: ${result.error.message}`)
  process.exit(1)
}

process.exit(result.status ?? 1)

function targetsM5StackChanCoreS3(values) {
  const platformIndex = values.indexOf('-p')
  return platformIndex >= 0 && values[platformIndex + 1]?.toLowerCase().includes('m5stackchan_cores3')
}
