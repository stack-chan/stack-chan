import { registerTTSFactory } from 'stackchan-factory-registry'
import { TTS } from 'tts-voicevox'

registerTTSFactory('voicevox', (param) => new TTS(param as ConstructorParameters<typeof TTS>[0]))
