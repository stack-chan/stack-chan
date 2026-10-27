#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import {
  assertNoCustomBuildOutput,
  buildOutputDirectory,
  ensureBuildOutputDirectory,
  hostApplicationName,
  moddableOutputArguments,
} from './lib/build-output.mjs'
import { prepareCoreS3IdfDependencies } from './lib/idf-dependencies.mjs'
import { prepareCoreS3VersionSdkconfig } from './lib/moddable-version.mjs'
import { manifestUsesWebRtc, prepareWebRtcSolution } from './lib/webrtc-solution.mjs'

const args = process.argv.slice(2)

try {
  assertNoCustomBuildOutput(args)
} catch (error) {
  console.error(`[stack-chan] ${error.message}`)
  process.exit(1)
}

ensureBuildOutputDirectory()
let subprocessEnvironment = process.env
const platformArgument = args[args.indexOf('-p') + 1] ?? ''
const platformName = platformArgument.split(/[/:\\]/).at(-1)
const manifest = args.find((arg) => arg.endsWith('.json'))
if (
  manifest &&
  ['m5stack_cores3', 'm5stackchan_cores3'].includes(platformName) &&
  manifestUsesWebRtc(manifest, platformName)
) {
  try {
    const solutionDirectory = prepareWebRtcSolution()
    prepareCoreS3IdfDependencies({
      outputDirectory: buildOutputDirectory,
      platformName,
      applicationName: hostApplicationName,
      mode: args.some((arg) => ['-d', '-dn', '-dl', '-dx'].includes(arg))
        ? 'debug'
        : args.includes('-i')
          ? 'instrument'
          : 'release',
      realtime: true,
      solutionDirectory,
    })
    subprocessEnvironment = { ...subprocessEnvironment, ESP_WEBRTC_SOLUTION: solutionDirectory }
  } catch (error) {
    console.error(`[stack-chan] WebRTC dependencies could not be prepared: ${error.message}`)
    process.exit(1)
  }
}
if (targetsM5StackChanCoreS3(args)) {
  try {
    const versionSdkconfig = prepareCoreS3VersionSdkconfig({
      realtime: Boolean(subprocessEnvironment.ESP_WEBRTC_SOLUTION),
      realtimePerformance: path.basename(manifest ?? '') === 'manifest_openai_live.json',
    })
    subprocessEnvironment = { ...subprocessEnvironment, SDKCONFIGPATH: versionSdkconfig.directory }
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
