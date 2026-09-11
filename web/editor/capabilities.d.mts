import type { CapabilityId } from '../../firmware/contracts/capabilities.js'
export { CAPABILITY_HOST_API_VERSIONS } from '../../firmware/contracts/capabilities.js'
export type Capability = CapabilityId

export type DeviceProfile = {
  label: string
  status: 'supported' | 'experimental'
  deviceInstall: boolean
  xsArchiveVersion: readonly number[] | null
  xsArchiveVersionRange: readonly [number, number, number, number] | null
  firmwareVersionPrefixes: readonly string[]
  chipPatterns: readonly string[]
  entrypoints: readonly 'mod'[]
  capabilities: readonly Capability[]
}

export const DEVICE_PROFILES: Readonly<Record<string, DeviceProfile>>

export const BLOCK_CAPABILITIES: Readonly<Record<string, readonly Capability[]>>

export type DeploymentCompatibilityOptions = {
  chip?: string
  xsVersion?: readonly number[] | null
  firmwareTarget?: string | null
  requireTarget?: boolean
  firmwareVersion?: string
  hostApiVersion?: number
  entrypoints?: readonly 'mod'[]
  requirements?: readonly string[]
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
