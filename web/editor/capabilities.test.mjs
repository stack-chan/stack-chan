import assert from 'node:assert/strict'
import test from 'node:test'

import {
  inspectDeploymentCompatibility,
  requirementsForBlockTypes,
  toolboxForTarget,
  unsupportedRequirements,
} from './capabilities.mjs'

test('capability requirements are unique and target-aware', () => {
  assert.deepEqual(requirementsForBlockTypes(['stackchan_on_imu', 'stackchan_on_imu', 'stackchan_say']), [
    'audio.speech',
    'input.imu',
  ])
  assert.deepEqual(unsupportedRequirements('simulator', ['input.imu', 'face']), ['input.imu'])
  assert.deepEqual(requirementsForBlockTypes(['stackchan_on_head_touch']), ['input.headTouch'])
  assert.deepEqual(unsupportedRequirements('m5stackchan-cores3', ['input.headTouch']), [])
  assert.deepEqual(unsupportedRequirements('simulator', ['input.headTouch']), ['input.headTouch'])
  assert.deepEqual(unsupportedRequirements('portable', ['input.headTouch']), ['input.headTouch'])
})

test('singing blocks are available only on stackchan-voice targets', () => {
  assert.deepEqual(requirementsForBlockTypes(['stackchan_sing_score', 'stackchan_song_note_tuple']), [
    'audio.singing',
  ])
  assert.deepEqual(unsupportedRequirements('m5stackchan-cores3', ['audio.singing']), [])
  assert.deepEqual(unsupportedRequirements('simulator', ['audio.singing']), [])
  assert.deepEqual(unsupportedRequirements('portable', ['audio.singing']), ['audio.singing'])

  const toolbox = {
    contents: [
      {
        contents: [
          { kind: 'block', type: 'stackchan_say' },
          { kind: 'block', type: 'stackchan_sing_score' },
          { kind: 'block', type: 'stackchan_song_note_tuple' },
        ],
      },
    ],
  }
  assert.deepEqual(
    toolboxForTarget(toolbox, 'portable').contents[0].contents.map((entry) => entry.type),
    ['stackchan_say']
  )
})

test('deployment compatibility checks chip family and exact XS archive version', () => {
  assert.equal(
    inspectDeploymentCompatibility('m5stackchan-cores3', {
      chip: 'ESP32-S3',
      xsVersion: [17, 8, 0],
      firmwareVersion: '8.3.0-1-gabcdef',
      requireFirmware: true,
      requireArchive: true,
    }).compatible,
    true
  )
  const wrongChip = inspectDeploymentCompatibility('m5stackchan-cores3', {
    chip: 'ESP32-C3',
    xsVersion: [17, 8, 0],
  })
  assert.deepEqual(
    wrongChip.diagnostics.map((item) => item.code),
    ['VP_DEVICE_CHIP_MISMATCH']
  )
  const wrongXs = inspectDeploymentCompatibility('m5stackchan-cores3', {
    chip: 'ESP32-S3',
    xsVersion: [17, 7, 0],
  })
  assert.deepEqual(
    wrongXs.diagnostics.map((item) => item.code),
    ['VP_XS_VERSION_MISMATCH']
  )
  const malformedXs = inspectDeploymentCompatibility('m5stackchan-cores3', {
    chip: 'ESP32-S3',
    xsVersion: '17.8.0',
  })
  assert.deepEqual(
    malformedXs.diagnostics.map((item) => item.code),
    ['VP_XS_VERSION_MISMATCH']
  )
  assert.match(malformedXs.diagnostics[0].message, /MODはXS 不明です/)
  const wrongFirmware = inspectDeploymentCompatibility('m5stackchan-cores3', {
    chip: 'ESP32-S3',
    xsVersion: [17, 8, 0],
    firmwareVersion: '8.2.1',
    requireFirmware: true,
  })
  assert.deepEqual(
    wrongFirmware.diagnostics.map((item) => item.code),
    ['VP_FIRMWARE_VERSION_MISMATCH']
  )
  const simulatorInstall = inspectDeploymentCompatibility('simulator', {
    firmwareVersion: '8.3.0',
    requireFirmware: true,
  })
  assert.deepEqual(
    simulatorInstall.diagnostics.map((item) => item.code),
    ['VP_DEVICE_TARGET_UNSUPPORTED']
  )

  const missingDeviceEvidence = inspectDeploymentCompatibility('m5stackchan-cores3', {
    firmwareVersion: '8.3.0',
    requireFirmware: true,
    requireArchive: true,
  })
  assert.deepEqual(
    missingDeviceEvidence.diagnostics.map((item) => item.code),
    ['VP_DEVICE_CHIP_MISSING', 'VP_XS_VERSION_MISSING']
  )
})
