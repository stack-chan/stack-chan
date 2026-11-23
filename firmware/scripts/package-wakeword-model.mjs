// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const componentVersion = '2.4.7'
const modelName = 'wn9l_histackchan_tts3'
const modelFile = 'stackchan-wakenet-v247.bin'
const noticeFile = 'esp-sr-2.4.7-LICENSE.txt'
const output = fileURLToPath(new URL('../dist/wakeword-model/', import.meta.url))
const modelSha256 = '3f4c14a5f1cda06cba9d1983dfa37a8cd0de768a9d0082d2b07aa2a2a45f705b'

const hashes = {
  'idf_component.yml': '17bd7ae6e93d3144f1d716f1369c846f42a7ea247765abf375463b6ca8661dd6',
  LICENSE: '7d916fb00bc0742c47cafb0d0144b67f826d76779730b1cb8796045ea6ba1b9a',
  wn9_index: '1eedc9ede6a99e279f7a0e77fb9f4a8f1fee366a21fa082d0a09515f9076df34',
  wn9_data: 'bf982eb08ae778b53183ff4fe6f9ed5a4df5d4b5d21600ed4a879048bf1493fe',
  _MODEL_INFO_: '6fdf1352ff1887f86d678f5569756787a6a97454a0e42fcd86572f9392825ef7',
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

async function pinnedFile(directory, name) {
  const data = await readFile(path.join(directory, name))
  if (sha256(data) !== hashes[name]) throw new Error(`Unexpected ESP-SR ${componentVersion} ${name} checksum`)
  return data
}

export async function packageWakeWordModel(component) {
  await pinnedFile(component, 'idf_component.yml')
  const notice = await pinnedFile(component, 'LICENSE')
  const modelDirectory = path.join(component, 'model', 'wakenet_model', modelName)
  // Match vendor pack_model.py's format, but order index + data before the
  // text so both coefficient files start at 16-byte-aligned offsets.
  const names = ['wn9_index', 'wn9_data', '_MODEL_INFO_']
  const contents = await Promise.all(names.map((name) => pinnedFile(modelDirectory, name)))
  const header = Buffer.alloc(4 + 36 + names.length * 40)
  header.writeUInt32LE(1, 0)
  header.write(modelName, 4, 32, 'ascii')
  header.writeUInt32LE(names.length, 36)
  let offset = header.length
  for (let i = 0; i < names.length; i++) {
    const field = 40 + i * 40
    header.write(names[i], field, 32, 'ascii')
    header.writeUInt32LE(offset, field + 32)
    header.writeUInt32LE(contents[i].length, field + 36)
    offset += contents[i].length
  }
  const model = Buffer.concat([header, ...contents])
  if (sha256(model) !== modelSha256) throw new Error('Unexpected packed WakeNet model checksum')
  return { model, notice }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    console.error('Usage: node scripts/package-wakeword-model.mjs <local espressif/esp-sr 2.4.7 component directory>')
    process.exitCode = 1
  } else {
    try {
      const { model, notice } = await packageWakeWordModel(process.argv[2])
      await mkdir(output, { recursive: true })
      await Promise.all([
        writeFile(path.join(output, modelFile), model),
        writeFile(path.join(output, noticeFile), notice),
      ])
      console.log(`WakeNet ${modelName}: ${model.length} bytes, sha256 ${modelSha256}`)
    } catch (error) {
      console.error(error.message)
      process.exitCode = 1
    }
  }
}
