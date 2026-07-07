import { registerTTSFactory } from 'stackchan-factory-registry'
import { TTS } from 'tts-openai'

registerTTSFactory('openai', (param) => new TTS(param as ConstructorParameters<typeof TTS>[0]))
