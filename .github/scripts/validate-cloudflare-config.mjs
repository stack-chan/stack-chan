#!/usr/bin/env node

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function validateCloudflareConfig(environment = process.env) {
  const required = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_PAGES_PROJECT']
  for (const name of required) {
    if (!environment[name]) throw new Error(`GitHub Actions setting ${name} is not configured`)
  }
  if (!/^[0-9a-f]{32}$/.test(environment.CLOUDFLARE_ACCOUNT_ID)) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID must be a 32-character hexadecimal ID')
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(environment.CLOUDFLARE_PAGES_PROJECT)) {
    throw new Error('CLOUDFLARE_PAGES_PROJECT contains unsupported characters')
  }
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (isMain) {
  try {
    validateCloudflareConfig()
    console.log('Validated Cloudflare Pages configuration')
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : error}`)
    process.exit(1)
  }
}
