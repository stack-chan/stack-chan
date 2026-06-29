# Chat tests

Chat 機能の検証用テストは、対象 module または MOD の近くに配置する。

## 実行方法

```sh
source /home/sskw/.local/share/xs-dev-export.sh
mcconfig -m -d -p lin/m5stack -t run ./host/modules/conversation/__tests__/chat-service/manifest.test.json
mcconfig -m -d -p lin/m5stack -t run ./host/modules/ui/components/status-bar/__tests__/chat-status-bar/manifest.test.json
mcconfig -m -d -p lin/m5stack -t run ./host/modules/ui/components/bubble/__tests__/speech-balloon/manifest.test.json
mcconfig -m -d -p lin/m5stack -t run ./mods/chat_audioio/__tests__/chat-audioio-config/manifest.test.json
```

## テスト一覧

- `chat-service`: ChatService と ChatAudioIO の橋渡し、tools 変換の検証
- `chat-status-bar`: AppBar 状態表示の切替と入力ゲイン反映
- `chat-balloon`: SpeechBalloon の生成/更新が成立することの確認
- `chat-audioio-config`: `config.chat.type` のガードが不正値を弾くことを確認

## 備考

ChatService のテストは `ChatAudioIO` を `host/modules/testing/fakes/ChatAudioIO.js` に差し替えて実行する。

このテスト群は実機とネットワークに依存しない。
