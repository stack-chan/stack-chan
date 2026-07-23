import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

const pages = [
  'index.html',
  'flash/index.html',
  'preference/index.html',
  'mod-gallery/index.html',
  'simulator/index.html',
  'editor/index.html',
  'editor/tutorial.html',
  'face-editor/index.html',
]

await access(new URL('./assets/stackchan-icon.png', import.meta.url))
await access(new URL('./assets/stackchan-symbol.png', import.meta.url))
await access(new URL('./assets/stackchan-favicon-32.png', import.meta.url))
await access(new URL('./assets/stackchan-apple-touch-icon.png', import.meta.url))

test('all Vite entry pages reference the shared browser icons', async () => {
  for (const page of pages) {
    const pageUrl = new URL(`./${page}`, import.meta.url)
    const html = await readFile(pageUrl, 'utf8')
    const favicon = html.match(/rel="icon" href="([^"]+)"/)?.[1]
    const appleIcon = html.match(/rel="apple-touch-icon" href="([^"]+)"/)?.[1]

    assert.ok(favicon, `${page} should reference a favicon`)
    assert.ok(appleIcon, `${page} should reference an apple-touch-icon`)
    assert.equal(
      new URL(favicon, pageUrl).pathname,
      new URL('./assets/stackchan-favicon-32.png', import.meta.url).pathname
    )
    assert.equal(
      new URL(appleIcon, pageUrl).pathname,
      new URL('./assets/stackchan-apple-touch-icon.png', import.meta.url).pathname
    )
  }
})

test('the React home page displays the Stack-chan icon through Vite assets', async () => {
  const homeEntry = await readFile(new URL('./src/entries/home.tsx', import.meta.url), 'utf8')
  assert.match(homeEntry, /new URL\(['"]\.\.\/\.\.\/assets\/stackchan-icon\.png['"], import\.meta\.url\)/)
})
