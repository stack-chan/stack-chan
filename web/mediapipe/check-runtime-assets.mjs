import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'

const assets = new URL('../dist/assets/', import.meta.url)
const names = await readdir(assets)
for (const stem of ['vision_wasm_internal', 'vision_wasm_nosimd_internal']) {
  for (const extension of ['js', 'wasm']) {
    const built = names.filter((name) => name.startsWith(`${stem}-`) && name.endsWith(`.${extension}`))
    assert.equal(built.length, 1, `Expected one bundled ${stem}.${extension}`)
    const actual = await readFile(new URL(built[0], assets))
    const expected = await readFile(
      new URL(`../node_modules/@mediapipe/tasks-vision/wasm/${stem}.${extension}`, import.meta.url)
    )
    assert.deepEqual(actual, expected, `${stem}.${extension} must match the lockfile-installed package`)
  }
}
console.log('MediaPipe SIMD and fallback runtime assets match the installed npm package.')
