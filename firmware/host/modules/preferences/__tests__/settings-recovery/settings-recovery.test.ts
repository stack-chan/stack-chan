import { checkSettingsRecovery } from 'settings-recovery-cases'
import { SettingsService } from 'settings-service'
import { assert } from 'testing/assert'

const reboots = checkSettingsRecovery(SettingsService, assert)
assert(reboots > 30, 'exercise save and recovery interruption boundaries')
trace(`settings recovery: ${reboots} simulated reboots and 100 saves\n`)
trace('ok\n')
