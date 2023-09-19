import { DynamixelDriver } from 'dynamixel-driver'

const driver = new DynamixelDriver({
  panId: 1,
  tiltId: 2,
  baud: 1_000_000,
})

driver.applyRotation({
  r: 0,
  p: 0,
  y: 0,
})
