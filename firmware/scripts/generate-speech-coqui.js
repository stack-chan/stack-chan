import http from 'http'
import fs from 'fs'
import speeches from '../stackchan/assets/sounds/speeches_ja.js'
import wae from 'web-audio-engine'
import shiftPitch from './pitch-shift.js'

const AudioContext = wae.RenderingAudioContext
// read TTS server configuration
const manifest = JSON.parse(fs.readFileSync('./stackchan/manifest_local.json'))
const config = manifest.config
console.debug(manifest.config)
const host = config.tts?.host
const port = config.tts?.port
if (host == null || port == null) {
  throw new Error('specify tts.host and tts.port in stackchan/manifest_local.json')
}

/**
 * @description download wav file from tts server
 * @param {string} url
 * @param {string} path
 */
async function download(url, path) {
  const tmpPath = '/tmp/audio.wav'
  const file = fs.createWriteStream(tmpPath)
  return new Promise((resolve, reject) => {
    let count = 0
    http
      .get(url, (res) => {
        res.on('data', (d) => {
          console.log(`Downloading ${path}(${count++})`)
          file.write(d)
        })
        res.on('close', () => {
          console.log(`Downloaded ${path}`)
          file.end()
          const context = new AudioContext()
          // TODO: stop using tmp file and use wav data directly
          const audioData = fs.readFileSync(tmpPath)
          /* postprocess */
          context.decodeAudioData(audioData).then((audioBuffer) => {
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
            const audioData = context.exportAsAudioData()
            context.encodeAudioData(audioData).then((audioData) => {
              fs.writeFileSync(path, Buffer.from(audioData))
              resolve()
            })
          })
        })
      })
      .on('error', (e) => {
        console.log(`Got error: ${e.message}`)
        file.end()
        reject()
      })
  })
}

// generate speeches
; (async function generate() {
  for (let [key, text] of Object.entries(speeches.speeches)) {
    const file = `./stackchan/assets/sounds/${key}.wav`
    if (fs.existsSync(file)) {
      fs.unlinkSync(file, (err) => {
        if (err) {
          console.log(err)
          return
        }
      })
    }
    const url = `http://${host}:${port}/api/tts?text=${text}`
    // NOTE: need to await coz current tts-server supports one request at a time
    await download(url, file)
  }
})()
