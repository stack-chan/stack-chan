import { PWMServoDriver } from 'sg90-driver'

const driver = new PWMServoDriver({
  pwmPan: 16,
  pwmTilt: 17,
})

void driver
trace('ok\n')
