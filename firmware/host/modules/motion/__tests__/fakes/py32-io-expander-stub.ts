export function getSharedPY32IOExpander(_options?: { address?: number }) {
  return {
    setDirection(_pin: number, _output: boolean): void {},
    setPullMode(_pin: number, _enabled: boolean): void {},
    digitalWrite(_pin: number, _enabled: boolean): void {},
    getWriteValue(_pin: number): boolean {
      return false
    },
  }
}
