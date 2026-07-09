import { SCServoDriver } from 'scservo-driver'
import { registerMotionDriverFactory } from 'stackchan-factory-registry'

registerMotionDriverFactory(
  'scservo',
  (param) => new SCServoDriver(param as ConstructorParameters<typeof SCServoDriver>[0]),
)
