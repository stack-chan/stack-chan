const http = require('http')
const fs = require('fs')

// read TTS server configuration
const manifest = JSON.parse(fs.readFileSync('./stackchan/manifest_local.json'))
const config = manifest.config
console.debug(manifest.config)
const host = config.tts?.host
const port = config.tts?.port
if (host == null || port == null) {
  console.error('specify tts.host and tts.port in stackchan/manifest_local.json')
  return -1
}

// read speech scripts
const speeches = require('../stackchan/assets/sounds/speeches.js')

/**
 * @description download wav file from tts server
 * @param {string} url
 * @param {string} path
 */
async function download(url, path) {
  return new Promise((resolve, reject) => {
    let count = 0
    http
      .get(url, (res) => {
        res.on('data', (d) => {
          // TODO: support postprocess such as pitch and speed modification
          console.log(`Generating ${path}(${count++})`)
          fs.appendFileSync(path, d)
        })
        res.on('close', () => {
          console.log(`Generated ${path}`)
          resolve()
        })
      })
      .on('error', (e) => {
        console.log(`Got error: ${e.message}`)
        reject()
      })
  })
}

// generate speeches
;(async function generate() {
  for (let { key, text } of speeches) {
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
