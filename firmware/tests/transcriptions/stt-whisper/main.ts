import config from 'mc/config'
import Microphone from 'microphone'
import STT from 'stt-whisper'

const token = config.token

if (!token || token === 'YOUR_API_KEY_HERE') throw new Error('API token is missing.')

const microphone = new Microphone()
const stt = new STT({
  apiKey: token,
})

try {
  const audio = await microphone.record()
  const result = await stt.transcribe(audio)
  if (result.success === true) {
    trace(result.value)
  } else {
    trace(`Error: ${result.reason}`)
  }
} catch (error) {
  trace(`An error occurred: ${error.message}`)
}
