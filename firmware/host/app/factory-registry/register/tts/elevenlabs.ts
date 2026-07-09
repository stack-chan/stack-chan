import { registerTTSFactory } from 'stackchan-factory-registry'
import { TTS } from 'tts-elevenlabs'

registerTTSFactory('elevenlabs', (param) => new TTS(param as ConstructorParameters<typeof TTS>[0]))
