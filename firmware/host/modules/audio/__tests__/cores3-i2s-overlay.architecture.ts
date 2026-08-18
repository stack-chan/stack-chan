import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('CoreS3 AudioOut overlay uses the manifest I2S port and IDF slot macros', () => {
  const source = readFileSync('host/modules/audio/platforms/m5stackchan-cores3/io-audioout/audioout-esp32.c', 'utf8')

  assert.match(source, /I2S_CHANNEL_DEFAULT_CONFIG\(MODDEF_AUDIOOUT_I2S_NUM/)
  assert.doesNotMatch(source, /I2S_CHANNEL_DEFAULT_CONFIG\(I2S_NUM_AUTO/)
  assert.match(source, /I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG/)
  assert.match(source, /I2S_STD_MSB_SLOT_DEFAULT_CONFIG/)
})

test('CoreS3 AudioIn overlay creates the RX channel without enabling it', () => {
  const source = readFileSync('host/modules/audio/platforms/m5stackchan-cores3/io-audioin/audioin.c', 'utf8')

  assert.match(source, /audioInOpenStdChannel/)
  assert.match(source, /Leave the RX channel in READY until start/)
  assert.doesNotMatch(
    source,
    /err = i2s_channel_enable\(input->handle\);\s*\n\s*if \(err\) \{\s*\n\s*i2s_del_channel\(input->handle\);\s*\n\s*input->handle = C_NULL;/,
  )
})

test('CoreS3 AudioOut define drops speaker MCLK and selects Philips I2S on I2S1', () => {
  const manifest = JSON.parse(readFileSync('host/modules/audio/manifest.json', 'utf8')) as {
    platforms: Record<string, { defines?: { audioOut?: { i2s?: Record<string, unknown> } } }>
  }
  const i2s = manifest.platforms['esp32/m5stackchan_cores3'].defines?.audioOut?.i2s

  assert.equal(i2s?.num, 1)
  assert.equal(i2s?.format_i2s, 1)
  assert.equal(i2s?.mck_pin, -1)
  assert.equal(i2s?.bck_pin, 34)
  assert.equal(i2s?.lr_pin, 33)
  assert.equal(i2s?.dataout_pin, 13)
})
