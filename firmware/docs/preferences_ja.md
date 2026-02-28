# ｽﾀｯｸﾁｬﾝ Preference 設定リファレンス

[English](./preferences.md)

このドキュメントでは、ｽﾀｯｸﾁｬﾝのファームウェアおよび MOD で使われる Preference キーを説明します。

## 設定値の優先順

実行時に使われる最終的な値は、次の優先順で決まります。

1. Preference（NVS。Web/BLE または `Preference.set` で書き込み）
2. MOD 側の `mod/config`
3. ホスト側 manifest の `config`

## Web アプリでの設定

BLE を使って [web/preference](https://stack-chan.github.io/stack-chan/web/preference/) から設定を書き込めます。

- フォームの空欄は送信されません。
- リクエストに含まれたキーだけが上書きされます。
- フラッシュ消去を行うと、書き込んだ Preference も消去されます。

## キー一覧

### Wi-Fi

| キー | 型 | 説明 | 例 |
| --- | --- | --- | --- |
| `wifi.ssid` | `string` | Wi-Fi 接続先 SSID | `MyHomeWiFi` |
| `wifi.password` | `string` | Wi-Fi 接続パスワード | `secret1234` |

### Renderer

| キー | 型 | 説明 | 例 |
| --- | --- | --- | --- |
| `renderer.type` | `string` | 顔レンダラーの種類 | `simple`, `dog`, `small-face` |

### Driver

| キー | 型 | 説明 | 例 |
| --- | --- | --- | --- |
| `driver.type` | `string` | サーボドライバの種類 | `scservo`, `dynamixel`, `rs30x`, `pwm`, `none` |
| `driver.panId` | `number` | パン軸シリアルサーボ ID | `1` |
| `driver.tiltId` | `number` | チルト軸シリアルサーボ ID | `2` |
| `driver.pwmPan` | `number` | PWM ドライバ使用時のパン軸ピン番号 | `5` |
| `driver.pwmTilt` | `number` | PWM ドライバ使用時のチルト軸ピン番号 | `2` |
| `driver.baud` | `number` | Dynamixel のボーレート | `1000000` |
| `driver.baudrate` | `number` | `driver.baud` の後方互換キー | `1000000` |
| `driver.offsetPan` | `number` | パン軸オフセット（角度相当値） | `0` |
| `driver.offsetTilt` | `number` | チルト軸オフセット（角度相当値） | `0` |

### TTS

| キー | 型 | 説明 | 例 |
| --- | --- | --- | --- |
| `tts.type` | `string` | TTS エンジンの種類 | `local`, `remote`, `voicevox`, `voicevox-web`, `elevenlabs`, `openai` |
| `tts.host` | `string` | TTS サーバホスト（`remote` / `voicevox`） | `tts.local` |
| `tts.port` | `number` | TTS サーバポート（`remote` / `voicevox`） | `50021` |
| `tts.token` | `string` | API トークン（`voicevox-web` / `elevenlabs` / `openai`） | `sk-...` |
| `tts.voice` | `string` | 音声 ID / 名称（`elevenlabs` / `openai`） | `alloy` |
| `tts.speakerId` | `number` | VOICEVOX の speaker ID | `1` |
| `tts.model` | `string` | モデル名（`elevenlabs` / `openai`） | `tts-1` |
| `tts.speed` | `number` | 話速（`openai`） | `1.0` |
| `tts.instructions` | `string` | 音声生成時の指示（`openai`） | `Speak in a cheerful tone.` |
| `tts.volume` | `number` | 再生音量 | `0.5` |

### AI（mods）

| キー | 型 | 説明 | 例 |
| --- | --- | --- | --- |
| `ai.token` | `string` | AI 系 MOD 用 API トークン | `sk-...` |
| `ai.context` | `string` | AI 系 MOD 用コンテキスト | `You are Stack-chan...` |
