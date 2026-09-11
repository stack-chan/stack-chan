import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fonts = join(root, 'host/modules/ui/assets/fonts')
const temporary = mkdtempSync(join(tmpdir(), 'stackchan-body-font-'))
const basename = 'k8x12-12'
try {
  let characters = readFileSync(join(fonts, 'k8x12-chars.txt'), 'utf8')
  for (let point = 32; point <= 126; point++) characters += String.fromCodePoint(point)
  for (const locale of ['ja', 'en', 'zh-CN']) {
    const catalog = JSON.parse(readFileSync(join(root, 'host/app/strings', `${locale}.json`), 'utf8'))
    characters += Object.values(catalog).join('')
  }
  const charactersPath = join(temporary, 'characters.txt')
  writeFileSync(charactersPath, [...new Set(characters)].sort().join(''))
  const result = spawnSync(
    process.env.FONTBM || 'fontbm',
    [
      '--font-file',
      join(fonts, 'k8x12.ttf'),
      '--font-size',
      '12',
      '--output',
      join(temporary, basename),
      '--texture-size',
      '1024x768',
      '--max-texture-count',
      '1',
      '--texture-crop-width',
      '--texture-crop-height',
      '--texture-name-suffix',
      'none',
      '--data-format',
      'bin',
      '--monochrome',
      '--chars-file',
      charactersPath,
    ],
    { stdio: 'inherit' },
  )
  if (result.error || result.status !== 0) throw result.error ?? new Error('fontbm failed')
  for (const suffix of ['.fnt', '.png']) {
    const output = join(fonts, basename + suffix)
    const generated = join(temporary, basename + suffix)
    if (process.argv.includes('--check')) {
      if (!readFileSync(output).equals(readFileSync(generated))) throw new Error(`Regenerate ${basename}${suffix}`)
    } else copyFileSync(generated, output)
  }
  console.log(`Body font ${process.argv.includes('--check') ? 'verified' : 'rebuilt'}`)
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
