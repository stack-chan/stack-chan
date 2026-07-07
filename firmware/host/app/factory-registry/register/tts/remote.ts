import { registerTTSFactory } from 'stackchan-factory-registry'
import { TTS } from 'tts-remote'

registerTTSFactory('remote', (param) => new TTS(param as ConstructorParameters<typeof TTS>[0]))
