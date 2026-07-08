import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage } from '../../testing/node-alias-package.js'

type FakeAudioIn = typeof import('../../testing/fakes/audio-in.js')

function installBareSpecifierPackages(): void {
  const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  writeAliasPackage(modulesRoot, 'audio-buffer', resolve(modulesRoot, 'audio/audio-buffer.js'))
  writeAliasPackage(modulesRoot, 'audio-in', resolve(modulesRoot, 'testing/fakes/audio-in.js'), {
    hasDefaultExport: true,
  })
}

function oneByte(value: number): ArrayBuffer {
  return Uint8Array.of(value).buffer
}

async function setup(chunks: Array<ArrayBuffer | null>) {
  installBareSpecifierPackages()
  const [{ default: Microphone }, audioIn] = await Promise.all([
    import('../microphone.js'),
    import('../../testing/fakes/audio-in.js') as Promise<FakeAudioIn>,
  ])
  ;(globalThis as typeof globalThis & { trace: (...messages: unknown[]) => void }).trace = () => {}
  audioIn.resetAudioIn(chunks)
  return { Microphone, audioIn }
}

async function recordOneByte(
  microphone: InstanceType<Awaited<ReturnType<typeof setup>>['Microphone']>,
  audioIn: FakeAudioIn,
) {
  const recording = microphone.record(1)
  const instance = audioIn.getAudioInInstances().at(-1)
  assert.ok(instance)
  instance.emitReadable(1)
  return recording
}

test('Microphone.record clears recording state after a completed recording', async () => {
  const { Microphone, audioIn } = await setup([oneByte(1), oneByte(2)])
  const microphone = new Microphone()

  await recordOneByte(microphone, audioIn)
  assert.equal(microphone.recording, false)

  await recordOneByte(microphone, audioIn)
  assert.equal(microphone.recording, false)
})

test('Microphone.record opens AudioIn as mono', async () => {
  const { Microphone, audioIn } = await setup([oneByte(1)])
  const microphone = new Microphone()

  await recordOneByte(microphone, audioIn)

  const [instance] = audioIn.getAudioInInstances()
  assert.equal(instance.channels, 1)
})

test('Microphone.record rejects overlapping recordings while one is active', async () => {
  const { Microphone, audioIn } = await setup([oneByte(1)])
  const microphone = new Microphone()

  const recording = microphone.record(1)
  await assert.rejects(() => microphone.record(1), /already recording/)

  const [instance] = audioIn.getAudioInInstances()
  instance.emitReadable(1)
  await recording
})

test('Microphone.record clears recording state when AudioIn start throws', async () => {
  const { Microphone, audioIn } = await setup([])
  const microphone = new Microphone()
  audioIn.setAudioInStartFailure(true)

  await assert.rejects(() => microphone.record(1), /start failed/)

  assert.equal(microphone.recording, false)
})
