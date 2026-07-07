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
})

test('authorizeMCPRequest rejects an invalid bearer token', () => {
  assert.deepEqual(authorizeMCPRequest('Bearer wrong-token', 'secret-token'), {
    authorized: false,
    reason: 'invalid-authorization',
  })
})

test('authorizeMCPRequest rejects requests when no token is configured', () => {
  assert.deepEqual(authorizeMCPRequest('Bearer secret-token', undefined), {
    authorized: false,
    reason: 'token-not-configured',
  })
})

test('normalizeMCPToken treats blank strings as unconfigured', () => {
  assert.equal(normalizeMCPToken('  '), undefined)
})
