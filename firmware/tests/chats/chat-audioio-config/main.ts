import config from 'mc/config'
import { equal } from 'mocks/assert'
import { onRobotCreated } from '../../../mods/chat_audioio/mod.js'

trace('=== chat-audioio-config test ===\n')

type MutableConfig = {
  chat?: unknown
}

type StubRobot = {
  renderer: {
    setFace: () => void
    application: {
      addDrawerButton: () => void
      distribute: (_event: string, _payload: unknown) => void
    }
  }
  application: {
    addDrawerButton: () => void
  }
}

function createStubRobot() {
  const calls = {
    setFace: 0,
    addDrawerButton: 0,
  }
  const application = {
    addDrawerButton: () => {
      calls.addDrawerButton += 1
    },
    distribute: () => {},
  }
  const robot: StubRobot = {
    renderer: {
      setFace: () => {
        calls.setFace += 1
      },
      application,
    },
    application,
  }
  return { calls, robot }
}

const mutableConfig = config as MutableConfig
const originalChat = mutableConfig.chat

mutableConfig.chat = { type: { invalid: true } }
let test = createStubRobot()
onRobotCreated(test.robot)
equal(test.calls.setFace, 0, 'non-string chat type should not initialize the face')
equal(test.calls.addDrawerButton, 0, 'non-string chat type should not add drawer buttons')

mutableConfig.chat = { type: '' }
test = createStubRobot()
onRobotCreated(test.robot)
equal(test.calls.setFace, 0, 'empty chat type should not initialize the face')
equal(test.calls.addDrawerButton, 0, 'empty chat type should not add drawer buttons')

mutableConfig.chat = originalChat

trace('ok\n')
