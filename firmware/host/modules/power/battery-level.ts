export type BatteryRegisterReader = (register: number) => number

function isByte(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xff
}

function clampBatteryLevel(level: number): number {
  return Math.min(Math.max(level, 0), 100)
}

export function readAxp2101BatteryLevel(readRegister: BatteryRegisterReader): number | undefined {
  const status = readRegister(0x00)
  if (!isByte(status) || (status & 0x08) === 0) return undefined

  const level = readRegister(0xa4)
  return isByte(level) && level <= 100 ? level : undefined
}

export function readAxp192BatteryLevel(readRegister: BatteryRegisterReader): number | undefined {
  const status = readRegister(0x01)
  if (!isByte(status) || (status & 0x20) === 0) return undefined

  const high = readRegister(0x78)
  const low = readRegister(0x79)
  if (!isByte(high) || !isByte(low)) return undefined

  const millivolts = ((high << 4) | (low & 0x0f)) * 1.1
  const level = Math.trunc(((millivolts - 3300) * 100) / (4150 - 3350))
  return clampBatteryLevel(level)
}

export function readCore2BatteryLevel(readRegister: BatteryRegisterReader): number | undefined {
  const powerIcId = readRegister(0x03)
  if (powerIcId === 0x03) return readAxp192BatteryLevel(readRegister)
  if (powerIcId === 0x4a) return readAxp2101BatteryLevel(readRegister)
  return undefined
}

export function readIp5306BatteryLevel(readRegister: BatteryRegisterReader): number {
  switch (readRegister(0x78) >> 4) {
    case 0x00:
      return 100
    case 0x08:
      return 75
    case 0x0c:
      return 50
    case 0x0e:
      return 25
    default:
      return 0
  }
}
