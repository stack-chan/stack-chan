import { M5StackChanServoDriver } from 'm5stackchan-servo-driver'
import { registerMotionDriverFactory } from 'stackchan-factory-registry'

registerMotionDriverFactory(
  'm5stackchan',
  (param) => new M5StackChanServoDriver(param as ConstructorParameters<typeof M5StackChanServoDriver>[0]),
)
