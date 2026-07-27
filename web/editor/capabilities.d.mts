export const CAPABILITIES: Readonly<{
  FACE: 'face'
  SPEECH: 'audio.speech'
  SINGING: 'audio.singing'
  TONE: 'audio.tone'
  MOTION: 'motion'
  LIGHTING: 'lighting'
  BUTTONS: 'input.buttons'
  IMU: 'input.imu'
  HEAD_TOUCH: 'input.headTouch'
  DRAWER: 'ui.drawer'
}>

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES]

export type DeviceProfile = {
  label: string
  status: 'supported' | 'experimental'
  deviceInstall: boolean
  xsArchiveVersion: readonly number[] | null
  firmwareVersionPrefixes: readonly string[]
  chipPatterns: readonly string[]
  entrypoints: readonly ('mod' | 'miniapp')[]
  capabilities: readonly Capability[]
}

export const DEVICE_PROFILES: Readonly<Record<'m5stackchan-cores3' | 'simulator' | 'portable', DeviceProfile>>

export const BLOCK_CAPABILITIES: Readonly<Record<string, readonly Capability[]>>

export type DeploymentCompatibilityOptions = {
  chip?: string
  xsVersion?: readonly number[] | null
  firmwareVersion?: string
  entrypoints?: readonly ('mod' | 'miniapp')[]
  requireFirmware?: boolean
  requireArchive?: boolean
}

export type DeploymentDiagnostic = {
  code: string
  message: string
}

export type DeploymentCompatibility = {
  compatible: boolean
  profile: DeviceProfile
  diagnostics: DeploymentDiagnostic[]
}

export function profileFor(target: string): DeviceProfile
export function requirementsForBlockTypes(blockTypes: readonly string[]): Capability[]
export function unsupportedRequirements(target: string, requirements: readonly Capability[]): Capability[]
export function toolboxForTarget<T>(toolbox: T, target: string): T
export function inspectDeploymentCompatibility(
  target: string,
  options?: DeploymentCompatibilityOptions
): DeploymentCompatibility
