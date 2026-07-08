import { GeminiDialogue } from 'dialogue-gemini'
import config from 'mc/config'

const token = config.token ?? 'test-token'

const dialogue = new GeminiDialogue({
  apiKey: token,
})
dialogue.clear()
trace('ok\n')
