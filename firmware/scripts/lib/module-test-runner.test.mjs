import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildOutputDirectory } from './build-output.mjs'

const firmwareRoot = fileURLToPath(new URL('../..', import.meta.url))
const pass = '@@STACKCHAN_TEST:PASS@@'
const fail = '@@STACKCHAN_TEST:FAIL@@'

function runnerFixture(simulatorSource, buildSource = '') {
  const root = mkdtempSync(join(firmwareRoot, '.module-runner-fixture-'))
  const sdk = join(root, 'sdk')
  const bin = join(root, 'bin')
  const manifests = ['invalid', 'valid'].map((name) =>
    join(root, `${root.split('/').pop()}-${name}`, 'manifest.test.json'),
  )
  mkdirSync(join(sdk, 'tools/xsbug-log'), { recursive: true })
  mkdirSync(join(sdk, 'build/bin/lin/release'), { recursive: true })
  mkdirSync(bin)
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'commonjs' }))
  for (const path of manifests) {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, JSON.stringify({ modules: { main: './main' } }))
  }
  writeFileSync(
    join(sdk, 'tools/xsbug-log/xsbug-log.js'),
    `
const net = require('node:net');
net.createServer(socket => socket.on('data', bytes => process.stdout.write(bytes))).listen(+process.env.XSBUG_LOG_PORT, '127.0.0.1', () => console.log('xsdb listening on port ' + process.env.XSBUG_LOG_PORT + '.'));
`,
  )
  const executable = (path, source) => writeFileSync(path, `#!${process.execPath}\n${source}\n`, { mode: 0o700 })
  executable(
    join(bin, 'dbus-run-session'),
    `
if (process.argv.includes('--version')) process.exit(0);
const {spawn} = require('node:child_process');
const child = spawn(process.argv[3], process.argv.slice(4), {stdio:'inherit'});
child.on('exit', (code, signal) => process.exit(code ?? 1));
`,
  )
  executable(
    join(bin, 'xvfb-run'),
    `
const {spawn} = require('node:child_process');
const child = spawn(process.argv[4], process.argv.slice(5), {stdio:'inherit'});
child.on('exit', code => process.exit(code ?? 1));
`,
  )
  executable(
    join(bin, 'mcconfig'),
    `
const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2);
const manifest = args.at(-1), name = path.basename(path.dirname(manifest));
const output = args[args.indexOf('-o')+1];
const tmp = path.join(output, 'tmp/lin/mc/debug', name), bin = path.join(output, 'bin/lin/mc/debug', name);
${buildSource}
fs.mkdirSync(tmp, {recursive:true}); fs.mkdirSync(bin, {recursive:true});
fs.writeFileSync(path.join(tmp, 'makefile'), 'BIN_DIR = ' + bin + '\\n');
fs.writeFileSync(path.join(bin, 'mc.so'), 'fixture');
`,
  )
  executable(
    join(sdk, 'build/bin/lin/release/mcsim'),
    `
const fs = require('node:fs'), net = require('node:net');
fs.writeFileSync(process.env.STACKCHAN_FIXTURE_PID, String(process.pid));
const socket = net.connect(+process.env.XSBUG_PORT, process.env.XSBUG_HOST, () => { ${simulatorSource} });
`,
  )
  return {
    root,
    sdk,
    manifests,
    run(extra = {}, paths = manifests.slice(0, 1)) {
      return spawnSync(process.execPath, ['scripts/run-module-tests.js', ...paths], {
        cwd: firmwareRoot,
        env: {
          ...process.env,
          MODDABLE: sdk,
          PATH: `${bin}${delimiter}${process.env.PATH}`,
          STACKCHAN_MODULE_TEST_JOBS: '1',
          STACKCHAN_MODULE_TEST_TIMEOUT_MS: '1500',
          STACKCHAN_MODULE_TEST_BUILD_TIMEOUT_MS: '1000',
          STACKCHAN_MODULE_TEST_LOG_DIR: join(root, 'logs'),
          STACKCHAN_FIXTURE_PID: join(root, 'pid'),
          ...extra,
        },
        encoding: 'utf8',
        timeout: 9000,
      })
    },
    close() {
      if (existsSync(join(root, 'pid'))) {
        try {
          process.kill(Number(readFileSync(join(root, 'pid'), 'utf8')), 'SIGKILL')
        } catch {}
      }
      for (const manifest of manifests) {
        const name = manifest.split('/').at(-2)
        for (const kind of ['tmp', 'bin'])
          rmSync(join(buildOutputDirectory, kind, 'lin/mc/debug', name), { recursive: true, force: true })
      }
      rmSync(root, { recursive: true, force: true })
    },
  }
}

const linuxOnly = { skip: process.platform !== 'linux' }

test('normal runner waits for asynchronous completion and rejects diagnostics, FAIL and early exit', linuxOnly, () => {
  for (const [source, status, reason] of [
    [
      `socket.write('a diagnostic mentions ${pass}\\n');setTimeout(() => socket.write('${pass}\\n'), 250);`,
      0,
      /All Moddable test manifests passed/,
    ],
    [`socket.write('${pass}\\n${fail}\\n');`, 1, /test-failed/],
    [
      `process.on('SIGTERM', () => { socket.write('${fail}\\n');setTimeout(() => process.exit(0), 50); });socket.write('${pass}\\n');`,
      1,
      /test-failed/,
    ],
    [`socket.write(JSON.stringify({text:'${pass}'})+'\\n');`, 1, /timeout/],
    [`socket.write('${pass}\\n');process.exit(7);`, 1, /exit/],
    [
      `socket.write('pending asynchronous assertion\\n');setTimeout(() => socket.write('${pass}\\n'), 6000);`,
      1,
      /timeout/,
    ],
  ]) {
    const f = runnerFixture(source)
    try {
      const result = f.run()
      assert.equal(result.status, status, result.stdout + result.stderr)
      assert.match(result.stdout + result.stderr, reason)
    } finally {
      f.close()
    }
  }
})

test('runtime timeout reaps a TERM-resistant simulator before returning', linuxOnly, () => {
  const f = runnerFixture("process.on('SIGTERM', () => {});setInterval(() => {}, 1000);")
  try {
    const result = f.run()
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stderr, /timeout/)
    const pid = Number(readFileSync(join(f.root, 'pid'), 'utf8'))
    assert.throws(() => process.kill(pid, 0), /ESRCH/)
  } finally {
    f.close()
  }
})

test('failed warmup and worker builds discard emitted artifacts before retry', linuxOnly, () => {
  const f = runnerFixture(
    `socket.write('${pass}\\n');`,
    `
if (name.endsWith('-invalid')) {
  if (fs.existsSync(path.join(tmp, 'emitted.js'))) process.exit(0);
  fs.mkdirSync(tmp, {recursive:true}); fs.mkdirSync(bin, {recursive:true});
  fs.writeFileSync(path.join(tmp, 'emitted.js'), 'stale JS');
  fs.writeFileSync(path.join(bin, 'mc.so'), 'stale binary');
  console.error('TypeScript compile failure');process.exit(2);
}
`,
  )
  try {
    const result = f.run({ STACKCHAN_MODULE_TEST_JOBS: '2' }, f.manifests)
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stdout, /warm-up build.*failed/)
    assert.match(result.stdout, /invalid.*failed/)
    assert.match(result.stdout, /valid.*ok/)
    const name = f.manifests[0].split('/').at(-2)
    for (const kind of ['tmp', 'bin'])
      assert.equal(existsSync(join(buildOutputDirectory, kind, 'lin/mc/debug', name)), false)
  } finally {
    f.close()
  }
})

test('build timeout terminates a TERM-resistant compiler and removes its output', linuxOnly, () => {
  const f = runnerFixture(
    '',
    `
fs.mkdirSync(tmp, {recursive:true});fs.writeFileSync(path.join(tmp, 'emitted.js'), 'stale JS');
fs.writeFileSync(process.env.STACKCHAN_FIXTURE_PID, String(process.pid));
process.on('SIGTERM', () => {});setInterval(() => {}, 1000);
return;
`,
  )
  try {
    const result = f.run()
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stderr, /mcconfig.*timed out/)
    const pid = Number(readFileSync(join(f.root, 'pid'), 'utf8'))
    assert.throws(() => process.kill(pid, 0), /ESRCH/)
    const name = f.manifests[0].split('/').at(-2)
    assert.equal(existsSync(join(buildOutputDirectory, 'tmp/lin/mc/debug', name)), false)
  } finally {
    f.close()
  }
})
