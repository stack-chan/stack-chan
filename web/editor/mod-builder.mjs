/**
 * Client-side MOD build pipeline.
 *
 * Drives the Moddable tools compiled to WebAssembly (vendor/tools.js + tools.wasm)
 * to run `mcrun` fully in the browser (or Node for tests):
 *
 *   1. mcrun -d -p wasm ... writes a `make.json` build plan into the virtual FS
 *   2. each make.json step (xsc / xsa / cp ...) runs through the same wasm binary
 *   3. the resulting `mc.xsa` archive bytes are read back from the virtual FS
 *
 * The archive contains xsb bytecode modules and can be installed into the wasm
 * simulator or transferred to a device over WebSerial.
 */

// Fallback when the version cannot be detected from the tools binary output.
// The TOOL base class verifies $(MODDABLE)/tools/VERSION against the version
// baked into the binary, so this must match vendor/tools.wasm.
export const DEFAULT_TOOLS_VERSION = '8.3.0'

export const DEFAULT_MOD_MANIFEST = {
  modules: {
    '*': ['./mod'],
  },
}

/**
 * Parse the version mismatch warning that the Moddable TOOL base class traces
 * when $(MODDABLE)/tools/VERSION differs from the version baked into the
 * binary. Returns the binary's version string, or null when no mismatch was
 * reported.
 */
export function detectToolsVersionMismatch(logLines) {
  for (const line of logLines) {
    const match = /tools mismatch between binary \(([^)]+)\) and source/.exec(line)
    if (match) return match[1]
  }
  return null
}

/**
 * Locate the first file with the given suffix in a list of paths.
 */
export function findFileWithSuffix(paths, suffix) {
  return paths.find((path) => path.endsWith(suffix))
}

function listFilesRecursively(FS, directory, results = []) {
  for (const name of FS.readdir(directory)) {
    if (name === '.' || name === '..') continue
    const path = `${directory}/${name}`
    if (FS.isDir(FS.stat(path).mode)) listFilesRecursively(FS, path, results)
    else results.push(path)
  }
  return results
}

async function instantiateTools(createTools, { toolsVersion, log }) {
  const tools = await createTools({
    print: (text) => log(text),
    printErr: (text) => log(text),
    preRun: [(module) => (module.ENV.MODDABLE = '/moddable')],
  })
  const { FS } = tools
  FS.mkdirTree('/moddable/tools')
  FS.writeFile('/moddable/tools/VERSION', toolsVersion)
  FS.mkdirTree('/mod')
  FS.mkdirTree('/build')
  return tools
}

function runTool(tools, argv, log) {
  log(`> ${argv.join(' ')}`)
  // when a tool exits non-zero, emscripten's node shim records the status in
  // process.exitCode; restore it so a failed build step cannot change the exit
  // code of a host process (e.g. the test runner)
  const nodeProcess = globalThis.process
  const previousExitCode = nodeProcess?.exitCode
  try {
    return tools.callMain(argv)
  } catch (error) {
    log(`!! ${error.message ?? error}`)
    return -1
  } finally {
    if (nodeProcess && nodeProcess.exitCode !== previousExitCode) nodeProcess.exitCode = previousExitCode
  }
}

/**
 * Build a MOD archive (mc.xsa) from JavaScript source, fully client-side.
 *
 * @param createTools factory exported by vendor/tools.js
 * @param options.modJs   MOD JavaScript source (contents of mod.js)
 * @param options.manifest MOD manifest object (default: modules: * -> ./mod)
 * @param options.name    project directory name; becomes part of the signature
 * @param options.onLog   receives each build log line
 * @returns Uint8Array of the mc.xsa archive
 */
export async function buildModArchive(
  createTools,
  { modJs, manifest = DEFAULT_MOD_MANIFEST, name = 'mod', onLog } = {}
) {
  const logs = []
  const log = (text) => {
    logs.push(String(text))
    onLog?.(String(text))
  }

  let toolsVersion = DEFAULT_TOOLS_VERSION
  for (let attempt = 0; attempt < 2; attempt++) {
    const tools = await instantiateTools(createTools, { toolsVersion, log })
    const { FS } = tools

    const projectDirectory = `/mod/${name}`
    FS.mkdirTree(projectDirectory)
    FS.writeFile(`${projectDirectory}/manifest.json`, JSON.stringify(manifest, null, 2))
    FS.writeFile(`${projectDirectory}/mod.js`, modJs)
    FS.chdir(projectDirectory)

    const exitCode = runTool(
      tools,
      ['mcrun', '-d', '-p', 'wasm', '-o', '/build', `${projectDirectory}/manifest.json`],
      log
    )
    if (exitCode !== 0) throw new Error(`mcrun failed:\n${logs.join('\n')}`)

    const planPath = findFileWithSuffix(listFilesRecursively(FS, '/build'), 'make.json')
    if (!planPath) {
      const mismatch = detectToolsVersionMismatch(logs)
      if (mismatch && mismatch !== toolsVersion) {
        // the binary disagrees with our VERSION file: retry with its version
        toolsVersion = mismatch
        continue
      }
      throw new Error(`mcrun did not produce a build plan:\n${logs.join('\n')}`)
    }

    const steps = JSON.parse(new TextDecoder().decode(FS.readFile(planPath)))
    for (const step of steps) {
      const stepCode = runTool(tools, step, log)
      if (stepCode !== 0) throw new Error(`build step failed (${step[0]}):\n${logs.join('\n')}`)
    }

    const archivePath = findFileWithSuffix(listFilesRecursively(FS, '/build/bin'), '.xsa')
    if (!archivePath) throw new Error(`no archive produced:\n${logs.join('\n')}`)
    log(`archive: ${archivePath}`)
    return FS.readFile(archivePath)
  }
  throw new Error(`tools version mismatch could not be resolved:\n${logs.join('\n')}`)
}

/**
 * Quick sanity check that bytes look like an XS archive (XS_A atom).
 */
export function isXsArchive(bytes) {
  if (!bytes || bytes.length < 8) return false
  return bytes[4] === 0x58 && bytes[5] === 0x53 && bytes[6] === 0x5f && bytes[7] === 0x41 // "XS_A"
}

/**
 * Read the XS engine version an archive was built for ([major, minor, patch]).
 */
export function xsArchiveVersion(bytes) {
  if (!isXsArchive(bytes) || bytes.length < 19) return null
  // layout: size(4) "XS_A" size(4) "VERS" major minor patch flag
  // confirm the "VERS" atom before reading the version bytes
  if (bytes[12] !== 0x56 || bytes[13] !== 0x45 || bytes[14] !== 0x52 || bytes[15] !== 0x53) return null
  return [bytes[16], bytes[17], bytes[18]]
}
