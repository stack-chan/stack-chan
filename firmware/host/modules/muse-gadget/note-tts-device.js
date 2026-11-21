import Decoder from 'esp32-mp3-decoder'
import { scan } from 'mp3-frames'
import { id3Size } from 'mp3-metadata'
import { createMuseNotePlayer } from 'muse-note-tts-player'
import resample from 'pcm-resampler'
import { createPcmSource } from 'stackchan/voice/media'

export default createMuseNotePlayer({ Decoder, scan, id3Size, resample, createPcmSource })
