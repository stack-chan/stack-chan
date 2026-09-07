#!/usr/bin/env node
// Automated on-device smoke test. Deploys a smoke MOD to a USB-connected
// device and judges pass/fail from the device log.
//
// Channels:
//   xsbug (default) - installs through the normal firmware wrapper, then
//     serial2xsbug bridges device traces to a local log server; passes when the MOD traces its completion
//     line. Requires a debug-build host firmware on the device (use --flash
//     for a full build+deploy first). The xsbug serial bridge is known to be
//     flaky on CoreS3, so failed attempts retry automatically.
//   serial - watches the raw serial port for crash markers only. trace()
//     output is NOT visible on raw serial (it only flows over the xsbug
//     protocol in debug builds), so this mode is a boot-stability smoke, not
//     a completion check. Requires UPLOAD_PORT.
//
// Usage:
//   UPLOAD_PORT=/dev/ttyACM0 npm run test:device
//   npm run test:device -- --device stackchan_rt --port /dev/ttyACM0 --flash
//   UPLOAD_PORT=/dev/ttyACM0 npm run test:device -- --channel serial
import { spawn, spawnSync } from 'node:child_process'
import { createReadStream, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { devices, resolveDevice } from './lib/devices.mjs'
import { startXsbugServer } from './lib/xsbug-log-server.js'

const TIMEOUT_MS = Number(process.env.STACKCHAN_DEVICE_SMOKE_TIMEOUT_MS ?? '120000')
const RETRIES = Number(process.env.STACKCHAN_DEVICE_SMOKE_RETRIES ?? '2')
const SERIAL_BAUD = process.env.STACKCHAN_DEVICE_SMOKE_BAUD ?? '115200'
const DEBUGGER_BAUD = process.env.DEBUGGER_SPEED ?? '460800'
const dryRun = process.env.STACKCHAN_DRY_RUN === '1'

const okPattern = new RegExp(process.env.STACKCHAN_DEVICE_SMOKE_OK ?? 'board diagnostics\\] complete')
const failurePattern =
  /XS abort|# Exception|# exception|stack overflow|module not found|Cannot find module|unhandled exception|throw!|board diagnostics\] .*error/i
const crashPattern = /Guru Meditation|abort\(\)|Brownout detector|panic'?ed/i

const rawArgs = process.argv.slice(2)

function fail(message) {
  console.error(`[device-smoke] ${message}`)
  process.exit(1)
}

function readOption(values, name) {
  const prefix = `--${name}=`
  const index = values.indexOf(`--${name}`)
  if (index >= 0) {
    if (!values[index + 1] || values[index + 1].startsWith('--')) fail(`--${name} requires a value`)
    return values[index + 1]
  }
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
const modManifest = resolve(readOption(rawArgs, 'mod') ?? 'mods/examples/board_diagnostics/manifest.json')
const channel = readOption(rawArgs, 'channel') ?? 'xsbug'
const serialPort =
  readOption(rawArgs, 'port') ?? process.env.STACKCHAN_PORT ?? process.env.UPLOAD_PORT ?? process.env.ESPPORT
if (!serialPort) fail('Specify --port or UPLOAD_PORT so installation and diagnostics use the same device')
if (!['xsbug', 'serial'].includes(channel)) fail(`unknown channel: ${channel} (expected xsbug or serial)`)
if (!Number.isSafeInteger(TIMEOUT_MS) || TIMEOUT_MS <= 0) fail('STACKCHAN_DEVICE_SMOKE_TIMEOUT_MS must be positive')
if (!Number.isSafeInteger(RETRIES) || RETRIES < 0) fail('STACKCHAN_DEVICE_SMOKE_RETRIES must be a nonnegative integer')
const workRoot = mkdtempSync(join(tmpdir(), 'stackchan-device-smoke-'))

function killProcessGroup(child, signal = 'SIGTERM') {
  if (!child.pid) return
  try {
    process.kill(-child.pid, signal)
  } catch {
    child.kill(signal)
  }
}

function decodeXsbugLog(log) {
  return Array.from(log.matchAll(/<log(?:\s[^>]*)?>([\s\S]*?)<\/log>/g), ([, text]) => text)
    .join('')
    .replaceAll('&#10;', '\n')
    .replaceAll('&#13;', '\r')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
}

function runFirmwareCommand(command, ...args) {
  const commandArgs = [
    resolve('scripts/firmware.mjs'),
    command,
    deviceName,
    ...args,
    '--mode=debug',
    '--port',
    serialPort,
  ]
  console.log(`[device-smoke] firmware ${command} for ${device.label} on ${serialPort}`)
  const result = spawnSync(process.execPath, commandArgs, {
    stdio: 'inherit',
  })
  if (result.status !== 0) fail(`firmware ${command} failed; diagnostics were not started`)
}

if (hasFlag(rawArgs, 'flash')) runFirmwareCommand('deploy')
// This is the only installation path: archive validation, live host/API/partition
// checks, esptool write and read-back all belong to the normal MOD command.
if (channel === 'xsbug') runFirmwareCommand('mod', modManifest)
if (dryRun) {
  console.log(`[device-smoke] would watch ${channel} on ${serialPort}; no device was written or tested`)
  process.exit(0)
}

async function runXsbugAttempt(attempt) {
  const logPath = join(workRoot, `attempt-${attempt}.xsbug.log`)
  const logServer = startXsbugServer(logPath)
  const port = await logServer.ready
  console.log(`[device-smoke] attempt ${attempt}: serial2xsbug ${serialPort} -> 127.0.0.1:${port}`)

  return await new Promise((resolveRun) => {
    let settled = false
    let echoedLength = 0
    const child = spawn('serial2xsbug', [serialPort, DEBUGGER_BAUD, '8N1'], {
      detached: true,
      env: { ...process.env, XSBUG_HOST: '127.0.0.1', XSBUG_PORT: String(port) },
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
      const closed = new Promise((resolveClosed) => {
        if (!child.pid || child.exitCode !== null || child.signalCode !== null) return resolveClosed()
        const force = setTimeout(() => killProcessGroup(child, 'SIGKILL'), 1000)
        child.once('close', () => {
          clearTimeout(force)
          resolveClosed()
        })
        killProcessGroup(child)
      })
      Promise.all([closed, logServer.close()]).then(() => resolveRun(status))
    }

    child.on('error', (error) => {
      console.error(`[device-smoke] serial2xsbug failed to start: ${error.message}`)
      finish('error')
    })
    child.on('exit', (code, signal) => {
      if (!settled) {
        console.error(`[device-smoke] serial2xsbug exited early: code=${code ?? 'null'} signal=${signal ?? 'null'}`)
        console.error(`[device-smoke] xsbug log: ${logPath}`)
        finish('exit')
      }
    })

    const poll = setInterval(() => {
      const decoded = decodeXsbugLog(logServer.getLog())
      const fresh = decoded.slice(echoedLength)
      echoedLength = decoded.length
      for (const line of fresh.split('\n')) {
        if (line.includes('board diagnostics]')) console.log(`[device] ${line}`)
      }
      if (failurePattern.test(decoded)) {
        console.error(`[device-smoke] failure marker in device log; full log: ${logPath}`)
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
  const stty = spawnSync('stty', ['-F', serialPort, SERIAL_BAUD, 'raw', '-echo'])
  if (stty.status !== 0) {
    console.error(`[device-smoke] failed to configure ${serialPort}`)
    process.exit(1)
  }

  console.log(`[device-smoke] watching ${serialPort} for ${TIMEOUT_MS}ms (crash markers only)`)
  return await new Promise((resolveRun) => {
    let output = ''
    const stream = createReadStream(serialPort, { encoding: 'utf8' })
    const finish = (status) => {
      clearTimeout(timer)
      stream.close()
      resolveRun(status)
    }
    stream.on('data', (chunk) => {
      output += chunk
      process.stdout.write(chunk)
      if (crashPattern.test(output)) {
        console.error('[device-smoke] crash marker on serial console')
        finish('failure')
      }
    })
    stream.on('error', (error) => {
      console.error(`[device-smoke] serial read failed: ${error.message}`)
      finish('error')
    })
    const timer = setTimeout(() => finish('ok'), TIMEOUT_MS)
  })
}

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
}

if (status === 'ok') {
  console.log('[device-smoke] PASS')
  process.exit(0)
}
console.error(`[device-smoke] FAIL (${status})`)
process.exit(1)
