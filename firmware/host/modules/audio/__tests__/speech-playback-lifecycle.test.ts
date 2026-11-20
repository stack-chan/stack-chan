import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type AudioOut from '../../testing/fakes/audio-out.js'
import { writeAliasPackage, writeAliasPackageSubpath } from '../../testing/node-alias-package.js'

type FakeAudioOutModule = typeof import('../../testing/fakes/audio-out.js')

function installBareSpecifierPackages(): void {
  const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  writeAliasPackage(modulesRoot, 'calculate-power', resolve(modulesRoot, 'testing/fakes/calculate-power.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackageSubpath(modulesRoot, 'pins', 'audioout', resolve(modulesRoot, 'testing/fakes/audio-out.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackage(modulesRoot, 'speech-playback-types', resolve(modulesRoot, 'audio/speech-playback-types.js'))
}

async function setup() {
  installBareSpecifierPackages()
  const [{ beginSpeechPlayback, runSpeechPlayback }, audioOut] = await Promise.all([
    import('../speech-playback-lifecycle.js'),
    import('../../testing/fakes/audio-out.js') as Promise<FakeAudioOutModule>,
  ])
  ;(globalThis as typeof globalThis & { trace: (...messages: unknown[]) => void }).trace = () => {}
  audioOut.resetAudioOut()
  return { beginSpeechPlayback, runSpeechPlayback, audioOut }
}

test('speech playback lifecycle closes the mouth before reporting playback errors', async () => {
  const { beginSpeechPlayback } = await setup()
  const order: string[] = []
  const owner = {
    streaming: false,
    onDone: () => order.push('done'),
    onPlayed: (power: number) => order.push(`played:${power}`),
  }
  const lifecycle = beginSpeechPlayback(owner, (error?: unknown) => {
    order.push(`callback:${String(error)}`)
  })

  assert.ok(lifecycle)
  const audio = lifecycle.openAudio({ streams: 1, sampleRate: 11025 }, 0.5) as AudioOut
  lifecycle.attach({ close: () => order.push('streamer:close') })
  lifecycle.addCleanup(() => order.push('extra:close'))
  lifecycle.onReady(true)
  lifecycle.onPlayed(Uint8Array.of(1, 2, 3).buffer)
  lifecycle.onError('boom')
  lifecycle.onError('duplicate')

  assert.equal(owner.streaming, false)
  assert.equal(owner.onPlayed, owner.onPlayed)
  assert.equal(audio.closed, true)
  assert.equal(audio.started, 1)
  assert.deepEqual(order, ['played:3', 'extra:close', 'streamer:close', 'done', 'callback:boom'])
})

test('speech playback lifecycle clears streaming after synchronous setup failures', async () => {
  const { runSpeechPlayback, audioOut } = await setup()
  const order: string[] = []
  const owner = {
    streaming: false,
    onDone: () => order.push('done'),
  }

  audioOut.setAudioOutConstructorFailure(new Error('audio failed'))
  runSpeechPlayback(
    owner,
    (error?: unknown) => order.push(`callback:${String(error)}`),
    (lifecycle) => {
      lifecycle.openAudio({ streams: 1, sampleRate: 11025 }, 0.5)
    },
  )

  assert.equal(owner.streaming, false)
  assert.equal(order.length, 2)
  assert.equal(order[0], 'done')
  assert.match(order[1], /^callback:Error: audio failed$/)

  audioOut.resetAudioOut()
  const next = runSpeechPlayback(owner, undefined, (lifecycle) => {
    lifecycle.openAudio({ streams: 1, sampleRate: 11025 }, 0.5)
    lifecycle.onDone()
  })
  void next
  assert.equal(owner.streaming, false)
  assert.equal(audioOut.getAudioOutInstances().length, 1)
})

test('speech playback lifecycle rejects overlapping playback without firing onDone', async () => {
  const { beginSpeechPlayback } = await setup()
  const order: string[] = []
  const owner = {
    streaming: false,
    onDone: () => order.push('done'),
  }

  const active = beginSpeechPlayback(owner)
  assert.ok(active)
  const duplicate = beginSpeechPlayback(owner, (error?: unknown) => order.push(String(error)))

  assert.equal(duplicate, undefined)
  assert.deepEqual(order, ['Error: already playing'])
  active.onDone()
  assert.deepEqual(order, ['Error: already playing', 'done'])
})

test('speech playback lifecycle forwards an already calculated streaming power value', async () => {
  const { beginSpeechPlayback } = await setup()
  const powers: number[] = []
  const owner = {
    streaming: false,
    onPlayed: (power: number) => powers.push(power),
  }
  const lifecycle = beginSpeechPlayback(owner)

  assert.ok(lifecycle)
  lifecycle.onPower(1234)
  lifecycle.onDone()
  lifecycle.onPower(5678)

  assert.deepEqual(powers, [1234])
})
