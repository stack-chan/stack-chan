#!/usr/bin/env node
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'

const root = resolve(new URL('..', import.meta.url).pathname)
const repoRoot = resolve(root, '..')
const firmwareRoot = join(repoRoot, 'firmware')
const moddableRoot = process.env.MODDABLE || join(process.env.HOME, '.local/share/moddable')
const port = Number(process.env.PORT || 8081)
const allowedMods = new Set(['look_around', 'm5stackchan_smoke'])
const allowedTargets = new Set(['esp32/m5stack', 'esp32/m5stack_core2', 'esp32/m5stack_cores3', 'esp32/m5stackchan_cores3'])

function contentType(path) {
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.wasm': 'application/wasm',
    '.xsa': 'application/octet-stream',
    '.stl': 'model/stl',
  }[extname(path)] ?? 'application/octet-stream'
}

function run(command, args, options = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    child.on('close', (code) => resolveRun({ code, output }))
  })
}

async function buildMod({ mod, target }) {
  if (!allowedMods.has(mod)) throw new Error(`unsupported mod: ${mod}`)
  if (!allowedTargets.has(target)) throw new Error(`unsupported target: ${target}`)
  const manifest = join(firmwareRoot, 'mods', mod, 'manifest.json')
  const xsa = join(moddableRoot, 'build/bin/esp32/debug', mod, `${mod}.xsa`)
  const beforeMtime = existsSync(xsa) ? statSync(xsa).mtimeMs : 0
  const env = { ...process.env, MODDABLE: moddableRoot, PATH: `${process.env.HOME}/.local/bin:${moddableRoot}/build/bin/lin/release:${process.env.PATH}` }
  const result = await run('mcrun', ['-d', '-m', '-p', target, manifest], { cwd: firmwareRoot, env })
  const built = existsSync(xsa) && statSync(xsa).mtimeMs >= beforeMtime
  if (!built) throw new Error(`mcrun did not produce ${xsa}\n${result.output}`)
  const bytes = await readFile(xsa)
  return {
    name: basename(xsa),
    mod,
    target,
    size: bytes.byteLength,
    crc32: crc32(bytes),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    artifactBase64: bytes.toString('base64'),
    logs: result.output.slice(-4000),
  }
}

function crc32(bytes) {
  let value = 0xffffffff
  for (const byte of bytes) {
    value ^= byte
    for (let i = 0; i < 8; i += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  return ((value ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0')
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`)
    if (url.pathname === '/api/mod-build') {
      const result = await buildMod({ mod: url.searchParams.get('mod') || 'look_around', target: url.searchParams.get('target') || 'esp32/m5stack' })
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' })
      response.end(JSON.stringify(result))
      return
    }

    const pathname = url.pathname === '/' ? '/simulator/' : url.pathname
    const candidate = resolve(root, `.${pathname}`)
    if (!candidate.startsWith(root)) throw new Error('path traversal rejected')
    const filePath = existsSync(candidate) && statSync(candidate).isDirectory() ? join(candidate, 'index.html') : candidate
    if (!existsSync(filePath)) {
      response.writeHead(404)
      response.end('not found')
      return
    }
    response.writeHead(200, { 'content-type': contentType(filePath) })
    createReadStream(filePath).pipe(response)
  } catch (error) {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    response.end(String(error?.message ?? error))
  }
})

server.listen(port, '0.0.0.0', () => {
  console.log(`Stack-chan web MOD build server: http://127.0.0.1:${port}/simulator/`)
})
