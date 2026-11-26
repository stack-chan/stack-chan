import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const patch = fileURLToPath(new URL('../../patches/moddable-10.1.1-native-pcm.patch', import.meta.url))

export function prepareBufferedAudioDriver(sdk, output) {
  if (!sdk) return
  const filename = 'audioout-esp32.c'
  const source = path.join(sdk, 'modules/embedded/io/audio/out/esp32', filename)
  if (!existsSync(source)) return
  const directory = path.join(output, 'tmp/sdk-audioout')
  const driver = path.join(directory, filename)
  mkdirSync(directory, { recursive: true })
  const staging = mkdtempSync(path.join(directory, 'patch-'))
  try {
    const next = path.join(staging, filename)
    copyFileSync(source, next)
    execFileSync('git', ['apply', '--no-index', '-p7', patch], {
      cwd: staging,
      env: { ...process.env, GIT_CEILING_DIRECTORIES: directory },
    })
    if (!existsSync(driver) || !readFileSync(driver).equals(readFileSync(next))) renameSync(next, driver)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}
