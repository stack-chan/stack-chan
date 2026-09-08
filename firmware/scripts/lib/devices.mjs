import { TARGETS } from '../../contracts/targets.js'

export const devices = Object.fromEntries(
  Object.entries(TARGETS)
    .filter(([, profile]) => profile.deviceInstall)
    .map(([id, profile]) => [
      profile.buildName,
      {
        ...profile,
        id,
        manifest: `./${profile.manifest}`,
        esptoolChip: profile.chip,
        firmwareVersionSource: 'moddable',
      },
    ]),
)

export const aliases = {
  default: 'm5stackchan_cores3',
  m5stackchan: 'm5stackchan_cores3',
  rt: 'stackchan_rt',
  takao: 'takao_core2_sg90',
}

export function resolveDevice(value, prefix = '[stack-chan]') {
  const name = aliases[value] ?? value
  if (devices[name]) return name
  console.error(`${prefix} Unknown device: ${value}`)
  console.error(`${prefix} Supported devices: ${Object.keys(devices).join(', ')}`)
  process.exit(1)
}
