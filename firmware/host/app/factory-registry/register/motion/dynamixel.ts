import { DynamixelDriver } from 'dynamixel-driver'
import { registerMotionDriverFactory } from 'stackchan-factory-registry'

registerMotionDriverFactory(
  'dynamixel',
  (param) => new DynamixelDriver(param as ConstructorParameters<typeof DynamixelDriver>[0]),
)
