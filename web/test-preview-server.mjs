import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

export function resolveChromium() {
  const executablePath = [
    process.env.CHROMIUM_PATH,
    '/snap/bin/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].find((candidate) => candidate && existsSync(candidate))
  if (!executablePath) throw new Error('Chromium executable not found; set CHROMIUM_PATH')
  return executablePath
}

export async function startPreview({ port, url }) {
  const baseUrl = url ?? `http://127.0.0.1:${port}`
  const server = url
    ? undefined
    : spawn(
        resolve('node_modules/.bin/vite'),
        ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
        { cwd: process.cwd(), stdio: 'inherit' }
      )
  let startupFinished = false
  const startupFailure = server
    ? new Promise((_, reject) => {
        server.once('error', (error) => {
          if (!startupFinished) reject(new Error(`Vite preview could not start: ${error.message}`, { cause: error }))
        })
        server.once('exit', (code, signal) => {
          if (!startupFinished) {
            reject(
              new Error(
                `Vite preview exited before readiness with exit code ${String(code)}${
                  signal ? ` (signal ${signal})` : ''
                }`
              )
            )
          }
        })
      })
    : new Promise(() => {})

  try {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const ready = await Promise.race([
        fetch(baseUrl)
          .then((response) => response.ok)
          .catch(() => false),
        startupFailure,
      ])
      if (ready) {
        startupFinished = true
        return { baseUrl, server }
      }
      await Promise.race([new Promise((resolveDelay) => setTimeout(resolveDelay, 100)), startupFailure])
    }
    throw new Error(`Vite preview did not start at ${baseUrl}`)
  } catch (error) {
    startupFinished = true
    server?.kill('SIGTERM')
    throw error
  }
}
