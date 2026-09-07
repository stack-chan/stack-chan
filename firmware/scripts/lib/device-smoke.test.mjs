import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const scripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Run the actual CLI and TCP log server; replace only firmware installation and
// the physical serial bridge with observable child processes.
function runSmoke(args = [], environment = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'stackchan-smoke-test-'))
  const journal = path.join(root, 'calls.jsonl')
  mkdirSync(path.join(root, 'scripts/lib'), { recursive: true })
  mkdirSync(path.join(root, 'bin'))
  writeFileSync(path.join(root, 'package.json'), '{"type":"module"}')
  for (const name of ['run-device-smoke.js', 'lib/devices.mjs', 'lib/xsbug-log-server.js'])
    copyFileSync(path.join(scripts, name), path.join(root, 'scripts', name))
  const observe = `
import { appendFileSync, readFileSync } from 'node:fs'
const journal = process.env.SMOKE_TEST_JOURNAL
const record = value => appendFileSync(journal, JSON.stringify(value) + '\\n')
`
  writeFileSync(
    path.join(root, 'scripts/firmware.mjs'),
    `${observe}
const args = process.argv.slice(2)
record({ kind: 'firmware', args })
if (process.env.SMOKE_TEST_REJECT === args[0]) process.exit(1)
`,
  )
  writeFileSync(
    path.join(root, 'bin/serial2xsbug'),
    `#!/usr/bin/env node
${observe}
import { createConnection } from 'node:net'
record({ kind: 'bridge', args: process.argv.slice(2), pid: process.pid })
const mode = process.env.SMOKE_TEST_BRIDGE
if (mode === 'flaky' && readFileSync(journal, 'utf8').split('"kind":"bridge"').length === 2) process.exit(2)
process.on('SIGTERM', () => {
  if (mode === 'stubborn') return
  record({ kind: 'bridge-closed', pid: process.pid })
  process.exit(0)
})
const socket = createConnection(Number(process.env.XSBUG_PORT), process.env.XSBUG_HOST, () => {
  if (mode === 'stubborn') return
  socket.write('<xsbug><login name="ignored"/><log path="diagnostics">[board diagnostics] complete&#10;' +
    (mode === 'failure' ? '[board diagnostics] error: servo failed&#10;' : '') + '</log></xsbug>')
})
setInterval(() => {}, 1000)
`,
    { mode: 0o755 },
  )
  let calls = []
  try {
    const env = {
      ...process.env,
      PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}`,
      TMPDIR: root,
      SMOKE_TEST_JOURNAL: journal,
      STACKCHAN_DEVICE: 'default',
      STACKCHAN_DRY_RUN: '',
      STACKCHAN_PORT: '',
      UPLOAD_PORT: '',
      ESPPORT: '',
      DEBUGGER_SPEED: '460800',
      STACKCHAN_DEVICE_SMOKE_TIMEOUT_MS: '2000',
      STACKCHAN_DEVICE_SMOKE_RETRIES: '1',
      ...environment,
    }
    const result = spawnSync(process.execPath, ['scripts/run-device-smoke.js', '--port', '/dev/test robot', ...args], {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: 10000,
      killSignal: 'SIGKILL',
    })
    calls = existsSync(journal) ? readFileSync(journal, 'utf8').trim().split('\n').map(JSON.parse) : []
    const liveChildren = calls.filter((call) => {
      if (call.kind !== 'bridge') return false
      try {
        process.kill(call.pid, 0)
        return true
      } catch {
        return false
      }
    })
    return { ...result, calls, liveChildren }
  } finally {
    for (const call of calls.filter((call) => call.kind === 'bridge')) {
      try {
        process.kill(call.pid, 'SIGKILL')
      } catch {}
    }
    rmSync(root, { recursive: true, force: true })
  }
}

test('device smoke deploys once through the normal MOD command before attaching its debugger', () => {
  const result = runSmoke(['--flash', '--device', 'stackchan_rt'], { STACKCHAN_PORT: '/dev/ignored' })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(
    result.calls.map((call) => call.kind),
    ['firmware', 'firmware', 'bridge', 'bridge-closed'],
  )
  const [host, mod, bridge] = result.calls
  assert.deepEqual(host.args, ['deploy', 'stackchan_rt', '--mode=debug', '--port', '/dev/test robot'])
  assert.equal(mod.args[0], 'mod')
  assert.equal(mod.args[1], 'stackchan_rt')
  assert.match(mod.args[2], /mods\/examples\/board_diagnostics\/manifest.json$/)
  assert.deepEqual(mod.args.slice(3), ['--mode=debug', '--port', '/dev/test robot'])
  assert.deepEqual(bridge.args, ['/dev/test robot', '460800', '8N1'])
  assert.match(result.stdout, /PASS/)
})

test('preflight or host deployment failure prevents the debugger and every later step', () => {
  for (const command of ['deploy', 'mod']) {
    const result = runSmoke(command === 'deploy' ? ['--flash'] : [], { SMOKE_TEST_REJECT: command })
    assert.equal(result.status, 1)
    assert.equal(result.calls.length, 1)
    assert.equal(result.calls[0].args[0], command)
    assert.doesNotMatch(result.stdout, /PASS/)
  }
})

test('channel retry attaches again without rebuilding or reinstalling the MOD', () => {
  const result = runSmoke([], { SMOKE_TEST_BRIDGE: 'flaky' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.calls.filter((call) => call.kind === 'firmware').length, 1)
  assert.equal(result.calls.filter((call) => call.kind === 'bridge').length, 2)
})

test('device failure takes priority over completion and does not trigger a channel retry', () => {
  const result = runSmoke([], { SMOKE_TEST_BRIDGE: 'failure' })
  assert.equal(result.status, 1)
  assert.equal(result.calls.filter((call) => call.kind === 'bridge').length, 1)
  assert.match(result.stderr, /FAIL \(failure\)/)
})

test('timeout terminates even an unresponsive bridge before the command returns', () => {
  const result = runSmoke([], { SMOKE_TEST_BRIDGE: 'stubborn', STACKCHAN_DEVICE_SMOKE_RETRIES: '0' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /FAIL \(timeout\)/)
  const bridge = result.calls.find((call) => call.kind === 'bridge')
  assert.ok(bridge)
  assert.deepEqual(result.liveChildren, [])
})

test('invalid channel or timing fails before an optional firmware deployment', () => {
  for (const [args, env] of [
    [['--channel', 'invalid'], {}],
    [[], { STACKCHAN_DEVICE_SMOKE_TIMEOUT_MS: 'abc' }],
    [[], { STACKCHAN_DEVICE_SMOKE_RETRIES: '-1' }],
  ]) {
    const result = runSmoke(['--flash', ...args], env)
    assert.equal(result.status, 1)
    assert.deepEqual(result.calls, [])
  }
})

test('dry run never attaches the debugger or reports a device pass', () => {
  const result = runSmoke([], { STACKCHAN_DRY_RUN: '1' })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(
    result.calls.map((call) => call.kind),
    ['firmware'],
  )
  assert.doesNotMatch(result.stdout, /PASS/)
})
