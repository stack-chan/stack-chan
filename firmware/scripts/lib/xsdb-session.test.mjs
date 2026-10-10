import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { jsonEvents, successfulTestSummary } from './xsdb-session.mjs'

test('xsdb JSON events tolerate prompts, pretty printing, escaped strings and split chunks', () => {
  const expected = [
    { event: 'log', data: { text: 'a "quote", \\ and {braces}' } },
    { event: 'test_summary', data: { total: 4, failed: 0, passed: 3, skipped: 1 } },
  ]
  for (const chunkSize of [1, 2, 17, 256]) {
    const actual = []
    const parse = jsonEvents((event) => actual.push(event))
    const output = `xsdb listening on port 123.\n(xsdb) ${expected.map((event) => JSON.stringify(event, null, 2)).join('\n(xsdb) ')}`
    for (let offset = 0; offset < output.length; offset += chunkSize) parse(output.slice(offset, offset + chunkSize))
    assert.deepEqual(actual, expected)
  }
})

test('a suite requires observed passes, consistent counts and no failure or stopped reason', () => {
  const complete = { total: 4, failed: 0, passed: 3, skipped: 1 }
  assert.equal(successfulTestSummary(complete), true)
  for (const data of [
    undefined,
    {},
    { ...complete, failed: 1 },
    { ...complete, reason: 'stopped' },
    { ...complete, reason: 'test app did not restart within 30 seconds' },
    { total: 4, failed: 0, passed: 0, skipped: 4 },
    { ...complete, total: 5 },
  ]) {
    assert.equal(Boolean(successfulTestSummary(data)), false)
  }
})

test('serial smoke requires observed completion and terminates on a quiet virtual tty', {
  skip: process.platform !== 'linux' ? 'Linux PTY required; physical hardware is not tested' : false,
}, () => {
  const probe = spawnSync(
    'python3',
    [
      '-c',
      `
import os, pty, subprocess, json, sys
results = []
for name, payload, expected in [('quiet', b'', 1), ('complete', b'M5StackChan CoreS3 smoke] complete\\n', 0), ('crash', b'Guru Meditation\\n', 1)]:
    master, slave = pty.openpty()
    env = {**os.environ, 'UPLOAD_PORT': os.ttyname(slave), 'STACKCHAN_DEVICE_SMOKE_TIMEOUT_MS': '300'}
    child = subprocess.Popen(['node', 'scripts/run-device-smoke.js', '--channel', 'serial'], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        first = child.stdout.readline()
        if payload: os.write(master, payload)
        output = first + child.communicate(timeout=2)[0]
        results.append({'case': name, 'exit': child.returncode, 'expected': expected, 'output': output})
    finally:
        if child.poll() is None: child.kill(); child.communicate()
        os.close(master); os.close(slave)
env = {**os.environ}; env.pop('UPLOAD_PORT', None)
child = subprocess.run(['node', 'scripts/run-device-smoke.js', '--channel', 'serial'], env=env, capture_output=True, text=True, timeout=2)
results.append({'case': 'no-device', 'exit': child.returncode, 'expected': 1, 'output': child.stdout + child.stderr})
print(json.dumps(results))
`,
    ],
    { cwd: fileURLToPath(new URL('../..', import.meta.url)), encoding: 'utf8', timeout: 10000 },
  )
  assert.equal(probe.status, 0, probe.stderr)
  const results = JSON.parse(probe.stdout)
  assert.equal(results.length, 4)
  for (const result of results) assert.equal(result.exit, result.expected, `${result.case}: ${result.output}`)
})
