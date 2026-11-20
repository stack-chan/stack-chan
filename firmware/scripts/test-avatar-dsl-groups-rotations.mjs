// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

// Each SDK rotation rewrites the same managed test module. Keep builds serial.
for (const rotation of [0, 90, 180, 270]) {
  const result = spawnSync(process.execPath, ['scripts/test-avatar-dsl-groups-render.mjs', String(rotation)], {
    stdio: 'inherit',
  })
  assert.equal(result.status, 0, `rotation ${rotation}`)
}
