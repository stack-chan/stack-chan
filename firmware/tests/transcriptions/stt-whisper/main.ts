import config from 'mc/config'
import STT from 'stt-whisper'
import Resource from 'Resource'

const token = config.token

const audio = new Resource('speak.wav')
if (!token || token === 'YOUR_API_KEY_HERE') throw new Error('API token is missing.')

const stt = new STT({
  apiKey: token,
})

try {
  const result = await stt.transcribe(audio)
  if (result.success === true) {
    trace(result.value)
  } else {
    trace(`Error: ${result.reason}`)
  }
} catch (error) {
  trace(`An error occurred: ${error.message}`)
}
