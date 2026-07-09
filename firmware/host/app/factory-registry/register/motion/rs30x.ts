import { RS30XDriver } from 'rs30x-driver'
import { registerMotionDriverFactory } from 'stackchan-factory-registry'

registerMotionDriverFactory('rs30x', (param) => new RS30XDriver(param as ConstructorParameters<typeof RS30XDriver>[0]))
