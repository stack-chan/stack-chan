#!/usr/bin/env node
// Automated on-device smoke test. Deploys a smoke MOD to a USB-connected
// device and judges pass/fail from the device log.
//
// Channels:
//   xsbug (default) - `mcrun -dn -x` bridges device traces over serial2xsbug
//     to SDK xsdb; passes when the smoke MOD traces its completion
//     line. Requires a debug-build host firmware on the device (use --flash
//     for a full build+deploy first). The xsbug serial bridge is known to be
//     flaky on CoreS3, so failed attempts retry automatically.
//   serial - requires an observed completion marker as well as no crash.
//     Debug trace() uses xsbug, not raw serial: use the xsbug channel for those
//     tests. Silence is inconclusive and fails. Requires UPLOAD_PORT.
//
// Usage:
//   UPLOAD_PORT=/dev/ttyACM0 npm run test:device
//   npm run test:device -- --device stackchan_rt --flash
//   UPLOAD_PORT=/dev/ttyACM0 npm run test:device -- --channel serial
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, constants, mkdtempSync, openSync, readSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ensureBuildOutputDirectory, moddableOutputArguments } from './lib/build-output.mjs'
import { devices, resolveDevice } from './lib/devices.mjs'
import { startXsdbSession } from './lib/xsdb-session.mjs'

const TIMEOUT_MS = Number.parseInt(process.env.STACKCHAN_DEVICE_SMOKE_TIMEOUT_MS ?? '120000', 10)
const RETRIES = Number.parseInt(process.env.STACKCHAN_DEVICE_SMOKE_RETRIES ?? '2', 10)
const SERIAL_BAUD = process.env.STACKCHAN_DEVICE_SMOKE_BAUD ?? '115200'

const okPattern = new RegExp(process.env.STACKCHAN_DEVICE_SMOKE_OK ?? 'M5StackChan CoreS3 smoke\\] complete')
const failurePattern =
  /XS abort|# Exception|# exception|stack overflow|module not found|Cannot find module|unhandled exception|throw!|smoke\] .*error/i
const crashPattern = /Guru Meditation|abort\(\)|Brownout detector|panic'?ed/i

const rawArgs = process.argv.slice(2)

function readOption(values, name) {
  const prefix = `--${name}=`
  const index = values.indexOf(`--${name}`)
  if (index >= 0) return values[index + 1]
  return values.find((value) => value.startsWith(prefix))?.slice(prefix.length)
}

function hasFlag(values, name) {
  return values.includes(`--${name}`)
}

const deviceName = resolveDevice(
  readOption(rawArgs, 'device') ?? process.env.STACKCHAN_DEVICE ?? 'default',
  '[device-smoke]',
)
const device = devices[deviceName]
const platform = `esp32:${device.platform}`
const modManifest = resolve(readOption(rawArgs, 'mod') ?? 'mods/examples/m5stackchan_smoke/manifest.json')
const channel = readOption(rawArgs, 'channel') ?? 'xsbug'
const workRoot = mkdtempSync(join(tmpdir(), 'stackchan-device-smoke-'))
ensureBuildOutputDirectory()
const outputArgs = moddableOutputArguments()

function killProcessGroup(child) {
  if (!child.pid || child.killed) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
}

function flashHostFirmware() {
  console.log(`[device-smoke] building and deploying host firmware for ${device.label}`)
  const result = spawnSync(
    'mcconfig',
    ['-d', '-m', '-p', platform, '-t', 'deploy', ...outputArgs, resolve(device.manifest)],
    { stdio: 'inherit' },
  )
  if (result.status !== 0) {
    console.error('[device-smoke] host firmware deploy failed')
    process.exit(result.status ?? 1)
  }
}

async function runXsbugAttempt(attempt) {
  const logPath = join(workRoot, `attempt-${attempt}.xsbug.log`)
  const logServer = await startXsdbSession(logPath, join(workRoot, `xsdb-${attempt}`), process.env.MODDABLE)
  const port = await logServer.ready
  console.log(`[device-smoke] attempt ${attempt}: mcrun -dn -x 127.0.0.1:${port} ${modManifest}`)

  return await new Promise((resolveRun) => {
    let settled = false
    let echoedLength = 0
    const child = spawn('mcrun', ['-dn', '-x', `127.0.0.1:${port}`, '-m', '-p', platform, ...outputArgs, modManifest], {
      detached: true,
      env: process.env,
    })

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => process.stdout.write(chunk))
    child.stderr.on('data', (chunk) => process.stderr.write(chunk))

    const finish = (status) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      clearInterval(poll)
      killProcessGroup(child)
      logServer.close().then(() => resolveRun(status))
    }

    child.on('error', (error) => {
      console.error(`[device-smoke] mcrun failed to start: ${error.message}`)
      finish('error')
    })
    child.on('exit', (code, signal) => {
      if (!settled) {
        console.error(`[device-smoke] mcrun exited early: code=${code ?? 'null'} signal=${signal ?? 'null'}`)
        console.error(`[device-smoke] xsbug log: ${logPath}`)
        finish('exit')
      }
    })

    const poll = setInterval(() => {
      const decoded = logServer.getLog()
      const fresh = decoded.slice(echoedLength)
      echoedLength = decoded.length
      for (const line of fresh.split('\n')) {
        if (line.includes('smoke]')) console.log(`[device] ${line}`)
      }
      if (logServer.getError() || failurePattern.test(decoded)) {
        console.error(`[device-smoke] debugger error or failure marker; full log: ${logPath}`)
        finish('failure')
      } else if (okPattern.test(decoded)) {
        finish('ok')
      }
    }, 200)

    const timeout = setTimeout(() => {
      console.error(`[device-smoke] timed out after ${TIMEOUT_MS}ms; xsbug log: ${logPath}`)
      finish('timeout')
    }, TIMEOUT_MS)
  })
}

async function runSerialWatch() {
  const serialPort = process.env.UPLOAD_PORT
  if (!serialPort) {
    console.error('[device-smoke] --channel serial requires UPLOAD_PORT=/dev/tty...')
    process.exit(1)
  }
  const stty = spawnSync('stty', ['-F', serialPort, SERIAL_BAUD, 'raw', '-echo'])
  if (stty.status !== 0) {
    console.error(`[device-smoke] failed to configure ${serialPort}`)
    process.exit(1)
  }

  console.log(`[device-smoke] watching ${serialPort} for ${TIMEOUT_MS}ms (completion and crash markers)`)
  return await new Promise((resolveRun) => {
    let output = ''
    // A blocking fs stream can keep Node's worker thread alive after timeout
    // while a silent tty never satisfies its pending read. Poll a nonblocking
    // descriptor instead so failure really terminates within the time limit.
    const descriptor = openSync(serialPort, constants.O_RDONLY | constants.O_NONBLOCK)
    const buffer = Buffer.alloc(4096)
    const finish = (status) => {
      clearTimeout(timer)
      clearInterval(poll)
      closeSync(descriptor)
      resolveRun(status)
    }
    const poll = setInterval(() => {
      try {
        const count = readSync(descriptor, buffer, 0, buffer.length)
        if (!count) return finish('disconnected')
        const chunk = buffer.toString('utf8', 0, count)
        output += chunk
        process.stdout.write(chunk)
        if (crashPattern.test(output)) finish('failure')
        else if (okPattern.test(output)) finish('ok')
      } catch (error) {
        if (error.code === 'EAGAIN') return
        console.error(`[device-smoke] serial read failed: ${error.message}`)
        finish('error')
      }
    }, 50)
    const timer = setTimeout(() => finish('timeout'), TIMEOUT_MS)
  })
}

if (channel === 'xsbug' && !process.env.MODDABLE) {
  console.error('[device-smoke] xsdb requires MODDABLE to select the SDK')
  process.exit(1)
}

if (hasFlag(rawArgs, 'flash')) flashHostFirmware()

let status
if (channel === 'serial') {
  status = await runSerialWatch()
} else if (channel === 'xsbug') {
  for (let attempt = 1; attempt <= 1 + RETRIES; attempt++) {
    status = await runXsbugAttempt(attempt)
    // 'failure' is a real device-side failure; only retry channel flakiness.
    if (status === 'ok' || status === 'failure') break
    if (attempt <= RETRIES) console.log('[device-smoke] retrying (xsbug serial bridge may have dropped)')
  }
} else {
  console.error(`[device-smoke] unknown channel: ${channel} (expected xsbug or serial)`)
  process.exit(1)
}

if (status === 'ok') {
  console.log('[device-smoke] PASS')
  process.exit(0)
}
console.error(`[device-smoke] FAIL (${status})`)
process.exit(1)
