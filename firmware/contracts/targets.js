import { CAPABILITY_IDS } from './capabilities.js'

/** @typedef {import('./capabilities.js').CapabilityId} CapabilityId */
/** @typedef {{
 * label: string, code?: string, buildName?: string, chip?: string,
 * platform?: string, manifest?: string, sdkconfigTarget?: string, bundleId?: string,
 * capabilities: readonly CapabilityId[], deviceInstall: boolean
 * }} TargetProfile */

// These lists describe implementations a target can provide. Connections, user
// settings and exclusive resource ownership are checked by the running host.
const nativeCapabilities = CAPABILITY_IDS.filter((id) => id !== 'conversation.remote')
const core2Capabilities = nativeCapabilities.filter((id) => id !== 'camera' && id !== 'input.headTouch')
const simulatorCapabilities = CAPABILITY_IDS.filter((id) =>
  [
    'face',
    'audio.speech',
    'audio.singing',
    'audio.tone',
    'audio.clips',
    'audio.recording',
    'audio.playback',
    'motion',
    'input.primary',
    'input.secondary',
    'input.tertiary',
    'camera',
    'settings',
    'ui.piu',
    'ui.controls',
    'input.primary.release',
    'input.secondary.release',
    'input.tertiary.release',
  ].includes(id),
)

/** Canonical metadata IDs, firmware descriptor codes and supported build targets. */
export const TARGETS = Object.freeze(
  /** @type {Record<string, TargetProfile>} */ ({
    m5stack: {
      label: 'M5Stack',
      code: 'm5',
      buildName: 'm5stack',
      chip: 'esp32',
      platform: 'esp32/m5stack',
      manifest: 'host/app/manifest.json',
      bundleId: 'com.m5stack',
      capabilities: core2Capabilities,
      deviceInstall: true,
    },
    'm5stack-core2': {
      label: 'M5Stack Core2',
      code: 'c2',
      buildName: 'm5stack_core2',
      chip: 'esp32',
      platform: 'esp32/m5stack_core2',
      manifest: 'host/app/manifest.json',
      sdkconfigTarget: 'm5stack_core2',
      bundleId: 'com.m5stack.core2',
      capabilities: core2Capabilities,
      deviceInstall: true,
    },
    'm5stack-cores3': {
      label: 'M5Stack CoreS3',
      code: 'c3',
      buildName: 'm5stack_cores3',
      chip: 'esp32s3',
      platform: 'esp32/m5stack_cores3',
      manifest: 'host/app/manifest.json',
      sdkconfigTarget: 'm5stack_cores3',
      bundleId: 'com.m5stack.cores3',
      capabilities: nativeCapabilities,
      deviceInstall: true,
    },
    'm5stackchan-cores3': {
      label: 'M5StackChan CoreS3',
      code: 'sc3',
      buildName: 'm5stackchan_cores3',
      chip: 'esp32s3',
      platform: 'esp32:./host/platforms/m5stackchan_cores3',
      manifest: 'host/app/manifest_m5stackchan_cores3.json',
      sdkconfigTarget: 'm5stack_cores3',
      bundleId: 'm5stackchan_cores3',
      capabilities: CAPABILITY_IDS,
      deviceInstall: true,
    },
    'stackchan-rt': {
      label: 'Stack-chan RT CoreS3',
      code: 'rt',
      buildName: 'stackchan_rt',
      chip: 'esp32s3',
      platform: 'esp32:./host/platforms/stackchan_rt',
      manifest: 'host/app/manifest_stackchan_rt.json',
      sdkconfigTarget: 'm5stack_cores3',
      capabilities: nativeCapabilities,
      deviceInstall: true,
    },
    'takao-core2-sg90': {
      label: 'Stack-chan Takao Core2 + SG90',
      code: 't2',
      buildName: 'takao_core2_sg90',
      chip: 'esp32',
      platform: 'esp32:./host/platforms/takao_core2_sg90',
      manifest: 'host/app/manifest_takao_core2_sg90.json',
      sdkconfigTarget: 'm5stack_core2',
      capabilities: core2Capabilities,
      deviceInstall: true,
    },
    simulator: {
      label: 'Webシミュレーター',
      platform: 'wasm',
      manifest: 'host/app/manifest_wasm.json',
      capabilities: simulatorCapabilities,
      deviceInstall: false,
    },
    portable: {
      label: '機種を限定しない',
      deviceInstall: false,
      capabilities: ['face', 'audio.speech', 'audio.tone', 'motion', 'ui.controls', 'input.primary'],
    },
  }),
)
for (const profile of Object.values(TARGETS)) {
  Object.freeze(profile.capabilities)
  Object.freeze(profile)
}

/** @param {unknown} id @returns {TargetProfile | undefined} */
export function targetProfile(id) {
  return typeof id === 'string' && Object.hasOwn(TARGETS, id) ? TARGETS[id] : undefined
}

/** @param {string} name */
export function targetForBuild(name) {
  const entry = Object.entries(TARGETS).find(([, profile]) => profile.buildName === name)
  if (!entry) throw new Error(`Unknown build target: ${name}`)
  return { id: entry[0], ...entry[1] }
}

/** Decode the board identity recorded by the build, never infer a board from a chip. @param {string} code */
export function targetForCode(code) {
  return Object.keys(TARGETS).find((id) => TARGETS[id].code === code)
}
