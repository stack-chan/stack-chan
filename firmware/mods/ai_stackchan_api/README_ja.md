# AI Stack-chan API
[@robo8080](https://github.com/robo8080) さんらが公開しているAIｽﾀｯｸﾁｬﾝが備えている、チャットや発話ができるWeb APIを実装したModです。[ｽﾀｯｸﾁｬﾝCONNECT](https://notes.yh1224.com/stackchan-connect/)等のアプリからWeb APIを使用できます。

## 使い方
M5Stack Core2で、TTSはWeb版VOICEVOX ([TTS QUEST V3 VOICEVOX API](https://github.com/ts-klassen/ttsQuestV3Voicevox/)) を使用する例で使い方を説明します。

### 1. manifest_local.json の設定
Web版VOICEVOXの設定"tts"と、ChatGPTの設定"ai"を記述する。  
※Web版VOICEVOXのAPIキーは空白でも使用できますが、音声合成が遅くなり声が途切れ途切れになる可能性があります。APIキーの取得方法はこちらのページ ([TTS QUEST V3 VOICEVOX API](https://github.com/ts-klassen/ttsQuestV3Voicevox/)) の下の方に解説があります。
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
スピーカー出力のサンプルレートなどを記述する。
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

