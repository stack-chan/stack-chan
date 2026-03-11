import { StartupScreen } from 'startup-screen'
import Timer from 'timer'

const startupScreen = new StartupScreen({
  onOpenSetup: () => {
    startupScreen.setStatus('Setup screen request captured (test)')
    trace('[startup-test] setup screen requested\n')
  },
})
const messages = [
  'Preparing startup...',
  'Checking Wi-Fi settings...',
  'Connecting to Wi-Fi...',
  'Wi-Fi connected',
  'Loading mod...',
  'Running launch hooks...',
  'Initializing robot...',
  'Starting robot callbacks...',
  'Startup complete',
]

let index = 0
startupScreen.setStatus(messages[index])

Timer.repeat(() => {
  if (startupScreen.isSetupRequested()) {
    return
  }
  index += 1
  if (index >= messages.length) {
    startupScreen.showError(new Error('Sample startup error'))
    index = -1
    return
  }
  startupScreen.setStatus(messages[index])
}, 900)
