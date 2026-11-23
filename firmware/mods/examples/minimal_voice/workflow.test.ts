import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { ConversationPipeline, TurnResult } from 'stackchan/voice'

type WorkflowModule = typeof import('./workflow.js')

function linkPackage(root: string, name: string, target: string): void {
  const pkgDir = resolve(root, 'node_modules', name)
  mkdirSync(pkgDir, { recursive: true })
  const rel = relative(pkgDir, target).replaceAll('\\', '/')
  writeFileSync(`${pkgDir}/index.js`, `export * from ${JSON.stringify(rel.startsWith('.') ? rel : `./${rel}`)};\n`)
  writeFileSync(`${pkgDir}/package.json`, JSON.stringify({ type: 'module', exports: './index.js' }))
}

function installAliases(): void {
  const distRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
  linkPackage(distRoot, 'stackchan-result', resolve(distRoot, 'host/modules/util/result.js'))
}

installAliases()
const { isErr, isOk } = await import('stackchan-result')

function fixture() {
  const calls: string[] = []
  const pending: ((result: TurnResult) => void)[] = []
  let closed = false
  const pipeline: ConversationPipeline = {
    capabilities: {
      textInput: true,
      imageInput: false,
      inputRoles: ['user'],
      interruption: 'remote-cancel',
      interruptionReuse: 'reusable',
      historyRepair: 'truncate',
      turnControl: 'client',
      submitCompletion: 'playback',
    },
    async start() {
      calls.push('start')
    },
    async setMicrophoneMuted(value) {
      calls.push(`muted:${value}`)
    },
    setVolume() {},
    async submit(message) {
      calls.push(message.content[0].type === 'input_text' ? message.content[0].text : 'image')
      return {
        completion: 'playback',
        id: String(pending.length + 1),
        done: new Promise<TurnResult>((resolve) => pending.push(resolve)),
      }
    },
    async interrupt() {
      return { playback: [], remote: 'cancelled', history: 'aligned' }
    },
    async close(options) {
      if (!closed) calls.push(`close:${options?.mode ?? 'abort'}`)
      closed = true
      return { reason: 'drained', remoteFinalization: 'not-required' }
    },
  }
  return { pipeline, pending, calls }
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

test('minimal example waits for each response playback before sending or closing', async () => {
  installAliases()
  const { runTextConversation } = (await import('./workflow.js')) as WorkflowModule
  const { pipeline, pending, calls } = fixture()
  const running = runTextConversation(pipeline, ['first', 'second'])
  await tick()
  assert.deepEqual(calls, ['muted:true', 'start', 'first'])
  pending[0]({ turnId: '1', status: 'completed' })
  await tick()
  assert.deepEqual(calls, ['muted:true', 'start', 'first', 'second'])
  pending[1]({ turnId: '2', status: 'completed' })
  const result = await running
  assert.equal(isOk(result), true)
  if (isOk(result)) {
    assert.deepEqual(result.value, { reason: 'drained', remoteFinalization: 'not-required' })
  }
  assert.deepEqual(calls, ['muted:true', 'start', 'first', 'second', 'close:drain'])
})

test('minimal example aborts after a failed turn and does not send the next prompt', async () => {
  installAliases()
  const { formatVoiceExampleError, runTextConversation } = (await import('./workflow.js')) as WorkflowModule
  const { pipeline, pending, calls } = fixture()
  const running = runTextConversation(pipeline, ['first', 'second'])
  await tick()
  pending[0]({ turnId: '1', status: 'failed' })
  const result = await running
  assert.equal(isErr(result), true)
  if (isErr(result)) {
    assert.deepEqual(result.error, { kind: 'turn-incomplete', turnId: '1', status: 'failed' })
    assert.equal(formatVoiceExampleError(result.error), 'Turn 1: failed')
  }
  assert.deepEqual(calls, ['muted:true', 'start', 'first', 'close:abort'])
})

test('minimal example closes even when startup fails', async () => {
  installAliases()
  const { formatVoiceExampleError, runTextConversation } = (await import('./workflow.js')) as WorkflowModule
  const { pipeline, calls } = fixture()
  pipeline.start = async () => {
    throw new Error('unavailable')
  }
  const result = await runTextConversation(pipeline, ['first'])
  assert.equal(isErr(result), true)
  if (isErr(result)) {
    assert.equal(result.error.kind, 'startup-failed')
    assert.equal(formatVoiceExampleError(result.error), 'unavailable')
  }
  assert.deepEqual(calls, ['muted:true', 'close:abort'])
})

test('minimal example returns playback-completion-unsupported and closes cleanly when unsupported', async () => {
  installAliases()
  const { runTextConversation } = (await import('./workflow.js')) as WorkflowModule
  const { pipeline, calls } = fixture()
  const unsupportedPipeline: ConversationPipeline = {
    ...pipeline,
    capabilities: {
      ...pipeline.capabilities,
      submitCompletion: 'unavailable',
    },
  }
  const result = await runTextConversation(unsupportedPipeline, ['first'])
  assert.equal(isErr(result), true)
  if (isErr(result)) {
    assert.deepEqual(result.error, { kind: 'playback-completion-unsupported' })
  }
  assert.deepEqual(calls, ['close:abort'])
})

test('minimal example returns close-failed Err instead of rejecting when drain close rejects', async () => {
  installAliases()
  const { formatVoiceExampleError, runTextConversation } = (await import('./workflow.js')) as WorkflowModule
  const { pipeline, pending, calls } = fixture()
  let closePromise: Promise<never> | undefined
  pipeline.close = (options) => {
    calls.push(`close:${options?.mode ?? 'abort'}`)
    closePromise ??= Promise.reject(new Error('drain timeout'))
    return closePromise
  }

  const running = runTextConversation(pipeline, ['first'])
  await tick()
  pending[0]({ turnId: '1', status: 'completed' })
  const result = await running
  assert.equal(isErr(result), true)
  if (isErr(result)) {
    assert.equal(result.error.kind, 'close-failed')
    assert.equal(formatVoiceExampleError(result.error), 'drain timeout')
  }
  assert.deepEqual(calls, ['muted:true', 'start', 'first', 'close:drain'])
})
