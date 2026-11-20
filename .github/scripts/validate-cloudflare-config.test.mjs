import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateCloudflareConfig } from './validate-cloudflare-config.mjs'

const validConfig = {
  CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  CLOUDFLARE_API_TOKEN: 'secret',
  CLOUDFLARE_PAGES_PROJECT: 'stack-chan-pr-preview',
}

test('accepts the required Cloudflare Pages configuration', () => {
  assert.doesNotThrow(() => validateCloudflareConfig(validConfig))
})

test('rejects missing and malformed Cloudflare Pages configuration', () => {
  assert.throws(() => validateCloudflareConfig({}), /CLOUDFLARE_ACCOUNT_ID is not configured/)
  assert.throws(
    () => validateCloudflareConfig({ ...validConfig, CLOUDFLARE_ACCOUNT_ID: 'not-an-id' }),
    /32-character hexadecimal ID/
  )
  assert.throws(
    () => validateCloudflareConfig({ ...validConfig, CLOUDFLARE_PAGES_PROJECT: 'Invalid/project' }),
    /unsupported characters/
  )
})
