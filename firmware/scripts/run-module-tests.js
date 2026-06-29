#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'

const DEFAULT_ROOTS = ['host/modules']
const XSBUG_HOST = process.env.STACKCHAN_MODULE_TEST_XSBUG_HOST ?? '127.0.0.1'
const RUNTIME_TIMEOUT_MS = Number.parseInt(process.env.STACKCHAN_MODULE_TEST_TIMEOUT_MS ?? '8000', 10)
const BUILD_TIMEOUT_MS = Number.parseInt(process.env.STACKCHAN_MODULE_TEST_BUILD_TIMEOUT_MS ?? '180000', 10)
const FILTER = process.env.STACKCHAN_MODULE_TEST_FILTER

const MODDABLE = process.env.MODDABLE
if (!MODDABLE) {
  console.error('MODDABLE is not set. Source xs-dev-export.sh before running module tests.')
  process.exit(1)
}

const firmwareRoot = process.cwd()
const workRoot = mkdtempSync(join(tmpdir(), 'stackchan-module-tests-'))
const failurePattern =
  /XS abort|# Exception|# exception|stack overflow|module not found|Cannot find module|unhandled exception|throw!/i
const okPattern = /<log>ok(?:&#10;|\n)<\/log>/

function relativePath(path) {
  return relative(firmwareRoot, path)
}

async function walk(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      files.push(...(await walk(path)))
    } else {
      files.push(path)
    }
  }
  return files
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function isRunnableManifest(path) {
  const manifest = readJson(path)
  return typeof manifest.modules?.main === 'string'
}

function selectPlatform(manifestPath) {
  return relativePath(manifestPath).includes('host/modules/ui/') ? 'lin/m5stack' : 'lin'
}

function platformBuildSegment(platform) {
  return platform === 'lin' ? 'lin/mc' : platform
}

function removeBuildOutput(platform, name) {
  const segment = platformBuildSegment(platform)
  rmSync(join(MODDABLE, 'build', 'tmp', segment, 'debug', name), { recursive: true, force: true })
  rmSync(join(MODDABLE, 'build', 'bin', segment, 'debug', name), { recursive: true, force: true })
}

function readBinDir(platform, name) {
  const makefile = join(MODDABLE, 'build', 'tmp', platformBuildSegment(platform), 'debug', name, 'makefile')
  const source = readFileSync(makefile, 'utf8')
  const match = source.match(/^BIN_DIR = (.+)$/m)
  if (!match) throw new Error(`BIN_DIR not found in ${makefile}`)
  return match[1]
}

function printProcessFailure(label, result) {
  const stdout = result.stdout?.toString() ?? ''
  const stderr = result.stderr?.toString() ?? ''
  console.error(`${label} failed with exit code ${result.status}`)
  if (stdout.length > 0) console.error(stdout)
  if (stderr.length > 0) console.error(stderr)
}

function buildManifest({ manifestPath, platform, port, name }) {
  removeBuildOutput(platform, name)
  const result = spawnSync(
    'mcconfig',
    ['-d', '-x', `${XSBUG_HOST}:${port}`, '-m', '-p', platform, '-t', 'build', manifestPath],
    {
      cwd: firmwareRoot,
      encoding: 'utf8',
      timeout: BUILD_TIMEOUT_MS,
      maxBuffer: 20 * 1024 * 1024,
    },
  )

  if (result.error) {
    console.error(result.error.stack ?? result.error.message)
    return false
  }
  if (result.status !== 0) {
    printProcessFailure(`mcconfig ${relativePath(manifestPath)}`, result)
    return false
  }
  return true
}

function startXsbugServer(logPath) {
  let log = ''
  let promptBuffer = ''
  let resolveReady
  writeFileSync(logPath, '')
  const ready = new Promise((resolveReadyPromise) => {
    resolveReady = resolveReadyPromise
  })

  const append = (chunk) => {
    log += chunk
    writeFileSync(logPath, log)
  }

  const server = createServer((socket) => {
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      append(chunk)
      promptBuffer += chunk
      if (/<(login|break|bubble)\b/.test(promptBuffer)) {
        socket.write('\r\n<go/>\r\n')
        promptBuffer = ''
      } else {
        promptBuffer = promptBuffer.slice(-128)
      }
    })
    socket.on('error', (error) => {
      append(`\n[xsbug socket error] ${error.stack ?? error.message}\n`)
    })
  })

  server.listen(0, XSBUG_HOST, () => {
    resolveReady(server.address().port)
  })

  return {
    ready,
    close: () =>
      new Promise((resolveClose) => {
        server.close(() => resolveClose())
      }),
    getLog: () => log,
  }
}

function killProcessGroup(child) {
  if (!child.pid || child.killed) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
}

async function runSimulator({ binDir, port, logServer }) {
  const simulator = join(MODDABLE, 'build', 'bin', 'lin', 'release', 'mcsim')
  if (!existsSync(simulator)) throw new Error(`mcsim not found at ${simulator}`)

  return await new Promise((resolveRun) => {
    let settled = false
    let stdout = ''
    let stderr = ''
    const child = spawn('xvfb-run', ['-a', simulator, join(binDir, 'mc.so')], {
      cwd: firmwareRoot,
      detached: true,
      env: {
        ...process.env,
        XSBUG_HOST,
        XSBUG_PORT: String(port),
      },
    })

    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      clearInterval(poll)
      killProcessGroup(child)
      resolveRun({ ...result, stdout, stderr, log: logServer.getLog() })
    }

    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      finish({ status: 'error', message: error.stack ?? error.message })
    })
    child.on('exit', (code, signal) => {
      if (!settled) finish({ status: 'exit', code, signal })
    })

    const poll = setInterval(() => {
      const log = logServer.getLog()
      if (failurePattern.test(log)) {
        finish({ status: 'failure-marker' })
      } else if (okPattern.test(log)) {
        finish({ status: 'ok' })
      }
    }, 100)

    const timeout = setTimeout(() => {
      finish({ status: 'timeout' })
    }, RUNTIME_TIMEOUT_MS)
  })
}

function printRuntimeFailure(manifestPath, result, logPath) {
  console.error(`Runtime failed: ${relativePath(manifestPath)} (${result.status})`)
  if (result.message) console.error(result.message)
  if (result.code != null || result.signal != null) {
    console.error(`mcsim exit: code=${result.code ?? 'null'} signal=${result.signal ?? 'null'}`)
  }
  if (result.stdout) console.error(result.stdout)
  if (result.stderr) console.error(result.stderr)
  console.error(`xsbug log: ${logPath}`)
  console.error(result.log.split('\n').slice(-40).join('\n'))
}

async function collectManifestPaths(args) {
  const roots = args.length > 0 ? args : DEFAULT_ROOTS
  const manifests = []
  for (const root of roots) {
    const path = resolve(firmwareRoot, root)
    if (!existsSync(path)) throw new Error(`${root} does not exist`)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      manifests.push(...(await walk(path)).filter((file) => file.endsWith('manifest.test.json')))
    } else if (path.endsWith('manifest.test.json')) {
      manifests.push(path)
    }
  }

  const runnable = manifests.filter(isRunnableManifest).sort()
  if (FILTER) {
    return runnable.filter((path) => relativePath(path).includes(FILTER))
  }
  return runnable
}

const manifestPaths = await collectManifestPaths(process.argv.slice(2))
if (manifestPaths.length === 0) {
  console.log('No runnable Moddable test manifests found.')
  process.exit(0)
}

let failures = 0
console.log(`Running ${manifestPaths.length} Moddable test manifest(s)`)

for (const manifestPath of manifestPaths) {
  const name = basename(dirname(manifestPath))
  const platform = selectPlatform(manifestPath)
  const logPath = join(workRoot, `${name}.xsbug.log`)
  const logServer = startXsbugServer(logPath)
  const port = await logServer.ready
  const label = `${relativePath(manifestPath)} [${platform}]`

  try {
    process.stdout.write(`- ${label} ... `)
    if (!buildManifest({ manifestPath, platform, port, name })) {
      failures += 1
      console.log('build failed')
      continue
    }

    const binDir = readBinDir(platform, name)
    const result = await runSimulator({ binDir, port, logServer })
    if (result.status === 'ok') {
      console.log('ok')
    } else {
      failures += 1
      console.log('failed')
      printRuntimeFailure(manifestPath, result, logPath)
    }
  } finally {
    await logServer.close()
  }
}

if (failures > 0) {
  console.error(`${failures} Moddable test manifest(s) failed`)
  process.exit(1)
}

console.log('All Moddable test manifests passed')
