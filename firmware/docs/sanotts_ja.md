# CoreS3 で sanoTTS-jp を使う

M5StackChan CoreS3 の 16 MiB フラッシュに専用ホストと日本語音声モデルをインストールします。標準ホストとは別にビルドでき、発話時のネットワーク接続は不要です。

モデルには sanoTTS-jp Model License 1.0 が適用されます。取得する前に、帰属表示、再配布条件、生成音声の用途制限を確認してください。本ソフトウェアの音声合成には、フリー素材キャラクター「つくよみちゃん」（© 夢前黎）が無料公開している音声データを使用しています。帰属表示の全文と各素材の権利表記は [LICENSE-MODEL.md](../vendor/sanotts-jp/LICENSE-MODEL.md) と [NOTICE.md](../vendor/sanotts-jp/NOTICE.md) にあります。

## インストール

ファームウェアの開発環境で、次のコマンドを firmware ディレクトリから実行します。COM6 は接続した端末のポートに置き換えてください。

```sh
npm run build:sanotts
npm run fetch:sanotts-model
npm run flash:sanotts -- --port COM6
npm run model:flash:sanotts -- --port COM6
```

取得するモデルは v1.2.0 の v4 int8 版です。取得時とインストール時に SHA-256 を照合します。ホストのビルド成果物は dist/bin/esp32/m5stackchan_cores3/release/stack-chan-sanotts、モデルは dist/models/sanotts に保存します。モデルを含む配布物には上記のライセンス、権利表記、[Apache License 2.0](../vendor/sanotts-jp/LICENSE-APACHE-2.0.txt) を添付してください。

専用ホストは標準レイアウトのアプリ領域の末尾 704 KiB をモデル領域に割り当てます。標準の NVS、MOD、ストレージは同じ位置と容量を使います。モデルのインストーラーは端末上の区画表を確認し、専用領域に書き込んだデータの照合後にヘッダーを確定します。標準ホストに戻すには `npm run deploy:m5stackchan_cores3 -- --port COM6` を実行してください。 この変更を含む標準ホストは、保存済みの `tts.type = sanotts` を保持したまま、読み上げと ai_stackchan の会話出力に内製の StackchanVoice を使います。以前の標準ホストに戻す場合は、書き込み前に `tts.type` を `stackchan-voice` に戻してください。
