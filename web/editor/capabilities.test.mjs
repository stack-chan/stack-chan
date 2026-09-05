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
  assert.deepEqual(requirementsForBlockTypes(['stackchan_sing_score', 'stackchan_song_note_tuple']), ['audio.singing'])
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

test('deployment compatibility checks chip family and runtime XS archive range', () => {
  assert.equal(
    inspectDeploymentCompatibility('m5stackchan-cores3', {
      chip: 'ESP32-S3',
      xsVersion: [17, 8, 0],
      firmwareVersion: '9.5.0+stackchan.1',
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
    xsVersion: [17, 6, 0],
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
    firmwareVersion: '9.5.0',
    requireFirmware: true,
  })
  assert.deepEqual(
    simulatorInstall.diagnostics.map((item) => item.code),
    ['VP_DEVICE_TARGET_UNSUPPORTED']
  )

  const missingDeviceEvidence = inspectDeploymentCompatibility('m5stackchan-cores3', {
    firmwareVersion: '9.5.0',
    requireFirmware: true,
    requireArchive: true,
  })
  assert.deepEqual(
    missingDeviceEvidence.diagnostics.map((item) => item.code),
    ['VP_DEVICE_CHIP_MISSING', 'VP_XS_VERSION_MISSING']
  )

  const unsupportedEntrypoint = inspectDeploymentCompatibility('portable', {
    entrypoints: ['mod', 'miniapp'],
  })
  assert.deepEqual(
    unsupportedEntrypoint.diagnostics.map((item) => item.code),
    ['VP_ARCHIVE_ENTRYPOINT_UNSUPPORTED']
  )
})

test('deployment compatibility gates versioned capabilities on the detected Stack-chan host API', () => {
  const currentHost = inspectDeploymentCompatibility('m5stackchan-cores3', {
    chip: 'ESP32-S3',
    xsVersion: [17, 8, 0],
    firmwareVersion: '9.5.0+stackchan.1',
    hostApiVersion: 1,
    requirements: ['conversation.remote', 'audio.usb', 'ui.approval'],
    requireFirmware: true,
    requireArchive: true,
  })
  assert.equal(currentHost.compatible, true)

  const legacyHost = inspectDeploymentCompatibility('m5stackchan-cores3', {
    chip: 'ESP32-S3',
    xsVersion: [17, 8, 0],
    firmwareVersion: '9.5.0',
    hostApiVersion: 0,
    requirements: ['conversation.remote', 'audio.usb', 'ui.approval'],
    requireFirmware: true,
    requireArchive: true,
  })
  assert.deepEqual(
    legacyHost.diagnostics.map((item) => item.code),
    ['VP_HOST_CAPABILITY_UNAVAILABLE']
  )
  assert.match(legacyHost.diagnostics[0].message, /host API 0/)

  const legacyBasicMod = inspectDeploymentCompatibility('m5stackchan-cores3', {
    chip: 'ESP32-S3',
    xsVersion: [17, 8, 0],
    firmwareVersion: '9.5.0',
    hostApiVersion: 0,
    requirements: ['face', 'input.headTouch'],
    requireFirmware: true,
    requireArchive: true,
  })
  assert.equal(legacyBasicMod.compatible, true)
})
