# AI Stack-chan API
[@robo8080](https://github.com/robo8080) さんらが公開しているAIｽﾀｯｸﾁｬﾝが備えている、チャットや発話ができるWeb APIを実装したModです。[ｽﾀｯｸﾁｬﾝCONNECT](https://notes.yh1224.com/stackchan-connect/)等のアプリからWeb APIを使用できます。

## 使い方
M5Stack Core2の場合は次の手順です。

### 1. manifest_local.json の設定
Web版VoiceVoxの設定"tts"とChatGPTの設定"ai"を記述する。
```
    "config": {
        "tts": {
            "type": "voicevox-web",
            "host": "api.tts.quest",
            "port": "443",
            "token": "YOUR_API_KEY"
        },
        "driver": {
            "type": "scservo"
        },
        "ai": {
            "token": "YOUR_API_KEY"
        }
    }
```

### 2. speeches/manifest_wavstream.json の設定
```
	"platforms": {
		"esp32/m5stack_core2": {
			"defines": {
				"audioOut": {
					"bitsPerSample": 16,
					"numChannels": 1,
					"sampleRate": 22050 
				}
			}
		}
    }
```

### 3. ビルド、書き込み
```
cd (YOUR_WORKING_DIRECTORY)/stack-chan/firmware
npm run build --target=esp32/m5stack_core2 ssid=YOUR_WIFI_SSID password=YOUR_WIFI_PASSWORD
npm run deploy --target=esp32/m5stack_core2
npm run mod --target=esp32/m5stack_core2 ./mods/ai_stackchan_api/manifest.json
```

