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
import { prepareBuildVariant } from './lib/build-variant.mjs'
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
const platformIndex = args.indexOf('-p')
const platformArgument = platformIndex >= 0 ? (args[platformIndex + 1] ?? '') : ''
const platformName = platformArgument.split(/[/:\\]/).at(-1)
const manifest = args.find((arg) => arg.endsWith('.json'))
const isCoreS3 = ['m5stack_cores3', 'm5stackchan_cores3'].includes(platformName)
let usesWebRtc = false
try {
  usesWebRtc = Boolean(manifest) && isCoreS3 && manifestUsesWebRtc(manifest, platformName)
  const solutionDirectory = usesWebRtc ? prepareWebRtcSolution() : undefined
  if (solutionDirectory) subprocessEnvironment = { ...subprocessEnvironment, ESP_WEBRTC_SOLUTION: solutionDirectory }
  if (manifest && isCoreS3) {
    const modeArgs = args.filter((arg) => ['-d', '-dn', '-dl', '-dx', '-i'].includes(arg))
    const mode = modeArgs.some((arg) => arg !== '-i') ? 'debug' : modeArgs.includes('-i') ? 'instrument' : 'release'
    prepareBuildVariant({
      outputDirectory: buildOutputDirectory,
      deviceName: platformName,
      mode,
      applicationName: hostApplicationName,
      manifest,
      realtime: usesWebRtc,
      solutionDirectory,
      clean(selectedManifest) {
        const result = spawnSync(
          'mcconfig',
          [...moddableOutputArguments(), ...modeArgs, '-m', '-p', platformArgument, '-t', 'clean', selectedManifest],
          { env: subprocessEnvironment, stdio: 'inherit' },
        )
        if (result.error) throw result.error
        if (result.status !== 0) process.exit(result.status ?? 1)
      },
    })
    // Clean removes the generated project, including component links, IDF
    // manifest, sdkconfig and cached link inputs. Re-seed only the selected
    // target/mode; never remove the shared source checkout or SDK settings.
    prepareCoreS3IdfDependencies({
      outputDirectory: buildOutputDirectory,
      platformName,
      applicationName: hostApplicationName,
      mode,
      realtime: usesWebRtc,
      solutionDirectory,
    })
  }
} catch (error) {
  console.error(`[stack-chan] CoreS3 build dependencies could not be prepared: ${error.message}`)
  process.exit(1)
}
if (targetsM5StackChanCoreS3(args)) {
  try {
    const versionSdkconfig = prepareCoreS3VersionSdkconfig({
      realtime: usesWebRtc,
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
