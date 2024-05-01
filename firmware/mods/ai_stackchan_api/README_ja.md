# AI Stack-chan API
[@robo8080](https://github.com/robo8080) さんらが公開しているAIｽﾀｯｸﾁｬﾝが備えている、チャットや発話ができるWeb APIを実装したModです。[ｽﾀｯｸﾁｬﾝCONNECT](https://notes.yh1224.com/stackchan-connect/)等のアプリからWeb APIを使用できます。

## 動作確認済みデバイス
- M5Stack Core2

## 使い方
### 1. manifest_local.json の設定
#### 1.1. ChatGPTの設定
"config"の設定として、ChatGPTの設定"ai"を記述する。 
```
    "config": {
        ～省略～
        "ai": {
            "token": "YOUR_API_KEY"
        },
        ～省略～
    }
```

#### 1.2. Text to Speechの設定
"config"の設定として、Text to Speechの設定"tts"を記述する。 

■ Web版VOICEVOXを使用する場合    
```
    "config": {
        ～省略～
        "tts": {
            "type": "voicevox-web",
            "token": "YOUR_API_KEY",
            "speakerId": 1
        },
        ～省略～
    }
```
※現状、Web版VOICEVOXを使用すると音声再生開始までに30秒程度かかります。他のプラットフォームでは数秒で応答するため、原因調査中です。  
※Web版VOICEVOXのAPIキーは空白でも使用できますが、音声合成が遅くなり声が途切れ途切れになる可能性があります。APIキーの取得方法はこちらのページ ([TTS QUEST V3 VOICEVOX API](https://github.com/ts-klassen/ttsQuestV3Voicevox/)) の下の方に解説があります。

■ Elevenlabsを使用する場合    
```
    "config": {
        ～省略～
        "tts": {
            "type": "elevenlabs",
            "token": "YOUR_API_KEY",
            "model": "eleven_monolingual_v1"
        },
        ～省略～
    }
```
※現状、Elevenlabsを使用すると音声が途切れ途切れになる事象が発生しています ([issue#214](https://github.com/meganetaaan/stack-chan/issues/214) )。  
※日本語対応にする場合は"model"を"eleven_multilingual_v2"にしてください。

### 2. ビルド、書き込み
次の手順でModを書き込みます。--targetは使用するデバイスを指定してください。
```
cd (YOUR_WORKING_DIRECTORY)/stack-chan/firmware
npm run build --target=esp32/m5stack_core2 ssid=YOUR_WIFI_SSID password=YOUR_WIFI_PASSWORD
npm run deploy --target=esp32/m5stack_core2
npm run mod --target=esp32/m5stack_core2 ./mods/ai_stackchan_api/manifest.json
```

## Web API一覧

|API|説明|使用例|
|---|---|---|
|/chat|話しかける |http://xxx.xxx.xxx.xxx/chat?text=こんにちは|
|/speech|TTSで直接しゃべらす |http://xxx.xxx.xxx.xxx/speech?voice=2&expression=1&say=私の名前はｽﾀｯｸﾁｬﾝです|
|/face|表情を切り替える|http://xxx.xxx.xxx.xxx/face?expression=1|
