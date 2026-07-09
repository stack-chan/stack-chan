import { PWMServoDriver } from 'sg90-driver'
import { registerMotionDriverFactory } from 'stackchan-factory-registry'

registerMotionDriverFactory(
  'pwm',
  (param) => new PWMServoDriver(param as ConstructorParameters<typeof PWMServoDriver>[0]),
)
