import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readModdableVersion } from './lib/moddable-version.mjs'

const patch = fileURLToPath(new URL('../patches/moddable-10.1.1-xsl-key-budget.patch', import.meta.url))
const sdkPlatform = { darwin: 'mac', linux: 'lin', win32: 'win' }[process.platform]

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? result.signal}`)
}

try {
  const version = readModdableVersion()
  if (version !== '10.1.1') throw new Error(`Moddable SDK 10.1.1 is required (found ${version})`)
  if (!sdkPlatform) throw new Error(`Unsupported build host: ${process.platform}`)
  const sdk = path.resolve(process.env.MODDABLE)

  const applied = spawnSync('git', ['apply', '--reverse', '--check', patch], { cwd: sdk, stdio: 'ignore' })
  if (applied.error) throw applied.error
  if (applied.status !== 0) run('git', ['apply', patch], sdk)

  const windows = sdkPlatform === 'win'
  const make = windows ? 'nmake.exe' : 'make'
  const args = windows ? ['/nologo', '/f', 'xsl.mak'] : ['-f', 'xsl.mk']
  const xs = path.join(sdk, 'xs')
  const build = path.join(sdk, 'build')
  const cwd = path.join(xs, 'makefiles', sdkPlatform)
  args.push(`XS_DIR=${xs}`, `BUILD_DIR=${build}`)

  run(make, [...args, 'GOAL=release'], cwd)
  const debugLinker = path.join(build, 'bin', sdkPlatform, 'debug', windows ? 'xsl.exe' : 'xsl')
  if (existsSync(debugLinker)) run(make, [...args, 'GOAL=debug'], cwd)
} catch (error) {
  console.error(`[stack-chan] xsl setup failed: ${error.message}`)
  process.exitCode = 1
}
