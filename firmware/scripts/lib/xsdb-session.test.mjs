import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, join, relative } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { moduleTestResult, startXsdbSession } from './xsdb-session.mjs'

const firmwareRoot = fileURLToPath(new URL('../..', import.meta.url))
const pass = '@@STACKCHAN_TEST:PASS@@'
const fail = '@@STACKCHAN_TEST:FAIL@@'

test('only complete test marker lines count, and FAIL takes precedence', () => {
  for (const prefix of ['', '[Thread 1] ', '(xsdb) ', '(xsdb) [Thread 23] ']) {
    assert.equal(moduleTestResult(`${prefix}${pass}\n`), 'pass')
    assert.equal(moduleTestResult(`${prefix}${fail}\r\n`), 'fail')
  }
  for (const noise of [
    'ok\n',
    `a diagnostic mentions ${pass}\n`,
    JSON.stringify({ event: 'log', data: { text: pass } }),
    `"${pass}"\n`,
    `${pass} extra\n`,
    '@@STACKCHAN_TEST:PA\n',
  ]) {
    assert.equal(moduleTestResult(noise), undefined)
  }
  assert.equal(moduleTestResult(`${fail}\n${pass}\n`), 'fail')
  assert.equal(moduleTestResult(`${pass}\n${fail}\n`), 'fail')
})

function fixture(source) {
  const root = mkdtempSync(join(firmwareRoot, '.xsdb-session-fixture-'))
  const sdk = join(root, 'sdk')
  mkdirSync(join(sdk, 'tools', 'xsbug-log'), { recursive: true })
  writeFileSync(join(sdk, 'package.json'), JSON.stringify({ type: 'commonjs' }))
  writeFileSync(join(sdk, 'tools', 'xsbug-log', 'xsbug-log.js'), source)
  return {
    root,
    sdk,
    project: relative(firmwareRoot, join(root, 'project')),
    log: join(root, 'runtime.log'),
  }
}

test('text preferences, split readiness/UTF-8/marker, caught diagnostics and cleanup', async () => {
  const f = fixture(`
const fs = require('node:fs');
const path = require('node:path');
const prefs = JSON.parse(fs.readFileSync(path.join(process.env.XSBUG_PROJECT, '.xsdb.json')));
if (prefs.outputFormat !== 'text' || prefs.timestamps !== 'off') process.exit(2);
const bytes = Buffer.from('xsdb listening on port ' + process.env.XSBUG_LOG_PORT + '.\\r\\n# Exception: caught\\n日本語の診断\\n(xsdb) \\x1b[2K\\x1b[0G[Thread 1] ${pass}\\r\\n');
let offset=0;
const timer=setInterval(() => { if(offset < bytes.length) process.stdout.write(bytes.subarray(offset,++offset)); else clearInterval(timer); }, 1);
setInterval(() => {}, 1000);
`)
  let session
  try {
    session = await startXsdbSession(f.log, f.project, f.sdk)
    await session.ready
    for (let i = 0; i < 100 && !moduleTestResult(session.getLog()); i++) await delay(10)
    assert.equal(moduleTestResult(session.getLog()), 'pass')
    assert.match(session.getLog(), /日本語の診断/)
    assert.ok(!session.getLog().includes('\uFFFD'))
    assert.ok(!session.getLog().includes(String.fromCharCode(27)))
    assert.equal(session.getError(), undefined)
  } finally {
    await session?.close()
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('debugger stderr and abnormal exit remain observable', async () => {
  const f = fixture(
    `console.log('xsdb listening on port ' + process.env.XSBUG_LOG_PORT + '.'); setTimeout(() => { console.error('debugger failed'); process.exit(7); }, 40);`,
  )
  let session
  try {
    session = await startXsdbSession(f.log, f.project, f.sdk)
    await session.ready
    await delay(150)
    assert.match(session.getError(), /code=7/)
    assert.equal(moduleTestResult(session.getLog()), undefined)
  } finally {
    await session?.close()
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('startup exit rejects readiness and a TERM-resistant debugger is killed', async () => {
  for (const source of [
    'process.exit(9)',
    `console.log('xsdb listening on port ' + process.env.XSBUG_LOG_PORT + '.'); console.log('pid:' + process.pid); process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);`,
  ]) {
    const f = fixture(source)
    let session
    try {
      session = await startXsdbSession(f.log, f.project, f.sdk)
      if (source === 'process.exit(9)') await assert.rejects(session.ready, /code=9/)
      else {
        await session.ready
        await delay(30)
        const pid = Number(session.getLog().match(/pid:(\d+)/)[1])
        await session.close()
        assert.throws(() => process.kill(pid, 0), /ESRCH/)
      }
    } finally {
      await session?.close()
      rmSync(f.root, { recursive: true, force: true })
    }
  }
})

test('raw serial fails immediately and directs standard smoke traces to xsbug', () => {
  const env = { ...process.env }
  delete env.MODDABLE
  delete env.UPLOAD_PORT
  const result = spawnSync(process.execPath, ['scripts/run-device-smoke.js', '--channel', 'serial'], {
    cwd: firmwareRoot,
    env,
    encoding: 'utf8',
    timeout: 2000,
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /standard smoke MOD uses trace\(\) via xsbug; use --channel xsbug/)
})

test('xsbug smoke uses text logs and fails on fatal output, silence or stderr', {
  skip: process.platform !== 'linux' ? 'Linux fake child fixture required; hardware is not tested' : false,
}, () => {
  const f = fixture(
    `console.log('xsdb listening on port ' + process.env.XSBUG_LOG_PORT + '.');setTimeout(()=>{if(process.env.STACKCHAN_FAKE_SDK_ERROR)console.error('debugger failed');console.log('[Thread 1] '+process.env.STACKCHAN_FAKE_LOG);},50);setInterval(()=>{},1000);`,
  )
  const bin = join(f.root, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'mcrun'), '#!/bin/sh\nexec node -e "setInterval(() => {}, 1000)"\n', { mode: 0o700 })
  try {
    for (const [name, text, expected] of [
      ['complete', 'M5StackChan CoreS3 smoke] complete', 0],
      ['fatal', 'XS abort\nM5StackChan CoreS3 smoke] complete', 1],
      ['quiet', '', 1],
      ['stderr', 'M5StackChan CoreS3 smoke] complete', 1],
    ]) {
      const result = spawnSync(process.execPath, ['scripts/run-device-smoke.js', '--channel', 'xsbug'], {
        cwd: firmwareRoot,
        env: {
          ...process.env,
          MODDABLE: f.sdk,
          PATH: `${bin}${delimiter}${process.env.PATH}`,
          STACKCHAN_DEVICE_SMOKE_TIMEOUT_MS: '500',
          STACKCHAN_DEVICE_SMOKE_RETRIES: '0',
          STACKCHAN_FAKE_LOG: text,
          STACKCHAN_FAKE_SDK_ERROR: name === 'stderr' ? '1' : '',
        },
        encoding: 'utf8',
        timeout: 4000,
      })
      assert.equal(result.status, expected, `${name}: ${result.stdout}${result.stderr}`)
    }
  } finally {
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('smoke startup timeout closes the quiet debugger', () => {
  const f = fixture(
    "require('node:fs').writeFileSync(process.env.STACKCHAN_FIXTURE_PID, String(process.pid));setInterval(()=>{},1000);",
  )
  const pidFile = join(f.root, 'pid')
  let pid
  try {
    const result = spawnSync(process.execPath, ['scripts/run-device-smoke.js'], {
      cwd: firmwareRoot,
      env: {
        ...process.env,
        MODDABLE: f.sdk,
        STACKCHAN_FIXTURE_PID: pidFile,
      },
      encoding: 'utf8',
      timeout: 14000,
    })
    pid = Number(readFileSync(pidFile, 'utf8'))
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stderr, /xsdb startup timeout/)
    assert.throws(() => process.kill(pid, 0), /ESRCH/)
  } finally {
    if (pid) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {}
    }
    rmSync(f.root, { recursive: true, force: true })
  }
})
