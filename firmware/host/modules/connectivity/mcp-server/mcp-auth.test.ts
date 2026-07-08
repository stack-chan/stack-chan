import assert from 'node:assert/strict'
import { test } from 'node:test'

import { authorizeMCPRequest, normalizeMCPToken } from './mcp-auth.js'

test('authorizeMCPRequest accepts a matching bearer token', () => {
  assert.deepEqual(authorizeMCPRequest('Bearer secret-token', 'secret-token'), { authorized: true })
})

test('authorizeMCPRequest rejects a missing authorization header', () => {
  assert.deepEqual(authorizeMCPRequest(undefined, 'secret-token'), {
    authorized: false,
    reason: 'missing-authorization',
  })
  assert.deepEqual(authorizeMCPRequest('', 'secret-token'), {
    authorized: false,
    reason: 'missing-authorization',
  })
})

test('authorizeMCPRequest rejects invalid bearer tokens', () => {
  for (const authorization of ['Bearer wrong-token', 'Bearer', 'Basic secret-token']) {
    assert.deepEqual(authorizeMCPRequest(authorization, 'secret-token'), {
      authorized: false,
      reason: 'invalid-authorization',
    })
  }
})

test('authorizeMCPRequest allows requests when no token is configured', () => {
  assert.deepEqual(authorizeMCPRequest(undefined, undefined), { authorized: true })
  assert.deepEqual(authorizeMCPRequest('Bearer secret-token', ''), { authorized: true })
})

test('normalizeMCPToken treats blank strings as unconfigured', () => {
  assert.equal(normalizeMCPToken('  '), undefined)
})
