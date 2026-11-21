import test from 'node:test'
import assert from 'node:assert/strict'
import {museSessionId} from '../session-id.js'
test('Muse side chat uses canonical UUIDv4, not a prefixed opaque ID',()=>{
 const bytes=new Uint8Array(16)
 assert.equal(museSessionId(bytes),'00000000-0000-4000-8000-000000000000')
 assert.deepEqual(bytes,new Uint8Array(16))
 assert.match(museSessionId(new Uint8Array(16).fill(255)),/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
 assert.throws(()=>museSessionId(new Uint8Array(15)))
})
