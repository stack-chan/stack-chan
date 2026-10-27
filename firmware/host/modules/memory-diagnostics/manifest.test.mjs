import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const firmware = fileURLToPath(new URL('../../../', import.meta.url))

// Project-local manifest boundary check, not an SDK manifest compiler.
// SDK-variable includes are outside this check; actual target builds remain required.
function graph(entry, platform, found = new Map()) {
  const filename = path.resolve(firmware, entry)
  if (found.has(filename)) return found
  const manifest = JSON.parse(readFileSync(filename, 'utf8'))
  found.set(filename, manifest)
  for (const layer of [manifest, manifest.platforms?.[platform] ?? manifest.platforms?.esp32]) {
    for (const include of layer?.include ?? []) {
      if (typeof include === 'string' && !include.includes('$(')) {
        graph(path.resolve(path.dirname(filename), include), platform, found)
      }
    }
  }
  return found
}

test('heap diagnostic overlays leave standard host graphs and allocation configuration untouched', () => {
  for (const [platform, standard, diagnostic] of [
    ['esp32/m5stack_cores3', 'manifest_local.json', 'manifest_memory_diagnostics.json'],
    ['esp32/m5stackchan_cores3', 'manifest_m5stackchan_cores3.json', 'manifest_m5stackchan_memory_diagnostics.json'],
  ]) {
    const before = graph(`host/app/${standard}`, platform),
      after = graph(`host/app/${diagnostic}`, platform)
    assert.ok([...before.keys()].every((file) => after.has(file)))
    assert.ok([...before.keys()].every((file) => !file.includes('/memory-diagnostics/')))
    const extra = [...after.entries()].filter(([file]) => !before.has(file))
    assert.ok(extra.some(([file]) => file.includes('/memory-diagnostics/')))
    for (const [, manifest] of extra) {
      for (const layer of [manifest, ...Object.values(manifest.platforms ?? {})]) {
        assert.equal(layer.esp32Config, undefined)
        assert.equal(layer.preload, undefined)
        assert.equal(layer.creation, undefined)
      }
    }
  }
})

test('ordinary and measured Live MODs share one configuration and keep distinct source mappings', () => {
  const standard = graph('mods/examples/openai_live_webrtc/manifest.json'),
    diagnostic = graph('mods/examples/openai_live_webrtc/manifest.memory-diagnostics.json')
  const configs = (entries) => [...entries.values()].filter((m) => m.config).map((m) => m.config)
  assert.deepEqual(configs(diagnostic), configs(standard))
  const sources = new Set()
  for (const [filename, manifest] of diagnostic) {
    for (const value of Object.values(manifest.modules ?? {})) {
      for (const source of Array.isArray(value) ? value : [value]) {
        const resolved = path.resolve(path.dirname(filename), `${source}.js`)
        assert.ok(existsSync(resolved), resolved)
        // SDK module rules deduplicate by source. An alias must not silently
        // disappear because the same source was already mapped to another name.
        assert.ok(!sources.has(resolved), `duplicate module source: ${resolved}`)
        sources.add(resolved)
      }
    }
  }
})
