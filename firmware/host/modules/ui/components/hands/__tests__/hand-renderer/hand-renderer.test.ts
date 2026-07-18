import {
  HAND_ROTATION_UNITS_PER_TURN,
  HAND_SPRITE_ATLAS_HEIGHT,
  HAND_SPRITE_ATLAS_WIDTH,
  HAND_SPRITE_CELL_SIZE,
  type HandDirection,
  type HandSpriteState,
  handDirectionFromRotationUnits,
  handRotationUnits,
  handSpriteColumn,
  handSpriteColumnFromRotationUnits,
  handSpriteRow,
  nearestHandRotationUnits,
} from 'hand-sprites'
import { Texture } from 'piu/MC'
import { assert, equal } from 'testing/assert'

trace('=== hand sprite renderer test ===\n')

const directions: readonly HandDirection[] = [
  'up',
  'up-right',
  'right',
  'down-right',
  'down',
  'down-left',
  'left',
  'up-left',
]
const states: readonly HandSpriteState[] = ['fist', 'point', 'peace', 'open', 'side-open']

const outer = new Texture('hands-outer-mask.png')
const inner = new Texture('hands-inner-mask.png')
equal(outer.width, HAND_SPRITE_ATLAS_WIDTH, 'outer texture should expose the complete atlas width')
equal(outer.height, HAND_SPRITE_ATLAS_HEIGHT, 'outer texture should expose the complete atlas height')
equal(inner.width, HAND_SPRITE_ATLAS_WIDTH, 'inner texture should match outer atlas width')
equal(inner.height, HAND_SPRITE_ATLAS_HEIGHT, 'inner texture should match outer atlas height')
equal(
  outer.width,
  HAND_SPRITE_CELL_SIZE * directions.length,
  'the atlas should contain one fixed-size column for every authored direction',
)
equal(
  outer.height,
  HAND_SPRITE_CELL_SIZE * states.length * 2,
  'the atlas should contain every state for both handedness rows',
)

for (let index = 0; index < directions.length; index++) {
  equal(handSpriteColumn(directions[index]), index, `${directions[index]} should map to atlas column ${index}`)
  equal(
    handDirectionFromRotationUnits(index * (HAND_ROTATION_UNITS_PER_TURN / directions.length)),
    directions[index],
    `${directions[index]} rotation should resolve to the same authored direction`,
  )
}

equal(handRotationUnits(Math.PI * 2), HAND_ROTATION_UNITS_PER_TURN, 'one turn should use fixed-point units')
equal(handSpriteColumnFromRotationUnits(handRotationUnits(-Math.PI / 4)), 7, 'negative rotations should wrap')
const halfDirectionUnits = HAND_ROTATION_UNITS_PER_TURN / (directions.length * 2)
equal(
  handSpriteColumnFromRotationUnits(halfDirectionUnits - 1),
  0,
  'a direction should remain stable before its half-sector boundary',
)
equal(
  handSpriteColumnFromRotationUnits(halfDirectionUnits),
  1,
  'a half-sector boundary should select the clockwise sprite',
)
equal(
  nearestHandRotationUnits(7168, Math.PI / 4),
  9216,
  'up-left to up-right should cross zero by the shortest clockwise path',
)
equal(
  nearestHandRotationUnits(1024, (Math.PI * 7) / 4),
  -1024,
  'up-right to up-left should cross zero by the shortest counter-clockwise path',
)

for (let index = 0; index < states.length; index++) {
  equal(handSpriteRow('right', states[index]), index, `right ${states[index]} should use the upper atlas rows`)
  equal(
    handSpriteRow('left', states[index]),
    index + states.length,
    `left ${states[index]} should use the lower atlas rows`,
  )
}

assert(outer !== inner, 'primary and secondary layers should use separate textures')
trace('ok\n')
