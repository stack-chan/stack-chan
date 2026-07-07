import { NoneDriver } from 'none-driver'
import { registerMotionDriverFactory } from 'stackchan-factory-registry'

registerMotionDriverFactory('none', () => new NoneDriver())
