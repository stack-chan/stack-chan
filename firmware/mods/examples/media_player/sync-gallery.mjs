import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const examples = new URL('../', import.meta.url)
const gallery = new URL('../../../../web/mod-gallery/samples/media-player/', import.meta.url)

// Preserve the sibling paths in the firmware manifests. These are public source copies;
// build the MOD from the repository so the host's fonts and typings are available.
export function gallerySources() {
  const files = ['web_radio/config.ts']
  for (const folder of ['media_player', 'podcast']) {
    for (const name of readdirSync(new URL(`${folder}/`, examples)))
      if (/\.(?:js|ts|json)$/.test(name)) files.push(`${folder}/${name}`)
  }
  for (const name of readdirSync(new URL('podcast/strings/', examples))) files.push(`podcast/strings/${name}`)
  files.push('podcast/assets/PodcastCJK-chars.txt')
  return files
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const file of gallerySources()) {
    const target = new URL(`mod/${file}`, gallery)
    mkdirSync(new URL('./', target), { recursive: true })
    copyFileSync(new URL(file, examples), target)
  }
  copyFileSync(new URL('./README.md', import.meta.url), new URL('README.md', gallery))
  copyFileSync(
    new URL('../../../host/modules/ui/assets/fonts/StackchanCJK-Regular.LICENSE.txt', import.meta.url),
    new URL('LICENSE.font.txt', gallery),
  )
  copyFileSync(
    new URL('../../../dist/bin/esp32/release/media_player/media_player.xsa', import.meta.url),
    new URL('media-player.xsa', gallery),
  )
}
