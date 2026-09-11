import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Publish source packages from the maintained firmware examples; never transform application code. */
const canonicalPackages = Object.freeze([
  ['stackchan-minigames', 'stackchan_minigames'],
  ['ui-playground', 'mini_app_ui_sample'],
  ['mediapipe-ble', 'mediapipe_ble'],
  ['mcp', 'mcp'],
  ['codex-voice', 'codex_voice'],
])

export function prepareCanonicalSources() {
  for (const [gallery, example] of canonicalPackages) {
    const source = new URL(`../../firmware/mods/examples/${example}/`, import.meta.url)
    const target = new URL(`./samples/${gallery}/source/`, import.meta.url)
    rmSync(target, { recursive: true, force: true })
    mkdirSync(target, { recursive: true })
    cpSync(source, target, {
      recursive: true,
      filter: (path) => !path.includes('__tests__') && !path.endsWith('stackchan-mod.json'),
    })
    const manifest = JSON.parse(readFileSync(new URL('manifest.json', source), 'utf8'))
    manifest.data['stackchan-mod'] = ['../stackchan-mod.json']
    writeFileSync(new URL('manifest.json', target), `${JSON.stringify(manifest, null, 2)}\n`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) prepareCanonicalSources()
