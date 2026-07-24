import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

const page = (path: string) => fileURLToPath(new URL(path, import.meta.url))

const wasmBuildId = () => {
  const artifacts = [page('./simulator/mc.js'), page('./simulator/mc.wasm')]
  if (artifacts.some((artifact) => !existsSync(artifact))) return 'development'
  const hash = createHash('sha256')
  for (const artifact of artifacts) hash.update(readFileSync(artifact))
  return hash.digest('hex').slice(0, 16)
}

const copyRuntimeAssets = () => ({
  name: 'copy-stackchan-runtime-assets',
  closeBundle() {
    const copy = (source: string, target: string) => {
      if (!existsSync(source)) return
      mkdirSync(dirname(target), { recursive: true })
      cpSync(source, target, { recursive: true })
    }
    copy(page('./simulator/assets'), page('./dist/simulator/assets'))
    copy(page('./simulator/samples'), page('./dist/simulator/samples'))
    copy(page('./mod-gallery/catalog.json'), page('./dist/mod-gallery/catalog.json'))
    copy(page('./mod-gallery/samples'), page('./dist/mod-gallery/samples'))
    for (const name of readdirSync(page('./flash'))) {
      if (name.endsWith('.json')) copy(page(`./flash/${name}`), page(`./dist/flash/${name}`))
    }
    copy(page('./flash/tech.moddable.stackchan'), page('./dist/flash/tech.moddable.stackchan'))
    for (const name of ['mc.js', 'mc.wasm']) {
      copy(join(page('./simulator'), name), join(page('./dist/simulator'), name))
    }
  },
})

export default defineConfig({
  base: './',
  define: {
    'import.meta.env.VITE_WASM_BUILD_ID': JSON.stringify(wasmBuildId()),
  },
  plugins: [react(), tailwindcss(), copyRuntimeAssets()],
  resolve: {
    alias: {
      '@/editor': fileURLToPath(new URL('./editor', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        home: page('./index.html'),
        flash: page('./flash/index.html'),
        preference: page('./preference/index.html'),
        gallery: page('./mod-gallery/index.html'),
        mediapipe: page('./mediapipe/index.html'),
        simulator: page('./simulator/index.html'),
        editor: page('./editor/index.html'),
        tutorial: page('./editor/tutorial.html'),
        faceEditor: page('./face-editor/index.html'),
      },
    },
  },
})
