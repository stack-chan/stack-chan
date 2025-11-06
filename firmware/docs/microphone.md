# Microphone Support

Stack-chan supports audio input through I2S-connected microphones on supported hardware platforms.

## Supported Platforms

### M5Stack CoreS3

The M5Stack CoreS3 includes a built-in ES7210 dual-microphone codec that provides high-quality audio input.

#### Hardware Specifications
- **Codec**: ES7210 (dual-channel ADC)
- **Sample Rate**: 16000 Hz (configurable)
- **Bit Depth**: 16-bit
- **Channels**: Stereo (2 channels)
- **I2S Pins**:
  - Data In (SD): GPIO 46
  - Word Select (WS): GPIO 12
  - Serial Clock (SCK): GPIO 11
- **I2C Control**:
  - SDA: GPIO 2
  - SCL: GPIO 1
  - Address: 0x40

#### Automatic Initialization

The ES7210 codec is automatically initialized when using the microphone on CoreS3. The initialization includes:
- Microphone bias voltage configuration (2.87V)
- Microphone gain settings (27dB)
- High-pass filter configuration
- Clock and power management

No manual setup is required - just create a `Microphone` instance and start recording.

## Usage Example

```javascript
import Microphone from 'microphone'

const microphone = new Microphone()

// Record 3 seconds of audio
const audioBuffer = await microphone.record(3000)

// audioBuffer contains WAV format audio data
// You can save it, send it to a speech-to-text service, etc.
```

## Configuration

Microphone settings can be configured in the manifest:

```json
{
  "defines": {
    "audioIn": {
      "sampleRate": 16000,
      "bitsPerSample": 16
    }
  }
}
```

## Platform-Specific Notes

### M5Stack CoreS3

- The microphone shares the I2S bus with the speaker. Ensure the speaker is not actively playing when recording audio.
- The built-in microphones are located on the top of the device.
- For best results, speak clearly and position the device appropriately.

## Troubleshooting

### No audio captured

1. Verify that the platform supports microphone input (currently only CoreS3)
2. Check that no other device is using the I2S bus
3. Ensure the speaker is not playing during recording
4. Check trace logs for initialization errors

### Poor audio quality

1. Adjust the recording duration - longer recordings may capture more context
2. Ensure the environment is not too noisy
3. Check that the microphone openings are not blocked

## API Reference

See the [Microphone API documentation](./api.md#microphone) for detailed information on the Microphone class methods and properties.

## Related

- [Speech-to-Text (STT)](./api.md#transcriptions)
- [Text-to-Speech (TTS)](./text-to-speech.md)
