#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { availableParallelism, tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { startXsbugServer } from './lib/xsbug-log-server.js'

const DEFAULT_ROOTS = ['host/app', 'host/modules', 'mods/examples']
const XSBUG_HOST = process.env.STACKCHAN_MODULE_TEST_XSBUG_HOST ?? '127.0.0.1'
const RUNTIME_TIMEOUT_MS = Number.parseInt(process.env.STACKCHAN_MODULE_TEST_TIMEOUT_MS ?? '15000', 10)
const BUILD_TIMEOUT_MS = Number.parseInt(process.env.STACKCHAN_MODULE_TEST_BUILD_TIMEOUT_MS ?? '360000', 10)
const FILTER = process.env.STACKCHAN_MODULE_TEST_FILTER
// Incremental builds are safe: mcconfig regenerates the makefile on every run and
// the generated mc.xs.c rule depends on every manifest in the include chain, so
// stale outputs cannot survive a manifest or module edit. CLEAN exists as an
// escape hatch for a corrupted build tree.
const CLEAN = process.env.STACKCHAN_MODULE_TEST_CLEAN === '1'
const JOBS = (() => {
  const parsed = Number.parseInt(process.env.STACKCHAN_MODULE_TEST_JOBS ?? '', 10)
  if (Number.isFinite(parsed) && parsed >= 1) return parsed
  // Each mcconfig build already compiles with make --jobs 8 internally; leave
  // CPU headroom or cold builds on 4-core CI runners exceed the build timeout.
  return Math.min(4, Math.max(1, availableParallelism() - 2))
})()
// Explicit per-test X display numbers: xvfb-run -a probes lock files and races
// when several instances start concurrently.
const DISPLAY_BASE = 100 + (process.pid % 1000)
// mcsim is a GtkApplication with a fixed application-id and no
// G_APPLICATION_NON_UNIQUE, so a second instance on the same DBus session bus
// hands its .so to the first one and exits 0. A private bus per test keeps
// concurrent simulators (and any mcsim the user has open) independent.
const HAS_DBUS_RUN_SESSION = spawnSync('dbus-run-session', ['--version'], { stdio: 'ignore' }).status === 0

const MODDABLE = process.env.MODDABLE
if (!MODDABLE) {
  console.error('MODDABLE is not set. Source xs-dev-export.sh before running module tests.')
  process.exit(1)
}

const firmwareRoot = process.cwd()
const workRoot = mkdtempSync(join(tmpdir(), 'stackchan-module-tests-'))
// xsbug emits `# Exception` for caught Promise rejections too. Fatal aborts are
// explicit; a stopped runtime without either a fatal marker or `ok` times out.
const fatalFailurePattern = /XS abort|stack overflow|module not found|Cannot find module|unhandled exception/i
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

function localManifestPath(basePath, includePath) {
  if (!includePath.startsWith('.')) return undefined
  const path = resolve(dirname(basePath), includePath)
  return existsSync(path) && statSync(path).isFile() ? path : undefined
}

function manifestUsesPiu(manifestPath, seen = new Set()) {
  const normalizedPath = relativePath(manifestPath)
  if (normalizedPath.includes('host/modules/ui/')) return true
  if (seen.has(manifestPath)) return false
  seen.add(manifestPath)

  const manifest = readJson(manifestPath)
  const values = JSON.stringify({
    include: manifest.include ?? [],
    modules: manifest.modules ?? {},
    platforms: manifest.platforms ?? {},
  })
  if (/host\/modules\/ui\/manifest|modules\/ui\/manifest|startup-splash|settings-view|piu\/MC/.test(values)) {
    return true
  }

  for (const includePath of manifest.include ?? []) {
    const localPath = localManifestPath(manifestPath, includePath)
    if (localPath && manifestUsesPiu(localPath, seen)) return true
  }
  return false
}

function selectPlatform(manifestPath) {
  return manifestUsesPiu(manifestPath) ? 'lin/m5stack' : 'lin'
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

// Tests sharing a build-output directory would corrupt each other under
// parallel execution; the directory name is the test directory basename.
function assertUniqueNames(manifestPaths) {
  const seen = new Map()
  for (const manifestPath of manifestPaths) {
    const key = `${platformBuildSegment(selectPlatform(manifestPath))}/${basename(dirname(manifestPath))}`
    const existing = seen.get(key)
    if (existing) {
      console.error(`Duplicate test directory name shares build output "${key}":`)
      console.error(`  ${relativePath(existing)}`)
      console.error(`  ${relativePath(manifestPath)}`)
      process.exit(1)
    }
    seen.set(key, manifestPath)
  }
}

function runProcess(command, args, { timeout }) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { cwd: firmwareRoot })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeout)
    child.on('error', (error) => {
      clearTimeout(timer)
      resolveRun({ status: null, stdout, stderr, error, timedOut })
    })
    child.on('close', (status) => {
      clearTimeout(timer)
      resolveRun({ status, stdout, stderr, timedOut })
    })
  })
}

function formatProcessFailure(label, result) {
  const lines = [`${label} failed with exit code ${result.status}`]
  if (result.stdout.length > 0) lines.push(result.stdout)
  if (result.stderr.length > 0) lines.push(result.stderr)
  return lines
}

async function buildManifest({ manifestPath, platform, port, name, output }) {
  if (CLEAN) removeBuildOutput(platform, name)
  const label = `mcconfig ${relativePath(manifestPath)}`
  const result = await runProcess(
    'mcconfig',
    ['-d', '-x', `${XSBUG_HOST}:${port}`, '-m', '-p', platform, '-t', 'build', manifestPath],
    { timeout: BUILD_TIMEOUT_MS },
  )

  if (result.error) {
    output.push(result.error.stack ?? result.error.message)
    return false
  }
  if (result.timedOut) {
    output.push(`${label} timed out after ${BUILD_TIMEOUT_MS}ms`)
    if (result.stdout.length > 0) output.push(result.stdout)
    if (result.stderr.length > 0) output.push(result.stderr)
    return false
  }
  if (result.status !== 0) {
    output.push(...formatProcessFailure(label, result))
    return false
  }
  return true
}

function killProcessGroup(child) {
  if (!child.pid || child.killed) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
}

async function runSimulator({ binDir, port, logServer, display, configHome }) {
  const simulator = join(MODDABLE, 'build', 'bin', 'lin', 'release', 'mcsim')
  if (!existsSync(simulator)) throw new Error(`mcsim not found at ${simulator}`)

  return await new Promise((resolveRun) => {
    let settled = false
    let stdout = ''
    let stderr = ''
    const xvfbCommand = ['xvfb-run', '-n', String(display), simulator, join(binDir, 'mc.so')]
    const [command, ...args] = HAS_DBUS_RUN_SESSION ? ['dbus-run-session', '--', ...xvfbCommand] : xvfbCommand
    const child = spawn(command, args, {
      cwd: firmwareRoot,
      detached: true,
      env: {
        ...process.env,
        XSBUG_HOST,
        XSBUG_PORT: String(port),
        // mcsim copies mc.so into $XDG_CONFIG_HOME/tech.moddable.mcsim/ and
        // runs it from there; concurrent instances sharing the default
        // ~/.config would overwrite each other's mapped archive (SIGBUS).
        XDG_CONFIG_HOME: configHome,
        // Keep the private session bus from auto-spawning accessibility,
        // gvfs, and portal daemons per test.
        NO_AT_BRIDGE: '1',
        GTK_A11Y: 'none',
        GIO_USE_VFS: 'local',
        GTK_USE_PORTAL: '0',
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
      if (fatalFailurePattern.test(log)) {
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

function formatRuntimeFailure(manifestPath, result, logPath) {
  const lines = [`Runtime failed: ${relativePath(manifestPath)} (${result.status})`]
  if (result.message) lines.push(result.message)
  if (result.code != null || result.signal != null) {
    lines.push(`mcsim exit: code=${result.code ?? 'null'} signal=${result.signal ?? 'null'}`)
  }
  if (result.stdout) lines.push(result.stdout)
  if (result.stderr) lines.push(result.stderr)
  lines.push(`xsbug log: ${logPath}`)
  lines.push(result.log.split('\n').slice(-40).join('\n'))
  return lines
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

async function runOne(manifestPath, index) {
  const name = basename(dirname(manifestPath))
  const platform = selectPlatform(manifestPath)
  const logPath = join(workRoot, `${name}.xsbug.log`)
  const logServer = startXsbugServer(logPath, XSBUG_HOST)
  const port = await logServer.ready
  const label = `${relativePath(manifestPath)} [${platform}]`
  const output = []

  try {
    if (!(await buildManifest({ manifestPath, platform, port, name, output }))) {
      return { label, ok: false, reason: 'build failed', output }
    }

    const binDir = readBinDir(platform, name)
    const configHome = join(workRoot, `config-${name}`)
    mkdirSync(configHome, { recursive: true })
    const result = await runSimulator({ binDir, port, logServer, display: DISPLAY_BASE + index, configHome })
    if (result.status === 'ok') {
      return { label, ok: true, output }
    }
    output.push(...formatRuntimeFailure(manifestPath, result, logPath))
    return { label, ok: false, reason: result.status, output }
  } finally {
    await logServer.close()
  }
}

const manifestPaths = await collectManifestPaths(process.argv.slice(2))
if (manifestPaths.length === 0) {
  console.log('No runnable Moddable test manifests found.')
  process.exit(0)
}

assertUniqueNames(manifestPaths)

let jobs = Math.min(JOBS, manifestPaths.length)
if (jobs > 1 && !HAS_DBUS_RUN_SESSION) {
  console.warn('dbus-run-session not found; running 1 job at a time (concurrent mcsim instances would collide)')
  jobs = 1
}
console.log(
  `Running ${manifestPaths.length} Moddable test manifest(s) with ${jobs} job(s)${CLEAN ? ', clean build' : ''}`,
)

// The XS core objects live in a lib directory shared by every app of the same
// platform segment; build one manifest per segment up front so parallel builds
// never race on populating it.
if (jobs > 1) {
  const warmups = new Map()
  for (const manifestPath of manifestPaths) {
    const segment = platformBuildSegment(selectPlatform(manifestPath))
    if (!warmups.has(segment)) warmups.set(segment, manifestPath)
  }
  for (const [segment, manifestPath] of warmups) {
    process.stdout.write(`- warm-up build [${segment}] ${relativePath(manifestPath)} ... `)
    const output = []
    const ok = await buildManifest({
      manifestPath,
      platform: selectPlatform(manifestPath),
      port: 5002,
      name: basename(dirname(manifestPath)),
      output,
    })
    console.log(ok ? 'ok' : 'failed')
    if (!ok && output.length > 0) console.error(output.join('\n'))
  }
}

let cursor = 0
let failures = 0

async function worker() {
  while (true) {
    const index = cursor++
    if (index >= manifestPaths.length) return
    const manifestPath = manifestPaths[index]
    let result
    try {
      result = await runOne(manifestPath, index)
    } catch (error) {
      result = {
        label: relativePath(manifestPath),
        ok: false,
        output: [error.stack ?? String(error)],
      }
    }
    if (result.ok) {
      console.log(`- ${result.label} ... ok`)
    } else {
      failures += 1
      console.log(`- ${result.label} ... failed`)
      if (result.output.length > 0) console.error(result.output.join('\n'))
    }
  }
}

await Promise.all(Array.from({ length: jobs }, () => worker()))

if (failures > 0) {
  console.error(`${failures} Moddable test manifest(s) failed`)
  process.exit(1)
}

console.log('All Moddable test manifests passed')
