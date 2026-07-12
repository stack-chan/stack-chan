export const devices = {
  m5stackchan_cores3: {
    platform: './host/platforms/m5stackchan_cores3',
    manifest: './host/app/manifest_m5stackchan_cores3.json',
    label: 'M5StackChan CoreS3',
  },
  stackchan_rt: {
    platform: './host/platforms/stackchan_rt',
    manifest: './host/app/manifest_stackchan_rt.json',
    label: 'Stack-chan RT CoreS3',
  },
  takao_core2_sg90: {
    platform: './host/platforms/takao_core2_sg90',
    manifest: './host/app/manifest_takao_core2_sg90.json',
    label: 'Stack-chan Takao Core2 + SG90',
  },
}

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
