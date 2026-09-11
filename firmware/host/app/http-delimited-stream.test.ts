import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { writeAliasPackageSubpath } from '../modules/testing/node-alias-package.js'

async function setup() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  writeAliasPackageSubpath(root, 'stackchan', 'errors', resolve(root, '../sdk/errors.js'))
  return import('./http-delimited-stream.js')
}
test('continuous HTTP framing survives split UTF-8, split JSON and several messages per chunk', async () => {
  const { DelimitedTextStream } = await setup()
  const messages: string[] = []
  const decoder = new TextDecoder()
  const frame = new DelimitedTextStream(
    '|',
    128,
    (bytes) => decoder.decode(bytes),
    (message) => messages.push(message),
  )
  const bytes = new TextEncoder().encode('{"face":"顔"}|{"face":[]}|')
  for (let index = 0; index < 14; index++) frame.push(bytes.buffer.slice(index, index + 1))
  frame.push(bytes.buffer.slice(14))
  assert.deepEqual(messages, ['{"face":"顔"}', '{"face":[]}'])
})
test('the stream bounds each message and reuses the buffer across completed frames', async () => {
  const { DelimitedTextStream } = await setup()
  const messages: string[] = []
  const frame = new DelimitedTextStream(
    '|',
    3,
    (bytes) => new TextDecoder().decode(bytes),
    (text) => messages.push(text),
  )
  frame.push(new TextEncoder().encode('abc|ab|').buffer)
  assert.deepEqual(messages, ['abc', 'ab'])
  assert.throws(() => frame.push(new TextEncoder().encode('abcd').buffer), { code: 'IO' })
})
