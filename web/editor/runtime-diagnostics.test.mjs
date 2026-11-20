import assert from 'node:assert/strict'
import test from 'node:test'
import { parseVisualTrace } from './runtime-diagnostics.mjs'

test('parses structured Visual Programming errors and ignores unrelated trace', () => {
  const record = parseVisualTrace(
    '#stackchan {"schema_version":1,"component":"visual-programming","error_code":"VP_RUNTIME_HANDLER","block_id":"b1"}'
  )
  assert.equal(record.block_id, 'b1')
  assert.equal(parseVisualTrace('[main] start'), null)
})
