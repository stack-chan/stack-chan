import { readFileSync } from 'node:fs'

export async function loadModule(path) {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'))
  let source = readFileSync(new URL(`../${path}.js`, import.meta.url), 'utf8')
  for (const [name, target] of Object.entries(manifest.modules))
    source = source.replaceAll(`'${name}'`, `'${new URL(`../${target}.js`, import.meta.url).href}'`)
  return import(`data:text/javascript,${encodeURIComponent(source)}`)
}
