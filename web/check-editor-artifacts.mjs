import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { FACE_ASSET_EMOTIONS, FACE_ASSET_FORMAT, FACE_ASSET_VERSION } from './editor/face-assets.mjs'

const [
  html,
  simulatorHtml,
  simulatorSource,
  builder,
  installer,
  toolsWasm,
  esptoolBundle,
  esptoolLicense,
  specification,
  faceSchemaText,
  buildWorkflow,
  bundleWorkflow,
  releaseWorkflow,
  simulatorBuildScript,
  editorToolsBuildScript,
  editorToolsXscWrapper,
  setupAction,
  homeHtml,
  tutorialHtml,
  faceEditorHtml,
  flashHtml,
  packageText,
] = await Promise.all([
  readFile(new URL('./editor/index.html', import.meta.url), 'utf8'),
  readFile(new URL('./simulator/index.html', import.meta.url), 'utf8'),
  readFile(new URL('./src/services/simulator/simulator-engine.mjs', import.meta.url), 'utf8'),
  readFile(new URL('./editor/mod-builder.mjs', import.meta.url), 'utf8'),
  readFile(new URL('./editor/esptool-installer.mjs', import.meta.url), 'utf8'),
  readFile(new URL('./editor/vendor/tools.wasm', import.meta.url)),
  readFile(new URL('./editor/vendor/esptool-js-0.5.7.bundle.mjs', import.meta.url)),
  readFile(new URL('./editor/vendor/esptool-js-0.5.7.LICENSE', import.meta.url), 'utf8'),
  readFile(new URL('../docs/specs/visual-programming.md', import.meta.url), 'utf8'),
  readFile(new URL('../docs/specs/face-asset.schema.json', import.meta.url), 'utf8'),
  readFile(new URL('../.github/workflows/build.yml', import.meta.url), 'utf8'),
  readFile(new URL('../.github/workflows/bundle.yml', import.meta.url), 'utf8'),
  readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'),
  readFile(new URL('../firmware/scripts/build-wasm.sh', import.meta.url), 'utf8'),
  readFile(new URL('../firmware/scripts/build-editor-tools.sh', import.meta.url), 'utf8'),
  readFile(new URL('../firmware/scripts/xsc-without-debug-paths.sh', import.meta.url), 'utf8'),
  readFile(new URL('../.github/actions/setup/action.yml', import.meta.url), 'utf8'),
  readFile(new URL('./index.html', import.meta.url), 'utf8'),
  readFile(new URL('./editor/tutorial.html', import.meta.url), 'utf8'),
  readFile(new URL('./face-editor/index.html', import.meta.url), 'utf8'),
  readFile(new URL('./flash/index.html', import.meta.url), 'utf8'),
  readFile(new URL('./package.json', import.meta.url), 'utf8'),
])

assert.deepEqual([...toolsWasm.subarray(0, 4)], [0, 0x61, 0x73, 0x6d], 'tools.wasm must be a WebAssembly module')
for (const absoluteHomePrefix of ['/home/', '/Users/']) {
  assert.equal(
    toolsWasm.includes(Buffer.from(absoluteHomePrefix)),
    false,
    `tools.wasm must not embed a build host path beginning with ${absoluteHomePrefix}`
  )
}
assert.equal(
  createHash('sha384').update(esptoolBundle).digest('hex'),
  'f1474e04de7e5849e77d6c1650e487b1c604b356919fbd25a8b7720dccab333aee1c30dfdbb26789394ddb06ec3c8bde',
  'vendored esptool-js 0.5.7 bundle must match the reviewed npm artifact'
)
assert.match(esptoolLicense, /Apache License/)
assert.match(builder, /DEFAULT_TOOLS_VERSION = '\d+\.\d+\.\d+'/)
const packageJson = JSON.parse(packageText)
for (const dependency of ['@base-ui/react', 'blockly', 'lucide-react', 'react', 'three']) {
  assert.match(
    packageJson.dependencies?.[dependency] ?? '',
    /^\^?\d+\.\d+\.\d+/,
    `${dependency} must be pinned through package.json`
  )
}
for (const [name, page] of [
  ['home', homeHtml],
  ['editor', html],
  ['tutorial', tutorialHtml],
  ['face editor', faceEditorHtml],
  ['flash', flashHtml],
  ['simulator', simulatorHtml],
]) {
  const externalScripts = [...page.matchAll(/<script\b[^>]*\bsrc="https:\/\/[^>]+>/g)]
  assert.equal(externalScripts.length, 0, `${name} page must not depend on runtime CDN scripts`)
  assert.doesNotMatch(page, /unpkg\.com|<style\b|<script>(?!\s*<\/script>)/)
}
assert.match(simulatorSource, /from 'three'/)
assert.match(simulatorSource, /from 'three\/addons\/controls\/OrbitControls\.js'/)
assert.match(simulatorSource, /from 'three\/addons\/geometries\/RoundedBoxGeometry\.js'/)
assert.match(simulatorSource, /from 'three\/addons\/loaders\/STLLoader\.js'/)
assert.doesNotMatch(simulatorSource, /https:\/\/|unpkg\.com/)
assert.doesNotMatch(flashHtml, /esp-web-install-button|esp-web-tools/)
assert.match(specification, /tech\.stackchan\.visual-project/)
const faceSchema = JSON.parse(faceSchemaText)
assert.equal(faceSchema.properties.format.const, FACE_ASSET_FORMAT)
assert.equal(faceSchema.properties.version.const, FACE_ASSET_VERSION)
assert.deepEqual(faceSchema.properties.emotion.enum, FACE_ASSET_EMOTIONS)
assert.deepEqual(faceSchema.required, [
  'format',
  'version',
  'kind',
  'name',
  'emotion',
  'colors',
  'mouth',
  'canvas',
  'shape',
])
assert.equal(faceSchema.properties.kind.const, 'shape')
assert.deepEqual(faceSchema.properties.canvas.required, ['left', 'top', 'width', 'height'])
assert.deepEqual(faceSchema.properties.shape.required, ['eyes', 'mouth'])
assert.deepEqual(faceSchema.properties.shape.properties.eyes.required, ['left', 'right'])

const moddableVersion = '9.0.0'
for (const [name, source] of [
  ['simulator build script', simulatorBuildScript],
  ['editor tools build script', editorToolsBuildScript],
]) {
  assert.ok(
    source.includes(`EXPECTED_MODDABLE_VERSION="${moddableVersion}"`),
    `${name} must require Moddable SDK ${moddableVersion}`
  )
}
const emscriptenVersion = '5.0.1'
for (const [name, source] of [
  ['simulator build script', simulatorBuildScript],
  ['editor tools build script', editorToolsBuildScript],
]) {
  assert.ok(
    source.includes(`EXPECTED_EMSCRIPTEN_VERSION="${emscriptenVersion}"`),
    `${name} must require Emscripten ${emscriptenVersion}`
  )
}
assert.ok(
  setupAction.includes(`version: ${emscriptenVersion}`),
  `setup action must install Emscripten ${emscriptenVersion}`
)
assert.ok(
  editorToolsBuildScript.includes('XSC="$SCRIPT_DIR/xsc-without-debug-paths.sh"'),
  'editor tools build must use the deterministic xsc wrapper'
)
assert.match(editorToolsXscWrapper, /\[\[ "\$arg" != "-d" \]\]/)
for (const [name, source] of [
  ['build workflow', buildWorkflow],
  ['bundle workflow', bundleWorkflow],
  ['release workflow', releaseWorkflow],
]) {
  assert.ok(
    source.includes(`target-branch: "${moddableVersion}"`),
    `${name} must install Moddable SDK ${moddableVersion} for WebAssembly builds`
  )
}
console.log('Visual Programming artifacts and pinned dependencies are consistent')
