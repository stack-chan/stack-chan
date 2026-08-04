#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodeXsbugLog, evaluateChatSmokeLog, selectChatSmokeProgress } from './lib/chat-smoke-log.mjs'
import { startXsbugServer } from './lib/xsbug-log-server.js'

const firmwareDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rawArguments = process.argv.slice(2)
const port = readOption(rawArguments, 'port') ?? process.env.STACKCHAN_PORT ?? process.env.UPLOAD_PORT ?? '/dev/ttyACM0'
const expectedMac = normalizeMac(readOption(rawArguments, 'expected-mac') ?? process.env.STACKCHAN_EXPECTED_MAC)
const serialSpeed = readOption(rawArguments, 'baud') ?? process.env.STACKCHAN_CHAT_SMOKE_BAUD ?? '460800'
const timeoutMs = positiveInteger(
  readOption(rawArguments, 'timeout-ms') ?? process.env.STACKCHAN_CHAT_SMOKE_TIMEOUT_MS ?? '120000',
  'timeout-ms',
)
const cleanupTimeoutMs = positiveInteger(
  readOption(rawArguments, 'cleanup-timeout-ms') ?? process.env.STACKCHAN_CHAT_SMOKE_CLEANUP_TIMEOUT_MS ?? '15000',
  'cleanup-timeout-ms',
)
const runs = positiveInteger(readOption(rawArguments, 'runs') ?? process.env.STACKCHAN_CHAT_SMOKE_RUNS ?? '1', 'runs')
const requireInput = rawArguments.includes('--require-input')
const outputRoot = path.resolve(
  readOption(rawArguments, 'output') ??
    process.env.STACKCHAN_CHAT_SMOKE_OUTPUT ??
    path.join(firmwareDirectory, 'dist/chat-smoke', timestamp()),
)
const moddableDirectory = process.env.MODDABLE
const serialBridge = moddableDirectory
  ? path.resolve(moddableDirectory, 'build/bin/lin/release/serial2xsbug')
  : undefined

if (!existsSync(port)) {
  console.error(`[chat-smoke] serial device does not exist: ${port}`)
  process.exit(1)
}
if (!/^[1-9][0-9]*$/.test(String(serialSpeed))) {
  console.error(`[chat-smoke] invalid baud rate: ${serialSpeed}`)
  process.exit(1)
}
if (!moddableDirectory) {
  console.error('[chat-smoke] MODDABLE is not set. Load the xs-dev environment first.')
  process.exit(1)
}
if (!existsSync(serialBridge)) {
  console.error(`[chat-smoke] serial2xsbug was not found: ${serialBridge}`)
  process.exit(1)
}

mkdirSync(outputRoot, { recursive: true })
let activeBridge
let interrupted = false

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    interrupted = true
    console.error(`[chat-smoke] received ${signal}; stopping the active bridge`)
    stopBridge(activeBridge)
  })
}

const results = []
for (let run = 1; run <= runs && !interrupted; run += 1) {
  const runDirectory = path.join(outputRoot, `run-${String(run).padStart(2, '0')}`)
  mkdirSync(runDirectory, { recursive: true })
  console.log(`[chat-smoke] run ${run}/${runs}: target=${port}`)

  const identity = resetAndReadIdentity()
  if (!identity.ok) {
    results.push({ run, status: 'failed', reason: identity.reason })
    break
  }

  const result = await collectRun({ run, runDirectory })
  results.push({ run, ...result })
  console.log(`[chat-smoke] run ${run}/${runs}: ${result.status.toUpperCase()} (${result.elapsedMs} ms)`)
  if (result.status !== 'passed') break
}

const summaryPath = path.join(outputRoot, 'summary.json')
writeFileSync(
  summaryPath,
  `${JSON.stringify(
    {
      target: port,
      expectedMac,
      requireInput,
      runsRequested: runs,
      results,
    },
    null,
    2,
  )}\n`,
)

const allPassed = results.length === runs && results.every((result) => result.status === 'passed')
if (allPassed) {
  console.log(`[chat-smoke] PASS ${results.length}/${runs}; artifacts=${outputRoot}`)
  process.exit(0)
}

const failed = results.find((result) => result.status !== 'passed')
console.error(
  `[chat-smoke] FAIL run=${failed?.run ?? results.length + 1} reason=${failed?.reason ?? 'interrupted'}; artifacts=${outputRoot}`,
)
process.exit(interrupted ? 130 : 1)

function resetAndReadIdentity() {
  const result = spawnSync(
    'esptool',
    ['--chip', 'esp32s3', '--port', port, '--before', 'default-reset', '--after', 'hard-reset', 'chip-id'],
    {
      cwd: firmwareDirectory,
      env: process.env,
      encoding: 'utf8',
    },
  )
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (result.error) {
    console.error(`[chat-smoke] esptool could not start: ${result.error.message}`)
    return { ok: false, reason: 'esptool could not start' }
  }
  if (result.status !== 0) {
    process.stderr.write(output)
    return { ok: false, reason: `esptool exited with status ${result.status ?? 'unknown'}` }
  }

  const detectedMac = normalizeMac(output.match(/\bMAC:\s*([0-9a-f:]{17})\b/i)?.[1])
  if (!detectedMac) {
    process.stderr.write(output)
    return { ok: false, reason: 'device MAC was not present in esptool output' }
  }
  console.log(`[chat-smoke] device MAC=${detectedMac}`)
  if (expectedMac && detectedMac !== expectedMac) {
    return { ok: false, reason: `unexpected device MAC ${detectedMac} (expected ${expectedMac})` }
  }
  return { ok: true, detectedMac }
}

async function collectRun({ run, runDirectory }) {
  const rawLogPath = path.join(runDirectory, 'xsbug-raw.log')
  const decodedLogPath = path.join(runDirectory, 'device.log')
  const logServer = startXsbugServer(rawLogPath)
  const xsbugPort = await logServer.ready
  const bridge = spawn(serialBridge, [port, String(serialSpeed), '8N1'], {
    detached: true,
    env: {
      ...process.env,
      XSBUG_HOST: '127.0.0.1',
      XSBUG_PORT: String(xsbugPort),
    },
    stdio: 'ignore',
  })
  activeBridge = bridge
  const startedAt = Date.now()

  return await new Promise((resolveRun) => {
    let settled = false
    let shownProgressLines = 0
    let passDetectedAt
    let poll
    let heartbeat
    let timeout

    const finish = async (status, reason, marker) => {
      if (settled) return
      settled = true
      clearInterval(poll)
      clearInterval(heartbeat)
      clearTimeout(timeout)
      stopBridge(bridge)
      const decoded = decodeXsbugLog(logServer.getLog())
      writeFileSync(decodedLogPath, decoded)
      await logServer.close()
      activeBridge = undefined
      resolveRun({ status, reason, marker, elapsedMs: Date.now() - startedAt })
    }

    bridge.on('error', (error) => {
      finish('failed', `serial2xsbug could not start: ${error.message}`)
    })
    bridge.on('exit', (code, signal) => {
      if (!settled) {
        finish('failed', `serial2xsbug exited early: code=${code ?? 'null'} signal=${signal ?? 'null'}`)
      }
    })

    poll = setInterval(() => {
      const decoded = decodeXsbugLog(logServer.getLog())
      const progressLines = selectChatSmokeProgress(decoded)
      for (const line of progressLines.slice(shownProgressLines)) console.log(`[device] ${line}`)
      shownProgressLines = progressLines.length

      const evaluation = evaluateChatSmokeLog(decoded, { requireInput })
      if (evaluation.status === 'failed') {
        finish('failed', evaluation.reason, evaluation.marker)
      } else if (evaluation.status === 'passed') {
        finish('passed', undefined, evaluation.marker)
      } else if (evaluation.status === 'passing') {
        passDetectedAt ??= Date.now()
        if (Date.now() - passDetectedAt >= cleanupTimeoutMs) {
          finish('failed', `chat did not disconnect within ${cleanupTimeoutMs} ms after PASS`, evaluation.marker)
        }
      }
    }, 100)

    heartbeat = setInterval(() => {
      console.log(`[chat-smoke] run ${run}/${runs}: waiting elapsedMs=${Date.now() - startedAt}`)
    }, 10000)

    timeout = setTimeout(() => {
      finish('failed', `timed out after ${timeoutMs} ms`)
    }, timeoutMs)
  })
}

function stopBridge(bridge) {
  if (!bridge?.pid || bridge.killed) return
  try {
    process.kill(-bridge.pid, 'SIGTERM')
  } catch {
    bridge.kill('SIGTERM')
  }
}

function readOption(values, name) {
  const prefix = `--${name}=`
  const index = values.indexOf(`--${name}`)
  if (index >= 0) {
    const value = values[index + 1]
    if (!value || value.startsWith('--')) {
      console.error(`[chat-smoke] --${name} requires a value`)
      process.exit(1)
    }
    return value
  }
  const argument = values.find((value) => value.startsWith(prefix))
  if (!argument) return undefined
  const value = argument.slice(prefix.length)
  if (!value) {
    console.error(`[chat-smoke] --${name} requires a value`)
    process.exit(1)
  }
  return value
}

function positiveInteger(value, name) {
  if (!/^[1-9][0-9]*$/.test(String(value))) {
    console.error(`[chat-smoke] --${name} must be a positive integer: ${value}`)
    process.exit(1)
  }
  return Number.parseInt(String(value), 10)
}

function normalizeMac(value) {
  if (value === undefined) return undefined
  const normalized = String(value).trim().toLowerCase()
  if (!/^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/.test(normalized)) {
    console.error(`[chat-smoke] invalid MAC address: ${value}`)
    process.exit(1)
  }
  return normalized
}

function timestamp() {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
}
