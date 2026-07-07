import { registerTTSFactory } from 'stackchan-factory-registry'
import { TTS } from 'tts-voicevox-web'

registerTTSFactory('voicevox-web', (param) => new TTS(param as ConstructorParameters<typeof TTS>[0]))
