import { access, readFile } from 'node:fs/promises'

const pages = [
  ['index.html', 'assets/stackchan-favicon-32.png', 'assets/stackchan-apple-touch-icon.png'],
  ['flash/index.html', '../assets/stackchan-favicon-32.png', '../assets/stackchan-apple-touch-icon.png'],
  ['preference/index.html', '../assets/stackchan-favicon-32.png', '../assets/stackchan-apple-touch-icon.png'],
]

await access(new URL('./assets/stackchan-icon.png', import.meta.url))
await access(new URL('./assets/stackchan-symbol.png', import.meta.url))
await access(new URL('./assets/stackchan-favicon-32.png', import.meta.url))
await access(new URL('./assets/stackchan-apple-touch-icon.png', import.meta.url))

for (const [page, faviconPath, appleIconPath] of pages) {
  const html = await readFile(new URL(`./${page}`, import.meta.url), 'utf8')
  if (!html.includes(`rel="icon" href="${faviconPath}"`)) {
    throw new Error(`${page} should reference ${faviconPath} as favicon`)
  }
  if (!html.includes(`rel="apple-touch-icon" href="${appleIconPath}"`)) {
    throw new Error(`${page} should reference ${appleIconPath} as apple-touch-icon`)
  }
}

const indexHtml = await readFile(new URL('./index.html', import.meta.url), 'utf8')
if (!indexHtml.includes('src="assets/stackchan-icon.png"')) {
  throw new Error('index.html should show the Stack-chan icon on the development page')
}
