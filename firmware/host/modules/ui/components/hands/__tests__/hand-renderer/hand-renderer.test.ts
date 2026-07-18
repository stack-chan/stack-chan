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

equal(HAND_SPRITE_CELL_SIZE, 96, 'hand sprites should use fixed-size cells')
equal(HAND_SPRITE_ATLAS_WIDTH, 768, 'hand sprite atlas should contain eight columns')
equal(HAND_SPRITE_ATLAS_HEIGHT, 960, 'hand sprite atlas should contain ten rows')

const outer = new Texture('hands-outer-mask.png')
const inner = new Texture('hands-inner-mask.png')
equal(outer.width, HAND_SPRITE_ATLAS_WIDTH, 'outer texture should expose the complete atlas width')
equal(outer.height, HAND_SPRITE_ATLAS_HEIGHT, 'outer texture should expose the complete atlas height')
equal(inner.width, HAND_SPRITE_ATLAS_WIDTH, 'inner texture should match outer atlas width')
equal(inner.height, HAND_SPRITE_ATLAS_HEIGHT, 'inner texture should match outer atlas height')

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
for (let index = 0; index < directions.length; index++) {
  equal(handSpriteColumn(directions[index]), index, `${directions[index]} should map to atlas column ${index}`)
  equal(
    handDirectionFromRotationUnits(index * (HAND_ROTATION_UNITS_PER_TURN / 8)),
    directions[index],
    `${directions[index]} rotation should resolve to the same authored direction`,
  )
}

equal(handRotationUnits(Math.PI * 2), HAND_ROTATION_UNITS_PER_TURN, 'one turn should use fixed-point units')
equal(handSpriteColumnFromRotationUnits(handRotationUnits(-Math.PI / 4)), 7, 'negative rotations should wrap')
equal(handSpriteColumnFromRotationUnits(511), 0, 'a direction should remain stable before its half-sector boundary')
equal(handSpriteColumnFromRotationUnits(512), 1, 'a half-sector boundary should select the clockwise sprite')
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

const states: readonly HandSpriteState[] = ['fist', 'point', 'peace', 'open', 'side-open']
for (let index = 0; index < states.length; index++) {
  equal(handSpriteRow('right', states[index]), index, `right ${states[index]} should use the upper atlas rows`)
  equal(handSpriteRow('left', states[index]), index + 5, `left ${states[index]} should use the lower atlas rows`)
}

assert(outer !== inner, 'primary and secondary layers should use separate textures')
trace('ok\n')
