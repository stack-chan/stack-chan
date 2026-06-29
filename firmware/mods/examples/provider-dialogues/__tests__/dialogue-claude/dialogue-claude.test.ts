import { ClaudeDialogue } from 'dialogue-claude'
import config from 'mc/config'

const token = config.token ?? 'test-token'

const dialogue = new ClaudeDialogue({
  apiKey: token,
})
dialogue.clear()
trace('ok\n')
