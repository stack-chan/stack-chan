import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const bridgeSources = [
  'host/modules/audio/wasm/audio-bridge.c',
  'host/modules/camera/wasm/camera-bridge.c',
  'host/modules/input/wasm/button-bridge.c',
].map((path) => [path, readFileSync(path, 'utf8')] as const)

test('browser WASM bridge dependencies stay inside the Emscripten module scope', () => {
  for (const [path, source] of bridgeSources) {
    assert.match(source, /stackchanRuntime/, `${path} must read the injected runtime`)
    assert.doesNotMatch(
      source,
      /globalThis\.(?:Host|__stackchan)/,
      `${path} must not publish bridge state through browser globals`,
    )
  }

  const preJs = readFileSync('host/platforms/wasm/browser-runtime.pre.js', 'utf8')
  assert.match(preJs, /Module\[['"]stackchanRuntime['"]\]/)
  assert.match(preJs, /const gxView =/)

  const buildScript = readFileSync('scripts/build-wasm.sh', 'utf8')
  assert.match(buildScript, /--pre-js \$RUNTIME_PRE_JS/)
})

test('the React simulator injects and releases its WASM runtime references directly', () => {
  const engine = readFileSync('../web/src/services/simulator/simulator-engine.mjs', 'utf8')

  assert.match(engine, /stackchanRuntime: this\.runtime/)
  assert.match(engine, /this\.runtime\.host = undefined/)
  assert.match(engine, /this\.runtime\.view = undefined/)
  assert.doesNotMatch(engine, /globalThis\.(?:Host|gxView)/)
  assert.doesNotMatch(engine, /postMessage|addEventListener\(['"]message['"]/)
})
