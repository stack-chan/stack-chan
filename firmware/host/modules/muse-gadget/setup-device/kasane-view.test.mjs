import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { GuruguruAvatar } from '../../../../mods/examples/guruguru_voice/avatar.js'

async function fixture({ expressions = false } = {}) {
  const draws = [],
    invalidations = [],
    textures = []
  class Content {
    constructor(model, options) {
      Object.assign(this, { width: 466, height: 466 }, options)
      if (options.Behavior) {
        this.behavior = new options.Behavior()
        this.behavior.onCreate(this, model)
      }
    }
    get time() {
      return this._time ?? 0
    }
    set time(value) {
      if (value === this.time) return
      this._time = value
      this.behavior?.onTimeChanged?.(this)
    }
    invalidate(...rect) {
      invalidations.push({ owner: this, rect })
    }
    add(child) {
      this.contents.push(child)
    }
    replace(before, after) {
      this.contents[this.contents.indexOf(before)] = after
    }
    start() {
      this.started = true
    }
    stop() {
      this.started = false
    }
    drawTexture(texture, _color, x, y, sx, sy, width, height) {
      draws.push({ texture: texture.path, x, y, sx, sy, width, height })
    }
  }
  const atlas = {
    width: 466,
    height: 466,
    frames: Array.from({ length: 9 }, (_, i) => ({
      texture: `kasane-${i}.png`,
      eyes: { texture: 'eyes.png', x: 150, y: 200, width: 130, height: 50 },
      mouth: { texture: `kasane-mouth-${i}.png`, x: 190 + i, y: 300, width: 38, height: 30 },
    })),
  }
  if (expressions)
    atlas.expressions = Object.fromEntries(
      ['happy', 'sad'].map((expression) => [
        expression,
        atlas.frames.map((frame, index) => ({
          ...frame,
          texture: `${expression}-${index}.png`,
          eyes: { ...frame.eyes, texture: `${expression}-eyes-${index}.png` },
          mouth: { ...frame.mouth, texture: `${expression}-mouth-${index}.png` },
        })),
      ]),
    )
  const context = vm.createContext({})
  const source = new vm.SourceTextModule(await readFile(new URL('./kasane-view.js', import.meta.url), 'utf8'), {
    context,
  })
  const modules = {
    'kasane-frames': { default: atlas },
    'guruguru-avatar': { GuruguruAvatar },
    'piu/MC': {
      Behavior: class {},
      Container: Content,
      Port: Content,
      Texture: class {
        constructor(path) {
          this.path = path
          textures.push(path)
        }
      },
    },
    'piu/Image': { Image: Content },
  }
  await source.link(
    (name) =>
      new vm.SyntheticModule(
        Object.keys(modules[name]),
        function () {
          for (const [key, value] of Object.entries(modules[name])) this.setExport(key, value)
        },
        { context },
      ),
  )
  await source.evaluate()
  const view = source.namespace.createGuruguruView()
  view.content.behavior.onDisplaying()
  const overlay = view.content.contents.at(-1),
    _images = view.content.contents.slice(0, 9)
  return {
    view,
    atlas,
    draws,
    invalidations,
    textures,
    overlay,
    get patches() {
      return view.content.contents.slice(10)
    },
    get images() {
      return view.content.contents.slice(0, 9)
    },
    draw(...rect) {
      overlay.behavior.onDraw(overlay, ...rect)
      return draws.at(-1)
    },
    tick() {
      view.content.time += view.content.interval
    },
  }
}
test('nine ColorCell frames are top-left anchored and switch without moving the mouth overlay', async () => {
  const f = await fixture()
  assert.equal(f.view.content.clip, true)
  for (let direction = 0; direction < 9; direction++) {
    f.view.model.trackFace((direction % 3) * 155 + 10, Math.floor(direction / 3) * 155 + 10, 466, 466)
    assert.equal(f.images.filter((image) => image.visible).length, 1)
    const image = f.images[direction]
    assert.equal(image.visible, true)
    assert.equal(image.path, `kasane-${direction}.cs`)
    assert.equal(image.left, 0)
    assert.equal(image.top, 0)
    assert.equal(image.width, 466)
    assert.equal(image.height, 466)
  }
})
test('4fps ticks invalidate only the mouth overlay, never the full image', async () => {
  const f = await fixture()
  f.view.model.setState('speak')
  assert.equal(f.view.content.interval, 250)
  f.tick()
  assert.equal(f.invalidations.length, 1)
  const invalidation = f.invalidations[0]
  assert.equal(invalidation.owner, f.overlay)
  assert.deepEqual(invalidation.rect, [194, 300, 38, 30])
  f.draw(...invalidation.rect)
  assert.equal(f.draws.length, 1)
  assert.equal(f.draws[0].texture, 'kasane-mouth-4.png')
  assert.equal(f.draws[0].width, 38)
  assert.equal(f.draws[0].height, 30)
  f.tick()
  f.draws.length = 0
  f.draw(...invalidation.rect)
  assert.equal(f.draws.length, 0)
  assert.equal(f.invalidations.length, 2)
})
test('audio levels do not invalidate; stopping speech restores mouth and resumes slow blinking', async () => {
  const f = await fixture()
  f.view.model.setState('speak')
  f.tick()
  const count = f.invalidations.length
  f.view.model.setLevel(1)
  f.view.model.setState('speak')
  assert.equal(f.invalidations.length, count)
  f.view.model.setState('idle')
  assert.equal(f.invalidations.length, count + 1)
  assert.equal(f.view.content.started, true)
  assert(f.view.content.interval >= 3000 && f.view.content.interval < 5000)
  f.view.close()
  assert.equal(f.view.content.started, false)
})

test('idle, listen and think blink only the eye ROI with a short closed interval', async () => {
  for (const state of ['idle', 'listen', 'think']) {
    const f = await fixture()
    f.view.model.setState(state)
    assert(f.view.content.interval >= 3000 && f.view.content.interval < 5000)
    f.tick()
    assert.equal(f.view.model.eyeOpen, false)
    assert.equal(f.view.content.interval, 120)
    assert.deepEqual(f.invalidations.at(-1).rect, [150, 200, 130, 50])
    f.draw(...f.invalidations.at(-1).rect)
    assert.equal(f.draws.at(-1).texture, 'eyes.png')
    f.tick()
    assert.equal(f.view.model.eyeOpen, true)
    assert(f.view.content.interval >= 3000 && f.view.content.interval < 5000)
    assert(f.invalidations.every((item) => item.owner === f.overlay && item.rect.length === 4))
  }
})
test('speech opens closed eyes immediately and runs only mouth ticks', async () => {
  const f = await fixture()
  f.tick()
  f.view.model.setState('speak')
  assert.equal(f.view.model.eyeOpen, true)
  assert.deepEqual(f.invalidations.at(-1).rect, [150, 200, 130, 50])
  const count = f.invalidations.length
  for (let i = 0; i < 8; i++) f.tick()
  assert.equal(f.view.content.interval, 250)
  assert.equal(f.view.model.eyeOpen, true)
  assert(f.invalidations.slice(count).every((item) => item.rect[2] === 38 && item.rect[3] === 30))
})
test('undisplay and close fence stale animation callbacks', async () => {
  const f = await fixture()
  f.view.content.behavior.onUndisplaying()
  f.tick()
  assert.equal(f.invalidations.length, 0)
  assert.equal(f.view.content.started, false)
  f.view.model.setState('speak')
  assert.equal(f.view.content.started, false)
  f.view.content.behavior.onDisplaying()
  assert.equal(f.view.content.started, true)
  f.view.close()
  const count = f.invalidations.length
  f.tick()
  f.view.content.behavior.onDisplaying()
  f.view.model.setState('speak')
  assert.equal(f.view.content.started, false)
  assert.equal(f.invalidations.length, count)
})

test('production eye patches stay inside the face and above the mouth in every direction', async () => {
  const { default: atlas } = await import('./kasane-frames.js')
  for (const frame of atlas.frames) {
    const eyes = frame.eyes
    assert(eyes.x >= 0 && eyes.y >= 0)
    assert(eyes.width > 0 && eyes.height > 0)
    assert(eyes.x + eyes.width <= atlas.width)
    assert(eyes.y + eyes.height < frame.mouth.y)
    const png = await readFile(new URL(`./assets/${eyes.texture}`, import.meta.url))
    assert.equal(png.readUInt32BE(16), eyes.width)
    assert.equal(png.readUInt32BE(20), eyes.height)
  }
})

test('close restores a closed blink before permanently stopping animation', async () => {
  const f = await fixture()
  f.tick()
  assert.equal(f.view.model.eyeOpen, false)
  const count = f.invalidations.length
  f.view.close()
  assert.equal(f.view.model.eyeOpen, true)
  assert.equal(f.invalidations.length, count + 1)
  assert.deepEqual(f.invalidations.at(-1).rect, [150, 200, 130, 50])
  f.draw(...f.invalidations.at(-1).rect)
  assert.equal(f.draws.length, 0)
  f.view.close()
  f.tick()
  assert.equal(f.invalidations.length, count + 1)
  assert.equal(f.view.content.started, false)
})

test('expression changes retain nine base images and at most two matching patches', async () => {
  const f = await fixture({ expressions: true })
  for (const expression of ['happy', 'sad', 'neutral']) {
    f.view.model.setExpression(expression)
    for (let direction = 0; direction < 9; direction++) {
      f.view.model.trackFace((direction % 3) * 155 + 10, Math.floor(direction / 3) * 155 + 10, 466, 466)
      const prefix = expression === 'neutral' ? 'kasane' : expression
      assert.equal(f.images[direction].path, `${prefix}-${direction}.cs`)
      assert.equal(f.images.filter((image) => image.visible).length, 1)
      assert.ok(f.view.content.contents.length <= 12)
      assert.equal(f.textures.length, 18, 'only neutral uses alpha textures')
      f.view.model.setState('speak')
      f.tick()
      if (expression === 'neutral') assert.equal(f.draw().texture, `${prefix}-mouth-${direction}.png`)
      else {
        const [eyes, mouth] = f.patches
        assert.equal(eyes.visible, false)
        assert.equal(mouth.visible, true)
        assert.equal(mouth.path, `${expression}-mouth-${direction}.cs`)
        const patch = f.atlas.expressions[expression][direction].mouth
        assert.deepEqual(
          [mouth.left, mouth.top, mouth.width, mouth.height],
          [patch.x, patch.y, patch.width, patch.height],
        )
        const count = f.draws.length
        f.draw()
        assert.equal(f.draws.length, count, 'opaque expressions never use alpha Port drawing')
      }
      f.view.model.setState('idle')
      f.tick()
      if (expression === 'neutral') assert.equal(f.draw().texture, 'eyes.png')
      else {
        const [eyes, mouth] = f.patches
        assert.equal(eyes.visible, true)
        assert.equal(mouth.visible, false)
        assert.equal(eyes.path, `${expression}-eyes-${direction}.cs`)
      }
      f.tick()
    }
  }
})

test('missing expression art stays neutral without repainting or disrupting speech', async () => {
  const f = await fixture()
  f.view.model.setState('speak')
  f.tick()
  const count = f.invalidations.length
  f.view.model.setExpression('happy')
  assert.equal(f.invalidations.length, count)
  assert.equal(f.images[4].path, 'kasane-4.cs')
  assert.equal(f.draw().texture, 'kasane-mouth-4.png')
})

test('changing expression during a blink repaints the matching eyelids without changing its timing', async () => {
  const f = await fixture({ expressions: true })
  f.tick()
  f.view.model.setExpression('happy')
  assert.deepEqual(f.invalidations.at(-1).rect, [])
  assert.equal(f.patches[0].path, 'happy-eyes-4.cs')
  assert.equal(f.patches[0].visible, true)
  assert.equal(f.view.content.interval, 120)
  f.tick()
  assert.equal(f.view.model.eyeOpen, true)
  f.view.close()
  const count = f.invalidations.length
  f.view.model.setExpression('sad')
  assert.equal(f.invalidations.length, count)
})

test('opaque expression animation reuses two bounded images without full-frame invalidation', async () => {
  const f = await fixture({ expressions: true })
  f.view.model.setExpression('happy')
  const patches = f.patches
  f.invalidations.length = 0
  f.view.model.setState('speak')
  for (let i = 0; i < 12; i++) {
    f.tick()
    assert.equal(f.patches[0], patches[0])
    assert.equal(f.patches[1], patches[1])
    assert.equal(f.patches[1].visible, i % 2 === 0)
  }
  assert.equal(f.invalidations.length, 0)
  f.view.model.setExpression('neutral')
  assert.ok(f.patches.every((image) => !image.visible))
  assert.equal(f.view.content.contents.length, 12)
})
