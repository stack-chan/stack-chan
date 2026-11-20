import { DynamixelDriver } from 'dynamixel-driver'

if (typeof DynamixelDriver !== 'function') {
  throw new Error('DynamixelDriver should be a constructor')
}
trace('@@STACKCHAN_TEST:PASS@@\n')
