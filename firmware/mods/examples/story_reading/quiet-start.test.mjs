import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('./mod.js', import.meta.url), 'utf8')
const config = readFileSync(new URL('./config.ts', import.meta.url), 'utf8')
for (const count of [0, 4]) {
  test(`Public startup with ${count} episodes never plays or changes volume`, async () => {
    const calls = []
    const player = {
      snapshot: { episodes: Array.from({ length: count }, () => ({})), state: 'idle' },
      subscribe() {},
      async start() {
        calls.push('start')
      },
      play() {
        calls.push('play')
      },
    }
    const audio = {
      media: {
        setVolume() {
          calls.push('gain')
        },
      },
    }
    Object.defineProperty(audio, 'volume', { get: () => 0.25, set: () => calls.push('volume') })
    const context = vm.createContext({ trace: () => {} })
    const deps = {
      'media-apps': {
        registerPlayers: () => {
          calls.push('register')
          return player
        },
      },
      'media-volume': { installVolume: () => calls.push('install-volume') },
      'web-radio-config': { STATIONS: [] },
    }
    const module = new vm.SourceTextModule(source, { context })
    await module.link(async (name) => {
      assert.ok(deps[name], `Unexpected dependency ${name}`)
      const exports = deps[name]
      return new vm.SyntheticModule(
        Object.keys(exports),
        function () {
          for (const [k, v] of Object.entries(exports)) this.setExport(k, v)
        },
        { context },
      )
    })
    await module.evaluate()
    await module.namespace.onContextCreated({ audio, ui: {}, motion: {} })
    assert.deepEqual(calls, ['register', 'install-volume', 'start'])
  })
}
test('Configured feed is the public podcast and title glyphs are available', async () => {
  const module = new vm.SourceTextModule(config)
  await module.link(() => {
    throw new Error('Unexpected import')
  })
  await module.evaluate()
  const feeds = module.namespace.feeds
  assert.equal(feeds.length, 1)
  assert.equal(feeds[0].url, 'https://nanikiku-stories.sskw.chatgpt.site/podcast.xml')
  const charset = readFileSync(new URL('./assets/PublicStoryCJK-chars.txt', import.meta.url), 'utf8')
  for (const title of [feeds[0].title, '桃太郎｜11.ai', '飴だま｜11.ai', '去年の木｜11.ai', '木の祭り｜11.ai'])
    for (const c of title) assert.ok(charset.includes(c), `Missing ${c}`)
})
