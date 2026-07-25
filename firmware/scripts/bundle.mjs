#!/usr/bin/env node

import {
  buildFirmwareBundleTarget,
  firmwareBundleTargets,
  packageFirmwareBundle,
  resetFirmwareBundleStagingDirectory,
} from './lib/firmware-bundle.mjs'

try {
  resetFirmwareBundleStagingDirectory()
  for (const target of firmwareBundleTargets) buildFirmwareBundleTarget(target.name)
  packageFirmwareBundle()
} catch (error) {
  console.error(`[stack-chan] firmware bundle failed: ${error.message}`)
  process.exit(1)
}
