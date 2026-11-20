#!/usr/bin/env node

import { buildFirmwareBundleTarget } from './lib/firmware-bundle.mjs'

const target = process.argv[2]
if (!target || process.argv.length !== 3) {
  console.error('[stack-chan] use a named npm run build:release:<target> script')
  process.exit(1)
}

try {
  buildFirmwareBundleTarget(target)
} catch (error) {
  console.error(`[stack-chan] firmware bundle target failed: ${error.message}`)
  process.exit(1)
}
