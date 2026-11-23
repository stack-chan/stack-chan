import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
registerHooks({
  resolve(name, context, next) {
    if (name === 'muse-caption-layout') return next(new URL('./caption-layout.js', import.meta.url).href, context)
    return next(name, context)
  },
})
const { createCaptionState } = await import('./caption-state.js')
const { paginateCaption } = await import('./caption-layout.js')
const measure = (text) => Array.from(text).length * 24

function fixture() {
  let clock = 0,
    sequence = 0
  const timers = new Map(),
    renders = []
  const timer = {
    set(callback, delay) {
      const id = ++sequence
      timers.set(id, { at: clock + delay, callback })
      return id
    },
    clear(id) {
      timers.delete(id)
    },
  }
  const state = createCaptionState({
    measure,
    timer,
    now: () => clock,
    render: (value) => renders.push({ ...value, at: clock }),
  })
  const step = (until = clock) => {
    for (;;) {
      const job = [...timers].filter(([, job]) => job.at <= until).sort((a, b) => a[1].at - b[1].at)[0]
      if (!job) break
      clock = job[1].at
      timers.delete(job[0])
      job[1].callback()
    }
    clock = until
  }
  const start = (id, text = 'おはよう') => {
    state.input(true)
    state.input(false)
    state.transcript(text)
    state.event({ type: 'turn.started', turnId: id })
    step()
  }
  return {
    state,
    renders,
    timers,
    step,
    start,
    get last() {
      return renders.at(-1)
    },
  }
}

test('final user text persists through waiting and synthesis until actual PCM', () => {
  const f = fixture()
  f.start('one')
  assert.equal(f.last.lines.join(''), 'おはよう')
  f.state.prepare('reply/0')
  f.state.event({ type: 'caption.segment', turnId: 'one', outputId: 'reply/0', text: 'こんにちは' })
  f.step()
  assert.equal(f.last.lines.join(''), 'おはよう')
  assert.equal(f.last.waiting, true)
  f.state.audible()
  f.step()
  assert.equal(f.last.lines.join(''), 'こんにちは')
  assert.equal(f.last.speaker, 'muse')
})

test('long buffered reply displays every page in order using supplied PCM duration', () => {
  const f = fixture(),
    text = '今日は小さなロボットの仕組みを紹介します。'.repeat(10)
  f.start('one')
  f.state.prepare('reply/0')
  for (const segment of [text.slice(0, 60), text.slice(60)])
    f.state.event({ type: 'caption.segment', turnId: 'one', outputId: 'reply/0', text: segment })
  f.state.event({ type: 'caption.duration', turnId: 'one', outputId: 'reply/0', durationMs: 30000 })
  f.step()
  f.state.audible()
  f.step(30000)
  const pages = f.renders.filter((render) => render.speaker === 'muse').map((render) => render.lines)
  assert.deepEqual(pages, paginateCaption(text, measure))
  f.state.event({ type: 'turn.ended', turnId: 'one', status: 'completed' })
  f.step(31999)
  assert.notEqual(f.last.lines.length, 0)
  f.step(32000)
  assert.equal(f.last.lines.length, 0)
})

test('new input fences old expiry callbacks and late old turn events', () => {
  const f = fixture()
  f.start('one')
  f.state.event({ type: 'turn.ended', turnId: 'one', status: 'completed' })
  const old = [...f.timers.values()].map((value) => value.callback)
  f.start('two', '次のお話')
  for (const callback of old) callback()
  f.state.event({ type: 'caption.segment', turnId: 'one', outputId: 'old', text: '古い字幕' })
  f.state.event({ type: 'turn.ended', turnId: 'one', status: 'completed' })
  f.step(3000)
  assert.equal(f.last.lines.join(''), '次のお話')
})

test('PCM levels and token deltas do not redraw a caption page', () => {
  const f = fixture()
  f.start('one')
  f.state.prepare('reply/0')
  f.state.event({ type: 'caption.segment', turnId: 'one', outputId: 'reply/0', text: 'こんにちは' })
  f.step()
  f.state.audible()
  f.step()
  const count = f.renders.length
  for (let index = 0; index < 100; index++) {
    f.state.audible()
    f.state.event({ type: 'output.text', outputId: 'reply', delta: '字' })
  }
  f.step()
  assert.equal(f.renders.length, count)
})

test('cancel, error and close clear previous captions and fence queued rendering', () => {
  const f = fixture()
  f.start('one')
  f.state.clear()
  f.step()
  assert.equal(f.last.lines.length, 0)
  f.start('two')
  f.state.error('もう一度お話しください')
  f.step()
  assert.equal(f.last.speaker, 'error')
  assert.equal(f.last.lines.join(''), 'もう一度お話しください')
  const stale = [...f.timers.values()].map((value) => value.callback)
  f.state.close()
  for (const callback of stale) callback()
  f.state.event({ type: 'turn.started', turnId: 'three' })
  f.state.audible()
  f.step(10000)
  assert.equal(f.last.phase, 'closed')
  assert.equal(f.last.lines.length, 0)
})

test('final expiry uses playback stop even when turn cleanup finishes later', () => {
  const f = fixture()
  f.start('one')
  f.state.prepare('reply/0', 'one')
  f.state.event({ type: 'caption.segment', turnId: 'one', outputId: 'reply/0', text: '返答' })
  f.step()
  f.state.audible()
  f.step(1000)
  f.state.stopOutput({ turnId: 'one', outputId: 'reply/0' })
  f.step(2500)
  f.state.event({ type: 'turn.ended', turnId: 'one', status: 'completed' })
  f.step(2999)
  assert.equal(f.last.lines.join(''), '返答')
  f.step(3000)
  assert.deepEqual(f.last.lines, [])
})

test('captions expire from playback stop before delayed turn cleanup completes', () => {
  const f = fixture()
  f.start('one')
  f.state.prepare('reply/0', 'one')
  f.state.event({ type: 'caption.segment', turnId: 'one', outputId: 'reply/0', text: '返答' })
  f.step()
  f.state.audible()
  f.step(1000)
  f.state.stopOutput({ turnId: 'one', outputId: 'reply/0' })
  f.step(2999)
  assert.equal(f.last.lines.join(''), '返答')
  f.step(3000)
  assert.deepEqual(f.last.lines, [])
  f.state.audible()
  f.state.event({ type: 'caption.segment', turnId: 'one', outputId: 'reply/0', text: '古い通知' })
  f.step(4000)
  assert.deepEqual(f.last.lines, [])
  f.step(5000)
  f.state.event({ type: 'turn.ended', turnId: 'one', status: 'completed' })
  f.step()
  assert.deepEqual(f.last.lines, [])
})

test('a later output after a long gap can show without stale expiry hiding it', () => {
  const f = fixture()
  f.start('one')
  f.state.prepare('reply/0', 'one')
  f.state.event({ type: 'caption.segment', turnId: 'one', outputId: 'reply/0', text: '最初の返答' })
  f.step()
  f.state.audible()
  f.step(1000)
  f.state.stopOutput({ turnId: 'one', outputId: 'reply/0' })
  const oldExpiry = [...f.timers.values()].map((value) => value.callback)
  f.step(4000)
  assert.deepEqual(f.last.lines, [])
  assert.equal(f.state.prepare('reply/1', 'one'), true)
  f.state.event({ type: 'caption.segment', turnId: 'one', outputId: 'reply/1', text: '続きの返答' })
  f.step()
  f.state.audible()
  for (const callback of oldExpiry) callback()
  f.step()
  assert.equal(f.last.lines.join(''), '続きの返答')
  assert.equal(f.state.prepare('reply/0', 'one'), false)
})

test('old output stop cannot stop the next turn with the same output ID', () => {
  const f = fixture()
  f.start('one')
  f.start('two')
  f.state.prepare('reply/0', 'two')
  f.state.event({ type: 'caption.segment', turnId: 'two', outputId: 'reply/0', text: 'あ'.repeat(140) })
  f.state.event({ type: 'caption.duration', turnId: 'two', outputId: 'reply/0', durationMs: 5000 })
  f.step()
  f.state.audible()
  f.step()
  const before = f.renders.length
  f.state.stopOutput({ turnId: 'one', outputId: 'reply/0' })
  f.step(1200)
  assert.ok(f.renders.length > before)
})

test('late duration cannot collapse remaining pages into millisecond flashes', () => {
  const f = fixture()
  f.start('one')
  f.state.prepare('reply/0', 'one')
  f.state.event({ type: 'caption.segment', turnId: 'one', outputId: 'reply/0', text: 'あ'.repeat(140) })
  f.step()
  f.state.audible()
  f.step(1900)
  f.state.event({ type: 'caption.duration', turnId: 'one', outputId: 'reply/0', durationMs: 2000 })
  f.step(1906)
  assert.equal(f.renders.filter((value) => value.speaker === 'muse').length, 1)
  f.step(10000)
  const pages = f.renders.filter((value) => value.speaker === 'muse')
  for (let index = 1; index < pages.length; index++) assert.ok(pages[index].at - pages[index - 1].at >= 700)
})

test('text arriving after playback starts updates the visible page and resumes pagination', () => {
  const f = fixture(),
    text = '今日は小さなロボットの仕組みを紹介します。'.repeat(4)
  f.start('one')
  f.state.prepare('reply/0')
  const append = (text) => f.state.event({ type: 'caption.segment', turnId: 'one', outputId: 'reply/0', text })
  append(text.slice(0, 5))
  f.step()
  f.state.audible()
  f.step()
  assert.equal(f.last.lines.join(''), text.slice(0, 5))
  f.step(500)
  append(text.slice(5))
  f.step(10000)
  const pages = f.renders
    .filter((value) => value.speaker === 'muse')
    .slice(1)
    .map((value) => value.lines)
  assert.equal(pages.flat().join(''), text)
})

test('an empty final transcript leaves a retry message and clears the waiting indicator', () => {
  const f = fixture()
  f.state.input(true)
  f.state.input(false)
  f.state.transcript('  ')
  f.step()
  assert.equal(f.last.lines.join(''), '音声を聞き取れませんでした。')
  assert.equal(f.last.waiting, false)
})
