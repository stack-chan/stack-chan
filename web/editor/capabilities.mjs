import { assertTargetIdentity } from '../../firmware/contracts/mod-package.js'
import { TARGETS } from '../../firmware/contracts/targets.js'
import { isXsVersionCompatible, XS_ARCHIVE_VERSION_RANGE } from '../../firmware/contracts/xs-compatibility.js'
import { t } from '../i18n.mjs'

import { CAPABILITY_HOST_API_VERSIONS } from '../../firmware/contracts/capabilities.js'
export { CAPABILITY_HOST_API_VERSIONS }

export const DEVICE_PROFILES = Object.freeze(
  Object.fromEntries(
    Object.entries(TARGETS).map(([id, profile]) => [
      id,
      {
        ...profile,
        status: id === 'portable' ? 'experimental' : 'supported',
        xsArchiveVersion: id === 'portable' ? null : [17, 8, 2],
        xsArchiveVersionRange: id === 'portable' ? null : XS_ARCHIVE_VERSION_RANGE,
        firmwareVersionPrefixes: id === 'portable' ? [] : ['9.5.'],
        chipPatterns: profile.chip ? [profile.chip === 'esp32s3' ? 'ESP32-S3' : 'ESP32'] : [],
        entrypoints: ['mod'],
      },
    ])
  )
)

export const BLOCK_CAPABILITIES = Object.freeze({
  stackchan_on_button: ['input.primary'],
  stackchan_on_imu: ['input.motion'],
  stackchan_on_head_touch: ['input.headTouch'],
  stackchan_on_drawer_button: ['ui.controls'],
  stackchan_set_emotion: ['face'],
  stackchan_set_color: ['face'],
  stackchan_set_mouth: ['face'],
  stackchan_say: ['audio.speech'],
  stackchan_sing_score: ['audio.singing'],
  stackchan_song_note_tuple: ['audio.singing'],
  stackchan_song_rest_tuple: ['audio.singing'],
  stackchan_show_balloon: ['ui.controls'],
  stackchan_hide_balloon: ['ui.controls'],
  stackchan_tone: ['audio.tone'],
  stackchan_look_at: ['motion'],
  stackchan_look_away: ['motion'],
  stackchan_set_torque: ['motion'],
  stackchan_set_pose: ['motion'],
  stackchan_light_on: ['lighting'],
  stackchan_light_off: ['lighting'],
  stackchan_light_rainbow: ['lighting'],
  stackchan_light_blink: ['lighting'],
  stackchan_drawer_control: ['ui.controls'],
  stackchan_show_face: ['face'],
})

export function profileFor(target) {
  const profile = DEVICE_PROFILES[target]
  if (!profile) throw new Error(`Unknown device target: ${target}`)
  return profile
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
  {
    chip,
    xsVersion,
    firmwareVersion,
    firmwareTarget,
    hostApiVersion = 0,
    entrypoints = ['mod'],
    requirements = [],
    requireFirmware = false,
    requireTarget = requireFirmware,
    requireArchive = false,
  } = {}
) {
  const profile = profileFor(target)
  const diagnostics = []
  if (requireTarget && profile.deviceInstall) {
    try {
      assertTargetIdentity(firmwareTarget, target)
    } catch (error) {
      diagnostics.push({ code: error.code, message: error.message })
    }
  }
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
  const unsupportedCapabilities = [...new Set(requirements)].filter(
    (capability) => !profile.capabilities.includes(capability)
  )
  if (unsupportedCapabilities.length) {
    diagnostics.push({
      code: 'VP_UNSUPPORTED_CAPABILITY',
      message: t('{profile}は「{capability}」に対応していません', {
        profile: t(profile.label),
        capability: unsupportedCapabilities.join(', '),
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
    } else if (xsVersion !== undefined && !isXsVersionCompatible(xsVersion, profile.xsArchiveVersionRange)) {
      const detectedXsVersion = Array.isArray(xsVersion) ? xsVersion.join('.') : t('不明')
      diagnostics.push({
        code: 'VP_XS_VERSION_MISMATCH',
        message: t('{profile}のXS {expected}に対して、MODはXS {actual}です', {
          profile: t(profile.label),
          expected: `${profile.xsArchiveVersionRange.slice(0, 2).join('.')}–${profile.xsArchiveVersionRange.slice(2).join('.')}`,
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
        message: t(
          'ファームウェア {firmwareVersion} は、{profile}の対応範囲（{prefixes}系）に含まれません。ホストファームウェアを更新してください',
          {
            firmwareVersion,
            profile: t(profile.label),
            prefixes: profile.firmwareVersionPrefixes.join(', '),
          }
        ),
      })
    }
  }
  if (requireFirmware) {
    const detectedHostApiVersion = Number.isSafeInteger(hostApiVersion) && hostApiVersion >= 0 ? hostApiVersion : 0
    const unavailableCapabilities = [...new Set(requirements)].filter(
      (capability) =>
        profile.capabilities.includes(capability) &&
        (CAPABILITY_HOST_API_VERSIONS[capability] ?? 0) > detectedHostApiVersion
    )
    if (unavailableCapabilities.length) {
      const requiredHostApiVersion = Math.max(
        ...unavailableCapabilities.map((capability) => CAPABILITY_HOST_API_VERSIONS[capability])
      )
      diagnostics.push({
        code: 'VP_HOST_CAPABILITY_UNAVAILABLE',
        message: t(
          'ファームウェア {firmwareVersion} のhost API {actual}では「{capabilities}」を利用できません（API {required}以上が必要です）。host firmwareを更新してください',
          {
            firmwareVersion: firmwareVersion ?? t('不明'),
            actual: detectedHostApiVersion,
            capabilities: unavailableCapabilities.join(', '),
            required: requiredHostApiVersion,
          }
        ),
      })
    }
  }
  return { compatible: diagnostics.length === 0, profile, diagnostics }
}
