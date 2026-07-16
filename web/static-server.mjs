import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.wasm', 'application/wasm'],
])

export function contentType(path) {
  return MIME_TYPES.get(extname(path).toLowerCase()) ?? 'application/octet-stream'
}

export function resolveRequestPath(root, requestUrl) {
  let pathname
  try {
    const rawPath = requestUrl.split(/[?#]/, 1)[0]
    if (!rawPath.startsWith('/') || rawPath.startsWith('//')) return null
    pathname = decodeURIComponent(rawPath)
  } catch {
    return null
  }
  if (pathname.includes('\0')) return null
  if (pathname.split(/[\\/]/).includes('..')) return null
  const candidate = resolve(root, `.${pathname}`)
  const fromRoot = relative(root, candidate)
  if (isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) return null
  return candidate
}

function option(name, fallback) {
  const prefix = `--${name}=`
  const value = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length)
  return value || fallback
}

export function createStaticServer({ root = process.cwd() } = {}) {
  const documentRoot = resolve(root)
  return createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end()
      return
    }
    let path = resolveRequestPath(documentRoot, request.url ?? '/')
    if (!path) {
      response.writeHead(403).end('Forbidden')
      return
    }
    try {
      if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html')
      const bytes = await readFile(path)
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Length': bytes.byteLength,
        'Content-Type': contentType(path),
      })
      response.end(request.method === 'HEAD' ? undefined : bytes)
    } catch (error) {
      const status = error?.code === 'ENOENT' || error?.code === 'ENOTDIR' ? 404 : 500
      response.writeHead(status).end(status === 404 ? 'Not Found' : 'Internal Server Error')
    }
  })
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (isMain) {
  const root = option('root', dirname(fileURLToPath(import.meta.url)))
  const host = option('host', '127.0.0.1')
  const port = Number(option('port', '8080'))
  const server = createStaticServer({ root })
  server.listen(port, host, () => console.log(`Stack-chan web server: http://${host}:${port}/`))
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => process.exit(0)))
  }
}
