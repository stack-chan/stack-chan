export function normRand(m: number, s: number): number {
  const a = 1 - Math.random()
  const b = 1 - Math.random()
  const c = Math.sqrt(-2 * Math.log(a))
  if (0.5 - Math.random() > 0) {
    return c * Math.sin(Math.PI * 2 * b) * s + m
  } else {
    return c * Math.cos(Math.PI * 2 * b) * s + m
  }
}

export function randomBetween(min: number, max: number): number {
  return min + (max - min) * Math.random()
}

export function quantize(value: number, divider: number): number {
  return Math.ceil(value * divider) / divider
}
