export const CAPABILITIES = Object.freeze({
  FACE: 'face',
  SPEECH: 'audio.speech',
  SINGING: 'audio.singing',
  TONE: 'audio.tone',
  MOTION: 'motion',
  LIGHTING: 'lighting',
  BUTTONS: 'input.buttons',
  IMU: 'input.imu',
  TOUCH: 'input.touch',
  DRAWER: 'ui.drawer',
})

export const DEVICE_PROFILES = Object.freeze({
  'm5stackchan-cores3': {
    label: 'M5Stack-chan CoreS3',
    status: 'supported',
    deviceInstall: true,
    xsArchiveVersion: [17, 8, 0],
    firmwareVersionPrefixes: ['8.3.'],
    chipPatterns: ['ESP32-S3'],
    capabilities: Object.values(CAPABILITIES),
  },
  simulator: {
    label: 'Webシミュレーター',
    status: 'supported',
    deviceInstall: false,
    xsArchiveVersion: [17, 8, 0],
    firmwareVersionPrefixes: ['8.3.'],
    chipPatterns: [],
    capabilities: [
      CAPABILITIES.FACE,
      CAPABILITIES.SPEECH,
      CAPABILITIES.SINGING,
      CAPABILITIES.TONE,
      CAPABILITIES.MOTION,
      CAPABILITIES.BUTTONS,
      CAPABILITIES.TOUCH,
      CAPABILITIES.DRAWER,
    ],
  },
  portable: {
    label: '機種を限定しない',
    status: 'experimental',
    deviceInstall: false,
    xsArchiveVersion: null,
    firmwareVersionPrefixes: [],
    chipPatterns: [],
    capabilities: [CAPABILITIES.FACE, CAPABILITIES.SPEECH, CAPABILITIES.TONE, CAPABILITIES.MOTION],
  },
})

export const BLOCK_CAPABILITIES = Object.freeze({
  stackchan_on_button: [CAPABILITIES.BUTTONS],
  stackchan_on_imu: [CAPABILITIES.IMU],
  stackchan_on_touch: [CAPABILITIES.TOUCH],
  stackchan_on_drawer_button: [CAPABILITIES.DRAWER],
  stackchan_set_emotion: [CAPABILITIES.FACE],
  stackchan_set_color: [CAPABILITIES.FACE],
  stackchan_set_mouth: [CAPABILITIES.FACE],
  stackchan_say: [CAPABILITIES.SPEECH],
  stackchan_sing: [CAPABILITIES.SINGING],
  stackchan_sing_score: [CAPABILITIES.SINGING],
  stackchan_song_note_tuple: [CAPABILITIES.SINGING],
  stackchan_song_rest_tuple: [CAPABILITIES.SINGING],
  stackchan_song_note: [CAPABILITIES.SINGING],
  stackchan_song_rest: [CAPABILITIES.SINGING],
  stackchan_show_balloon: [CAPABILITIES.DRAWER],
  stackchan_hide_balloon: [CAPABILITIES.DRAWER],
  stackchan_tone: [CAPABILITIES.TONE],
  stackchan_look_at: [CAPABILITIES.MOTION],
  stackchan_look_away: [CAPABILITIES.MOTION],
  stackchan_set_torque: [CAPABILITIES.MOTION],
  stackchan_set_pose: [CAPABILITIES.MOTION],
  stackchan_light_on: [CAPABILITIES.LIGHTING],
  stackchan_light_off: [CAPABILITIES.LIGHTING],
  stackchan_light_rainbow: [CAPABILITIES.LIGHTING],
  stackchan_light_blink: [CAPABILITIES.LIGHTING],
  stackchan_drawer_control: [CAPABILITIES.DRAWER],
  stackchan_show_face: [CAPABILITIES.FACE],
})

export function profileFor(target) {
  return DEVICE_PROFILES[target] ?? DEVICE_PROFILES.portable
}

export function requirementsForBlockTypes(blockTypes) {
  return [...new Set(blockTypes.flatMap((type) => BLOCK_CAPABILITIES[type] ?? []))].sort()
}

export function unsupportedRequirements(target, requirements) {
  const supported = new Set(profileFor(target).capabilities)
  return requirements.filter((capability) => !supported.has(capability))
}

export function toolboxForTarget(toolbox, target) {
  const supported = new Set(profileFor(target).capabilities)
  const clone = structuredClone(toolbox)
  for (const category of clone.contents ?? []) {
    if (!Array.isArray(category.contents)) continue
    category.contents = category.contents.filter((entry) => {
      const requirements = BLOCK_CAPABILITIES[entry.type] ?? []
      return requirements.every((capability) => supported.has(capability))
    })
  }
  return clone
}

export function inspectDeploymentCompatibility(
  target,
  { chip, xsVersion, firmwareVersion, requireFirmware = false, requireArchive = false } = {}
) {
  const profile = profileFor(target)
  const diagnostics = []
  if (requireFirmware && !profile.deviceInstall) {
    diagnostics.push({
      code: 'VP_DEVICE_TARGET_UNSUPPORTED',
      message: `${profile.label}はWebSerial実機書き込みの対象ではありません`,
    })
  }
  if (profile.chipPatterns.length) {
    if (requireFirmware && !chip) {
      diagnostics.push({
        code: 'VP_DEVICE_CHIP_MISSING',
        message: `${profile.label}の実チップを確認できません`,
      })
    } else if (chip && !profile.chipPatterns.some((pattern) => String(chip).includes(pattern))) {
      diagnostics.push({
        code: 'VP_DEVICE_CHIP_MISMATCH',
        message: `${profile.label}の対象チップ（${profile.chipPatterns.join(', ')}）と検出結果「${chip}」が一致しません`,
      })
    }
  }
  if (profile.xsArchiveVersion) {
    if (requireArchive && xsVersion === undefined) {
      diagnostics.push({
        code: 'VP_XS_VERSION_MISSING',
        message: 'MODのXSバージョンを確認できません',
      })
    } else if (
      xsVersion !== undefined &&
      (!Array.isArray(xsVersion) || profile.xsArchiveVersion.join('.') !== xsVersion.join('.'))
    ) {
      const detectedXsVersion = Array.isArray(xsVersion) ? xsVersion.join('.') : '不明'
      diagnostics.push({
        code: 'VP_XS_VERSION_MISMATCH',
        message: `${profile.label}のXS ${profile.xsArchiveVersion.join('.')}に対して、MODはXS ${detectedXsVersion}です`,
      })
    }
  }
  if (requireFirmware && profile.firmwareVersionPrefixes.length) {
    if (!firmwareVersion) {
      diagnostics.push({
        code: 'VP_FIRMWARE_VERSION_MISSING',
        message: `${profile.label}のファームウェアバージョンを確認できません`,
      })
    } else if (!profile.firmwareVersionPrefixes.some((prefix) => String(firmwareVersion).startsWith(prefix))) {
      diagnostics.push({
        code: 'VP_FIRMWARE_VERSION_MISMATCH',
        message: `ファームウェア ${firmwareVersion} は、${profile.label}の対応範囲（${profile.firmwareVersionPrefixes.join(', ')}系）に含まれません`,
      })
    }
  }
  return { compatible: diagnostics.length === 0, profile, diagnostics }
}
