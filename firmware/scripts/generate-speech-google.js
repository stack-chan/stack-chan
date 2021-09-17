// Imports the Google Cloud client library
import textToSpeech from '@google-cloud/text-to-speech'
import fs from 'fs'
import util from 'util'
import speeches from '../stackchan/assets/sounds/speeches_ja.js'
import shiftPitch from './pitch-shift.js'
import wae from 'web-audio-engine'

const AudioContext = wae.RenderingAudioContext

// Import other required libraries
// Creates a client
const client = new textToSpeech.TextToSpeechClient()
async function quickStart() {
  const tmpPath = '/tmp/audio.wav'
  // The text to synthesize
  for (let [key, voice] of Object.entries(speeches.speeches)) {
    const text = voice
    const filePath = `./stackchan/assets/sounds/${key}.wav`

    // Construct the request
    const request = {
      input: { text: text },
      // Select the language and SSML voice gender (optional)
      voice: {
        languageCode: 'ja-JP',
        name: 'ja-JP-Wavenet-A',
        ssmlGender: 'NEUTRAL',
      },
      // select the type of audio encoding
      audioConfig: { audioEncoding: 'LINEAR16', pitch: 2.0, speakingRate: 1.5 },
    }
    console.log(`POSTING: ${JSON.stringify(request)}`)

    // Performs the text-to-speech request
    const [response] = await client.synthesizeSpeech(request)
    // Write the binary audio content to a local file
    const writeFile = util.promisify(fs.writeFile)
    await writeFile(tmpPath, response.audioContent, 'binary')
    //   console.log("Audio content written to file: output.mp3");
    const context = new AudioContext()
    // TODO: stop using tmp file and use wav data directly
    const audioData = fs.readFileSync(tmpPath)
    /* postprocess */
    // TODO: integrate with coqui-tts version
    const audioBuffer = await context.decodeAudioData(audioData)
    shiftPitch(audioBuffer, speeches.shift)
    const source = context.createBufferSource()
    source.buffer = audioBuffer
    let ended = false
    source.onended = () => {
      ended = true
      console.log('ended')
    }
    source.connect(context.destination)
    source.start()
    const tick = 0.1
    let currentTime = 0
    while (!ended) {
      context.processTo(currentTime)
      currentTime = currentTime + tick
    }
    const exporting = context.exportAsAudioData()
    const encoded = await context.encodeAudioData(exporting)
    fs.writeFileSync(filePath, Buffer.from(encoded))
  }
}
quickStart()
