/**
 * M5Stack CoreS3 ES7210 Codec Initialization
 * Initializes the ES7210 dual-microphone codec via I2C
 * This module is preloaded on CoreS3 to initialize the codec before microphone use
 */

import I2C from 'embedded:io/I2C'
import Timer from 'timer'

const ES7210_I2C_ADDR = 0x40
const I2C_SDA_PIN = 2
const I2C_SCL_PIN = 1

// ES7210 register initialization sequence from M5Unified
const ES7210_INIT_SEQUENCE = [
  [0x00, 0x41], // RESET_CTL
  [0x01, 0x1f], // CLK_ON_OFF
  [0x06, 0x00], // DIGITAL_PDN
  [0x07, 0x20], // ADC_OSR
  [0x08, 0x10], // MODE_CFG
  [0x09, 0x30], // TCT0_CHPINI
  [0x0a, 0x30], // TCT1_CHPINI
  [0x20, 0x0a], // ADC34_HPF2
  [0x21, 0x2a], // ADC34_HPF1
  [0x22, 0x0a], // ADC12_HPF2
  [0x23, 0x2a], // ADC12_HPF1
  [0x02, 0xc1],
  [0x04, 0x01],
  [0x05, 0x00],
  [0x11, 0x60],
  [0x40, 0x42], // ANALOG_SYS
  [0x41, 0x70], // MICBIAS12
  [0x42, 0x70], // MICBIAS34
  [0x43, 0x1b], // MIC1_GAIN
  [0x44, 0x1b], // MIC2_GAIN
  [0x45, 0x00], // MIC3_GAIN
  [0x46, 0x00], // MIC4_GAIN
  [0x47, 0x00], // MIC1_LP
  [0x48, 0x00], // MIC2_LP
  [0x49, 0x00], // MIC3_LP
  [0x4a, 0x00], // MIC4_LP
  [0x4b, 0x00], // MIC12_PDN
  [0x4c, 0xff], // MIC34_PDN
  [0x01, 0x14], // CLK_ON_OFF
]

// Initialize ES7210 codec on module load (runs once when preloaded)
try {
  // Initialize I2C
  const i2c = new I2C({
    sda: I2C_SDA_PIN,
    scl: I2C_SCL_PIN,
    hz: 400000,
    address: ES7210_I2C_ADDR,
  })

  // Reset ES7210
  i2c.write(Uint8Array.of(0x00, 0xff))

  // Wait for reset to complete using a timer
  Timer.set(() => {
    try {
      // Write initialization sequence
      for (const [reg, value] of ES7210_INIT_SEQUENCE) {
        i2c.write(Uint8Array.of(reg, value))
      }
      i2c.close()
      trace('ES7210 codec initialized successfully for CoreS3 microphone\n')
    } catch (error) {
      trace(`Failed to initialize ES7210 registers: ${error}\n`)
    }
  }, 10)
} catch (error) {
  trace(`Failed to initialize ES7210 codec: ${error}\n`)
}

// Export empty object to satisfy module system
export default {}
