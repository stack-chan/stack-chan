# Chat tests

Chat機能の検証用テストを `tests/chats` 配下に配置しています。

## 実行方法（シミュレータ）
```
source /home/sskw/.local/share/xs-dev-export.sh
mcconfig -m -d -p sim/m5stack -t run ./tests/chats/chat-service/manifest.json
mcconfig -m -d -p sim/m5stack -t run ./tests/chats/chat-statusbar/manifest.json
mcconfig -m -d -p sim/m5stack -t run ./tests/chats/chat-balloon/manifest.json
```

## テスト一覧
- `chat-service`: ChatService と ChatAudioIO の橋渡し、tools変換の検証（Mock ChatAudioIO）
- `chat-statusbar`: AppBar 状態表示の切替・入力ゲイン反映
- `chat-balloon`: SpeechBalloon の生成/更新が成立することの確認

## 備考
- ChatService のユニットテストは `ChatAudioIO` を `tests/chats/mocks/ChatAudioIO.js` に差し替えて実行します。
- 実機/ネットワークには依存しません。
