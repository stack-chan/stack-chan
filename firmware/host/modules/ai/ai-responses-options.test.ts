import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { writeAliasPackage } from '../testing/node-alias-package.js'

const directory = dirname(fileURLToPath(import.meta.url))
for (const name of ['ai-core', 'ai-image', 'ai-wire'])
  writeAliasPackage(resolve(directory, '../../..'), 'stackchan-' + name, resolve(directory, name + '.js'))
const { prepareBody } = await import('./ai-responses.js')
ArrayBuffer.fromString ??= (value: string) => new TextEncoder().encode(value).buffer as ArrayBuffer

test('stateless Responses requests omit optional reasoning-only fields and replay opaque reasoning', () => {
  const reasoning = { type: 'reasoning', id: 'r', encrypted_content: 'sealed' }
  for (const model of ['gpt-4o-mini', 'gpt-5']) {
    const body = prepareBody(
      { input: [{ type: 'provider_item', provider: 'openai', id: 'r', value: reasoning }] },
      model,
      'openai',
      4096,
    )
    const wire = JSON.parse(Buffer.concat([...body.read()]).toString())
    assert.equal(wire.model, model)
    assert.equal(wire.store, false)
    assert.equal(wire.include, undefined)
    assert.deepEqual(wire.input, [reasoning])
  }
})
