// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const root = fileURLToPath(new URL('../../', import.meta.url))
const sdk = process.env.MODDABLE
if (!sdk) throw new Error('Set MODDABLE to the installed Moddable SDK.')
const runtime = path.join(root, 'web/avatar-dsl/runtime')
const native = path.join(root, 'firmware/host/modules/ui/components/face/avatar-native')
const freetype = path.join(sdk, 'modules/commodetto/freetype')
const smooth = path.join(freetype, 'src/smooth')
if (!existsSync(path.join(smooth, 'ftgrays.c'))) throw new Error('The current SDK FreeType sources are required.')
const sources = [
  path.join(runtime, 'bridge.c'),
  path.join(native, 'avds-engine.c'),
  path.join(native, 'avds-render.c'),
  path.join(smooth, 'ftgrays.c'),
]
const includes = [runtime, native, smooth, path.join(freetype, 'include'), path.join(freetype, 'include/freetype')].map(
  (p) => `-I${p}`
)
const exports = [
  'web_bytes',
  'web_context',
  'web_commands',
  'web_plan',
  'web_pixels',
  'web_count',
  'web_primitives',
  'web_steps',
  'web_error',
  'web_run',
]
const args = [
  '-std=c11',
  '-O2',
  '-DSTANDALONE_',
  '-DFALL_THROUGH=',
  '-ffp-contract=off',
  '-fno-builtin-sin',
  '-fno-builtin-cos',
  '-fno-builtin-tan',
  ...includes,
  ...sources,
  '-lm',
  '--no-entry',
  '-sSTANDALONE_WASM=1',
  '-sSUPPORT_LONGJMP=wasm',
  '-sALLOW_MEMORY_GROWTH=0',
  '-sINITIAL_MEMORY=16777216',
  '-sSTACK_SIZE=1048576',
  '-sMALLOC=emmalloc',
  `-sEXPORTED_FUNCTIONS=${JSON.stringify(exports.map((n) => `_${n}`))}`,
  '-o',
  path.join(runtime, 'avds.wasm'),
]
const result = spawnSync(process.env.EMCC ?? 'emcc', args, { stdio: 'inherit' })
if (result.error) throw result.error
if (result.status) process.exit(result.status)
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
const sdkRevision = spawnSync('git', ['-C', sdk, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout?.trim()
const compilerVersion = spawnSync(process.env.EMCC ?? 'emcc', ['--version'], { encoding: 'utf8' }).stdout?.split(
  '\n'
)[0]
writeFileSync(
  path.join(runtime, 'avds-build.json'),
  JSON.stringify(
    {
      sdkRevision,
      compilerVersion,
      memoryBytes: 16777216,
      stackBytes: 1048576,
      wasmSha256: hash(path.join(runtime, 'avds.wasm')),
      sources: Object.fromEntries(
        [...sources, path.join(native, 'avds-outline.h')].map((file) => [
          file.startsWith(root)
            ? path.relative(root, file).replaceAll('\\', '/')
            : 'MODDABLE/modules/commodetto/freetype/src/smooth/ftgrays.c',
          hash(file),
        ])
      ),
    },
    null,
    2
  ) + '\n'
)
console.log('Built shared AVDS C VM, clip planner, outline geometry and SDK FreeType raster (16 MiB fixed memory).')
