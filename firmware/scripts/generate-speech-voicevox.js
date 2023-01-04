// Imports the Google Cloud client library
import fetch from 'node-fetch'
import { createFFmpeg } from '@ffmpeg/ffmpeg'
import yargs from 'yargs/yargs'
import { hideBin } from 'yargs/helpers'
import { writeFile } from 'fs/promises'

const ffmpeg = createFFmpeg({
  log: true
})
/**
 * get Speech data from VoiceVox server
 * @param {*} speechText 
 * @param {*} options 
 * @returns Promise<Blob>
 */
async function getSpeech(speechText, options) {
  console.log(speechText)
  if (speechText?.length == 0) {
    throw new Error("speechText required")
  }
  const host = options?.host ?? 'localhost'
  const port = options?.port ?? 50021
  const speakerId = options?.speakerId ?? 1
  return fetch(encodeURI(`http://${host}:${port}/audio_query?text=${speechText}&speaker=${speakerId}`),{
    method: 'POST',
    cache: 'no-cache',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  })
  .then(response => response.text())
  .then(text => fetch(encodeURI(`http://${host}:${port}/synthesis?speaker=${speakerId}`),
  {
    method: 'POST',
    cache: 'no-cache',
    headers: {
      'Content-Type': 'application/json'
    },
    body: text
  }))
  .then(res => 
    {
      return res.arrayBuffer()
    })
}

const TEMP_FILE = 'tmp.wav'
async function normalizeAndSave(speechData, path) {
  const sampleRate = 11025
  if (!ffmpeg.isLoaded()) {
    await ffmpeg.load()
  }
  // await writeFile(TEMP_FILE, Buffer.from(speechData))
  // ffmpeg.FS('writeFile', TEMP_FILE, fetchFile(`/tmp/ffmpeg/${TEMP_FILE}`))
  // ffmpeg.FS('writeFile', TEMP_FILE, Uint8Array.from(speechData))
  ffmpeg.FS('writeFile', TEMP_FILE, new Uint8Array(speechData))
  await ffmpeg.run('-i', TEMP_FILE, '-ar', String(sampleRate), 'result.wav')
  await writeFile(path, ffmpeg.FS('readFile', 'result.wav') )
}


async function generateSpeech(input, output) {
  // スピーチ一覧をインポートする
  const { speeches } = await import(input)
  // The text to synthesize
  for (let [key, text] of Object.entries(speeches)) {
    const speech = await getSpeech(text)
    await normalizeAndSave(speech, output + `/${key}.wav`)
  }
}

async function main() {
  const argv = yargs(hideBin(process.argv)).argv
  const cwd = process.cwd()
  const input = argv.input ?? './speeches.js'
  const output = argv.output ?? './assets/'
  await generateSpeech(cwd + '/' + input, cwd + '/' + output)
  process.exit(0)
}

main()
