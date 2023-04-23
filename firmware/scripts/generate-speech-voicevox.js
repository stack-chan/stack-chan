// Imports the Google Cloud client library
import fetch from 'node-fetch'
import yargs from 'yargs/yargs'
import fs from 'fs'
import path from 'path'
import { hideBin } from 'yargs/helpers'
import { writeFile } from 'fs/promises'
import { stringify } from 'querystring'

/**
 * get Speech data from VoiceVox server
 * @param {*} speechText 
 * @param {*} options 
 * @returns Promise<Blob>
 */
async function getSpeech(speechText, options) {
// windows resolve localhost returens IPv6 address(::1)
// but voicevox only listening IPv4 address(127.0.0.1)
//const host = options?.host ?? 'localhost'
  const host = options?.host ?? '127.0.0.1'
  const port = options?.port ?? 50021
  const speakerId = options?.speakerId ?? 1
  const speed = options?.speed ?? 1
  const pitch = options?.pitch ?? 0
  const intonation = options?.intonation ?? 1
  const sampleRate = options?.sampleRate ?? 11025
  const speakerName = await getSpeakerName(speakerId,options)
  console.log(`${speakerName}  Text:${speechText}`)
  if (speechText?.length == 0) {
    throw new Error("speechText required")
  }
  console.log(`http://${host}:${port}/audio_query?text=${speechText}&speaker=${speakerId}`)
  return fetch(encodeURI(`http://${host}:${port}/audio_query?text=${speechText}&speaker=${speakerId}`),{
    method: 'POST',
    cache: 'no-cache',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  })
  .then((response) => response.json())
  .then((json) => {
    // change voice parameter
    json.speedScale = speed
    json.pitchScale = pitch
    json.intonationScale = intonation
    json.outputSamplingRate = sampleRate
    return fetch(encodeURI(`http://${host}:${port}/synthesis?speaker=${speakerId}`),{
      method: 'POST',
      cache: 'no-cache',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(json)
    })})
  .then(res => 
    {
      return res.arrayBuffer()
    })
}

async function getSpeakerName(speakerId,options) {
  const host = options?.host ?? '127.0.0.1'
  const port = options?.port ?? 50021
  // get speaker name
  return fetch(encodeURI(`http://${host}:${port}/speakers`),{
    method: 'GET',
    cache: 'no-cache',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  })
  .then((response) => response.json())
  .then((json) => {
    let result = ''
    json.forEach(speaker => {
      speaker.styles.forEach(style=>{
        if ((typeof speakerId) == 'number' ){
          if (speakerId == style.id){
            result = `${speaker.name}(${style.name}) SpeakerId:${style.id}`
          }
        } else {
          result += `${speaker.name}(${style.name}) SpeakerId:${style.id}\n`
        }
      })   
    })
    return result ? result : 'Speaker Id Not Found'
  })
}

async function generateSpeech(options) {
  // import speechs list
  const { speeches } = await import(`file://${options.input}`)
  // The text to synthesize
  for (let [key, text] of Object.entries(speeches)) {
    const speech = await getSpeech(text,options)
    console.log(`write ${key}.wav`)
    writeFile(`${options.output}/${key}.wav`, Buffer.from(speech))
    console.log('ended')
  }
}

async function main() {
  const options = []
  const argv = yargs(hideBin(process.argv)).argv
  const cwd = process.cwd() // save CurrentDiredtory (firmware Directory)
  process.chdir(process.env.INIT_CWD) // change CurrntDirectory to npm run was executed direcory

  options.host = argv.host
  options.port = argv.port
  options.speakerId = argv.speaker
  options.sampleRate = argv.sample
  options.speed = argv.speed
  options.pitch = argv.pitch
  options.intnation = argv.intnation

  if (argv.list){
    // --list specified only show charactor lists
    console.log(await getSpeakerName(argv.list,options))
    process.exit(0)
  }

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
  await generateSpeech(options)
}

main()
