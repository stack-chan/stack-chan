import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import atlas from './kasane-frames.js'

test('each expression has nine complete, registered and in-bounds device frames', async () => {
  const manifest = JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8'))
  const resourcePaths = Object.values(manifest.resources)
    .flat()
    .filter((value) => typeof value === 'string')
  for (const frames of [atlas.frames, ...Object.values(atlas.expressions)]) {
    assert.equal(frames.length, 9)
    for (const frame of frames) {
      for (const region of [
        { texture: frame.texture, x: 0, y: 0, width: atlas.width, height: atlas.height },
        frame.eyes,
        frame.mouth,
      ]) {
        assert(region.x >= 0 && region.y >= 0)
        assert(region.width > 0 && region.height > 0)
        assert(region.x + region.width <= atlas.width)
        assert(region.y + region.height <= atlas.height)
        const png = await readFile(new URL(`./assets/${region.texture}`, import.meta.url))
        assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
        assert.equal(png.readUInt32BE(16), region.width)
        assert.equal(png.readUInt32BE(20), region.height)
        assert(resourcePaths.includes(`./assets/${region.texture.replace(/\.png$/, '')}`), region.texture)
      }
      assert(frame.eyes.y < frame.mouth.y)
    }
  }
})
