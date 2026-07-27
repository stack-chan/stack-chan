import { t } from '../i18n.mjs'

export const CAPABILITIES = Object.freeze({
  FACE: 'face',
  SPEECH: 'audio.speech',
  SINGING: 'audio.singing',
  TONE: 'audio.tone',
  MOTION: 'motion',
  LIGHTING: 'lighting',
  BUTTONS: 'input.buttons',
  IMU: 'input.imu',
  HEAD_TOUCH: 'input.headTouch',
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
    entrypoints: ['mod', 'miniapp'],
    capabilities: Object.values(CAPABILITIES),
  },
  simulator: {
    label: 'Webシミュレーター',
    status: 'supported',
    deviceInstall: false,
    xsArchiveVersion: [17, 8, 0],
    firmwareVersionPrefixes: ['8.3.'],
    chipPatterns: [],
    entrypoints: ['mod', 'miniapp'],
    capabilities: [
      CAPABILITIES.FACE,
      CAPABILITIES.SPEECH,
      CAPABILITIES.SINGING,
      CAPABILITIES.TONE,
      CAPABILITIES.MOTION,
      CAPABILITIES.BUTTONS,
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
    entrypoints: ['mod'],
    capabilities: [CAPABILITIES.FACE, CAPABILITIES.SPEECH, CAPABILITIES.TONE, CAPABILITIES.MOTION],
  },
})

export const BLOCK_CAPABILITIES = Object.freeze({
  stackchan_on_button: [CAPABILITIES.BUTTONS],
  stackchan_on_imu: [CAPABILITIES.IMU],
  stackchan_on_head_touch: [CAPABILITIES.HEAD_TOUCH],
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
  { chip, xsVersion, firmwareVersion, entrypoints = ['mod'], requireFirmware = false, requireArchive = false } = {}
) {
  const profile = profileFor(target)
  const diagnostics = []
  const unsupportedEntrypoints = entrypoints.filter((entrypoint) => !profile.entrypoints.includes(entrypoint))
  if (unsupportedEntrypoints.length) {
    diagnostics.push({
      code: 'VP_ARCHIVE_ENTRYPOINT_UNSUPPORTED',
      message: t('{profile}はarchiveの実行入口「{entrypoints}」に対応していません', {
        profile: t(profile.label),
        entrypoints: unsupportedEntrypoints.join(', '),
      }),
    })
  }
  if (requireFirmware && !profile.deviceInstall) {
    diagnostics.push({
      code: 'VP_DEVICE_TARGET_UNSUPPORTED',
      message: t('{profile}はWebSerial実機書き込みの対象ではありません', { profile: t(profile.label) }),
    })
  }
  if (profile.chipPatterns.length) {
    if (requireFirmware && !chip) {
      diagnostics.push({
        code: 'VP_DEVICE_CHIP_MISSING',
        message: t('{profile}の実チップを確認できません', { profile: t(profile.label) }),
      })
    } else if (chip && !profile.chipPatterns.some((pattern) => String(chip).includes(pattern))) {
      diagnostics.push({
        code: 'VP_DEVICE_CHIP_MISMATCH',
        message: t('{profile}の対象チップ（{expected}）と検出結果「{chip}」が一致しません', {
          profile: t(profile.label),
          expected: profile.chipPatterns.join(', '),
          chip,
        }),
      })
    }
  }
  if (profile.xsArchiveVersion) {
    if (requireArchive && xsVersion === undefined) {
      diagnostics.push({
        code: 'VP_XS_VERSION_MISSING',
        message: t('MODのXSバージョンを確認できません'),
      })
    } else if (
      xsVersion !== undefined &&
      (!Array.isArray(xsVersion) || profile.xsArchiveVersion.join('.') !== xsVersion.join('.'))
    ) {
      const detectedXsVersion = Array.isArray(xsVersion) ? xsVersion.join('.') : t('不明')
      diagnostics.push({
        code: 'VP_XS_VERSION_MISMATCH',
        message: t('{profile}のXS {expected}に対して、MODはXS {actual}です', {
          profile: t(profile.label),
          expected: profile.xsArchiveVersion.join('.'),
          actual: detectedXsVersion,
        }),
      })
    }
  }
  if (requireFirmware && profile.firmwareVersionPrefixes.length) {
    if (!firmwareVersion) {
      diagnostics.push({
        code: 'VP_FIRMWARE_VERSION_MISSING',
        message: t('{profile}のファームウェアバージョンを確認できません', { profile: t(profile.label) }),
      })
    } else if (!profile.firmwareVersionPrefixes.some((prefix) => String(firmwareVersion).startsWith(prefix))) {
      diagnostics.push({
        code: 'VP_FIRMWARE_VERSION_MISMATCH',
        message: t('ファームウェア {firmwareVersion} は、{profile}の対応範囲（{prefixes}系）に含まれません', {
          firmwareVersion,
          profile: t(profile.label),
          prefixes: profile.firmwareVersionPrefixes.join(', '),
        }),
      })
    }
  }
  return { compatible: diagnostics.length === 0, profile, diagnostics }
}
