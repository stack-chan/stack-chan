# Stack-chan Preferences Reference

[日本語](./preferences_ja.md)

This document describes the preference keys used by Stack-chan firmware and mods.

## Priority of values

The final runtime values are resolved in the following order:

1. Preference (NVS, written from Web/BLE or `Preference.set`)
2. `mod/config` in MOD
3. `config` in host manifest

## Editing from Web app

Use [web/preference](https://stack-chan.github.io/stack-chan/web/preference/) to write preferences over BLE.

- Only non-empty form fields are sent.
- Existing values are overwritten only for keys included in the request.
- Written values are erased if flash is erased.

## Keys

### Wi-Fi

| Key | Type | Description | Example |
| --- | --- | --- | --- |
| `wifi.ssid` | `string` | SSID for Wi-Fi connection | `MyHomeWiFi` |
| `wifi.password` | `string` | Password for Wi-Fi connection | `secret1234` |

### Renderer

| Key | Type | Description | Example |
| --- | --- | --- | --- |
| `renderer.type` | `string` | Face renderer type | `simple`, `dog`, `small-face` |

### Driver

| Key | Type | Description | Example |
| --- | --- | --- | --- |
| `driver.type` | `string` | Servo driver type | `scservo`, `dynamixel`, `rs30x`, `pwm`, `none` |
| `driver.panId` | `number` | Pan-axis serial servo ID | `1` |
| `driver.tiltId` | `number` | Tilt-axis serial servo ID | `2` |
| `driver.pwmPan` | `number` | PWM pin for pan-axis servo (PWM driver) | `5` |
| `driver.pwmTilt` | `number` | PWM pin for tilt-axis servo (PWM driver) | `2` |
| `driver.baud` | `number` | Dynamixel baud rate | `1000000` |
| `driver.baudrate` | `number` | Legacy key for `driver.baud` | `1000000` |
| `driver.offsetPan` | `number` | Pan-axis offset (degree-like value) | `0` |
| `driver.offsetTilt` | `number` | Tilt-axis offset (degree-like value) | `0` |

### TTS

| Key | Type | Description | Example |
| --- | --- | --- | --- |
| `tts.type` | `string` | TTS engine type | `local`, `remote`, `voicevox`, `voicevox-web`, `elevenlabs`, `openai` |
| `tts.host` | `string` | TTS host (`remote` / `voicevox`) | `tts.local` |
| `tts.port` | `number` | TTS port (`remote` / `voicevox`) | `50021` |
| `tts.token` | `string` | API token (`voicevox-web` / `elevenlabs` / `openai`) | `sk-...` |
| `tts.voice` | `string` | Voice id/name (`elevenlabs` / `openai`) | `alloy` |
| `tts.speakerId` | `number` | VOICEVOX speaker ID | `1` |
| `tts.model` | `string` | Model name (`elevenlabs` / `openai`) | `tts-1` |
| `tts.speed` | `number` | Speech speed (`openai`) | `1.0` |
| `tts.instructions` | `string` | Speech instruction (`openai`) | `Speak in a cheerful tone.` |
| `tts.volume` | `number` | Playback volume | `0.5` |

### AI (mods)

| Key | Type | Description | Example |
| --- | --- | --- | --- |
| `ai.token` | `string` | API token for AI mods | `sk-...` |
| `ai.context` | `string` | Prompt/context for AI mods | `You are Stack-chan...` |
