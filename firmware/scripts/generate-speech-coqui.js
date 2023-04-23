import http from 'http'
import fs from 'fs'
import wae from 'web-audio-engine'
import shiftPitch from './pitch-shift.js'
import yargs from 'yargs/yargs'
import { hideBin } from 'yargs/helpers'
import path from 'path'

const AudioContext = wae.RenderingAudioContext
/**
 * @description download wav file from tts server
 * @param {string} url
 * @param {string} path
 * @param {object} options
 */
async function download(url, path, options) {
  return new Promise((resolve, reject) => {
//  let count = 0
    console.log(`url: ${url}`)
    http.get(url, (res) => {
      let data = []
      res.on('data',(d) => {
        data.push(d)
//      console.log(`Downloading (${count++})`)
      })
      res.on('close',() => {
        let rawData = Buffer.concat(data)
        console.log(`Downloaded`)
        const context = new AudioContext()
        context.decodeAudioData(rawData).then((audioBuffer) => {
          if (options.shift != 1){
            shiftPitch(audioBuffer, options.shift)
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
            const audioData = context.exportAsAudioData()        
            context.encodeAudioData(audioData).then((audioData) => {
              fs.writeFileSync(path, Buffer.from(audioData))
            })
          }else{
            fs.writeFileSync(path, Buffer.from(rawData))
          }
          resolve()
        })
      })
      .on('error', (e) => {
        console.log(`Got error: ${e.message}`)
        file.end()
        reject()
      })
    })
  })
}

// generate speeches
async function generate(options) {
  for (let [key, text] of Object.entries(speeches)) {
    const file = `${options.output}/${key}.wav`
    if (fs.existsSync(file)) {
      fs.unlinkSync(file, (err) => {
        if (err) {
          console.log(err)
          return
        }
      })
    }
    const url = `http://${options.host}:${options.port}/api/tts?text=${text}`
    // NOTE: need to await coz current tts-server supports one request at a time
    await download(url, file, options)
  }
}

const options = []
const argv = yargs(hideBin(process.argv)).argv
// read TTS server configuration
const manifest = JSON.parse(fs.readFileSync('./stackchan/manifest_local.json'))
const config = manifest.config
console.debug(manifest.config)
options.host = config.tts?.host
options.port = config.tts?.port
if (argv.host) options.host = argv.host
if (argv.port) options.port = argv.port
if (! options.host || ! options.port) {
  throw new Error('specify tts.host and tts.port in stackchan/manifest_local.json or --host --port options required')
}

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

generate(options)