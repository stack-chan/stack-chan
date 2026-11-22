import Native from 'sanotts-native'
import { mono, readSource } from 'stackchan/voice/media'
import { createSanoTTS } from 'stackchan/voice/sanotts'
import { createVoiceScope, deferred } from 'stackchan/voice/scope'
import { equal } from 'testing/assert'

async function run() {
  const tts = createSanoTTS()
  const scope = createVoiceScope()
  const args = { signal: scope.signal, format: mono(24000), voice: 'default' }
  const synthesis = await tts.open(args)
  const gate = deferred<void>()
  const started = deferred<void>()
  let count = 0
  let firstBuffer: ArrayBufferLike | undefined
  readSource(synthesis.output, (bytes) => {
    firstBuffer ??= bytes.buffer
    equal(bytes.buffer, firstBuffer)
    for (const sample of new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2)) equal(sample, count++)
    if (count === 1024) {
      started.resolve()
      return gate.promise
    }
  })
  await synthesis.write('挨')
  await synthesis.write('拶')
  const done = synthesis.endInput()
  await started.promise
  equal(count, 1024)
  equal(Native.reads, 1)
  gate.resolve()
  await done
  equal(Native.lastKana, 'こんにちは')
  equal(count, 5007)
  equal(Native.active, 0)
  const pending = await tts.openKana(args)
  const held = deferred<void>()
  const playing = deferred<void>()
  readSource(pending.output, () => {
    playing.resolve()
    return held.promise
  })
  await pending.write('かな')
  const cancelled = pending.endInput().then(
    () => false,
    () => true,
  )
  await playing.promise
  scope.abort()
  await pending.close()
  equal(await cancelled, true)
  equal(Native.lastKana, 'かな')
  equal(Native.active, 0)
  held.resolve()
  const again = await tts.openKana({ ...args, ...createVoiceScope() })
  await again.write('missing-model')
  equal(
    await again.endInput().then(
      () => '',
      (e) => e.message,
    ),
    'model not installed',
  )
  equal(Native.active, 0)
  const retry = await tts.openKana({ ...args, ...createVoiceScope() })
  await retry.write('あ')
  await retry.endInput()
  equal(Native.lastKana, 'あ')
  equal(Native.active, 0)
  const custom = createSanoTTS({ toKana: (text) => (text === '電車' ? 'でんしゃ' : '') })
  const train = await custom.open({ ...args, ...createVoiceScope() })
  await train.write('電車')
  await train.endInput()
  equal(Native.lastKana, 'でんしゃ')
  const invalidReader = createSanoTTS({ toKana: () => ({ includes: () => false }) as unknown as string })
  const invalidReading = await invalidReader.open({ ...args, ...createVoiceScope() })
  await invalidReading.write('あ')
  equal(
    await invalidReading.endInput().then(
      () => false,
      (cause) => cause instanceof TypeError,
    ),
    true,
  )
  equal(Native.active, 0)
  for (const action of ['close', 'abort']) {
    const stopping = createVoiceScope()
    const provider = createSanoTTS({
      toKana() {
        if (action === 'close') void session.close()
        else stopping.abort()
        return 'あ'
      },
    })
    const session = await provider.open({ ...args, signal: stopping.signal })
    await session.write('あ')
    equal(
      await session.endInput().then(
        () => 'played',
        (cause) => cause.code,
      ),
      'cancelled',
    )
    await session.close()
    equal(Native.active, 0)
  }
  const releaseFailure = await tts.openKana({ ...args, ...createVoiceScope() })
  Native.failClose = true
  await releaseFailure.write('かな')
  equal(await releaseFailure.endInput().catch((error) => error.message), 'native close failed')
  equal(await releaseFailure.close().catch((error) => error.message), 'native close failed')
  Native.failClose = false
}
run().then(
  () => trace('@@STACKCHAN_TEST:PASS@@\n'),
  (e) => {
    throw e
  },
)
