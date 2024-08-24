import config from 'mc/config'
import { ChatGPTDialogue } from 'dialogue-chatgpt'

const token = config.token

if (!token || token == 'YOUR_API_KEY_HERE') throw new Error('API token is missing.')

const dialogue = new ChatGPTDialogue({
  apiKey: token,
})

try {
  const result = await dialogue.post('こんにちは')
  if (result.success == true) {
    trace(result.value)
  } else {
    trace('Error: ' + result.reason)
  }
} catch (error) {
  trace('An error occurred: ' + error.message)
}
