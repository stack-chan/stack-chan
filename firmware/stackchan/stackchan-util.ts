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

export type Vector3 = [number, number, number]

export const Vector3 = Object.freeze({
  // NOTE: both v1 and v2 has three numbers so below returns also certainly Vector3
  add(v1: Vector3, v2: Vector3): Vector3 {
    return v1.map((v, idx) => v + v2[idx]) as Vector3
  },
  sub(v1: Vector3, v2: Vector3): Vector3 {
    return v1.map((v, idx) => v - v2[idx]) as Vector3
  },
  multiply(v: Vector3, scala: number): Vector3 {
    return v.map(v => v * scala) as Vector3
  },
  rotate(v: Vector3, rot: Rotation): Vector3 {
    const [x, y, z] = v
    const cosY = Math.cos(rot.y)
    const sinY = Math.sin(rot.y)
    const yawRotated = {
      x: x * cosY - y * sinY,
      y: x * sinY + y * cosY,
      z: z,
    }
    const cosP = Math.cos(rot.p)
    const sinP = Math.sin(rot.p)
    return [
      yawRotated.x * cosP - yawRotated.z * sinP,
      yawRotated.y,
      yawRotated.x * sinP + yawRotated.z * cosP,
    ]
  }
})

export type Rotation = {
  r: number // radian
  p: number // radian
  y: number // radian
}

export type Position = {
  x: number // meter
  y: number // meter
  z: number // meter
}

export type Pose = {
  position: Position
  rotation: Rotation
}

export const Rotation = Object.freeze({
  fromVector3(v: Vector3): Rotation {
    const yaw = Math.atan2(v[1], v[0])
    const pitch = - Math.atan2(v[2], Math.sqrt(Math.pow(v[0], 2) + Math.pow(v[0], 2)))
    return {
      y: yaw,
      p: pitch,
      r: 0,
    }
  }
})

export function toRadian(deg: number) {
  return (deg * Math.PI) / 180
}

export function toDegree(rad: number) {
  return (rad * 180) / Math.PI
}
