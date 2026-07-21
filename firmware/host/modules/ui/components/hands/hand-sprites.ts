/** Fixed cells let the renderer switch authored poses without runtime scaling or layout. */
export const HAND_SPRITE_CELL_SIZE = 88
export const HAND_SPRITE_ATLAS_WIDTH = HAND_SPRITE_CELL_SIZE * 8
export const HAND_SPRITE_ATLAS_HEIGHT = HAND_SPRITE_CELL_SIZE * 10
export const HAND_ROTATION_UNITS_PER_TURN = 8192

const HAND_DIRECTION_COUNT = 8
const HAND_ROTATION_UNITS_PER_DIRECTION = HAND_ROTATION_UNITS_PER_TURN / HAND_DIRECTION_COUNT
const TAU = Math.PI * 2

export type Handedness = 'left' | 'right'
export type HandSpriteState = 'fist' | 'point' | 'peace' | 'open' | 'side-open'
export type HandDirection = 'up' | 'up-right' | 'right' | 'down-right' | 'down' | 'down-left' | 'left' | 'up-left'

const HAND_DIRECTIONS: readonly HandDirection[] = [
  'up',
  'up-right',
  'right',
  'down-right',
  'down',
  'down-left',
  'left',
  'up-left',
]

function wrapRotationUnits(rotationUnits: number): number {
  const wrapped = rotationUnits % HAND_ROTATION_UNITS_PER_TURN
  return wrapped < 0 ? wrapped + HAND_ROTATION_UNITS_PER_TURN : wrapped
}

/** Convert a clockwise screen rotation in radians to Timeline-friendly integer units. */
export function handRotationUnits(rotation: number): number {
  return Math.round((rotation * HAND_ROTATION_UNITS_PER_TURN) / TAU)
}

/** Resolve a target rotation to the equivalent angle nearest to the current unwrapped angle. */
export function nearestHandRotationUnits(fromUnits: number, targetRotation: number): number {
  const targetUnits = handRotationUnits(targetRotation)
  const halfTurn = HAND_ROTATION_UNITS_PER_TURN / 2
  let delta = (targetUnits - fromUnits) % HAND_ROTATION_UNITS_PER_TURN
  if (delta > halfTurn) delta -= HAND_ROTATION_UNITS_PER_TURN
  else if (delta < -halfTurn) delta += HAND_ROTATION_UNITS_PER_TURN
  return fromUnits + delta
}

/** Quantize an unwrapped rotation to one of the eight authored sprite directions. */
export function handSpriteColumnFromRotationUnits(rotationUnits: number): number {
  const centered = wrapRotationUnits(rotationUnits + HAND_ROTATION_UNITS_PER_DIRECTION / 2)
  return Math.floor(centered / HAND_ROTATION_UNITS_PER_DIRECTION) % HAND_DIRECTION_COUNT
}

export function handDirectionFromRotationUnits(rotationUnits: number): HandDirection {
  return HAND_DIRECTIONS[handSpriteColumnFromRotationUnits(rotationUnits)]
}

export function handSpriteColumn(direction: HandDirection): number {
  switch (direction) {
    case 'up':
      return 0
    case 'up-right':
      return 1
    case 'right':
      return 2
    case 'down-right':
      return 3
    case 'down':
      return 4
    case 'down-left':
      return 5
    case 'left':
      return 6
    case 'up-left':
      return 7
  }
}

export function handSpriteRow(handedness: Handedness, state: HandSpriteState): number {
  const handednessOffset = handedness === 'left' ? 5 : 0
  switch (state) {
    case 'fist':
      return handednessOffset
    case 'point':
      return handednessOffset + 1
    case 'peace':
      return handednessOffset + 2
    case 'open':
      return handednessOffset + 3
    case 'side-open':
      return handednessOffset + 4
  }
}
