import assert from 'node:assert/strict'
import test from 'node:test'
import { createSpeechProfile } from '../speech-profile.js'
import { createSpeechProvider, geminiSpeechVoices } from '../speech-provider.js'
import { createTalkFeedback, setupActions, savedStatusBounds, voiceMenuAvailable } from '../setup-device/talk-feedback.js'

test('all menu touch rectangles fit the circular display without overlap', () => {
  for (const box of Object.values(setupActions)) {
    assert.ok(box.width >= 48 && box.height >= 48)
    for (const x of [box.left, box.left + box.width])
      for (const y of [box.top, box.top + box.height]) assert.ok(Math.hypot(x - 233, y - 233) < 223)
  }
  const boxes = Object.values(setupActions)
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i],
        b = boxes[j]
      assert.ok(
        a.left + a.width <= b.left ||
          b.left + b.width <= a.left ||
          a.top + a.height <= b.top ||
          b.top + b.height <= a.top,
      )
    }
})

test('provider choice leaves the saved status message unobscured', () => {
  for (const box of Object.values(setupActions))
    assert.ok(savedStatusBounds.top + savedStatusBounds.height < box.top)
  for (const x of [savedStatusBounds.left, savedStatusBounds.left + savedStatusBounds.width])
    for (const y of [savedStatusBounds.top, savedStatusBounds.top + savedStatusBounds.height])
      assert.ok(Math.hypot(x - 233, y - 233) < 223)
})

test('provider selection preserves separate voice choices and rejects an unconfigured Gemini key', () => {
  let keyPresent = false
  const saved = { openai: 'coral', gemini: 'Zephyr' }
  const profiles = {
    openai: createSpeechProfile({ read: () => saved.openai, write: value => { saved.openai = value } }),
    gemini: createSpeechProfile({ read: () => saved.gemini, write: value => { saved.gemini = value }, voices: geminiSpeechVoices }),
  }
  const provider = createSpeechProvider({ hasGeminiKey: () => keyPresent })
  assert.equal(provider.current(), 'openai')
  assert.throws(() => provider.next(), { code: 'gemini_key_missing' })
  assert.equal(provider.current(), 'openai')
  keyPresent = true
  provider.next()
  assert.equal(profiles[provider.current()].next(), 'Laomedeia')
  provider.next()
  assert.equal(profiles[provider.current()].current(), 'coral')
  assert.deepEqual(saved, { openai: 'coral', gemini: 'Laomedeia' })
})

test('recording meter uses measured input only and clears on release', () => {
  const ui = createTalkFeedback()
  ui.event({ type: 'input.level', value: 0.7 })
  assert.equal(ui.snapshot().level, 0)
  ui.hold(true)
  assert.deepEqual(ui.snapshot(), { phase: 'recording', level: 0, recording: true, busy: true })
  ui.event({ type: 'input.level', value: 0.7 })
  assert.equal(ui.snapshot().level, 0.7)
  ui.event({ type: 'output.level', value: 0.1 })
  assert.equal(ui.snapshot().level, 0.7)
  ui.event({ type: 'input.level', value: Number.NaN })
  assert.equal(ui.snapshot().level, 0)
  ui.hold(false)
  ui.event({ type: 'input.level', value: 0.8 })
  assert.deepEqual(ui.snapshot(), { phase: 'transcribing', level: 0, recording: false, busy: true })
})

test('recognition, agent, playback and completion advance independently', () => {
  const ui = createTalkFeedback()
  ui.hold(true)
  ui.hold(false)
  ui.event({ type: 'input.transcript', value: { final: true, text: 'こんにちは' } })
  assert.equal(ui.snapshot().busy, true)
  ui.event({ type: 'turn.started' })
  assert.equal(ui.snapshot().phase, 'thinking')
  ui.playback(true)
  assert.equal(ui.snapshot().phase, 'speaking')
  ui.playback(false)
  assert.equal(ui.snapshot().busy, true, 'between reply segments the turn still owns its voice')
  ui.event({ type: 'turn.ended' })
  assert.equal(ui.snapshot().busy, false)
})

test('empty recognition, error and disconnect clear recording and stale levels', () => {
  for (const event of [
    { type: 'input.transcript', value: { final: true, text: ' ' } },
    { type: 'error', fatal: false },
    { type: 'error', fatal: true },
    { type: 'session.ended' },
  ]) {
    const ui = createTalkFeedback()
    ui.hold(true)
    ui.event({ type: 'input.level', value: 1 })
    ui.event(event)
    ui.hold(false)
    assert.deepEqual(ui.snapshot(), { phase: 'idle', level: 0, recording: false, busy: false })
  }
})

test('voice selector exists only in ready saved-settings menu, never in conversation', () => {
  assert.equal(voiceMenuAvailable('saved', true), true)
  for (const phase of ['connected', 'connecting', 'review', 'saving', 'idle'])
    assert.equal(voiceMenuAvailable(phase, true), false)
  assert.equal(voiceMenuAvailable('saved', false), false)
  assert.equal(voiceMenuAvailable('saved', true, true), false)
})
