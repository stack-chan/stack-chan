# Camera Hub Commands MOD

プライベート監視カメラhubのprotocol 1コマンドをｽﾀｯｸﾁｬﾝの公開capabilityへ変換するサンプルMODです。

- `tts.speak`を`context.audio.say()`で実行します。
- `panTilt.move`の度数をbody poseのラジアンへ変換し、`context.motion.setPose()`で実行します。
- 成功・入力エラー・TTS providerエラーを`command.ack`として返します。
- 現在のbody positionとrollは維持します。

Camera Hub固有のprotocol解釈はhostへ追加しません。Tailnetの開始、MagicDNS名前解決、WebSocketの接続と再接続は、今後`context.connectivity`配下で`moddable-tailscale`をラップする汎用transportとして実装します。このMODは、そのtransportから受け取ったJSONを`executeCameraHubCommand()`へ渡し、戻り値をWebSocketへ送るアプリケーション層です。

## ビルド

標準hostを書き込んだCoreS3向けのMOD archiveを作成します。

```console
cd firmware
npm run mod:build -- m5stackchan_cores3 ./mods/examples/camera_hub_commands/manifest.json
```

transportがhostへ追加された後は、同じmanifestを`mod:m5stackchan_cores3`へ渡して書き込めます。

```console
npm run mod:m5stackchan_cores3 -- ./mods/examples/camera_hub_commands/manifest.json
```

現時点ではcommand handlerだけを実装しており、単体でhubへ接続はしません。認証keyやhub URLをMODへ埋め込まないことで、Tailnet接続設定とアプリケーション固有のcommand protocolを分離しています。
