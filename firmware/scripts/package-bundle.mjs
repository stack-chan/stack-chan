#!/usr/bin/env node

import { packageFirmwareBundle } from './lib/firmware-bundle.mjs'

if (process.argv.length !== 2) {
  console.error('[stack-chan] usage: npm run bundle:package')
  process.exit(1)
}

try {
  packageFirmwareBundle()
} catch (error) {
  console.error(`[stack-chan] firmware bundle packaging failed: ${error.message}`)
  process.exit(1)
}
