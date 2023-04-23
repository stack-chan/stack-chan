// Imports the Google Cloud client library
import textToSpeech from '@google-cloud/text-to-speech'
import fs from 'fs'
import shiftPitch from './pitch-shift.js'
import wae from 'web-audio-engine'
import yargs from 'yargs/yargs'
import { hideBin } from 'yargs/helpers'
import path from 'path'

const AudioContext = wae.RenderingAudioContext
// const LANG = "EN"
// const LANG = "JA"
const VOICE_OPTIONS = {
  EN: {
    languageCode: 'en-US',
    name: 'en-US-Wavenet-F',
    ssmlGender: 'NEUTRAL',
  },
  JA: {
    languageCode: 'ja-JP',
    name: 'ja-JP-Wavenet-A',
    ssmlGender: 'NEUTRAL',
  }
}
// Import other required libraries
// Creates a client
const client = new textToSpeech.TextToSpeechClient()
async function quickStart(options) {
  // The text to synthesize
  for (let [key, voice] of Object.entries(speeches)) {
    const text = voice
    const filePath = `${options.output}/${key}.wav`
    // Construct the request
    const request = {
      input: { text: text },
      // Select the language and SSML voice gender (optional)
      voice: VOICE_OPTIONS[options.lang],
      // select the type of audio encoding
      // audioConfig: { audioEncoding: 'LINEAR16', pitch: 2.0, speakingRate: 1.5 },
      audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 44100,speakingRate: 0, pitch: 0 }
    }
    if (options.voicename){
      request.voice.name = options.voicename
      request.voice.languageCode = options.voicename.slice(5)
    } 
    if (options.sample) request.audioConfig.sampleRateHertz = options.sample
    if (options.speed) request.audioConfig.speakingRate = options.speed
    if (options.pitch) request.audioConfig.pitch = options.pitch
    console.log(`POSTING: ${JSON.stringify(request)}`)

    // Performs the text-to-speech request
    const [response] = await client.synthesizeSpeech(request)
    const context = new AudioContext()
    /* postprocess */
    // TODO: integrate with coqui-tts version
    const audioBuffer = await context.decodeAudioData(response.audioContent)
    if (options.shift != 1){
      shiftPitch(audioBuffer, options.shift)
    }
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
const options = []
const argv = yargs(hideBin(process.argv)).argv
// API Key path  convert to absolute path
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS)
const cwd = process.cwd() // save CurrentDiredtory (firmware Directory)
process.chdir(process.env.INIT_CWD) // change CurrntDirectory to npm run was executed direcory

const input = argv.input
if (input){
  console.log('cwd   :'+process.cwd())
  console.log(`input :${input}`)
  options.input= path.resolve(input)
  if (input != options.input){
    console.log(`      (${options.input})`)
  }
} else {
  if(fs.existsSync('./speeches.js')){
    console.log('cwd   :'+process.cwd())
    console.log('input :./speeches.js')
    options.input= path.resolve('./speeches.js')
  } else {
    process.chdir(cwd) // change CurrentDirectory to saved(firmware Directory)
    console.log('cwd   :'+process.cwd())
    console.log('input :./stackchan/assets/sounds/speeches_ja.js')
    options.input= path.resolve('./stackchan/assets/sounds/speeches_ja.js')
  }
  console.log(`      (${options.input})`)
}

const output = argv.output
if (output) {
  options.output = path.resolve(output)
  console.log(`output:${output}`)
  if (output != options.output){
    console.log(`      (${options.output})`)
  }
} else {
  if (fs.existsSync(path.dirname(options.input)+'/assets')){
    console.log('output:./assets')
    options.output = path.dirname(options.input)+'/assets'
    console.log(`      (${options.output})`)
  } else {
    options.output = path.dirname(options.input)
    console.log(`output:${options.output}`)
  }
}

const { speeches,SynthProps } = await import(`file://${options.input}`)
options.shift = SynthProps?.shift ?? 1.5
if (argv.shift) options.shift = argv.shift

options.voicename = argv.voivename
options.sample = argv.sample
options.speed = argv.speed
options.pitch = argv.pitch

options.lang = "JA"
if (path.basename(options.input,".js").slice(-3) == "_en"){
  options.lang="EN"
}
if (argv.lang) options.lang = argv.lang

quickStart(options) 