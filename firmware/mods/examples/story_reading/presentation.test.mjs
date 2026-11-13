import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'reading-choreography')
      return nextResolve(new URL('./choreography.js', import.meta.url).href, context)
    return nextResolve(specifier, context)
  },
})
const { ReadingPresentation, installPresentationChoice } = await import('./presentation.js')

function harness() {
  const effects = new Set(),
    timers = new Map(),
    mouths = [],
    removed = [],
    buttons = new Map()
  let id = 0,
    additions = 0
  const variants = [],
    gazes = []
  const book = {
      behavior: {
        onPageVariant(_book, variant) {
          variants.push(variant)
        },
      },
    },
    notes = {}
  const ui = {
    addEffect(value) {
      assert(!effects.has(value))
      effects.add(value)
      ++additions
    },
    removeEffect(value) {
      assert(effects.has(value))
      effects.delete(value)
      removed.push(value)
    },
  }
  const face = {
    render(value, gaze) {
      mouths.push(value)
      gazes.push({ ...gaze })
    },
    clear() {
      mouths.push(0)
    },
  }
  const timer = {
    repeat(callback, interval) {
      assert(interval >= 100)
      timers.set(++id, callback)
      return id
    },
    clear(value) {
      assert(timers.has(value))
      timers.delete(value)
    },
  }
  const drawer = {
    addDrawerButton(button) {
      buttons.set(button.key, button)
    },
    removeDrawerButton(key) {
      buttons.delete(key)
    },
  }
  const presentation = new ReadingPresentation({ ui, face, timer, book, notes })
  return {
    presentation,
    variants,
    gazes,
    effects,
    timers,
    mouths,
    removed,
    book,
    notes,
    buttons,
    context: { drawer },
    tick() {
      for (const callback of timers.values()) callback()
    },
    get additions() {
      return additions
    },
  }
}

test('reading starts only while playing, with one book and one bounded mouth timer', () => {
  const h = harness()
  h.presentation.update({ playbackState: 'connecting' })
  assert.deepEqual([...h.effects], [h.book])
  assert.equal(h.timers.size, 0)
  h.presentation.update({ playbackState: 'playing' })
  for (let i = 0; i < 100; ++i) {
    h.presentation.update({ playbackState: 'playing', progress: { position: i } })
    h.tick()
  }
  assert.equal(h.additions, 1)
  assert.equal(h.timers.size, 1)
  assert(h.mouths.every((value) => value >= 0 && value <= 1))
  assert(new Set(h.mouths).size > 3)
})

for (const state of ['paused', 'buffering', 'stalled', 'retrying']) {
  test(`${state} closes the mouth but retains the book; resume has one timer`, () => {
    const h = harness()
    h.presentation.update({ playbackState: 'playing' })
    h.tick()
    const stale = [...h.timers.values()][0]
    h.presentation.update({ playbackState: state })
    assert.deepEqual([...h.effects], [h.book])
    assert.equal(h.timers.size, 0)
    assert.equal(h.mouths.at(-1), 0)
    const count = h.mouths.length
    stale()
    assert.equal(h.mouths.length, count)
    h.presentation.update({ playbackState: 'playing' })
    assert.equal(h.timers.size, 1)
  })
}

for (const state of ['idle', 'ended', 'error']) {
  test(`${state} removes the book and closes the mouth`, () => {
    const h = harness()
    h.presentation.update({ playbackState: 'playing' })
    h.tick()
    h.presentation.update({ playbackState: state })
    assert.equal(h.effects.size, 0)
    assert.equal(h.timers.size, 0)
    assert.equal(h.mouths.at(-1), 0)
  })
}

test('switching modes while playing swaps visuals without touching playback', () => {
  const h = harness()
  h.presentation.update({ playbackState: 'playing' })
  h.tick()
  h.presentation.setMode('music')
  assert.deepEqual([...h.effects], [h.notes])
  assert.equal(h.timers.size, 0)
  assert.equal(h.mouths.at(-1), 0)
  h.presentation.setMode('none')
  assert.equal(h.effects.size, 0)
  h.presentation.setMode('reading')
  assert.deepEqual([...h.effects], [h.book])
  assert.equal(h.timers.size, 1)
  assert.equal(h.presentation.setMode('bad'), false)
  assert.equal(h.presentation.mode, 'reading')
})

test('music never changes mouth state and hides notes on pause', () => {
  const h = harness()
  h.presentation.setMode('music')
  h.presentation.update({ playbackState: 'playing', state: 'idle', source: 'radio' })
  assert.deepEqual([...h.effects], [h.notes])
  assert.equal(h.timers.size, 0)
  h.presentation.update({ playbackState: 'paused' })
  assert.equal(h.effects.size, 0)
  assert.equal(h.mouths.length, 0)
})

test('close is idempotent and old timer callbacks cannot reopen the mouth', () => {
  const h = harness()
  h.presentation.update({ playbackState: 'playing' })
  h.tick()
  const stale = [...h.timers.values()][0]
  h.presentation.close()
  h.presentation.close()
  stale()
  h.presentation.update({ playbackState: 'playing' })
  assert.equal(h.presentation.setMode('music'), false)
  assert.equal(h.effects.size, 0)
  assert.equal(h.timers.size, 0)
  assert.equal(h.mouths.at(-1), 0)
})

test('drawer mode changes are reversible, ignore invalid values, and unregister cleanly', () => {
  const h = harness()
  const remove = installPresentationChoice(h.context, h.presentation)
  const button = () => [...h.buttons.values()][0]
  assert.equal(button().value, 'reading')
  assert.equal(button().options.length, 3)
  button().callback(h.context, 'music')
  assert.equal(button().value, 'music')
  button().callback(h.context, undefined)
  assert.equal(button().value, 'music')
  button().callback(h.context, 'reading')
  assert.equal(button().value, 'reading')
  remove()
  assert.equal(h.buttons.size, 0)
})

test('page variants advance while mouth and gaze render calls remain frozen', () => {
  const h = harness()
  h.presentation.update({ playbackState: 'playing' })
  while (!h.variants.length) h.tick()
  assert.equal(h.variants.at(-1), 1)
  assert.equal(h.mouths.at(-1), 0)
  const calls = h.mouths.length,
    gazeCalls = h.gazes.length
  while (h.variants.at(-1) !== 5) {
    h.tick()
    assert.equal(h.mouths.length, calls)
    assert.equal(h.gazes.length, gazeCalls)
  }
  while (h.variants.at(-1) !== 0) h.tick()
  assert.equal(h.mouths.length, calls + 1)
  assert.equal(h.gazes.length, gazeCalls + 1)
})

test('pause in a page turn cancels the page, rejects stale callbacks, and resumes on the first page', () => {
  const h = harness()
  h.presentation.update({ playbackState: 'playing' })
  while (!h.variants.length) h.tick()
  const stale = [...h.timers.values()][0]
  h.presentation.update({ playbackState: 'paused' })
  assert.equal(h.variants.at(-1), 0)
  const count = h.mouths.length
  stale()
  assert.equal(h.mouths.length, count)
  h.presentation.update({ playbackState: 'playing' })
  for (let i = 0; i < 10; ++i) h.tick()
  assert.equal(h.variants.at(-1), 0)
})

test('switching to Music or Off during a page turn clears the tile and animation timer', () => {
  for (const mode of ['music', 'none']) {
    const h = harness()
    h.presentation.update({ playbackState: 'playing' })
    while (!h.variants.length) h.tick()
    h.presentation.setMode(mode)
    assert.equal(h.variants.at(-1), 0)
    assert.equal(h.timers.size, 0)
    assert.equal(h.mouths.at(-1), 0)
  }
})
