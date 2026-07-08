import config from 'mc/config'
import STT from 'stt-whisper'

const token = config.token ?? 'test-token'
const stt = new STT({
  apiKey: token,
})
void stt
trace('ok\n')
